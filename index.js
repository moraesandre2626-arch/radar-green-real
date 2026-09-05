const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
const CHAT_ID = '2051406570';
const STAKE_VALOR = (100 * 0.02).toFixed(2);
const LINK_BET365 = 'https://www.bet365.bet.br';

let jaAnalisados = new Set();
let enviadosEsc = new Set();
let enviadosFalta = new Set();

async function mandaTelegram(texto) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID, 
    text: texto, 
    parse_mode: 'Markdown',
    disable_notification: false // força vibrar
  }).catch(e=>console.log(e.message));
}

async function radarPreJogo10Min() {
  try {
    // DATA DE HOJE AUTOMÁTICA - CORRIGIDO
    const hoje = new Date().toISOString().split('T')[0];
    const res = await axios.get(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${hoje}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const jogos = res.data.events || [];
    console.log(`Varrendo ${jogos.length} jogos de ${hoje}`);

    for (let jogo of jogos) {
      const id = jogo.id;
      const casa = jogo.homeTeam?.name;
      const fora = jogo.awayTeam?.name;
      const minsProJogo = (new Date(jogo.startTimestamp*1000) - new Date()) / 60000;
      if (minsProJogo < 5 || minsProJogo > 60) continue;
      if (jaAnalisados.has(id)) continue;

      try {
        const lineRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/lineups`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!lineRes.data.home || !lineRes.data.home.players) continue;

        console.log(`ESCALAÇÃO SAIU! ${casa} x ${fora}`);
        const allPlayers = [...lineRes.data.home.players,...lineRes.data.away.players].filter(p=>!p.substitute);

        for (let p of allPlayers) {
          const nome = p.player?.name;
          const playerId = p.player?.id;
          if (!nome || !playerId) continue;
          try {
            const detailRes = await axios.get(`https://api.sofascore.com/api/v1/player/${playerId}/events/last/0`, {
              headers: { 'User-Agent': 'Mozilla/5.0' }
            }).catch(()=>null);
            const lastEvents = detailRes?.data?.events || [];
            let totalFouls=0, totalWasFouled=0, totalDribbles=0, jogosComStats=0;
            for (let ev of lastEvents.slice(0,5)) {
              try {
                const evLine = await axios.get(`https://api.sofascore.com/api/v1/event/${ev.id}/lineups`, {
                  headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const playerStat = [...(evLine.data.home?.players||[]),...(evLine.data.away?.players||[])].find(pl=>pl.player?.id===playerId);
                if (playerStat?.statistics) {
                  totalFouls += playerStat.statistics.fouls || 0;
                  totalWasFouled += playerStat.statistics.wasFouled || 0;
                  totalDribbles += playerStat.statistics.dribbles || 0;
                  jogosComStats++;
                }
              } catch(e){}
            }
            if (jogosComStats===0) continue;
            const mediaFalta = (totalFouls/jogosComStats).toFixed(1);
            const mediaSofrida = (totalWasFouled/jogosComStats).toFixed(1);
            const mediaDrible = (totalDribbles/jogosComStats).toFixed(1);

            if (parseFloat(mediaSofrida) >= 2.8 && parseFloat(mediaDrible) >= 1.5) {
              await mandaTelegram(`⚡ *ODD DESREGULADA - PEGA AGORA!* ⚡\n\n⚽ ${casa} x ${fora}\n⏰ Começa em ${Math.round(minsProJogo)} min - ESCALAÇÃO SAIU AGORA!\n\n👤 *${nome}* - TITULAR\n📊 Últimos ${jogosComStats}j: ${mediaSofrida} sofridas/j | ${mediaDrible} dribles/j\n✅ RETENTOR CONFIRMADO\n🚨 JANELA DE 10 MIN\n\n💎 Over 1.5 faltas sofridas ${nome}\n💰 R$${STAKE_VALOR} | [BET365 AGORA](${LINK_BET365})`);
            }
            if (parseFloat(mediaFalta) >= 2.0) {
              await mandaTelegram(`⚡ *ODD DESREGULADA - BRIGADOR* ⚡\n\n⚽ ${casa} x ${fora} - ${Math.round(minsProJogo)} min\n👤 *${nome}* - ${mediaFalta} faltas/j\n\n💎 Over 1.5 faltas ${nome}\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
            }
            await new Promise(r=>setTimeout(r, 400));
          } catch(e){ continue; }
        }
        jaAnalisados.add(id);
        setTimeout(()=>jaAnalisados.delete(id), 2*60*60*1000);
      } catch(e){ continue; }
    }
  } catch(e){ console.log('Erro pre-jogo:', e.message); }
}

async function radarAoVivo() {
  try {
    const res = await axios.get('https://api.sofascore.com/api/v1/sport/football/events/live', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const jogos = res.data.events || [];
    for (let jogo of jogos.slice(0,30)) {
      const id = jogo.id;
      const minuto = jogo.time?.minute || 0;
      if (minuto < 30 || minuto > 82) continue;
      const casa = jogo.homeTeam?.name;
      const fora = jogo.awayTeam?.name;
      const placarCasa = jogo.homeScore?.current || 0;
      const placarFora = jogo.awayScore?.current || 0;
      try {
        const statsRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/statistics`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const groups = statsRes.data.statistics?.[0]?.groups || [];
        let chutes=0, ataquesPerig=0, posseCasa=50, escCasa=0, escFora=0, faltasCasa=0, faltasFora=0, cartoes=0;
        groups.forEach(g=>{
          g.statisticsItems?.forEach(s=>{
            if(s.name==='Total shots') chutes=(s.home||0)+(s.away||0);
            if(s.name==='Dangerous attacks') ataquesPerig=(s.home||0)+(s.away||0);
            if(s.name==='Ball possession') posseCasa=s.home||50;
            if(s.name==='Corner kicks') { escCasa=s.home||0; escFora=s.away||0; }
            if(s.name==='Fouls') { faltasCasa=s.home||0; faltasFora=s.away||0; }
            if(s.name==='Yellow cards') cartoes=(s.home||0)+(s.away||0);
          });
        });
        const totalEsc = escCasa+escFora;
        const totalFaltas = faltasCasa+faltasFora;
        const favoritoPerdendo = (posseCasa>=58 && placarCasa<=placarFora) || (posseCasa<=42 && placarFora<=placarCasa);
        const jogoAmarrado = (placarCasa+placarFora) <=1;
        if (!enviadosEsc.has(id) && totalEsc>=6 && minuto>=55 && minuto<=82 && jogoAmarrado && ataquesPerig>=70 && chutes>=13 && favoritoPerdendo) {
          const linha = totalEsc<=9?9.5:10.5;
          await mandaTelegram(`🚩 *ESCANTEIO AO VIVO* 🚩\n\n⚽ ${casa} x ${fora} ${minuto}' ${placarCasa}-${placarFora}\n📊 Esc ${totalEsc} | Perig ${ataquesPerig}\n\n💎 Over ${linha} Esc\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
          enviadosEsc.add(id);
        }
        await new Promise(r=>setTimeout(r, 900));
      } catch(e){ continue; }
    }
  } catch(e){ console.log(e.message); }
}

// ROTA DE TESTE DE VIBRAÇÃO SEM SOM
app.get('/teste', async (req,res)=>{
  await mandaTelegram(`🔔 *TESTE VIBRAÇÃO - SEM SOM* 🔔\n\nSe vibrou sem fazer barulho, tá 100% configurado!\n\n💰 R$${STAKE_VALOR} | [Bet365](${LINK_BET365})`);
  res.send('Teste enviado! Olha o Telegram');
});

app.get('/', (req,res)=> res.send('Radar V8 ON - 30s varredura'));
setInterval(radarPreJogo10Min, 30*1000);
setInterval(radarAoVivo, 90*1000);
radarPreJogo10Min();
radarAoVivo();
app.listen(process.env.PORT || 10000);
