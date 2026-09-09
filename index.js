// ============================================================
// ELITE RADAR V19 - ANTI 403 + 20MIN + HORÁRIO INTELIGENTE
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
const DELAY_SOFASCORE = 3500;

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let TOTAL_ANALISADOS = 0;
let TOTAL_CANDIDATOS = 0;
let ULTIMO_ERRO = "Nenhum";
let JOGOS_JA_AVISADOS = new Set();

function dormir(ms){return new Promise(r=>setTimeout(r,ms));}
function numero(v){if(v==null)return 0;if(typeof v=="number")return isFinite(v)?v:0;const n=parseFloat(String(v).replace("%","").replace(",","."));return isFinite(n)?n:0;}
function textoSeguro(v){return String(v||"").replace(/[*_`\[\]]/g,"");}
function podeRodarAgora(){const agora=new Date();const brasil=new Date(agora.toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));const h=brasil.getHours();const d=brasil.getDay();const fds=d===0||d===6;return fds?h>=8&&h<24:h>=12&&h<24;}
function horarioTexto(){const agora=new Date();const brasil=new Date(agora.toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));const d=brasil.getDay();return (d===0||d===6)?"Sab-Dom 08h-00h BRT":"Seg-Sex 12h-00h BRT";}

async function sendTelegram(texto){
 if(!TOKEN||!CHAT_ID)return false;
 try{await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:texto,parse_mode:"Markdown"},{timeout:10000});TOTAL_ENVIADOS++;return true;}catch(e){console.log("ERRO TG",e.message);return false;}
}

const UAS = [
 "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
 "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
 "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

function getHeaders(){
 return {
  "User-Agent": UAS[Math.floor(Math.random()*UAS.length)],
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
  "Referer": "https://www.sofascore.com/",
  "Origin": "https://www.sofascore.com",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site"
 };
}

async function getComRetry(url, tentativas=3){
 for(let i=0;i<tentativas;i++){
  try{
   const r = await axios.get(url,{headers:getHeaders(),timeout:15000});
   return r;
  }catch(e){
   const status = e.response?.status;
   console.log(`Tentativa ${i+1} falhou ${url} status ${status}`);
   if(status===403 && i < tentativas-1){await dormir(2000 + Math.random()*2000); continue;}
   throw e;
  }
 }
}

function extrairEstatisticas(periodo){
 let escanteios=0,chutes=0,chutesNoAlvo=0,chutesCasa=0,chutesFora=0,alvoCasa=0,alvoFora=0,cantosCasa=0,cantosFora=0,ataquesPerigososCasa=0,ataquesPerigososFora=0,posseCasa=0,posseFora=0;
 const grupos=periodo?.groups||[];
 for(const grupo of grupos){for(const item of grupo.statisticsItems||[]){const nome=String(item.name||"").toLowerCase();const home=numero(item.home);const away=numero(item.away);
  if(nome.includes("corner")||nome.includes("escanteio")){escanteios+=home+away;cantosCasa+=home;cantosFora+=away;continue;}
  if(nome==="total shots"||nome==="shots"||nome.includes("total shots")){chutes+=home+away;chutesCasa+=home;chutesFora+=away;continue;}
  if(nome.includes("shots on target")||nome.includes("shots on goal")){chutesNoAlvo+=home+away;alvoCasa+=home;alvoFora+=away;continue;}
  if(nome.includes("dangerous attacks")){ataquesPerigososCasa+=home;ataquesPerigososFora+=away;continue;}
  if(nome.includes("ball possession")||nome.includes("possession")){posseCasa=home;posseFora=away;continue;}
 }}
 return {escanteios,chutes,chutesNoAlvo,chutesCasa,chutesFora,alvoCasa,alvoFora,cantosCasa,cantosFora,ataquesPerigososCasa,ataquesPerigososFora,posseCasa,posseFora};
}

function calcularScore(dados,jogo){
 let score=0;const motivos=[];const {escanteios,chutes,chutesNoAlvo,chutesCasa,chutesFora,alvoCasa,alvoFora,cantosCasa,cantosFora,ataquesPerigososCasa,ataquesPerigososFora,posseCasa,posseFora}=dados;
 if(escanteios<=2){score+=20;motivos.push("poucos cantos");}else if(escanteios<=3){score+=16;motivos.push("cantos baixos");}else if(escanteios<=5){score+=10;motivos.push("até 5 cantos");}else return {score:0,motivos:["cantos acima"]};
 if(chutes>=20){score+=25;motivos.push("20+ chutes");}else if(chutes>=17){score+=21;motivos.push("17+ chutes");}else if(chutes>=14){score+=16;motivos.push("14+ chutes");}else return {score:0,motivos:["poucos chutes"]};
 if(chutesNoAlvo>=8){score+=20;motivos.push("8+ no alvo");}else if(chutesNoAlvo>=6){score+=16;motivos.push("6+ no alvo");}else if(chutesNoAlvo>=4){score+=10;motivos.push("4+ no alvo");}else{score-=5;motivos.push("poucos no alvo");}
 const maiorVolume=Math.max(chutesCasa,chutesFora);if(maiorVolume>=10){score+=10;motivos.push("forte domínio");}
 const ataquesTotal=ataquesPerigososCasa+ataquesPerigososFora;if(ataquesTotal>=70){score+=8;motivos.push("muitos ataques perigosos");}
 const maiorPosse=Math.max(posseCasa,posseFora);if(maiorPosse>=65){score+=5;motivos.push("posse dominante");}
 const golsCasa=numero(jogo.homeScore?.current);const golsFora=numero(jogo.awayScore?.current);const diff=Math.abs(golsCasa-golsFora);if(diff===0){score+=5;motivos.push("empatado");}else if(diff>=3){score-=8;motivos.push("placar aberto");}
 score=Math.max(0,Math.min(100,score));return {score,motivos};
}
function classificacao(s){if(s>=90)return "🔥🔥 EXCEPCIONAL";if(s>=85)return "🔥 MUITO FORTE";if(s>=75)return "🟢 SINAL FORTE";if(s>=65)return "🟡 OBSERVAÇÃO";return "⚪ FRACO";}

async function buscarEstatisticas(id){
 const resposta = await getComRetry(`https://api.sofascore.com/api/v1/event/${id}/statistics`,3);
 const periodos=resposta.data?.statistics||[];
 const primeiroTempo=periodos.find(p=>p.period==="1ST"||p.period==="ALL");
 if(!primeiroTempo)return null;
 return extrairEstatisticas(primeiroTempo);
}

async function analisarJogo(jogo){
 const id=jogo.id;if(!id||JOGOS_JA_AVISADOS.has(id))return;
 TOTAL_ANALISADOS++;await dormir(DELAY_SOFASCORE);
 try{
  const dados=await buscarEstatisticas(id);if(!dados)return;
  console.log(`${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} | C:${dados.escanteios} CH:${dados.chutes} ALVO:${dados.chutesNoAlvo}`);
  if(dados.escanteios>5||dados.chutes<14)return;
  TOTAL_CANDIDATOS++;
  const resultado=calcularScore(dados,jogo);console.log(`SCORE ${resultado.score}`);
  if(resultado.score<SCORE_MINIMO)return;
  const casa=textoSeguro(jogo.homeTeam?.name);const fora=textoSeguro(jogo.awayTeam?.name);
  const golsCasa=numero(jogo.homeScore?.current);const golsFora=numero(jogo.awayScore?.current);
  const mensagem=`🚨 *ELITE RADAR V19 — SINAL AO VIVO* 🚨\n\n⚽ *${casa} ${golsCasa} x ${golsFora} ${fora}*\n\n⏱️ *INTERVALO*\n\n📊 *1º TEMPO*\n🚩 Escanteios: *${dados.escanteios}*\n🎯 Chutes: *${dados.chutes}*\n🥅 No alvo: *${dados.chutesNoAlvo}*\n\n📈 *SCORE*\n⭐ *${resultado.score}/100*\n${classificacao(resultado.score)}\n\n🎯 *OVER 4.5 ESCANTEIOS — 2º TEMPO*\n\n🕐 ${ULTIMO_CHECK}`;
  if(await sendTelegram(mensagem)){JOGOS_JA_AVISADOS.add(id);console.log("✅ ENVIADO");}
  if(JOGOS_JA_AVISADOS.size>300)JOGOS_JA_AVISADOS.clear();
 }catch(e){console.log(`Erro jogo ${id}`,e.message);}
}

async function verificarJogosAoVivo(){
 if(!podeRodarAgora()){ULTIMO_CHECK=`Dormindo - ${new Date().toLocaleString("pt-BR")} - ${horarioTexto()}`;console.log(ULTIMO_CHECK);return;}
 ULTIMO_CHECK=new Date().toLocaleString("pt-BR");
 console.log(`\n[${ULTIMO_CHECK}] V19 - 20MIN buscando...`);
 try{
  const resposta=await getComRetry("https://api.sofascore.com/api/v1/sport/football/events/live",3);
  const jogos=resposta.data?.events||[];console.log(`Total: ${jogos.length}`);
  const intervalo=jogos.filter(j=>j.status?.code===31||j.status?.type==="halftime");console.log(`Intervalo: ${intervalo.length}`);
  for(const jogo of intervalo){await analisarJogo(jogo);}
  ULTIMO_ERRO="Nenhum";
 }catch(e){ULTIMO_ERRO=e.response?.data||e.message;console.log("ERRO BUSCAR",ULTIMO_ERRO);}
}

app.get("/",(req,res)=>{res.json({status:"ELITE RADAR V19 ONLINE - 20MIN - ANTI403",score_minimo:SCORE_MINIMO,ultimo_check:ULTIMO_CHECK,total_enviados:TOTAL_ENVIADOS,total_analisados:TOTAL_ANALISADOS,total_candidatos:TOTAL_CANDIDATOS,jogos_avistados:JOGOS_JA_AVISADOS.size,ultimo_erro:ULTIMO_ERRO,intervalo:"20 minutos",horario:"Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",pode_rodar:podeRodarAgora(),horario_atual:horarioTexto()});});
app.get("/telegram-test",async(req,res)=>{const ok=await sendTelegram(`✅ *V19 TESTE OK - 20MIN - ANTI403*\nScore >=${SCORE_MINIMO}\n${ULTIMO_CHECK}`);res.json({ok,total_enviados:TOTAL_ENVIADOS});});
app.get("/limpar-cache",(req,res)=>{const a=JOGOS_JA_AVISADOS.size;JOGOS_JA_AVISADOS.clear();res.json({limpo:true,antes:a});});
setInterval(verificarJogosAoVivo,INTERVALO_MINUTOS*60*1000);verificarJogosAoVivo();
app.listen(PORT,()=>console.log(`🚀 V19 RODANDO NA PORTA ${PORT}`));
