const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando V28.1...';
let enviados = new Set();

async function enviarTelegram(msg) {
  try {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token ||!chatId) return;
    await axios.get(`https://api.telegram.org/bot${token}/sendMessage`, {
      params: { chat_id: chatId, text: msg, parse_mode: 'HTML' }
    });
  } catch(e){}
}

async function getLiveESPN() {
  try {
    const ligas = ['bra.1','bra.2','eng.1','eng.2','esp.1','ita.1','ger.1','fra.1','por.1','ned.1','arg.1','usa.1','mex.1','chl.1','uefa.champions'];
    let todos = [];
    for(const liga of ligas){
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`;
        const res = await axios.get(url, { timeout: 10000 });
        if(res.data.events) todos = todos.concat(res.data.events);
      } catch{}
    }

    const aoVivo = todos.filter(ev => {
      try {
        const status = ev.competitions[0].status.type.name;
        return status === 'STATUS_IN_PROGRESS';
      } catch { return false }
    });

    ultimoErro = `OK ESPN ${aoVivo.length} ao vivo / ${todos.length} total - ${new Date().toLocaleTimeString('pt-BR')}`;

    return aoVivo.map(ev => {
      const comp = ev.competitions[0];
      const home = comp.competitors.find(c=>c.homeAway==='home') || comp.competitors[0];
      const away = comp.competitors.find(c=>c.homeAway==='away') || comp.competitors[1];
      const clock = comp.status.displayClock || "";
      const minuto = parseInt(clock) || comp.status.clock || 0;

      let cantos = 0;
      try {
        if(comp.statistics) {
          const c = comp.statistics.find(s => s.name === 'cornerKicks');
          if(c) cantos = parseInt(c.displayValue) || 0;
        }
      } catch{}

      return {
        id: ev.id,
        homeTeam: { name: home.team.displayName },
        awayTeam: { name: away.team.displayName },
        time: { played: minuto },
        corners: cantos,
        score: `${home.score} x ${away.score}`
      };
    });
  } catch (e) {
    ultimoErro = `Erro V28.1: ${e.message} - ${new Date().toLocaleTimeString('pt-BR')}`;
    return [];
  }
}

async function analisar() {
  ultimoScan = new Date().toLocaleString('pt-BR');
  const events = await getLiveESPN();
  jogosAoVivo = events.length;
  console.log(`[V28.1 ESCANTEIO] ${jogosAoVivo} jogos - ${ultimoErro}`);

  for (const ev of events) {
    if (enviados.has(ev.id)) continue;
    const minuto = ev.time.played;
    const cantos = ev.corners;

    if (minuto >= 65 && cantos >= 6) {
      const msg = `🚩 <b>RADAR ESCANTEIO V28.1</b>\n⚽ ${ev.homeTeam.name} x ${ev.awayTeam.name}\n⏱️ ${minuto}'\n🚩 ${cantos} escanteios\n📊 ${ev.score}\n🔥 PRESSÃO FINAL!`;
      await enviarTelegram(msg);
      enviados.add(ev.id);
    }
  }
  if(enviados.size>200) enviados.clear();
}

app.get('/', (req,res) => {
  res.json({
    versao: "V28.1 FINAL - SO ESCANTEIO 5MIN",
    telegram_configurado:!!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID),
    ultimo_scan: ultimoScan,
    jogos_ao_v
