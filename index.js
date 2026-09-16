const http = require('http');
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

const LIGAS_PERMITIDAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
const FILTROS = { max_diferenca_gols:2, min_chutes_gol_time_precisa:2, min_total_chutes_jogo:8, minuto_minimo:40, minuto_maximo:55, posse_minima_pressao:60, min_pressao_score:6 };

let ultimoScan=null,totalAprovados=0,totalEnviados=0,totalErros=0;
const enviados=new Map();
const sinaisDia=[];
let relatorioEnviadoHoje=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),8000);
  try{ const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:c.signal}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally{ clearTimeout(t); }
}
function numero(v){ const n=parseFloat(String(v??0).replace(',','.').replace('%','')); return Number.isFinite(n)?n:0; }
function pegaStat(S,nomes){
  if(!Array.isArray(S)) return null;
  for(let nome of nomes){ const s=S.find(x=>x.name?.toLowerCase()===nome.toLowerCase()||x.abbreviation?.toLowerCase()===nome.toLowerCase()); if(s) return numero(s.displayValue??s.value??0); }
  return null;
}
async function buscarRaioXCompleto(liga,eventId){
  const raio={chutesCasa:0,chutesFora:0,alvoCasa:0,alvoFora:0,posseCasa:0,posseFora:0,escCasa:0,escFora:0,cruzCasa:0,cruzFora:0,apCasa:0,apFora:0,temAP:false,temCruz:false,amarelosCasa:0,amarelosFora:0};
  try{
    const summary=await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`);
    const teams=summary?.boxscore?.teams||[];
    for(let i=0;i<teams.length;i++){
      const bloco=teams[i]; const id=String(bloco?.team?.id||''); let lado=i===0?'home':'away';
      const comp=summary?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id); if(comp) lado=comp.homeAway;
      const S=bloco?.statistics||[];
      const chutes=pegaStat(S,['totalShots','shots'])??0, alvo=pegaStat(S,['shotsOnTarget','shotsOnGoal'])??0;
      const posse=pegaStat(S,['possessionPct','possession'])??0, esc=pegaStat(S,['wonCorners','cornerKicks'])??0;
      const ap=pegaStat(S,['dangerousAttacks','dangerousAttack'])??0, cruz=pegaStat(S,['crosses','totalCrosses'])??0, amarelos=pegaStat(S,['yellowCards'])??0;
      if(lado==='home'){ raio.chutesCasa=chutes; raio.alvoCasa=alvo; raio.posseCasa=posse; raio.escCasa=esc; raio.apCasa=ap; raio.cruzCasa=cruz; raio.amarelosCasa=amarelos; if(cruz) raio.temCruz=true; if(ap) raio.temAP=true; }
      else{ raio.chutesFora=chutes; raio.alvoFora=alvo; raio.posseFora=posse; raio.escFora=esc; raio.apFora=ap; raio.cruzFora=cruz; raio.amarelosFora=amarelos; if(cruz) raio.temCruz=true; if(ap) raio.temAP=true; }
    }
  }catch(e){}
  return raio;
}
function checaJogo(jogo,raio){
  if(!LIGAS_PERMITIDAS.includes(jogo.liga)) return {aprovado:false};
  if(Math.abs(jogo.gols_casa-jogo.gols_fora)>FILTROS.max_diferenca_gols) return {aprovado:false};
  if((jogo.chutes_casa+jogo.chutes_fora)<FILTROS.min_total_chutes_jogo) return {aprovado:false};
  const totalPosse=raio.posseCasa+raio.posseFora;
  const posseCasaPct=totalPosse>0?Math.round((raio.posseCasa/totalPosse)*100):50;
  const posseForaPct=100-posseCasaPct;
  let timePrecisa='',chutesPrecisa=0,posseTime=0,cruzTime=0,escTime=0,apTime=0;
  if(jogo.gols_casa<jogo.gols_fora){ timePrecisa=jogo.nome_casa; chutesPrecisa=jogo.alvo_casa; posseTime=posseCasaPct; cruzTime=raio.cruzCasa; escTime=raio.escCasa; apTime=raio.apCasa; }
  else if(jogo.gols_fora<jogo.gols_casa){ timePrecisa=jogo.nome_fora; chutesPrecisa=jogo.alvo_fora; posseTime=posseForaPct; cruzTime=raio.cruzFora; escTime=raio.escFora; apTime=raio.apFora; }
  else{ const casaMelhor=jogo.alvo_casa>=jogo.alvo_fora; timePrecisa=casaMelhor?jogo.nome_casa:jogo.nome_fora; chutesPrecisa=Math.max(jogo.alvo_casa,jogo.alvo_fora); posseTime=casaMelhor?posseCasaPct:posseForaPct; cruzTime=casaMelhor?raio.cruzCasa:raio.cruzFora; escTime=casaMelhor?raio.escCasa:raio.escFora; apTime=casaMelhor?raio.apCasa:raio.apFora; }
  if(chutesPrecisa<FILTROS.min_chutes_gol_time_precisa) return {aprovado:false};
  const scorePressao=cruzTime+(escTime*2)+(apTime/10);
  if(scorePressao<FILTROS.min_pressao_score) return {aprovado:false};
  if(posseTime<FILTROS.posse_minima_pressao) return {aprovado:false};
  let zonaPressao='Meio';
  if(cruzTime>=8||(cruzTime>=5&&escTime>=2)) zonaPressao=`Lateral (${cruzTime} cruz)`;
  else if(escTime>=3) zonaPressao=`Abafa Área (${escTime} esc)`;
  else if(apTime>=15) zonaPressao=`Meio-Perigoso (${apTime} AP)`;
  return {aprovado:true,timePrecisa,chutesPrecisa,totalChutes:jogo.chutes_casa+jogo.chutes_fora,possePct:posseTime,scorePressao,zonaPressao,cruzTime,escTime};
}

async function enviarTelegram(msg){
  if(!TELEGRAM_TOKEN||!CHAT_ID) return false;
  try{
    const r=await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:msg})});
    const d=await r.json(); if(!d.ok) throw new Error(d.description);
    totalEnviados++; return true;
  }catch(e){ totalErros++; console.log(`❌ Telegram: ${e.message}`); return false; }
}

// COM EMOJI BONITO - SEM LINK
async function enviarSinal(jogo,analise,raio){
  const pCasa=(raio.posseCasa+raio.posseFora)>0?Math.round((raio.posseCasa/(raio.posseCasa+raio.posseFora))*100):50;
  const linhaAP = raio.temAP? `🔥 Ataques Perigosos: ${raio.apCasa??0}x${raio.apFora??0}\n` : ``;
  const linhaCruz = raio.temCruz? `↗️ Cruzamentos: ${raio.cruzCasa}x${raio.cruzFora}\n` : ``;

  const msg = `🚨 RAIO-X GOL 2T — V34.8 PREMIUM

🏆 ${jogo.liga.toUpperCase()}
⚽ ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}
⏱️ ${jogo.minutoTexto}

📊 ESTATÍSTICAS HT:
🥅 Chutes: ${raio.chutesCasa}x${raio.chutesFora} (Total: ${analise.totalChutes})
🎯 No Alvo: ${raio.alvoCasa}x${raio.alvoFora}
${linhaAP}${linhaCruz}🚩 Escanteios: ${raio.escCasa}x${raio.escFora}
📊 Posse: ${pCasa}% x ${100-pCasa}%
🟨 Amarelos: ${raio.amarelosCasa}x${raio.amarelosFora}

📍 PRESSÃO: ${analise.zonaPressao}
📈 Score Pressão: ${analise.scorePressao.toFixed(1)} | Posse time: ${analise.possePct}% ✅ 60%+

🎯 Precisa: ${analise.timePrecisa} (${analise.chutesPrecisa} no alvo)
✅ FILTRO: 60% POSSE + PRESSAO LATERAL

⚡ ENTRADA: Over 0.5 GOL 2T`;

  if(await enviarTelegram(msg)){
    sinaisDia.push({hora: new Date().toLocaleTimeString('pt-BR'), jogo: `${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}`, liga: jogo.liga, pressao: analise.zonaPressao});
    return true;
  }
  return false;
}

async function enviarRelatorio(){
  const data = new Date().toLocaleDateString('pt-BR');
  let txt = `📊 RELATORIO DIARIO V34.8 PREMIUM - ${data}

🔎 Total varreduras: ${totalAprovados}
📨 Sinais enviados hoje: ${sinaisDia.length}
❌ Erros: ${totalErros}

`;
  if(sinaisDia.length===0){
    txt += `⚠️ Nenhum sinal aprovado hoje (filtro 60% posse + pressão).\n`;
  } else {
    txt += `✅ SINAIS DO DIA:\n`;
    sinaisDia.forEach((s,i)=>{
      txt += `${i+1}. [${s.hora}] ${s.liga.toUpperCase()} - ${s.jogo} - ${s.pressao}\n`;
    });
  }
  txt += `\n🤖 Robô online - Próximo reset meia-noite BRT`;
  await enviarTelegram(txt);
  sinaisDia.length=0; totalAprovados=0; totalErros=0;
}

function verificaHorarioRelatorio(){
  const agora = new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
  const hora = agora.split(', ')[1];
  const [h,m] = hora.trim().split(':').map(Number);
  if(h===23 && m===59 &&!relatorioEnviadoHoje){
    enviarRelatorio();
    relatorioEnviadoHoje=true;
  }
  if(h===0 && m===0) relatorioEnviadoHoje=false;
}

async function buscarJogosESPN(){
  const aprovados=[];
  for(const liga of LIGAS_PERMITIDAS){
    try{
      const data=await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`);
      if(!Array.isArray(data.events)) continue;
      for(const ev of data.events){
        try{
          const comp=ev?.competitions?.[0]; if(!comp) continue;
          const status=comp?.status?.type?.name||''; if(!['STATUS_HALFTIME','STATUS_SECOND_HALF'].includes(status)) continue;
          let minuto=numero(comp?.status?.clock); if(status==='STATUS_HALFTIME') minuto=45;
          if(minuto<FILTROS.minuto_minimo||minuto>FILTROS.minuto_maximo) continue;
          const casa=comp.competitors?.find(c=>c.homeAway==='home'), fora=comp.competitors?.find(c=>c.homeAway==='away'); if(!casa||!fora) continue;
          await sleep(400);
          const raioTemp=await buscarRaioXCompleto(liga,ev.id);
          const jogo={id:String(ev.id),liga,nome_casa:casa?.team?.displayName||'Casa
