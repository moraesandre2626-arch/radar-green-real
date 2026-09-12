const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Nenhum';
let enviados = new Set();

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
];

function getHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com'
  };
}

async function enviarTelegram(msg) {
  try {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await axios.get(`https://api.telegram.org/bot${token}/sendMessage`, {
      params: { chat_id: chatId, text: msg, parse_mode: 'HTML' }
    });
  } catch (e) { console.log('Erro telegram:', e.message); }
}

async function getLiveEvents() {
  try {
    const url = 'https://api.sofascore.com/api/v1/sport/football/events/live';
    const res = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
    ultimoErro = 'OK - ' + new Date().toLocaleTimeString('pt-BR');
    return res.data.events || [];
  } catch (e) {
    ultimoErro = `Erro: ${e.message} ${e.response?.status || ''} - ${new Date().toLocaleTimeString('pt-BR')}`;
    try {
      const url2 = 'https://www.sofascore.com/api/v1/sport/football/events/live';
      const res2 = await axios.get(url2, { headers: getHeaders(), timeout: 15000 });
      ultimoErro = 'OK fallback - ' + new Date().toLocaleTimeString('pt-BR');
      return res2.data.events || [];
    } catch (e2) {
      ultimoErro = `403 duplo: ${e2.message} - ${new Date().toLocaleTimeString('pt-BR')}`;
      return [];
    }
  }
}

async function analisar() {
  ultimoScan = new Date().toLocaleString('pt-BR');
  const events = await getLiveEvents();
  jogosAoVivo = events.length;
  console.log(`Scan: ${jogosAoVivo} jogos`);
  for (const ev of events) {
    if (enviados.has(ev.id)) continue;
    const minuto = ev.time?.played || ev.time?.minute || 0;
    const homeC = ev.homeScore?.corner || 0;
    const awayC = ev.awayScore?.corner || 0;
    const total = homeC + awayC;
    if (minuto >= 65 && total >= 6) {
      const msg = `🟢 <b>RADAR V25.2</b>\n⚽ ${ev.homeTeam?.name} x ${ev.awayTeam?.name}\n⏱️ ${minuto}'\n🚩 ${total} escanteios`;
      await enviarTelegram(msg);
      enviados.add(ev.id);
    }
  }
}

app.get('/', (req,res) => {
  res.json({
    versao: "V25.2 ANTI-403 FIX",
    telegram_configurado: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID),
    ultimo_scan: ultimoScan,
    jogos_ao_vivo: jogosAoVivo,
    ultimo_erro: ultimoErro
  });
});

app.get('/teste', async (req,res) => {
  await enviarTelegram(`✅ Teste V25.2 OK! ${new Date().toLocaleTimeString('pt-BR')}`);
  res.send('Teste enviado!');
});

setInterval(analisar, 1000*60*3);
analisar();
app.listen(PORT, () => console.log('Rodando ' + PORT));
