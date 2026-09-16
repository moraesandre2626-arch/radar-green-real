const http = require('http');
const cron = require('node-cron');
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const LIGAS_PERMITIDAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
const FILTROS = { max_diferenca_gols:2, min_chutes_gol_time_precisa:2, min_total_chutes_jogo:8, minuto_minimo:40, minuto_maximo:55, posse_minima_pressao:60, min_pressao_score:6 };

let ultimoScan=null, totalAprovados=0, totalEnviados=0, totalErros=0;
let relatorioDia = { data: new Date().toLocaleDateString('pt-BR'), sinais: [] };
const enviados = new Map();
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),8000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:c.signal});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally{ clearTimeout(t); }
}
function numero(v){
  const n=parseFloat(String(v??0).replace(',','.').replace('%',''));
  return Number.isFinite(n)?n:0;
}
function pegaStat(S,nomes){
  if(!Array.isArray(S)) return null;
  for(let nome of nomes){
    const s=S.find(x=>x.name?.toLowerCase()===nome.toLowerCase()||x.abbreviation?.toLowerCase()===nome.toLowerCase());
    if(s) return numero(s.displayValue??s.value??0);
  }
  return null;
}
async function buscarRaioXCompleto(liga,eventId){
  const raio={chutesCasa:0,chutesFora:0,alvoCasa:0,alvoFora:0,posseCasa:0,posseFora:0,escCasa:0,escFora:0,amarelosCasa:0,amarelosFora:0,cruzCasa:0,cruzFora:0,apCasa:null,apFora:null,temAP:false,temCruz:false};
  let finalCasa=null, finalFora=null, status=null;
  try{
    const summary=await getJson('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/summary?event='+eventId);
    const teams=summary?.boxscore?.teams||[];
    for(let i=0;i<teams.length;i++){
      const bloco=teams[i];
      const id=String(bloco?.team?.id||'');
      let lado=i===0?'home':'away';
      const comp=summary?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id);
      if(comp) lado=comp.homeAway;
      const S=bloco?.statistics||[];
      const chutes=pegaStat(S,['totalShots','shots'])??0;
      const alvo=pegaStat(S,['shotsOnTarget','shotsOnGoal'])??0;
      const posse=pegaStat(S,['possessionPct','possession'])??0;
      const esc=pegaStat(S,['wonCorners','cornerKicks'])??0;
      const amarelos=pegaStat(S,['yellowCards'])??0;
      const ap=pegaStat(S,['dangerousAttacks','dangerousAttack','attack']);
      const cruz=pegaStat(S,['crosses','totalCrosses','totalCross','cross']);
      if(lado==='home'){
        raio.chutesCasa=chutes; raio.alvoCasa=alvo; raio.posseCasa=posse; raio.escCasa=esc; raio.amarelosCasa=amarelos;
        if(cruz!==null){raio.cruzCasa=cruz; raio.temCruz=true;}
        if(ap!==null){raio.apCasa=ap; raio.temAP=true;}
      } else {
        raio.chutesFora=chutes; raio.alvoFora=alvo; raio.posseFora=posse; raio.escFora=esc; raio.amarelosFora=amarelos;
        if(cruz!==null){raio.cruzFora=cruz; raio.temCruz=true;}
        if(ap!==null){raio.apFora=ap; raio.temAP=true;}
      }
    }
    const compH = summary?.header?.competitions?.[0];
    if(compH){
      const casaC = compH.competitors?.find(c=>c.homeAway==='home');
      const foraC = compH.competitors?.find(c=>c.homeAway==='away');
      finalCasa = numero(casaC?.score);
      finalFora = numero(foraC?.score);
      status = compH?.status?.type?.name;
    }
  }catch(e){}
  return { raio, finalCasa, finalFora, status };
}
function checaJogo(jogo,raio){
  if(!LIGAS_PERMITIDAS.includes(jogo.liga)) return {aprovado:false};
  if(Math.abs(jogo.gols_casa-jogo.gols_fora)>FILTROS.max_diferenca_gols) return {aprovado:false};
  if((jogo.chutes_casa+jogo.chutes_fora)<FILTROS.min_total_chutes_jogo) return {aprovado:false};
  const totalPosse=raio.posseCasa+raio.posseFora;
  const posseCasaPct=totalPosse>0?Math.round((raio.posseCasa/totalPosse)*100):50;
  const posseForaPct=100-posseCasaPct;
  let timePrecisa='',chutesPrecisa=0,posseTime=0,cruzTime=0,escTime=0,apTime=0, ladoPrecisa='';
  if(jogo.gols_casa<jogo.gols_fora){timePrecisa=jogo.nome_casa; ladoPrecisa='home'; chutesPrecisa=jogo.alvo_casa;posseTime=posseCasaPct;cruzTime=raio.cruzCasa;escTime=raio.escCasa;apTime=raio.apCasa||0;}
  else if(jogo.gols_fora<jogo.gols_casa){timePrecisa=jogo.nome_fora; ladoPrecisa='away'; chutesPrecisa=jogo.alvo_fora;posseTime=posseForaPct;cruzTime=raio.cruzFora;escTime=raio.escFora;apTime=raio.apFora||0;}
  else{const casaMelhor=jogo.alvo_casa>=jogo.alvo_fora; timePrecisa=casaMelhor?jogo.nome_casa:jogo.nome_fora; ladoPrecisa=casaMelhor?'home':'away'; chutesPrecisa=Math.max(jogo.alvo_casa,jogo.alvo_fora); posseTime=casaMelhor?posseCasaPct:posseForaPct; cruzTime=casaMelhor?raio.cruzCasa:raio.cruzFora; escTime=casaMelhor?raio.escCasa:raio.escFora; apTime=casaMelhor?raio.apCasa||0:raio.apFora||0;}
  if(chutesPrecisa<FILTROS.min_chutes_gol_time_precisa) return {aprovado:false};
  const scorePressao=cruzTime+(escTime*2)+(apTime/10);
  if(scorePressao<FILTROS.min_pressao_score) return {aprovado:false};
  if(posseTime<FILTROS.posse_minima_pressao) return {aprovado:false};
  let zonaPressao='Meio';
  if(cruzTime>=8||(cruzTime
