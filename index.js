// ============================================================
// ELITE RADAR V20 - PROXY ANTI-BAN + 20MIN
// ============================================================
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN || "").trim();
const CHAT_ID = (process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || "").trim();

const SCORE_MINIMO = 75;
const INTERVALO_MINUTOS = 20;
let ULTIMO_CHECK="Nunca",TOTAL_ENVIADOS=0,TOTAL_ANALISADOS=0,TOTAL_CANDIDATOS=0,ULTIMO_ERRO="Nenhum";
let JOGOS_JA_AVISADOS=new Set();

function dormir(ms){return new Promise(r=>setTimeout(r,ms));}
function numero(v){if(v==null)return 0;if(typeof v=="number")return isFinite(v)?v:0;const n=parseFloat(String(v).replace("%","").replace(",","."));return isFinite(n)?n:0;}
function textoSeguro(v){return String(v||"").replace(/[*_`\[\]]/g,"");}
function podeRodarAgora(){const agora=new Date();const b=new Date(agora.toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));const h=b.getHours();const d=b.getDay();return (d===0||d===6)?h>=8&&h<24:h>=12&&h<24;}
function horarioTexto(){const b=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));return (b.getDay()===0||b.getDay()===6)?"Sab-Dom 08h-00h":"Seg-Sex 12h-00h";}

async function sendTelegram(t){if(!TOKEN||!CHAT_ID)return false;try{await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:t,parse_mode:"Markdown"},{timeout:10000});TOTAL_ENVIADOS++;return true;}catch(e){return false;}}

const HEADERS={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36","Accept":"application/json","Referer":"https://www.sofascore.com/","Origin":"https://www.sofascore.com"};

async function getSofascore(url){
 // tenta direto
 try{
  const r=await axios.get(url,{headers:HEADERS,timeout:12000});
  return r.data;
 }catch(e){
  if(e.response?.status!==403) throw e;
  console.log("403 direto, tentando via proxy...");
  // tenta via proxy 1
  try{
   const proxyUrl=`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
   const r2=await axios.get(proxyUrl,{timeout:15000});
   console.log("Proxy 1 funcionou!");
   return typeof r2.data==="string"?JSON.parse(r2.data):r2.data;
  }catch(e2){
   console.log("Proxy 1 falhou, tentando proxy 2...");
   const proxyUrl2=`https://corsproxy.io/?${encodeURIComponent(url)}`;
   const r3=await axios.get(proxyUrl2,{headers:HEADERS,timeout:15000});
   console.log("Proxy 2 funcionou!");
   return r3.data;
  }
 }
}

function extrairEstatisticas(periodo){
 let esc=0,ch=0,alvo=0,chC=0,chF=0,aC=0,aF=0,cC=0,cF=0,atC=0,atF=0,pC=0,pF=0;
 for(const g of periodo?.groups||[]){for(const it of g.statisticsItems||[]){const n=String(it.name||"").toLowerCase();const h=numero(it.home);const a=numero(it.away);
  if(n.includes("corner")){esc+=h+a;cC+=h;cF+=a;continue;}
  if(n==="total shots"||n.includes("total shots")){ch+=h+a;chC+=h;chF+=a;continue;}
  if(n.includes("on target")){alvo+=h+a;aC+=h;aF+=a;continue;}
  if(n.includes("dangerous attacks")){atC+=h;atF+=a;continue;}
  if(n.includes("possession")){pC=h;pF=a;continue;}
 }}
 return {escanteios:esc,chutes:ch,chutesNoAlvo:alvo,chutesCasa:chC,chutesFora:chF,alvoCasa:aC,alvoFora:aF,cantosCasa:cC,cantosFora:cF,ataquesPerigososCasa:atC,ataquesPerigososFora:atF,posseCasa:pC,posseFora:pF};
}
function calcularScore(d,v){let s=0,m=[];const {escanteios,chutes,chutesNoAlvo}=d;
 if(escanteios<=2){s+=20;m.push("poucos cantos");}else if(escanteios<=3){s+=16;m.push("cantos baixos");}else if(escanteios<=5){s+=10;m.push("até 5");}else return{score:0,motivos:["muitos cantos"]};
 if(chutes>=20){s+=25;m.push("20+ chutes");}else if(chutes>=17){s+=21;m.push("17+");}else if(chutes>=14){s+=16;m.push("14+");}else return{score:0,motivos:["poucos chutes"]};
 if(chutesNoAlvo>=8){s+=20;m.push("8+ alvo");}else if(chutesNoAlvo>=6){s+=16;m.push("6+ alvo");}else if(chutesNoAlvo>=4){s+=10;m.push("4+ alvo");}
 if(Math.max(d.chutesCasa,d.chutesFora)>=10){s+=10;m.push("domínio");}
 if(d.ataquesPerigososCasa+d.ataquesPerigososFora>=60){s+=8;m.push("ataques perigosos");}
 const diff=Math.abs(numero(v.homeScore?.current)-numero(v.awayScore?.current));if(diff===0){s+=5;m.push("empatado");}
 return{score:Math.min(100,s),motivos:m};
}

async function analisarJogo(jogo){
 if(JOGOS_JA_AVISADOS.has(jogo.id))return;
 TOTAL_ANALISADOS++;await dormir(4000);
 try{
  const data=await getSofascore(`https://api.sofascore.com/api/v1/event/${jogo.id}/statistics`);
  const periodo=(data?.statistics||[]).find(p=>p.period==="1ST"||p.period==="ALL");if(!periodo)return;
  const dados=extrairEstatisticas(periodo);
  if(dados.escanteios>5||dados.chutes<14)return;
  TOTAL_CANDIDATOS++;
  const res=calcularScore(dados,jogo);console.log(`${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} SCORE ${res.score}`);
  if(res.score<SCORE_MINIMO)return;
  const casa=textoSeguro(jogo.homeTeam?.name);const fora=textoSeguro(jogo.awayTeam?.name);
  const msg=`🚨 *ELITE RADAR V20 — SINAL AO VIVO* 🚨\n\n⚽ *${casa} ${numero(jogo.homeScore?.current)} x ${numero(jogo.awayScore?.current)} ${fora}*\n\n⏱️ *INTERVALO*\n🚩 Cantos: *${dados.escanteios}*\n🎯 Chutes: *${dados.chutes}*\n🥅 Alvo: *${dados.chutesNoAlvo}*\n\n⭐ *${res.score}/100*\n\n🎯 *OVER 4.5 ESCANTEIOS 2º TEMPO*\n\n🕐 ${ULTIMO_CHECK}`;
  if(await sendTelegram(msg)){JOGOS_JA_AVISADOS.add(jogo.id);}
  if(JOGOS_JA_AVISADOS.size>300)JOGOS_JA_AVISADOS.clear();
 }catch(e){console.log("Erro jogo",e.message);}
}

async function verificarJogosAoVivo(){
 if(!podeRodarAgora()){ULTIMO_CHECK=`Dormindo - ${new Date().toLocaleString("pt-BR")} - ${horarioTexto()}`;return;}
 ULTIMO_CHECK=new Date().toLocaleString("pt-BR");
 console.log(`\n[${ULTIMO_CHECK}] V20 buscando...`);
 try{
  const data=await getSofascore("https://api.sofascore.com/api/v1/sport/football/events/live");
  const jogos=data?.events||[];console.log(`Ao vivo ${jogos.length}`);
  const intervalo=jogos.filter(j=>j.status?.code===31||j.status?.type==="halftime");console.log(`Intervalo ${intervalo.length}`);
  for(const j of intervalo){await analisarJogo(j);}
  ULTIMO_ERRO="Nenhum - Proxy OK";
 }catch(e){ULTIMO_ERRO=e.message;console.log("ERRO",ULTIMO_ERRO);}
}

app.get("/",(req,res)=>res.json({status:"ELITE RADAR V20 ONLINE - 20MIN - PROXY FIX",score_minimo:SCORE_MINIMO,ultimo_check:ULTIMO_CHECK,total_enviados:TOTAL_ENVIADOS,total_analisados:TOTAL_ANALISADOS,ultimo_erro:ULTIMO_ERRO,intervalo:"20 minutos",horario:"Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",pode_rodar:podeRodarAgora()}));
app.get("/telegram-test",async(req,res)=>{const ok=await sendTelegram(`✅ *V20 TESTE OK - PROXY FIX - 20MIN*\n${ULTIMO_CHECK}`);res.json({ok,total_enviados:TOTAL_ENVIADOS});});
app.get("/limpar-cache",(req,res)=>{JOGOS_JA_AVISADOS.clear();res.json({ok:true});});
setInterval(verificarJogosAoVivo,INTERVALO_MINUTOS*60*1000);verificarJogosAoVivo();
app.listen(PORT,()=>console.log(`🚀 V20 PROXY RODANDO ${PORT}`));
