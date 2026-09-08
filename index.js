const express=require("express");const axios=require("axios");const app=express();app.use(express.json());const PORT=process.env.PORT||10000;
const PROXY_LIST=["https://api.codetabs.com/v1/proxy?quest=","https://corsproxy.io/?"];
const BASES=["https://www.sofascore.com/api/v1","https://api.sofascore.com/api/v1"];
const TELEGRAM_TOKEN=process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||"";const CHAT_ID=process.env.TELEGRAM_CHAT_ID||process.env.CHAT_ID||"";
const POLL_MINUTES=Number(process.env.POLL_MINUTES||5);const SCORE_MIN=Number(process.env.SCORE_MIN||78);const SCORE_FORTE=Number(process.env.SCORE_FORTE||88);
const MAX_ALERTAS=Number(process.env.MAX_ALERTAS||3);const MAX_STATS=Number(process.env.MAX_STATS||3);
const HORARIO_INICIO=Number(process.env.HORARIO_INICIO||9);const HORARIO_FIM=Number(process.env.HORARIO_FIM||23);
const historico=new Map(),enviados=new Map(),historicoPressao=new Map();let radarRodando=false,ultimoRadar=null,ultimoErro=null,ultimoProxy="nenhum";
const http=axios.create({timeout:25000,headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0","Accept":"application/json","Referer":"https://www.sofascore.com/","Origin":"https://www.sofascore.com"}});

async function sofaGet(path){
 for(const base of BASES){
  for(const proxy of PROXY_LIST){
   try{
    const url=`${base}${path}`;
    const finalUrl=`${proxy}${encodeURIComponent(url)}`;
    const r=await http.get(finalUrl);
    if(r.data&&(r.data.events||r.data.statistics||r.data.graphPoints)){ultimoProxy=proxy;return r;}
   }catch(e){continue;}
  }
 }
 throw new Error("Proxy falhou");
}
function horaBrasil(){try{return parseInt(new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",hour12:false}),10);}catch{return new Date().getHours();}}
function isHorarioAtivo(){const h=horaBrasil();if(HORARIO_INICIO<=HORARIO_FIM)return h>=HORARIO_INICIO&&h<=HORARIO_FIM;return h>=HORARIO_INICIO||h<=HORARIO_FIM;}
function num(v){if(v==null)return 0;if(typeof v==="number")return isFinite(v)?v:0;const n=parseFloat(String(v).replace("%","").replace(",",".").trim());return isFinite(n)?n:0;}
function esperar(ms){return new Promise(r=>setTimeout(r,ms));}
async function enviarTelegram(t){if(!TELEGRAM_TOKEN||!CHAT_ID)return false;try{await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:t,parse_mode:"Markdown",disable_web_page_preview:true},{timeout:10000});return true;}catch(e){return false;}}
function obterMinuto(j){const s=j.status?.type;if(s==="finished"||s==="canceled"||s==="postponed")return 0;const m=num(j.time?.minute);if(m>0)return Math.floor(m);const ini=j.time?.currentPeriodStartTimestamp;if(ini){const dif=Math.floor(Date.now()/1000)-Number(ini);if(dif>=0&&dif<7200)return Math.floor(dif/60);}return 0;}
function extrairStats(data){const stats={shots:0,shotsOnTarget:0,corners:0,dangerousAttacks:0};const lista=data?.statistics||[];let grupos=[];const all=lista.find(x=>String(x.period).toUpperCase()==="ALL");if(all)grupos=all.groups||[];else grupos=lista.flatMap(x=>x.groups||[]);for(const g of grupos){for(const it of g.statisticsItems||[]){const nome=String(it.name||"").toLowerCase();const h=num(it.home),a=num(it.away);if(nome.includes("total shots"))stats.shots=h+a;if(nome.includes("shots on target"))stats.shotsOnTarget=h+a;if(nome.includes("corner"))stats.corners=h+a;if(nome.includes("dangerous attack"))stats.dangerousAttacks=h+a;}}return stats;}

function detectarPressao(pts){
 if(!pts||pts.length<10)return null;
 const ult10=pts.slice(-10);
 const homePress=ult10.filter(p=>num(p.value)>60).length;
 const awayPress=ult10.filter(p=>num(p.value)<-60).length;
 if(homePress>=7)return{time:"HOME",forca:homePress*10+10};
 if(awayPress>=7)return{time:"AWAY",forca:awayPress*10+10};
 return null;
}
function detectarVirada(id, atual){
 if(!atual)return null;
 if(!historicoPressao.has(id))historicoPressao.set(id,[]);
 const hist=historicoPressao.get(id);
 hist.push({time:atual.time,timestamp:Date.now()});
 if(hist.length>8)hist.shift();
 if(hist.length<4)return null;
 const antes=hist.slice(-4,-1);
 const trocou=antes.some(h=>h.time!==atual.time);
 if(trocou&&atual.forca>=70)return{virada:true,de:antes[0].time,para:atual.time,forca:atual.forca};
 return null;
}

async function buscarStats(id){try{const r=await sofaGet(`/event/${id}/statistics`);return extrairStats(r.data);}catch{return null;}}
async function buscarMomentum(id){try{const r=await sofaGet(`/event/${id}/graph`);const pts=r.data?.graphPoints||[];const pressao=detectarPressao(pts);const virada=detectarVirada(id,pressao);const ult=pts.slice(-10),ant=pts.slice(-20,-10);const medA=ult.length?ult.reduce((s,p)=>s+num(p.value),0)/ult.length:0;const medB=ant.length?ant.reduce((s,p)=>s+num(p.value),0)/ant.length:0;const dif=medA-medB;let tend="ESTÁVEL";if(dif>=8)tend="SUBINDO";else if(dif<=-8)tend="CAINDO";return{momentum:{tendencia:tend,dif},pts,pressao,virada};}catch{return null;}}
function analisarEvolucao(id,stats,min){const atual={shots:stats?.shots||0,corners:stats?.corners||0,dangerousAttacks:stats?.dangerousAttacks||0,timestamp:Date.now()};let ant=null;const lista=historico.get(id);if(lista&&lista.length)ant=lista[lista.length-1];const ev={shots:0,corners:0,dangerousAttacks:0};if(ant){ev.shots=atual.shots-ant.shots;ev.corners=atual.corners-ant.corners;ev.dangerousAttacks=atual.dangerousAttacks-ant.dangerousAttacks;}if(!historico.has(id))historico.set(id,[]);const arr=historico.get(id);arr.push(atual);if(arr.length>6)arr.shift();return ev;}
function calcularScoreCorners(jogo,stats,mom,ev,pressao,virada){const min=obterMinuto(jogo);if(!stats)return{score:0,motivos:[]};let s=45;const m=[];if(min>=65)s+=12;if(min>=85)s+=18;if(stats.corners>=5){s+=12;m.push(`${stats.corners} esc`);}if(ev&&ev.corners>=1){s+=10;m.push(`+${ev.corners} esc`);}if(pressao&&pressao.forca>=70){s+=18;m.push(`PRESSÃO ${pressao.time} ${pressao.forca}%`);}if(virada&&virada.virada){s+=22;m.push(`VIRADA ${virada.de}->${virada.para} 🔥`);}if(mom&&mom.tendencia==="SUBINDO"){s+=8;m.push("subindo");}return{score:Math.min(100,s),motivos:m};}
function calcularScoreOver(jogo,stats,mom,ev,pressao,virada){const min=obterMinuto(jogo);let s=40;const m=[];if(stats){if(stats.shots>=8){s+=6;m.push(`${stats.shots} chutes`);}if(stats.shotsOnTarget>=3){s+=8;m.push(`${stats.shotsOnTarget} alvo`);}}if(pressao&&pressao.forca>=70){s+=8;m.push(`pressao ${pressao.time}`);}if(virada&&virada.virada){s+=10;m.push(`virada ${virada.para}`);}return{score:Math.min(100,s),motivos:m};}
function podeEnviar(id,mercado,score){const ch=`${id}-${mercado}`;const ant=enviados.get(ch);if(!ant)return true;if(score>=SCORE_FORTE&&ant.score<SCORE_FORTE)return true;if(Date.now()-ant.timestamp>1800000)return true;return false;}
function marcarEnviado(id,mercado,score){enviados.set(`${id}-${mercado}`,{score,timestamp:Date.now()});}
function criarMensagem(jogo,mercado,analise,stats,pressao,virada){const home=jogo.homeScore?.current??0,away=jogo.awayScore?.current??0,min=obterMinuto(jogo);const emoji=analise.score>=SCORE_FORTE?"🔥🔥🔥":"🟢";let t=`${emoji} *V8 PRESSÃO ${analise.score}/100*\n\n⚽ *${jogo.homeTeam?.name}* ${home} x ${away} *${jogo.awayTeam?.name}*\n⏱️ ${min}' - ${jogo.tournament?.name}\n\n🎯 *${mercado}*`;for(const mo of analise.motivos)t+=`\n• ${mo}`;if(stats)t+=`\n\n📈 ${stats.shots} chutes / ${stats.corners} esc / ${stats.dangerousAttacks} perig`;if(pressao)t+=`\n🔥 PRESSÃO: ${pressao.time} ${pressao.forca}%`;if(virada&&virada.virada)t+=`\n⚡ VIRADA: ${virada.de} -> ${virada.para}`;return t;}

async function radar(){if(radarRodando)return{jogos:0};radarRodando=true;let jogos=0,candidatos=0,sinais=0;try{const res=await sofaGet("/sport/football/events/live");const eventos=res.data?.events||[];jogos=eventos.length;const lista=eventos.map(j=>{const min=obterMinuto(j);return{jogo:j,minuto:min,prioridade:min>=65?30:10}}).filter(i=>i.minuto>=25&&i.minuto<=90).sort((a,b)=>b.prioridade-a.prioridade);candidatos=lista.length;for(const item of lista.slice(0,MAX_STATS)){if(sinais>=MAX_ALERTAS)break;const jogo=item.jogo;const stats=await buscarStats(jogo.id);await esperar(2500);const momData=await buscarMomentum(jogo.id);await esperar(2500);if(!momData)continue;const ev=analisarEvolucao(jogo.id,stats,item.minuto);const corn=calcularScoreCorners(jogo,stats,momData.momentum,ev,momData.pressao,momData.virada);if(corn.score>=SCORE_MIN&&podeEnviar(jogo.id,"ESCANTEIOS",corn.score)){const msg=criarMensagem(jogo,"ESCANTEIOS - PRESSÃO",corn,stats,momData.pressao,momData.virada);if(await enviarTelegram(msg)){marcarEnviado(jogo.id,"ESCANTEIOS",corn.score);sinais++;}}}ultimoRadar=new Date().toISOString();return{jogos,candidatos,sinais,proxy:ultimoProxy};}catch(e){ultimoErro=e.message;return{jogos,candidatos,sinais,erro:e.message};}finally{radarRodando=false;}}
app.get("/",(req,res)=>res.json({status:"online",v:"V8 PRESSAO",hora:horaBrasil(),proxy:ultimoProxy,ultimoRadar,ultimoErro}));
app.get("/radar",async(req,res)=>res.json(await radar()));
app.get("/telegram-test",async(req,res)=>{const ok=await enviarTelegram(`🟢 *V8 PRESSÃO OK*\nProxy: ${ultimoProxy}\nVirada configurada pra escanteio`);res.json({enviado:ok});});
app.listen(PORT,()=>console.log(`V8 na porta ${PORT}`));
setInterval(()=>{radar().catch(()=>{});},POLL_MINUTES*60*1000);
setTimeout(()=>{radar().catch(()=>{});},5000);
