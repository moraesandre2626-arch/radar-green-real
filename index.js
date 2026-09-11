// ============================================================
// ELITE RADAR V24 - API-FOOTBALL - FINAL SEM SUSPENSÃO
// 72 reqs/dia = 30min + 2 jogos por scan
// ============================================================
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const API_KEY = (process.env.EFO_IDS || "").trim();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || "";
const CHAT_ID = process.env.CHAT_ID || "";
const API_BASE = "https://v3.football.api-sports.io";
const MAX_REQUESTS_DAY = 99;
const INTERVALO_SCAN_MS = 30 * 60 * 1000; // 30 MINUTOS PRA NÃO BLOQUEAR
const SCORE_MINIMO = 65;
const MAX_JOGOS_POR_SCAN = 2; // SÓ 2 POR VEZ = 72/DIA
const TIMEOUT_API = 15000;

let requisicoesHoje = 0, ultimoErro = null, ultimoScan = null, proximoScan = null;
let jogosAnalisados = 0, candidatosEncontrados = 0, alertasEnviados = 0, protecoes = 0, erros403 = 0, ultimoResetUTC = null;
const JOGOS_JA_AVISADOS = new Set();
const CACHE_FIXTURES = new Map();
const CACHE_TTL = 60 * 1000;

function log(...a){console.log(new Date().toISOString(),...a)}
function horaBRT(){return new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())}
function dataBRT(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function dataUTC(){return new Date().toISOString().slice(0,10)}
function verificarResetDiario(){const hoje=dataUTC();if(ultimoResetUTC!==hoje){ultimoResetUTC=hoje;requisicoesHoje=0;jogosAnalisados=0;candidatosEncontrados=0;alertasEnviados=0;protecoes=0;erros403=0;JOGOS_JA_AVISADOS.clear();log("🔄 RESET:",hoje)}}
function podeConsultarAPI(){verificarResetDiario();if(!API_KEY){ultimoErro="EFO_IDS não configurado";return false}if(requisicoesHoje>=MAX_REQUESTS_DAY){protecoes++;ultimoErro=`Limite ${MAX_REQUESTS_DAY}/dia`;return false}return true}
function registrarRequisicao(){requisicoesHoje++;log(`📡 REQ ${requisicoesHoje}/${MAX_REQUESTS_DAY}`)}

async function apiGet(endpoint, params={}){
  if(!podeConsultarAPI())throw new Error("LIMITE_API_INTERNO");
  if(requisicoesHoje + 3 > MAX_REQUESTS_DAY) throw new Error("PROTECAO_100");
  try{
    const r=await axios.get(`${API_BASE}${endpoint}`,{params,timeout:TIMEOUT_API,headers:{"x-apisports-key":API_KEY},validateStatus:()=>true});
    registrarRequisicao();
    if(r.status===403){erros403++;throw new Error("API_403_SUSPENSA")}
    if(r.status===429)throw new Error("API_429_LIMITE");
    if(r.status<200||r.status>=300)throw new Error(`HTTP_${r.status}`);
    return r.data;
  }catch(e){ultimoErro=e.message;throw e}
}
async function buscarJogosAoVivo(){
  const c=CACHE_FIXTURES.get("live");
  if(c&&Date.now()-c.timestamp<CACHE_TTL)return c.data;
  const d=await apiGet("/fixtures",{live:"all"});
  const j=Array.isArray(d.response)?d.response:[];
  CACHE_FIXTURES.set("live",{timestamp:Date.now(),data:j});
  return j;
}
function estaNoIntervalo(j){return j?.fixture?.status?.short==="HT"}
function numero(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;const n=parseFloat(String(v).replace("%","").replace(",",".").trim());return isFinite(n)?n:0}
function extrairEstatisticas(arr){
  if(!Array.isArray(arr)||arr.length<2)return null;
  const casa=arr[0],fora=arr[1];
  const pegar=(bloco,nomes)=>{const stats=Array.isArray(bloco.statistics)?bloco.statistics:[];for(const nome of nomes){const it=stats.find(s=>String(s.type).toLowerCase()===String(nome).toLowerCase());if(it)return numero(it.value)}return 0};
  return{
    home:{chutes:pegar(casa,["Total Shots"]),alvo:pegar(casa,["Shots on Goal"]),bloqueados:pegar(casa,["Blocked Shots"]),dentroArea:pegar(casa,["Shots insidebox"]),posse:pegar(casa,["Ball Possession"]),escanteios:pegar(casa,["Corner Kicks"])},
    away:{chutes:pegar(fora,["Total Shots"]),alvo:pegar(fora,["Shots on Goal"]),bloqueados:pegar(fora,["Blocked Shots"]),dentroArea:pegar(fora,["Shots insidebox"]),posse:pegar(fora,["Ball Possession"]),escanteios:pegar(fora,["Corner Kicks"])}
  }
}
function analisarPressao(d){const h=d.home,a=d.away;let bonus=0,f=[];const total=h.chutes+a.chutes,max=Math.max(h.chutes,a.chutes),diff=max-Math.min(h.chutes,a.chutes);
  if(total>=18){bonus+=12;f.push("18+ chutes")}else if(total>=15){bonus+=10;f.push("15+ chutes")}else if(total>=12){bonus+=8;f.push("12+ chutes")}else if(total>=9){bonus+=5;f.push("9+ chutes")}
  if(max>=10&&diff>=5){bonus+=15;f.push("forte domínio")}else if(max>=9&&diff>=4){bonus+=12;f.push("domínio")}else if(max>=7&&diff>=3){bonus+=8;f.push("vantagem chutes")}
  if(h.chutes>=6&&a.chutes>=6){bonus+=10;f.push("pressão dos dois lados")}
  const alvo=h.alvo+a.alvo;if(alvo>=7){bonus+=10;f.push("7+ no alvo")}else if(alvo>=5){bonus+=8;f.push("5+ no alvo")}else if(alvo>=3){bonus+=5;f.push("3+ no alvo")}
  return{bonus,fatores:f}
}
function calcularScore(d,j){let score=25;const p=analisarPressao(d);score+=p.bonus;const gc=numero(j.goals?.home),gf=numero(j.goals?.away);
  if(gc===0&&gf===0)score+=8;else if(gc===gf)score+=5;if(Math.abs(gc-gf)>=3)score-=8;
  if((d.home.chutes+d.away.chutes)<=5)score-=15;score=Math.max(0,Math.min(100,score));return{score,fatores:p.fatores}}
function classificacao(s){if(s>=90)return"🔥 EXCEPCIONAL";if(s>=85)return"🚀 MUITO FORTE";if(s>=75)return"🟢 FORTE";if(s>=65)return"🟡 ATIVADO";return"⚪ FRACO"}
function montarAlerta(r){const h=r.home,a=r.away,f=r.fatores.length?r.fatores.map(x=>`• ${x}`).join("\n"):"• Pressão geral";return`🚨 ELITE RADAR V24\n\n${r.classificacao}\n\n⚽ ${r.nome}\n📊 Placar: ${r.gols}\n⏱️ Intervalo\n\n🎯 SCORE: ${r.score}/100\n\n📈 PRESSÃO 1º TEMPO\nChutes: 🏠 ${h.chutes} x ✈️ ${a.chutes}\nNo alvo: 🏠 ${h.alvo} x ✈️ ${a.alvo}\nBloqueados: 🏠 ${h.bloqueados} x ✈️ ${a.bloqueados}\nDentro área: 🏠 ${h.dentroArea} x ✈️ ${a.dentroArea}\nPosse: 🏠 ${h.posse}% x ✈️ ${a.posse}%\n🚩 Escanteios HT: 🏠 ${h.escanteios} x ✈️ ${a.escanteios}\n\n⚠️ ESCANTEIOS NÃO ENTRAM NO SCORE.\n\n🔥 FATORES\n${f}\n\n🎯 MERCADO: PRESSÃO → ESCANTEIOS 2º TEMPO\n📡 API: API-FOOTBALL\n🔄 30min - 72 req/dia`;}
async function enviarTelegram(t){if(!TELEGRAM_TOKEN||!CHAT_ID)throw new Error("Telegram não configurado");const url=`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;const res=await axios.post(url,{chat_id:CHAT_ID,text:t,disable_web_page_preview:true},{timeout:12000});if(!res.data?.ok)throw new Error("Telegram recusou");return true}

async function executarScan(){
  verificarResetDiario();ultimoScan=new Date();log("================================================");log(`🔎 V24 SCAN BRT ${horaBRT()} API ${requisicoesHoje}/${MAX_REQUESTS_DAY}`);
  if(!podeConsultarAPI()){log("🛑 Quota protegida");return}
  try{
    const aoVivo=await buscarJogosAoVivo();log(`⚽ Ao vivo: ${aoVivo.length}`);
    let intervalo=aoVivo.filter(estaNoIntervalo);log(`⏸️ Intervalo: ${intervalo.length}`);
    if(!intervalo.length)return; intervalo=intervalo.slice(0,MAX_JOGOS_POR_SCAN);
    for(const jogo of intervalo){
      if(!podeConsultarAPI())break;
      const fixtureId=jogo.fixture?.id; if(!fixtureId||JOGOS_JA_AVISADOS.has(fixtureId))continue; jogosAnalisados++;
      try{
        const statsData=await apiGet("/fixtures/statistics",{fixture:fixtureId});
        const dados=extrairEstatisticas(statsData.response); if(!dados){log(`Sem stats ${fixtureId}`);continue}
        const total=dados.home.chutes+dados.away.chutes; if(total<7){log(`Descartado ${fixtureId} ${total} chutes`);continue}
        const rs=calcularScore(dados,jogo); if(rs.score<65){log(`Abaixo score ${fixtureId}: ${rs.score}`);continue}
        candidatosEncontrados++; const casa=jogo.teams?.home?.name||"Casa",fora=jogo.teams?.away?.name||"Fora";
        const resultado={id:fixtureId,nome:`${casa} x ${fora}`,score:rs.score,classificacao:classificacao(rs.score),gols:`${jogo.goals?.home??0} x ${jogo.goals?.away??0}`,home:dados.home,away:dados.away,fatores:rs.fatores};
        log(`🎯 CANDIDATO: ${resultado.nome} | ${resultado.score}`); await enviarTelegram(montarAlerta(resultado)); JOGOS_JA_AVISADOS.add(fixtureId); alertasEnviados++;
      }catch(err){ultimoErro=err.message;log(`❌ Erro ${jogo.fixture?.id}: ${err.message}`)}
      await new Promise(r=>setTimeout(r,800));
    }
  }catch(e){ultimoErro=e.message;log("❌ ERRO SCAN:",e.message)}
  log(`📊 Consumo: ${requisicoesHoje}/${MAX_REQUESTS_DAY}`);
}
function estaNoHorarioRadar(){const agora=new Date();const hora=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",hour:"2-digit",hour12:false}).format(agora));const dia=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",weekday:"short"}).format(agora);const fds=dia==="Sat"||dia==="Sun";return fds?(hora>=8&&hora<24):(hora>=12&&hora<24)}
async function loopRadar(){try{if(estaNoHorarioRadar())await executarScan();else log(`⏰ Fora horário BRT ${horaBRT()}`)}catch(e){ultimoErro=e.message;log("❌ LOOP",e.message)}proximoScan=new Date(Date.now()+INTERVALO_SCAN_MS);setTimeout(loopRadar,INTERVALO_SCAN_MS)}
app.get("/",(req,res)=>{verificarResetDiario();res.json({projeto:"ELITE RADAR V24",status:"online",fonte:"API-FOOTBALL",efo_ids_configurado:!!API_KEY,telegram_configurado:!!(TELEGRAM_TOKEN&&CHAT_ID),requisicoes_hoje:requisicoesHoje,limite:MAX_REQUESTS_DAY,restantes:Math.max(0,MAX_REQUESTS_DAY-requisicoesHoje),intervalo_scan:"30 min",max_jogos_scan:MAX_JOGOS_POR_SCAN,score_minimo:SCORE_MINIMO,jogos_analisados:jogosAnalisados,candidatos:candidatosEncontrados,alertas:alertasEnviados,ultimo_scan:ultimoScan,proximo_scan:proximoScan,ultimo_erro:ultimoErro,hora_brt:horaBRT()})});
app.get("/api-status",(req,res)=>{verificarResetDiario();res.json({api:"API-FOOTBALL",configurada:!!API_KEY,requisicoes:requisicoesHoje,limite:MAX_REQUESTS_DAY,restantes:Math.max(0,MAX_REQUESTS_DAY-requisicoesHoje),ultimo_erro:ultimoErro,erros_403:erros403})});
app.get("/telegram-test",async(req,res)=>{try{await enviarTelegram(`🟢 V24 TESTE OK\n📡 API: ${requisicoesHoje}/${MAX_REQUESTS_DAY}\n🕐 BRT: ${horaBRT()}`);res.json({ok:true})}catch(e){res.status(500).json({ok:false,erro:e.message})}});
app.get("/limpar-cache",(req,res)=>{CACHE_FIXTURES.clear();res.json({ok:true})});
app.listen(PORT,()=>{log("================================================");log(`🚀 V24 API-FOOTBALL RODANDO PORTA ${PORT}`);log(`📊 LIMITE: ${MAX_REQUESTS_DAY}/DIA - 30min + 2 jogos = 72/dia`);setTimeout(loopRadar,5000)});
