const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando...';
let enviados = new Set();

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
];

function getHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random()*USER_AGENTS.length)],
    'Accept': 'application/json',
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
  } catch(e){ console.log('Telegram erro', e.message) }
}

async function getLiveEvents() {
  const target = 'https://api.sofascore.com/api/v1/sport/football/events/live';
  
  const PROXYS = [
    (url) => url, // 1 - direto
    (url) => `https://www.sofascore.com/api/v1/sport/football/events/live`, // 2 - www direto
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, // 3
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, // 4
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`, // 5
    (url) => `https://thingproxy.freeboard.name/fetch/${url}`, // 6
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` // 7 - json mode
  ];

  for (let i=0; i<PROXYS.length; i++) {
    try {
      const proxyUrl = PROXYS[i](target);
      console.log(`Tentando fonte ${i+1}: ${proxyUrl.substring(0,60)}`);
      const res = await axios.get(proxyUrl, { headers: getHeaders(), timeout: 20000 });
      
      let data = res.data;
      if (data && data.contents) { // allorigins get mode
        data = JSON.parse(data.contents);
      } else if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch{}
      }

      if (data && data.events) {
        ultimoErro = `OK FONTE ${i+1} - ${new Date().toLocaleTimeString('pt-BR')}`;
        return data.events;
      }
    } catch (e) {
      console.log(`Fonte ${i+1} falhou: ${e.message}`);
      continue; // tenta proxima
    }
  }
  
  ultimoErro = `FALHA 7 FONTES - ${new Date().toLocaleTimeString('pt-BR')}`;
  return [];
}

async function analisar() {
  ultimoScan = new Date().toLocaleString('pt-BR');
  const events = await getLiveEvents();
  jogosAoVivo = events.length;
  console.log(`[${ultimoScan}] Scan V26 MAX: ${jogosAoVivo} jogos | ${ultimoErro}`);
  
  if (events.length === 0) return;

  for (const ev of events) {
    if (enviados.has(ev.id)) continue;
    const minuto = ev.time?.played || ev.time?.minute || ev.statusTime?.played || 0;
    const homeC = ev.homeScore?.corner || 0;
    const awayC = ev.awayScore?.corner || 0;
    const total = homeC + awayC;
    
    // SUA REGRA ORIGINAL MANTIDA
    if (minuto >= 65 && total >= 6) {
      const msg = `🟢 <b>RADAR V26 MAX</b>\n⚽ ${ev.homeTeam?.name} x ${ev.awayTeam?.name}\n⏱️ ${minuto}'\n🚩 ${total} escanteios\n✅ ${ultimoErro}`;
      await enviarTelegram(msg);
      enviados.add(ev.id);
    }
  }
  if (enviados.size > 200) enviados.clear();
}

app.get('/', (req,res) => {
  res.json({
    versao: "V26 MAX GARANTIA 7 FONTES",
    telegram_configurado: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID),
    ultimo_scan: ultimoScan,
    jogos_ao_vivo: jogosAoVivo,
    ultimo_erro: ultimoErro
  });
});

app.get('/teste', async (req,res) => {
  await enviarTelegram(`✅ Teste V26 MAX OK! ${new Date().toLocaleTimeString('pt-BR')}\n${ultimoErro}`);
  res.send('Teste enviado!');
});

setInterval(analisar, 1000*60*2);
analisar();
app.listen(PORT, () => console.log('V26 MAX Rodando ' + PORT));
