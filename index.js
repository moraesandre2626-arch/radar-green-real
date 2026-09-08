const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || "";

let enviados = new Map();

function horaBrasil(){ return parseInt(new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",hour12:false}),10) }
function isHorarioAtivo(){ const h=horaBrasil(); return h>=9 && h<=23 }

async function enviarTelegram(t){
  if(!TELEGRAM_TOKEN||!CHAT_ID) return;
  try{ await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{chat_id:CHAT_ID,text:t,parse_mode:"Markdown"}) }catch(e){}
}

async function radar(){
  if(!isHorarioAtivo()) { console.log("Dormindo 00h-08h"); return {jogos:0, sinais:0}; }
  try{
    const res = await axios.get("https://api.sofascore.com/api/v1/sport/football/events/live", {
      headers: { "User-Agent":"Mozilla/5.0", "accept":"application/json" }, timeout: 10000
    });
    const jogos = res.data.events || [];
    let sinais = 0;

    for(const j of jogos){
      const min = j.time?.minute || j.status?.time || 0;
      if(min < 25) continue;

      const idKey = `${j.id}-${Math.floor(min/5)}`;
      if(enviados.has(idKey)) continue;

      const home = j.homeScore?.current ?? 0;
      const away = j.awayScore?.current ?? 0;
      const total = home + away;

      let score = 0;
      let motivo = [];

      if(min >= 25 && min <= 38 && total <= 2){ score = 85; motivo.push(`EARLY ${min}' - Jogo amarrado ${home}x${away}`); }
      else if(min >= 70 && min <= 88){ score = 88; motivo.push(`Pressão final ${min}'`); if(total <= 3) score += 5; }
      else if(min >= 85){ score = 92; motivo.push(`ABAFAMENTO ${min}'`); }
      else continue;

      if(total >= 5) continue;
      if(score < 82) continue;

      enviados.set(idKey, Date.now());
      sinais++;

      const emoji = score >= 90 ? "🔥🔥🔥" : "🟢";
      const msg = `${emoji} *GREEN REAL V7.5 - ${score} PTS*\n\n⚽ ${j.homeTeam.name} ${home} x ${away} ${j.awayTeam.name}\n⏱️ ${min}' | 🏆 ${j.tournament.name}\n📊 ${motivo.join(" | ")}\n\n💡 *OVER LIVE - SEM BLOQUEIO*\n🆔 ${j.id}`;
      await enviarTelegram(msg);

      if(sinais >= 4) break;
    }

    if(enviados.size > 300){
      const agora = Date.now();
      for(const [k,v] of enviados.entries()){ if(agora - v > 24*60*60*1000) enviados.delete(k); }
    }

    console.log(`[V7.5] ${jogos.length} jogos | ${sinais} sinais | 0 bloqueio`);
    return {jogos: jogos.length, sinais};
  }catch(e){ console.log("Erro:", e.message); return {jogos:0, sinais:0, erro:e.message}; }
}

app.get("/", (req,res) => res.send("V7.5 ZERO BLOQUEIO - Roda pra sempre sem chave"));
app.get("/health", (req,res) => res.json({
  versao: "V7.5 ZERO BLOQUEIO",
  status: isHorarioAtivo() ? "ATIVO 09h-23h" : "DORMINDO",
  bloqueio: "ZERO - sem API key, sem limite, nunca bloqueia",
  modo: "Sofascore FREE ilimitado",
  enviados: enviados.size,
  instrucao: "Bota pra rodar e esquece"
}));
app.get("/radar", async (req,res) => {
  const r = await radar();
  res.json({status:`V7.5 - ${r.sinais} sinais`, fonte:"Sofascore FREE", bloqueio:"NUNCA", ...r, timestamp: new Date().toISOString()});
});

// Roda sozinho a cada 3 minutos
setInterval(radar, 3 * 60 * 1000);
radar();

app.listen(PORT, () => console.log(`V7.5 ZERO BLOQUEIO na porta ${PORT} - SEM CHAVE, SEM BLOQUEIO`));
