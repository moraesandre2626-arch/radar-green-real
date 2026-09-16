const http = require('http');
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';

const LIGAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
const FILTROS = { maxGol:2, minAlvo:2, minChutes:8, minMin:40, maxMin:55, minPosse:60, minScore:6 };

let ultimoScan = null;
let totalAprovados = 0;
let totalEnviados = 0;
let sinaisDia = [];
let relatorioJaEnviado = false;
const enviados = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url){
  const c = new AbortController();
  setTimeout(()=>c.abort(),8000);
  const r = await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:c.signal});
  if(!r.ok) throw new Error("http "+r.status);
  return await r.json();
}
function num(v){
  const n = parseFloat(String(v||0).replace(',','.').replace('%',''));
  return isFinite(n)?n:0;
}
function stat(S,nomes){
  if(!Array.isArray(S)) return 0;
  for(const nome of nomes){
    const s = S.find(x=> (x.name||"").toLowerCase()===nome.toLowerCase() || (x.abbreviation||"").toLowerCase()===nome.toLowerCase() );
    if(s) return num(s.displayValue||s.value||0);
  }
  return 0;
}
async function buscaRaio(liga,eventId){
  const raio = { chCasa:0,chFora:0, alCasa:0,alFora:0, posseCasa:0,posseFora:0, escCasa:0,escFora:0, cruzCasa:0,cruzFora:0, apCasa:0,apFora:0, amaCasa:0,amaFora:0 };
  try{
    const sum = await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+liga+"/summary?event="+eventId);
    const teams = sum.boxscore?.teams || [];
    for(let i=0;i<teams.length;i++){
      const bloco = teams[i];
      let lado = i===0?"home":"away";
      const id = String(bloco.team?.id||"");
      const comp = sum.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id);
      if(comp) lado = comp.homeAway;
      const S = bloco.statistics||[];
      const ch = stat(S,["totalShots","shots"]);
      const al = stat(S,["shotsOnTarget","shotsOnGoal"]);
      const posse = stat(S,["possessionPct","possession"]);
      const esc = stat(S,["wonCorners","cornerKicks"]);
      const cruz = stat(S,["crosses","totalCrosses"]);
      const ap = stat(S,["dangerousAttacks","dangerousAttack","attack"]);
      const ama = stat(S,["yellowCards"]);
      if(lado==="home"){
        raio.chCasa=ch; raio.alCasa=al; raio.posseCasa=posse; raio.escCasa=esc; raio.cruzCasa=cruz; raio.apCasa=ap; raio.amaCasa=ama;
      }else{
        raio.chFora=ch; raio.alFora=al; raio.posseFora=posse; raio.escFora=esc; raio.cruzFora=cruz; raio.apFora=ap; raio.amaFora=ama;
      }
    }
  }catch(e){}
  return raio;
}
function checa(jogo,raio){
  if(!LIGAS.includes(jogo.liga)) return {ok:false};
  if(Math.abs(jogo.gc-jogo.gf)>FILTROS.maxGol) return {ok:false};
  if((jogo.chCasa+jogo.chFora)<FILTROS.minChutes) return {ok:false};
  const totalPosse = raio.posseCasa+raio.posseFora;
  const pCasa = totalPosse>0? Math.round((raio.posseCasa/totalPosse)*100):50;
  const pFora = 100-pCasa;
  let precisa="", chPrecisa=0, posseTime=0, cruzTime=0, escTime=0, apTime=0;
  if(jogo.gc<jogo.gf){ precisa=jogo.casa; chPrecisa=jogo.alCasa; posseTime=pCasa; cruzTime=raio.cruzCasa; escTime=raio.escCasa; apTime=raio.apCasa; }
  else if(jogo.gf<jogo.gc){ precisa=jogo.fora; chPrecisa=jogo.alFora; posseTime=pFora; cruzTime=raio.cruzFora; escTime=raio.escFora; apTime=raio.apFora; }
  else{ const casaMelhor=jogo.alCasa>=jogo.alFora; precisa=casaMelhor?jogo.casa:jogo.fora; chPrecisa=Math.max(jogo.alCasa,jogo.alFora); posseTime=casaMelhor?pCasa:pFora; cruzTime=casaMelhor?raio.cruzCasa:raio.cruzFora; escTime=casaMelhor?raio.escCasa:raio.escFora; apTime=casaMelhor?raio.apCasa:raio.apFora; }
  if(chPrecisa<FILTROS.minAlvo) return {ok:false};
  const score = cruzTime + (escTime*2) + (apTime/10);
  if(score<FILTROS.minScore) return {ok:false};
  if(posseTime<FILTROS.minPosse) return {ok:false};
  let zona="Meio";
  if(cruzTime>=8||(cruzTime>=5&&escTime>=2)) zona="Lateral ("+cruzTime+" cruz)";
  else if(escTime>=3) zona="Abafa Area ("+escTime+" esc)";
  else if(apTime>=15) zona="Meio-Perigoso ("+apTime+" AP)";
  return {ok:true, precisa, chPrecisa, posseTime, score, zona, cruzTime, escTime, pCasa};
}
async function enviaTelegram(texto){
  if(!TELEGRAM_TOKEN||!CHAT_ID) return false;
  try{
    const r = await fetch("https://api.telegram.org/bot"+TELEGRAM_TOKEN+"/sendMessage",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:texto})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.description);
    totalEnviados++;
    return true;
  }catch(e){ console.log("Telegram erro:",e.message); return false; }
}
async function enviaSinal(jogo,analise,raio){
  const pCasa = analise.pCasa;
  const msg = "RAIO-X GOL 2T V34.8 PREMIUM\n\n"+jogo.liga.toUpperCase()+"\n"+jogo.casa+" "+jogo.gc+"x"+jogo.gf+" "+jogo.fora+"\n"+jogo.minutoTxt+"\n\nChutes "+raio.chCasa+"x"+raio.chFora+" Alvo "+raio.alCasa+"x"+raio.alFora+"\nPosse "+pCasa+"% x "+(100-pCasa)+"% Esc "+raio.escCasa+"x"+raio.escFora+"\nPressao: "+analise.zona+" "+analise.cruzTime+"c Score "+analise.score.toFixed(1)+"\nPrecisa: "+analise.precisa+"\nENTRADA Over 0.5 GOL";
  const ok = await enviaTelegram(msg);
  if(ok){
    sinaisDia.push(jogo.casa+" x "+jogo.fora);
  }
  return ok;
}
async function buscaJogos(){
  const lista=[];
  for(const liga of LIGAS){
    try{
      const data = await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+liga+"/scoreboard");
      if(!Array.isArray(data.events)) continue;
      for(const ev of data.events){
        const comp = ev.competitions?.[0];
        if(!comp) continue;
        const st = comp.status?.type?.name||"";
        if(st!=="STATUS_HALFTIME" && st!=="STATUS_SECOND_HALF") continue;
        let minuto = num(comp.status?.clock);
        if(st==="STATUS_HALFTIME") minuto=45;
        if(minuto<FILTROS.minMin || minuto>FILTROS.maxMin) continue;
        const casaObj = comp.competitors?.find(c=>c.homeAway==="home");
        const foraObj = comp.competitors?.find(c=>c.homeAway==="away");
        if(!casaObj||!foraObj) continue;
        await sleep(400);
        const raio = await buscaRaio(liga, ev
