const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.CHAT_ID || "").trim();

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let JOGOS_JA_AVISADOS = new Set(); // anti-spam por jogo

function dormir(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function sendTelegram(texto) {
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: texto,
      parse_mode: "Markdown"
    });
    TOTAL_ENVIADOS++;
    return true;
  } catch(e){
    console.log("ERRO TG:", e.response?.data || e.message);
    return false;
  }
}

function podeRodarAgora() {
  const horaBR = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
  return horaBR >= 8 && horaBR < 24;
}

async function verificarJogosAoVivo() {
  if (!podeRodarAgora()) {
    ULTIMO_CHECK = `Dormindo (00h-08h) - ${new Date().toLocaleString("pt-BR")}`;
    console.log(ULTIMO_CHECK);
    return;
  }

  ULTIMO_CHECK = new Date().toLocaleString("pt-BR");
  console.log(`[${ULTIMO_CHECK}] Buscando jogos no intervalo no Sofascore...`);

  try {
    // 1. Pega todos os jogos ao vivo
    const liveRes = await axios.get("https://api.sofascore.com/api/v1/sport/football/events/live", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      },
      timeout: 15000
    });

    const jogos = liveRes.data.events || [];
    console.log(`Total ao vivo: ${jogos.length}`);

    for (const jogo of jogos) {
      // Só interessa jogo no INTERVALO (status code 31 no Sofascore)
      if (jogo.status?.code !== 31 && jogo.status?.type !== "halftime") continue;

      const id = jogo.id;
      if (JOGOS_JA_AVISADOS.has(id)) continue; // já avisou esse jogo

      await dormir(4000); // anti-block Sofascore

      try {
        // 2. Pega estatísticas do jogo
        const statsRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/statistics`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000
        });

        const allStats = statsRes.data.statistics || [];
        const period1 = allStats.find(p => p.period === "1ST") || allStats[0];
        if (!period1) continue;

        const groups = period1.groups || [];
        
        let chutes = 0, escanteios = 0;
        
        groups.forEach(g => {
          g.statisticsItems?.forEach(item => {
            const name = item.name?.toLowerCase();
            if (name.includes("total shots") || name.includes("chutes")) {
              chutes += (item.home || 0) + (item.away || 0);
            }
            if (name.includes("corner") || name.includes("escanteio")) {
              escanteios += (item.home || 0) + (item.away || 0);
            }
          });
        });

        console.log(`Jogo ${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} - 1ºT: ${chutes} chutes, ${escanteios} cantos`);

        // 3. SUA REGRA DE OURO VALIDADA
        if (escanteios <= 5 && chutes >= 14 && escanteios > 0) {
          const msg = `🚨 *PADRÃO EXPLOSÃO ENCONTRADO - AO VIVO* 🚨\n\n⚽ ${jogo.homeTeam?.name} ${jogo.homeScore?.current} x ${jogo.awayScore?.current} ${jogo.awayTeam?.name}\n⏱️ INTERVALO\n\n📊 *1º Tempo:*\n• ${escanteios} escanteios\n• ${chutes} chutes totais\n\n🔥 *Padrão igual Real 2x1 Inter que deu 10 cantos no 2ºT*\n\n🎯 *ENTRADA:* OVER 4.5 ESCANTEIOS NO 2º TEMPO\n💰 Confiança: ALTA\n\nHora: ${ULTIMO_CHECK}`;

          await sendTelegram(msg);
          JOGOS_JA_AVISADOS.add(id);
          
          // Limpa lista a cada 6h pra não lotar memória
          if (JOGOS_JA_AVISADOS.size > 100) JOGOS_JA_AVISADOS.clear();
        }

      } catch (e) {
        console.log(`Erro stats jogo ${id}: ${e.message}`);
      }
    }

  } catch (e) {
    console.log("Erro ao buscar live:", e.message);
  }
}

app.get("/", (req,res)=>{
  res.json({
    status: "V17 SOFASCORE AO VIVO ONLINE",
    regra: "INTERVALO: <=5 cantos + >=14 chutes => OVER 4.5 2ºT",
    validacao: "Real 2x1 Inter: 1ºT 5 cantos/17 chutes -> 2ºT 10 cantos",
    ultimo_check: ULTIMO_CHECK,
    total_enviados: TOTAL_ENVIADOS,
    jogos_avistados: JOGOS_JA_AVISADOS.size,
    intervalo: "30 min | 08h-00h BRT",
    pode_rodar: podeRodarAgora()
  });
});

app.get("/telegram-test", async (req,res)=>{
  await sendTelegram(`✅ *V17 AO VIVO TESTE OK*\nRegra: INTERVALO ≤5 cantos + ≥14 chutes = OVER 4.5 2ºT\nJá buscando jogos reais no Sofascore\n${ULTIMO_CHECK}`);
  res.json({ok:true, total:TOTAL_ENVIADOS});
});

app.get("/limpar-cache", (req,res)=>{
  JOGOS_JA_AVISADOS.clear();
  res.json({limpo:true});
});

// RODA DE 30 EM 30 MIN - 08h às 00h
setInterval(verificarJogosAoVivo, 30 * 60 * 1000);
verificarJogosAoVivo();

app.listen(PORT, ()=>console.log("V17 AO VIVO RODANDO"));
