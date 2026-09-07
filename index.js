const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const API_KEYS = [process.env.API_FOOTBALL, process.env.API_FOOTBALL_2, process.env.API_FOOTBALL_3].filter(Boolean);
const TELEGRAM_TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const DAILY_API_BUDGET = Number(process.env.DAILY_API_BUDGET || 90);
const RADAR_INTERVAL_MIN = Number(process.env.RADAR_INTERVAL_MIN || 10);
const STAKE = Number(process.env.STAKE || 5);
const MIN_EARLY_SCORE = Number(process.env.MIN_EARLY_SCORE || 82);
const MIN_LATE_SCORE = Number(process.env.MIN_LATE_SCORE || 78);

let apiRequestsToday = 0, detailCallsToday = 0, apiKeyIndex = 0, lastRadarRun = null, radarStatus = "INICIANDO", bank = 100;
const stats = { analisados: 0, candidatos: 0, alertas: 0 };
const alertedFixtures = new Set();
const history = [];
const statsCache = new Map();

function normalizeNumber(v){ if(v==null) return 0; const n=Number(String(v).replace("%","").replace(",",".")); return Number.isFinite(n)?n:0; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function getApiKey(){
  if(!API_KEYS.length) return null;
  const k=API_KEYS[apiKeyIndex%API_KEYS.length]; apiKeyIndex=(apiKeyIndex+1)%API_KEYS.length; return k;
}
async function apiGet(path,params={},options={}){
  const key=getApiKey();
  if(!key){ console.log("⛔ Nenhuma API key! Verifique API_FOOTBALL no Environment"); return null; }
  try{
    apiRequestsToday++;
    const r=await axios.get(`https://v3.football.api-sports.io${path}`,{params,headers:{"x-apisports-key":key},timeout:15000});
    return r.data;
  }catch(e){ console.log("❌ API:",e.message); return null; }
}
async function sendTelegram(msg){
  if(!TELEGRAM_TOKEN||!CHAT_ID) return false;
  try{ await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:msg,parse_mode:"HTML"}); return true; }catch(e){ console.log("Telegram erro"); return false; }
}
function parseTeamStatistics(statistics){
  const res={corners:0,dangerous:0,shotsOn:0,shotsTotal:0};
  if(!Array.isArray(statistics)) return res;
  for(const teamBlock of statistics){
    for(const item of (teamBlock.statistics||[])){
      const t=String(item.type||"").toLowerCase();
      if(t.includes("corner")) res.corners+=normalizeNumber(item.value);
      if(t.includes("dangerous")) res.dangerous+=normalizeNumber(item.value);
      if(t.includes("shots on goal")) res.shotsOn+=normalizeNumber(item.value);
      if(t==="total shots") res.shotsTotal+=normalizeNumber(item.value);
    }
  }
  return res;
}
async function getStatsForFixtures(ids){
  const result=new Map();
  for(const id of ids.slice(0,2)){
    const data=await apiGet("/fixtures/statistics",{fixture:id});
    if(!data?.response?.length) continue;
    const parsed=parseTeamStatistics(data.response);
    result.set(id,parsed); statsCache.set(id,parsed); await sleep(700);
  }
  return result;
}
async function getLiveFixtures(){ const d=await apiGet("/fixtures",{live:"all"}); return d?.response||[]; }
function isRadarWindow(f){
  const el=normalizeNumber(f.fixture?.status?.elapsed);
  const sh=String(f.fixture?.status?.short||"").toUpperCase();
  if(sh!=="1H"&&sh!=="2H") return null;
  if(el>=30&&el<=38) return "EARLY";
  if(el>=70&&el<=88) return "LATE";
  return null;
}
function analyzeFixture(fixture,liveStats,windowType){
  const elapsed=normalizeNumber(fixture.fixture?.status?.elapsed);
  const corners=normalizeNumber(liveStats.corners);
  const cornerRate=elapsed>0?corners/elapsed:0;
  const projected90=cornerRate*90;
  let score=0; const reasons=[];
  if(windowType==="EARLY"){ if(corners>=3){score+=20; reasons.push("3+ cantos");} if(projected90>=9){score+=20; reasons.push("ritmo 9+");} }
  else{ if(corners>=5){score+=20; reasons.push("5+ cantos");} if(projected90>=8){score+=20; reasons.push("ritmo 8+");} }
  return {fixtureId:fixture.fixture?.id,window:windowType,minute:elapsed,home:fixture.teams?.home?.name||"Casa",away:fixture.teams?.away?.name||"Fora",corners,projected90,score:Math.min(100,score),reasons};
}
async function runRadar(){
  if(radarStatus==="RODANDO") return;
  radarStatus="RODANDO";
  try{
    const live=await getLiveFixtures();
    console.log(`📊 Ao vivo: ${live.length} | Keys: ${API_KEYS.length} | Budget: ${apiRequestsToday}/${DAILY_API_BUDGET}`);
    if(!live.length){ radarStatus="SEM JOGOS"; return; }
    const interesting=[];
    for(const f of live){ const w=isRadarWindow(f); if(!w) continue; interesting.push({fixture:f,windowType:w}); }
    if(!interesting.length){ radarStatus="AGUARDANDO JANELA"; return; }
    const ids=interesting.map(x=>x.fixture.fixture.id);
    const statsMap=await getStatsForFixtures(ids);
    for(const {fixture,windowType} of interesting){
      const fid=fixture.fixture.id;
      if(alertedFixtures.has(fid)) continue;
      const ls=statsMap.get(fid)||statsCache.get(fid); if(!ls) continue;
      const an=analyzeFixture(fixture,ls,windowType);
      const minScore=windowType==="EARLY"?MIN_EARLY_SCORE:MIN_LATE_SCORE;
      if(an.score>=minScore){
        const msg=`<b>RADAR ${windowType}</b> ${an.score}/100\n${an.home} x ${an.away}\n${an.minute}' Cantos:${an.corners} Proj:${an.projected90.toFixed(1)}`;
        await sendTelegram(msg); alertedFixtures.add(fid); history.unshift({...an,time:new Date().toISOString()}); stats.alertas++;
      }
    }
    lastRadarRun=new Date().toISOString(); radarStatus="AGUARDANDO";
  }catch(e){ console.log("Erro:",e.message); radarStatus="ERRO: "+e.message; }
}
app.get("/",(req,res)=>{ res.json({status:radarStatus,lastRun:lastRadarRun,budget:`${apiRequestsToday}/${DAILY_API_BUDGET}`,keys:API_KEYS.length,stats,history:history.slice(0,10)}); });
app.get("/radar/run",async(req,res)=>{ runRadar(); res.json({ok:true}); });
app.get("/health",(req,res)=>res.json({ok:true}));
setInterval(()=>{ runRadar(); }, RADAR_INTERVAL_MIN*60*1000);
app.listen(PORT,()=>{ console.log(`✅ ELITE RADAR V6.1 na porta ${PORT} com ${API_KEYS.length} chaves`); setTimeout(()=>runRadar(),5000); });
