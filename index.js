const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
const CHAT_ID = '2051406570';
const STAKE_VALOR = (100 * 0.02).toFixed(2);
const LINK_BET365 = 'https://www.bet365.bet.br';

let jaAnalisados = new Set(); // pra não repetir o mesmo jogo
let enviadosEsc = new Set();
let enviadosFalta = new Set();

async function mandaTelegram(texto) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown'
  }).catch(()=>{});
}

// =========== RADAR PRÉ-JOGO - JANELA DE 10 MIN ===========
async function radarPreJogo10Min() {
  try {
    const res = await axios.get('https://api.sofascore.com/api/v1/sport/football/scheduled-events/2026-09-04', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const jogos = res.data.events || [];

    for (let jogo of jogos) {
      const id = jogo.id;
      const casa = jogo.homeTeam?.name;
      const fora = jogo.awayTeam?.name;

      // Só jogos que começam em 5 a 60 min
      const minsProJogo = (new Date(jogo.startTimestamp*1000) - new Date()) / 60000;
      if (minsProJogo < 5 || minsProJogo > 60) continue;
      if (jaAnalisados.has(id)) continue;

      try {
        // Tenta pegar escalação - se não tiver, pula
        const lineRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/lineups`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!lineRes.data.home ||!lineRes.data.home.players) {
          continue; // escalação ainda não saiu, vai tentar de novo em 30s
        }

        console.log(`ESCALAÇÃO SAIU! ${casa} x ${fora} - VASCULHANDO AGORA!`);

        // ESCALAÇÃO SAIU - VASCULHA JOGADOR POR JOGADOR INSTANTANEO
        const allPlayers = [...lineRes.data.home.players,...lineRes.data.away.players].filter(p=>!p.substitute);

        for (let p of allPlayers) {
          const nome = p.player?.name;
          const playerId = p.player?.id;
          if (!nome ||!playerId) continue;

          try {
            // Pega média últimos jogos do jogador - RAPIDO
            const detailRes = await axios.get(`https://api.sofascore.com/api/v1/player/${playerId}/events/last/0`, {
              headers: { 'User-Agent': 'Mozilla/5.0' }
            }).catch(()=>null);

            const lastEvents = detailRes?.data?.events || [];
            let totalFouls=0, totalWasFouled=0, totalDribbles=0, jogosComStats=0;

            // Pega stats dos últimos 5 jogos dele
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

            // FILTRO ODD DESREGULADA - JANELA 10 MIN
            if (parseFloat(mediaSofrida) >= 2.8 && parseFloat(mediaDrible) >= 1.5) {
              await mandaTelegram(
                `⚡ *ODD DESREGULADA - PEGA AGORA!* ⚡\n\n`+
                `⚽ ${casa} x ${fora}\n`+
                `⏰ Começa em ${Math.round(minsProJogo)} min - ESCALAÇÃO SAIU AGORA!\n\n`+
                `👤 *${nome}* - TITULAR\n`+
                `📊 Últimos ${jogosComStats}j: ${mediaSofrida} sofridas/j | ${mediaDrible} dribles/j\n`+
                `✅ RETENTOR CONFIRMADO - Média alta\n`+
                `🚨 JANELA DE 10 MIN - Bet365 ainda não corrigiu!\n\n`+
                `💎 *ENTRADA URGENTE:*\n`+
                `Over 1.5 faltas sofridas ${nome}\n`+
                `Over 2.5 faltas sofridas se odd @2.00+\n\n`+
                `💰 R$${STAKE_VALOR} | [BET365 AGORA](${LINK_BET365})\n`+
                `⚠️ Corre que em 10 min a odd cai pra 1.50`
              );
            }

            if (parseFloat(mediaFalta) >= 2.0) {
              await mandaTelegram(
                `⚡ *ODD DESREGULADA - BRIGADOR* ⚡\n\n`+
                `⚽ ${casa} x ${fora} - ${Math.round(minsProJogo)} min pro jogo\n`+
                `👤 *${nome}* - TITULAR\n`+
                `📊 Últimos ${jogosComStats}j: ${mediaFalta} faltas cometidas/j\n`+
                `✅ FAZ FALTA PRA CARAMBA\n`+
                `🚨 PEGA AGORA ANTES DE CORRIGIR\n\n`+
                `💎 Over 1.5 faltas cometidas ${nome}\n`+
                `💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`
              );
            }

            await new Promise(r=>setTimeout(r, 400)); // rapido mas sem tomar block
          } catch(e){ continue; }
        }

        jaAnalisados.add(id); // marca como já vasculhado pra não repetir
        // limpa da lista depois de 2h
        setTimeout(()=>jaAnalisados.delete(id), 2*60*60*1000);

      } catch(e){ continue; }
    }
  } catch(e){ console.log('Erro pre-jogo:', e.message); }
}

// =========== RADAR AO VIVO - ESCANTEIO E FALTA ===========
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
          await mandaTelegram(`🚩 *ESCANTEIO AO VIVO* 🚩\n\n⚽ ${casa} x ${fora} ${minuto}' ${placarCasa}-${placarFora}\n📊 Esc ${totalEsc} | Perig ${ataquesPerig} | Fav pressionando\n\n💎 Over ${linha} Esc\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
          enviadosEsc.add(id);
        }

        if (totalFaltas>=14 && minuto>=35) {
          const lineRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/lineups`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(()=>null);
          if (!lineRes) continue;
          const allPlayers = [...(lineRes.data.home?.players||[]),...(lineRes.data.away?.players||[])];
          for (let p of allPlayers) {
            const nome = p.player?.name;
            const s = p.statistics || {};
            const fouls = s.fouls || 0;
            const wasFouled = s.wasFouled || 0;
            const touches = s.touches || 0;
            const dribbles = s.dribbles || 0;

            if (!enviadosFalta.has(id+'-S-'+nome) && wasFouled>=2 && dribbles>=2 && touches>=30 && favoritoPerdendo) {
              await mandaTelegram(`🤕 *RETENTOR AO VIVO* 🤕\n\n⚽ ${casa} x ${fora} ${minuto}'\n👤 ${nome} | ${wasFouled} sofridas | ${dribbles} dribles | ${touches} toques\n\n💎 Over 2.5 sofridas\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
              enviadosFalta.add(id+'-S-'+nome);
            }
            if (!enviadosFalta.has(id+'-F-'+nome) && fouls>=2 && totalFaltas>=15 && cartoes>=1 && favoritoPerdendo) {
              await mandaTelegram(`🟨 *FALTA AO VIVO* 🟨\n\n⚽ ${casa} x ${fora} ${minuto}'\n👤 ${nome} | ${fouls} feitas | Jogo ${totalFaltas} faltas\n\n💎 Over 2.5 / Cartão\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
              enviadosFalta.add(id+'-F-'+nome);
            }
          }
        }
        await new Promise(r=>setTimeout(r, 900));
      } catch(e){ continue; }
    }
  } catch(e){ console.log(e.message); }
}

app.get('/teste', async (req,res)=>{
  await mandaTelegram(`🚀 *RADAR V8 - JANELA 10 MIN ATIVO!*\n\n⚡ Vasculha a cada 30 SEGUNDOS\n⚡ Saiu escalação = já analisa na hora\n⚡ Pega média real dos últimos 5 jogos\n⚡ Manda antes da Bet365 corrigir\n\n✅ Pré-jogo: Odd desregulada\n✅ Ao vivo: Escanteio + Retentor\n\n💰 R$${STAKE_VALOR} | [Bet365](${LINK_BET365})`);
  res.send('V8 teste - janela 10min');
});

app.get('/', (req,res)=> res.send('Radar V8 ON - 30s varredura'));
setInterval(radarPreJogo10Min, 30*1000); // A CADA 30 SEGUNDOS - INSTANTANEO
setInterval(radarAoVivo, 90*1000);

radarPreJogo10Min();
radarAoVivo();
app.listen(process.env.PORT || 10000);
