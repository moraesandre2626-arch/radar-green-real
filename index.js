const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando V28...';
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
    // Busca Brasileirão + Premier + LaLiga + todos ao vivo
    const ligas = ['bra.1','eng.1','esp.1','ita.1','ger.1'];
    let todos = [];
    for(const liga of ligas){
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`;
        const res = await axios.get(url, { timeout: 10000 });
        if(res.data.events) todos = todos.concat(res.data.events);
      } catch{}
    }

    // Filtra só ao vivo
    const aoVivo = todos.filter(ev => {
      const status = ev.competitions[0].status.type.name;
      return status === 'STATUS_IN_PROGRESS';
    });

    ultimoErro = `OK ESPN ${aoVivo.length} ao vivo / ${todos.length} total - ${new Date().toLocaleTimeString('pt-BR')}`;

    return aoVivo.map(ev => {
      const comp = ev.competitions[0];
      const home = comp.competitors.find(c=>c.homeAway==='home');
      const away = comp.competitors.find(c=>c.homeAway==='away');
      const clock = comp.status.displayClock || "0'";
      const minuto = parseInt(clock) || comp.status.clock || 0;

      // Pega escanteios das stats da ESPN
      let cantos = 0;
      try {
        const stats = comp.statistics || [];
        const cornerStat = stats.find(s => s.name === 'cornerKicks' || s.displayName === 'Corner Kicks');
        if(cornerStat){
          cantos = parseInt(cornerStat.displayValue) || 0;
        } else {
          // estima pela pressão se não tiver stat
          cantos = (home.statistics?.find(s=>s.name==='cornerKicks')?.displayValue || 0) + (away.statistics?.find(s=>s.name==='cornerKicks')?.displayValue || 0);
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
    ultimoErro = `Erro V28: ${e.message} - ${new Date().toLocaleTimeString('pt-BR')}`;
    return [];
  }
}

async function analisar() {
  ultimoScan = new Date().toLocaleString('pt-BR');
  const events = await getLiveESPN();
  jogosAoVivo = events.length;
  console.log(`[V28 ESCANTEIO] ${jogosAoVivo} jogos - ${ultimoErro}`);

  for (const ev of events) {
    if (enviados.has(ev.id)) continue;
    const minuto = ev.time.played;
    const cantos = ev.corners;

    // SUA REGRA ORIGINAL DE ESCANTEIO QUE VOCÊ PEDIU
    // 65 minutos + 6 escanteios = pressão
    if (minuto >= 65 && cantos >= 6) {
      const msg = `🚩 <b>RADAR ESCANTEIO V28</b>\n⚽ ${ev.homeTeam.name} x ${ev.awayTeam.name}\n⏱️ ${minuto}'\n🚩 ${cantos} escanteios\n📊 ${ev.score}\n🔥 PRESSÃO FINAL!`;
      await enviarTelegram(msg);
      enviados.add(ev.id);
    }
  }
  if(enviados.size>200) enviados.clear();
}

app.get('/', (req,res) => {
  res.json({
    versao: "V28 FINAL - SO ESCANTEIO 5MIN",
    telegram_configurado:!!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID),
    ultimo_scan: ultimoScan,
    jogos_ao_vivo: jogosAoVivo,
    ultimo_erro: ultimoErro,
    regra: "65min + 6 escanteios"
  });
});

app.get('/teste', async (req,res) => {
  await enviarTelegram(`✅ V28 ESCANTEIO TESTE OK! ${new Date().toLocaleTimeString('pt-BR')}\n${ultimoErro}\nJogos: ${jogosAoVivo}`);
  res.send('Teste V28 enviado!');
});

// A CADA 5 MINUTOS COMO VOCÊ PEDIU
setInterval(analisar, 1000*60*5);
analisar();
app.listen(PORT, () => console.log('V28 ESCANTEIO Rodando ' + PORT));
