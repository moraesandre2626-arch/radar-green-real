const express=require("express"),axios=require("axios");const app=express();app.use(express.json());const PORT=process.env.PORT||10000;
const API_KEYS=[process.env.API_FOOTBALL,process.env.API_FOOTBALL_2,process.env.API_FOOTBALL_3].filter(Boolean);
const TELEGRAM_TOKEN=process.env.TOKEN,CHAT_ID=process.env.CHAT_ID;
const DAILY_API_BUDGET=Number(process.env.DAILY_API_BUDGET||200),RADAR_INTERVAL_MIN=Number(process.env.RADAR_INTERVAL_MIN||15);
const MIN_EARLY_SCORE=Number(process.env.MIN_EARLY_SCORE||78),MIN_LATE_SCORE=Number(process.env.MIN_LATE_SCORE||78);
const MAX_STATS_PER_CYCLE=Number(process.env.MAX_STATS_PER_CYCLE||6);
const API_BASE="https://v3.football.api-sports.io";
let apiRequestsToday=0,apiKeyIndex=0,blockedKeys=new Map(),lastRadarRun=null,radarStatus="INICIANDO",lastReportDate=null,radarRunning=!1,currentDay=null;
const alertedFixtures=new Set(),history=[],liveCache=new Map();
const stats={analisados:0,janelas:0,candidatos:0,alertas:0,earlyAlerts:0,lateAlerts:0,elite:0,fortes:0,greens:0,reds:0,lastAlert:null,creditZeroHour:null};
function getBRTNow(){return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}))}
function todayBRTKey(){const d=getBRTNow();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function resetDailyIfNeeded(){const t=todayBRTKey();if(currentDay!==t){currentDay=t;apiRequestsToday=0;apiKeyIndex=0;blockedKeys.clear();Object.assign(stats,{analisados:0,janelas:0,candidatos:0,alertas:0,earlyAlerts:0,lateAlerts:0,elite:0,fortes:0,greens:0,reds:0,lastAlert:null,creditZeroHour:null});alertedFixtures.clear();liveCache.clear();console.log("🔄 NOVO DIA BRT")}}
function apiAvailable(){if(!API_KEYS.length)return!1;if(apiRequestsToday>=DAILY_API_BUDGET){if(!stats.creditZeroHour)stats.creditZeroHour=new Date().toISOString();return!1}return!0}
async function apiGet(path){
  resetDailyIfNeeded();if(!apiAvailable())throw new Error("LIMITE_DIARIO_API_ATINGIDO");
  const total=API_KEYS.length;
  for(let i=0;i<total;i++){
    let key=API_KEYS[apiKeyIndex];
    if(blockedKeys.has(key)){if(Date.now()-blockedKeys.get(key)<15*60*1000){apiKeyIndex=(apiKeyIndex+1)%total;continue}else blockedKeys.delete(key)}
    try{
      apiRequestsToday++;console.log(`🌐 API ${apiRequestsToday}/${DAILY_API_BUDGET} Chave ${apiKeyIndex+1} ${path}`);
      const r=await axios.get(`${API_BASE}${path}`,{headers:{"x-apisports-key":key},timeout:15000});return r.data;
    }catch(e){
      const s=e.response?.status;console.log(`⚠️ Erro chave ${apiKeyIndex+1}: ${s||e.message}`);
      if(s===403||s===429)blockedKeys.set(key,Date.now());
      apiKeyIndex=(apiKeyIndex+1)%total;if(apiRequestsToday>=DAILY_API_BUDGET)throw new Error("LIMITE_DIARIO_API_ATINGIDO");
    }
  }throw new Error("FALHA_NAS_CHAVES_API");
}
async function sendTelegram(m){if(!TELEGRAM_TOKEN||!CHAT_ID)return!1;try{await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:m,parse_mode:"HTML",disable_web_page_preview:!0},{timeout:10000});return!0}catch(e){console.log("❌ Telegram",e.response?.data||e.message);return!1}}
function number(v){if(v==null)return 0;if(typeof v==="number")return v;const n=Number(String(v).replace("%","").replace(",","."));return Number.isFinite(n)?n:0}
function emptyStats(){return{corners:0,dangerousHome:0,dangerousAway:0,dangerous:0,attacksHome:0,attacksAway:0,shotsOnHome:0,shotsOnAway:0,shotsOn:0,shotsHome:0,shotsAway:0,shotsTotal:0,possessionHome:0,possessionAway:0}}
function parseStatistics(data){
  const r=emptyStats(),resp=data?.response||[];if(!resp.length)return r;
  resp.forEach((b,idx)=>{let c=0,d=0,a=0,sO=0,sT=0,p=0;for(const it of b.statistics||[]){if(it.type==="Corner Kicks")c=number(it.value);if(it.type==="Dangerous Attacks")d=number(it.value);if(it.type==="Attacks")a=number(it.value);if(it.type==="Shots on Goal")sO=number(it.value);if(it.type==="Total Shots")sT=number(it.value);if(it.type==="Ball Possession")p=number(it.value)}
  if(idx===0){r.dangerousHome=d;r.attacksHome=a;r.shotsOnHome=sO;r.shotsHome=sT;r.possessionHome=p}
  if(idx===1){r.dangerousAway=d;r.attacksAway=a;r.shotsOnAway=sO;r.shotsAway=sT;r.possessionAway=p}
  r.corners+=c});r.dangerous=r.dangerousHome+r.dangerousAway;r.shotsOn=r.shotsOnHome+r.shotsOnAway;r.shotsTotal=r.shotsHome+r.shotsAway;return r;
}
function analyzeEvents(ev){const e=ev?.response||[];let ss=0,inj=0,sub=0,vr=0,g=0,ca=0;for(const x of e){const t=String(x.type||"").toLowerCase(),d=String(x.detail||"").toLowerCase();if(t==="goal"){g++;ss+=1}if(t==="subst"){sub++;ss+=1}if(d.includes("injury")||d.includes("lesion")){inj++;ss+=3}if(t.includes("var")||d.includes("var")){vr++;ss+=3}if(t==="card"||d.includes("yellow")||d.includes("red")){ca++;ss+=0.5}}let add=0;if(ss>=10)add=6;else if(ss>=7)add=5;else if(ss>=4)add=4;else if(ss>=2)add=3;else if(ss>=1)add=2;return{injuries:inj,substitutions:sub,varEvents:vr,goals:g,cards:ca,stoppageScore:ss,estimatedAdded:add}}
async function getLiveData(fix){const id=fix.fixture.id,c=liveCache.get(id),cm=number(fix.fixture?.status?.elapsed);if(c&&Date.now()-c.timestamp<120000&&Math.abs(cm-c.minute)<=1)return c;const sd=await apiGet(`/fixtures/statistics?fixture=${id}`);await new Promise(r=>setTimeout(r,700));const ed=await apiGet(`/fixtures/events?fixture=${id}`);const ps=parseStatistics(sd),ei=analyzeEvents(ed);const d={minute:cm,stats:ps,events:ei,timestamp:Date.now()};liveCache.set(id,d);return d}
function getWindow(m){if(m>=30&&m<=38)return"EARLY";if(m>=70&&m<=88)return"LATE";return null}
function calculateTimeContext(m,e){const a=number(e?.estimatedAdded);let em=m;if(m>=30&&m<=45)em=m+a;if(m>=70&&m<=90)em=m+a;let tf=0;if(m>=30&&m<=38){if(em>=36)tf+=5;if(em>=40)tf+=7}if(m>=70&&m<=88){if(em>=82)tf+=4;if(em>=87)tf+=6}return{officialMinute:m,estimatedAdded:a,estimatedEffectiveMinute:em,timeFactor:tf}}
function calculateProjection(c,m){if(!m)return 0;return Number(((c/Math.min(m,90))*90).toFixed(2))}
function calculateScore(fix,live){const m=number(fix.fixture?.status?.elapsed),w=getWindow(m);if(!w)return null;const s=live.stats,e=live.events,t=calculateTimeContext(m,e),proj=calculateProjection(s.corners,m);let sc=0,r=[];if(w==="EARLY"){if(s.corners>=5){sc+=30;r.push("5+ escanteios")}else if(s.corners>=4){sc+=25;r.push("4 escanteios")}else if(s.corners>=3){sc+=20;r.push("3 escanteios")}else if(s.corners>=2)sc+=12}if(w==="LATE"){if(s.corners>=7){sc+=30;r.push("7+ escanteios")}else if(s.corners>=6){sc+=26;r.push("6 escanteios")}else if(s.corners>=5){sc+=21;r.push("5 escanteios")}else if(s.corners>=4)sc+=12}
if(proj>=12){sc+=25;r.push("projeção muito alta")}else if(proj>=10){sc+=21;r.push("projeção alta")}else if(proj>=8.5){sc+=16;r.push("projeção boa")}else if(proj>=7)sc+=8;else sc-=8;
if(w==="EARLY"){if(s.dangerous>=70){sc+=22;r.push("pressão muito alta")}else if(s.dangerous>=55){sc+=18;r.push("pressão alta")}else if(s.dangerous>=40)sc+=12;else if(s.dangerous>=30)sc+=6}
if(w==="LATE"){if(s.dangerous>=100){sc+=22;r.push("pressão muito alta")}else if(s.dangerous>=75){sc+=18;r.push("pressão alta")}else if(s.dangerous>=55)sc+=12;else if(s.dangerous>=40)sc+=6}
if(s.shotsOn>=6){sc+=16;r.push("6+ no alvo")}else if(s.shotsOn>=4){sc+=13;r.push("4+ no alvo")}else if(s.shotsOn>=3)sc+=9;else if(s.shotsOn>=2)sc+=5;
if(s.shotsTotal>=16){sc+=12;r.push("muitas finalizações")}else if(s.shotsTotal>=12)sc+=9;else if(s.shotsTotal>=8)sc+=5;
const totA=s.attacksHome+s.attacksAway;if(totA>=100)sc+=7;else if(totA>=75)sc+=4;
const pd=Math.abs(s.possessionHome-s.possessionAway);if(s.possessionHome>0&&s.possessionAway>0&&pd<=20)sc+=4;
sc+=t.timeFactor;if(t.estimatedAdded>=5)r.push(`paralisações: +${t.estimatedAdded} estimados`);
if(s.corners===0&&s.shotsOn===0){sc-=20;r.push("jogo sem produção")}if(s.corners<=1&&s.dangerous<25)sc-=10;
const tg=number(fix.goals?.home)+number(fix.goals?.away);if(tg>=4)sc-=10;else if(tg>=3)sc-=5;
sc=Math.max(0,Math.min(100,Math.round(sc)));let lv="IGNORAR";if(sc>=85)lv="ELITE";else if(sc>=78)lv="FORTE";
return{score:sc,level:lv,window:w,minute:m,officialMinute:t.officialMinute,estimatedAdded:t.estimatedAdded,estimatedEffectiveMinute:t.estimatedEffectiveMinute,corners:s.corners,projection:proj,dangerous:s.dangerous,shotsOn:s.shotsOn,shotsTotal:s.shotsTotal,attacks:totA,goals:tg,reasons:r}}
function preFilter(f){const m=number(f.fixture?.status?.elapsed);if(!getWindow(m))return!1;if((number(f.goals?.home)+number(f.goals?.away))>=5)return!1;return!0}
function teamNames(f){return{home:f.teams?.home?.name||"Mandante",away:f.teams?.away?.name||"Visitante"}}
async function sendRadarAlert(f,a){const t=teamNames(f),ic=a.level==="ELITE"?"👑":"🔥";const msg=`\n${ic} <b>ELITE RADAR V6.4</b>\n\n<b>${a.level}</b> — Score ${a.score}/100\n\n⚽ <b>${t.home}</b>\n🆚 <b>${t.away}</b>\n\n⏱️ Minuto: <b>${a.officialMinute}'</b>\n➕ Acréscimo est: <b>+${a.estimatedAdded}'</b>\n🕐 Efetivo est: <b>${a.estimatedEffectiveMinute}'</b>\n\n🚩 Escanteios: <b>${a.corners}</b>\n📈 Projeção: <b>${a.projection}</b>\n🔥 Perigosos: <b>${a.dangerous}</b>\n🎯 No alvo: <b>${a.shotsOn}</b>\n🥅 Totais: <b>${a.shotsTotal}</b>\n⚽ Gols: <b>${a.goals}</b>\n📊 Janela: <b>${a.window}</b>\n\n🧠 <b>Indicadores:</b>\n${a.reasons.length?a.reasons.map(x=>`• ${x}`).join("\n"):"• Sem indicador"}\n\n🔄 API: ${apiRequestsToday}/${DAILY_API_BUDGET}\n⚠️ <i>Sinal estatístico</i>\n`;
const s=await sendTelegram(msg);if(s){stats.alertas++;stats.lastAlert=new Date().toISOString();if(a.window==="EARLY")stats.earlyAlerts++;if(a.window==="LATE")stats.lateAlerts++;if(a.level==="ELITE")stats.elite++;else stats.fortes++;history.push({timestamp:new Date().toISOString(),fixtureId:f.fixture.id,home:t.home,away:t.away,minute:a.minute,window:a.window,score:a.score,level:a.level,corners:a.corners,projection:a.projection});if(history.length>200)history.shift()}return s}
async function runRadar(){resetDailyIfNeeded();if(radarRunning){console.log("⏳ Já executando");return}if(!apiAvailable()){radarStatus="LIMITE API ATINGIDO";return}radarRunning=!0;radarStatus="ANALISANDO";try{console.log("\n🚨 ELITE RADAR V6.4");const ld=await apiGet("/fixtures?live=all"),fx=ld?.response||[];stats.analisados+=fx.length;console.log(`⚽ Ao vivo: ${fx.length}`);const cand=fx.filter(preFilter).sort((a,b)=>(number(a.goals?.home)+number(a.goals?.away))-(number(b.goals?.home)+number(b.goals?.away)));console.log(`🎯 Janelas: ${cand.length}`);let proc=0;for(const fix of cand){if(proc>=MAX_STATS_PER_CYCLE)break;const id=fix.fixture.id;if(alertedFixtures.has(id))continue;try{const d=await getLiveData(fix);proc++;const an=calculateScore(fix,d);if(!an)continue;stats.janelas++;console.log(`📊 ${teamNames(fix).home} x ${teamNames(fix).away} | ${an.minute}' | ${an.corners} cantos | Proj ${an.projection} | Score ${an.score}`);const min=an.window==="EARLY"?MIN_EARLY_SCORE:MIN_LATE_SCORE;if(an.score>=min-8)stats.candidatos++;if(an.score>=min){const sent=await sendRadarAlert(fix,an);if(sent)alertedFixtures.add(id)}}catch(e){console.log(`⚠️ Erro jogo ${id}: ${e.message}`)}}lastRadarRun=new Date().toISOString();radarStatus="OPERACIONAL";console.log(`✅ Concluído API ${apiRequestsToday}/${DAILY_API_BUDGET}`)}catch(e){console.log("❌ Erro geral",e.message);radarStatus=e.message==="LIMITE_DIARIO_API_ATINGIDO"?"LIMITE API ATINGIDO":"ERRO"}finally{radarRunning=!1}}
async function sendDailyReport(){resetDailyIfNeeded();const today=todayBRTKey();if(lastReportDate===today)return;const last=history.slice(-5);let txt="Nenhum sinal";if(last.length)txt=last.map((x,i)=>`${i+1}. ${x.home} x ${x.away} — ${x.minute}' — ${x.level} ${x.score}/100`).join("\n");const m=`\n📊 <b>RELATÓRIO V6.4</b>\n📅 ${today}\n⚽ Analisados: <b>${stats.analisados}</b>\n⏱️ Janelas: <b>${stats.janelas}</b>\n🎯 Candidatos: <b>${stats.candidatos}</b>\n🚨 Alertas: <b>${stats.alertas}</b>\n👑 ELITE: <b>${stats.elite}</b>\n🔥 FORTES: <b>${stats.fortes}</b>\n🌅 Early: <b>${stats.earlyAlerts}</b>\n🌙 Late: <b>${stats.lateAlerts}</b>\n🔄 API: <b>${apiRequestsToday}/${DAILY_API_BUDGET}</b>\n🔑 Chaves: <b>${API_KEYS.length}</b>\n\n📌 Últimos:\n${txt}\n`;const s=await sendTelegram(m);if(s)lastReportDate=today}
function checkDailyReport(){const n=getBRTNow();if(n.getHours()===23&&n.getMinutes()<=10)sendDailyReport().catch(e=>console.log(e.message))}
app.get("/",(req,res)=>res.json({system:"ELITE RADAR V6.4 FIX 403",status:radarStatus,apiKeys:API_KEYS.length,apiUsed:apiRequestsToday,apiBudget:DAILY_API_BUDGET,intervalMinutes:RADAR_INTERVAL_MIN,lastRadarRun,alerts:stats.alertas}));
app.get("/radar/run",async(req,res)=>{if(radarRunning)return res.json({ok:!1,message:"Já executando"});runRadar();res.json({ok:!0,message:"Radar iniciado",apiUsed:apiRequestsToday,apiBudget:DAILY_API_BUDGET})});
app.get("/health",(req,res)=>res.json({ok:!0,system:"ELITE RADAR V6.4 FIX 403",status:radarStatus,running:radarRunning,apiKeys:API_KEYS.length,apiRequestsToday,dailyBudget:DAILY_API_BUDGET,remaining:Math.max(0,DAILY_API_BUDGET-apiRequestsToday),lastRadarRun,alerts:stats.alertas,history:history.length,uptime:Math.round(process.uptime())}));
app.listen(PORT,()=>{console.log(`🚨 RADAR FIX 403 ONLINE Porta ${PORT} Chaves ${API_KEYS.length}`);resetDailyIfNeeded();setTimeout(()=>runRadar(),5000)});
setInterval(()=>runRadar().catch(e=>console.log(e.message)),RADAR_INTERVAL_MIN*60*1000);
setInterval(()=>checkDailyReport(),60*1000);
