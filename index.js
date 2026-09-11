const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

const API_KEY = process.env.API_FOOTBALL_KEY;
const EFO_IDS_RAW = process.env.EFO_IDS || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;

const BR_TZ = "America/Sao_Paulo";
const BASE_URL = "https://v3.football.api-sports.io";

let REQUISICOES_HOJE = 0;
let DATA_RESET = new Date().toLocaleDateString('pt-BR', {timeZone: BR_TZ});
let ULTIMO_ERRO = null;
let ULTIMO_SCAN = null;

const EFO_IDS = EFO_IDS_RAW.split(",").map(x=>parseInt(x.trim())).filter(x=>!isNaN(x));

function contarReq(n=1){
  const hoje = new Date().toLocaleDateString('pt-BR', {timeZone: BR_TZ});
  if(hoje !== DATA_RESET){ REQUISICOES_HOJE = 0; DATA_RESET = hoje; }
  REQUISICOES_HOJE += n;
}

async function enviarTelegram(msg){
  if(!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return false;
  try{
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: TELEGRAM_CHAT, text: msg, parse_mode:'HTML'})
    });
    return res.ok;
  }catch(e){ console.log("Erro Telegram",e); return false; }
}

function calcularScore(statsHome, statsAway, posseHome=50){
  try{
    const getVal = (stats, nome) => {
      const f = stats.find(s=>s.type.toLowerCase() === nome.toLowerCase());
      return f && f.value !== null ? f.value : 0;
    };
    const chutes = parseInt(getVal(statsHome,'Total Shots')||0);
    const escH = parseInt(getVal(statsHome,'Corner Kicks')||0);
    const escA = parseInt(getVal(statsAway,'Corner Kicks')||0);
    const ataques = parseInt(getVal(statsHome,'Dangerous Attacks')||0);
    let score = 0;
    if(posseHome >= 65) score+=25; else if(posseHome >=60) score+=15;
    if(chutes >=10) score+=25; else if(chutes>=7) score+=15;
    if(escH >=6) score+=30; else if(escH>=4) score+=20; else if(escH>=3) score+=10;
    if(escH>=3 && escA===0) score+=15;
    if(ataques>=30) score+=10;
    return {score: Math.min(score,100), chutes, escH, escA};
  }catch{ return {score:0,chutes:0,escH:0,escA:0}; }
}

async function scan(){
  if(!API_KEY){ ULTIMO_ERRO="Sem API_FOOTBALL_KEY"; return; }
  try{
    console.log(`[SCAN V24.1] ${new Date().toLocaleString('pt-BR',{timeZone:BR_TZ})}`);
    const r = await fetch(`${BASE_URL}/fixtures?live=all`,{headers:{"x-apisports-key":API_KEY}});
    contarReq(1);
    if(!r.ok){ ULTIMO_ERRO=`API ${r.status}`; return; }
    const data = await r.json();
    let jogos = data.response || [];
    if(EFO_IDS.length) jogos = jogos.filter(j=>EFO_IDS.includes(j.league.id));

    let candidatos = jogos.filter(j=>{
      const s = j.fixture.status.short;
      const el = j.fixture.status.elapsed || 0;
      return s==='HT' || (s==='2H' && el>=46 && el<=65);
    }).slice(0,2);

    console.log(`Candidatos: ${candidatos.length}`);
    for(const jogo of candidatos){
      const fid = jogo.fixture.id;
      const elapsed = jogo.fixture.status.elapsed || 0;
      const statusShort = jogo.fixture.status.short;
      const home = jogo.teams.home.name;
      const away = jogo.teams.away.name;
      const golsH = jogo.goals.home||0;
      const golsA = jogo.goals.away||0;

      await new Promise(res=>setTimeout(res,1000));
      const rs = await fetch(`${BASE_URL}/fixtures/statistics?fixture=${fid}`,{headers:{"x-apisports-key":API_KEY}});
      contarReq(1);
      if(!rs.ok) continue;
      const statsData = await rs.json();
      const resp = statsData.response || [];
      if(resp.length<2) continue;

      const statsHome = resp[0].statistics;
      const statsAway = resp[1].statistics;
      let posseHome = 50;
      const posseObj = statsHome.find(s=>s.type==='Ball Possession');
      if(posseObj && posseObj.value) posseHome = parseInt(posseObj.value.replace('%',''))||50;

      const {score, chutes, escH, escA} = calcularScore(statsHome, statsAway, posseHome);
      const minimo = statusShort==='HT'?65:70;
      if(score>=minimo){
        const tipo = statusShort==='HT'? '🟢 INTERVALO' : `⚠️ ENTRADA TARDIA ${elapsed}'`;
        const msg = `${tipo} - ELITE RADAR V24.1\n\n<b>${home} ${golsH} x ${golsA} ${away}</b>\nScore: <b>${score}/100</b> | Status: ${statusShort} ${elapsed}'\nPosse: ${posseHome}% | Chutes: ${chutes} | Esc: ${escH}x${escA}\n\n<b>ENTRADA:</b> Over Escanteios FT / Over ${escH+2}.5 casa\nLiga ID: ${jogo.league.id}\n\nHora: ${new Date().toLocaleString('pt-BR',{timeZone:BR_TZ})} BRT`;
        await enviarTelegram(msg);
        console.log(`ALERTA ENVIADO: ${home} ${score}`);
      }
    }
    ULTIMO_SCAN = new Date();
    ULTIMO_ERRO = null;
  }catch(e){ ULTIMO_ERRO=e.message; console.log("Erro scan",e); }
}

setInterval(scan, 30*60*1000);
scan(); // roda na inicialização

app.get("/", (req,res)=>{
  const agora = new Date().toLocaleString('pt-BR',{timeZone:BR_TZ});
  const proximo = ULTIMO_SCAN ? new Date(ULTIMO_SCAN.getTime()+30*60*1000).toLocaleString('pt-BR',{timeZone:BR_TZ}) : "em 2 min";
  res.json({
    projeto: "ELITE RADAR V24.1 - ATE 65'",
    status: "online",
    fonte: "API-FOOTBALL",
    efo_ids_configurado: EFO_IDS.length>0,
    qtd_ligas_filtradas: EFO_IDS.length,
    telegram_configurado: !!(TELEGRAM_TOKEN && TELEGRAM_CHAT),
    requisicoes_hoje: REQUISICOES_HOJE,
    limite: 99,
    restantes: 99-REQUISICOES_HOJE,
    intervalo_scan: "30 min",
    max_jogos_scan: 2,
    regra: "HT (65+) OU 2H 46'-65' (70+)",
    ultimo_scan: ULTIMO_SCAN ? ULTIMO_SCAN.toLocaleString('pt-BR',{timeZone:BR_TZ}) : "aguardando 1º scan",
    proximo_scan: proximo,
    ultimo_erro: ULTIMO_ERRO,
    hora_brt: agora
  });
});

app.get("/telegram-test", async (req,res)=>{
  const ok = await enviarTelegram(`✅ TESTE V24.1 OK - ${new Date().toLocaleString('pt-BR',{timeZone:BR_TZ})} BRT\nRegra: HT 65+ ou até 65' 70+ - Igual Besiktas 8 escanteios`);
  res.json({ok, api: `${REQUISICOES_HOJE}/99`});
});

app.get("/limpar-cache", (req,res)=> res.json({ok:true, requisicoes_hoje:REQUISICOES_HOJE}));

app.listen(PORT, ()=> console.log(`Rodando na porta ${PORT}`));
