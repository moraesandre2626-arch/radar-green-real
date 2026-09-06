const express = require('express');
const axios = require('axios');
const app = express();

// ENV VARS - No Render coloque TOKEN e CHAT_ID
const TOKEN = process.env.TOKEN || '8395026821:AAF9Q2bn17PS2B6kOkrAfcQlIy2Aaj6Y6Yg';
const CHAT_ID = process.env.CHAT_ID || '2051406570';
const WPP_PHONE = process.env.WPP_PHONE || '555591107861';
const WPP_APIKEY = process.env.WPP_APIKEY || '5665785';

const STAKE_VALOR = (100 * 0.02).toFixed(2);
const LINK_BET365 = 'https://www.bet365.bet.br';

let jaAnalisados = new Set();
let enviadosEsc = new Set();
let enviadosFalta = new Set();

// FUNÇÃO ÚNICA - MANDA TELEGRAM + WHATSAPP
async function enviarAlerta(texto) {
  // 1. Telegram - funciona HOJE
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: texto,
      parse_mode: 'Markdown',
      disable_notification: true
    });
    console.log('✅ Telegram OK');
  } catch(e){
    console.log('Erro TG:', e.response?.data || e.message);
  }

  // 2. WhatsApp - volta dia 07/09
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${WPP_PHONE}&text=${encodeURIComponent(texto)}&apikey=${WPP_APIKEY}`;
    const r = await axios.get(url, { timeout: 10000 });
    console.log('WhatsApp:', r.data);
  } catch(e){
    console.log('WhatsApp off - normal hoje');
  }
}

async function mandaTelegram(texto){ return enviarAlerta(texto); }

async function radarPreJogo10Min() {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const res = await axios.get(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${hoje}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const jogos = res.data.events || [];
    console.log(`[PRE-JOGO] Varrendo ${jogos.length} jogos de ${hoje}`);

    for (let jogo of jogos) {
      const id = jogo.id;
      const casa = jogo.homeTeam?.name;
      const fora = jogo.awayTeam?.name;
      const minsProJogo = (new Date(jogo.startTimestamp*1000) - new Date()) / 60000;
      if (minsProJogo < 5 || minsProJogo > 120) continue;
      if (jaAnalisados.has(id)) continue;

      try {
        const lineRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/lineups`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!lineRes.data.home ||!lineRes.data.home.players) continue;

        console.log(`ESCALAÇÃO SAIU! ${casa} x ${fora}`);
        const allPlayers = [...lineRes.data.home.players,...(lineRes.data.away?.players||[])].filter(p=>!p.substitute);

        for (let p of allPlayers) {
          const nome = p.player?.name;
          const playerId = p.player?.id;
          if (!nome ||!playerId) continue;
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

            if (parseFloat(mediaSofrida) >= 1.5 && parseFloat(mediaDrible) >= 0.8) {
              await enviarAlerta(`⚡ *TESTE ODDS BAIXA - RETENTOR* ⚡\n\n⚽ ${casa} x ${fora}\n⏰ ${Math.round(minsProJogo)} min - ESCALAÇÃO SAIU!\n\n👤 *${nome}* - TITULAR\n📊 ${mediaSofrida} sofridas/j | ${mediaDrible} dribles/j\n\n💎 Over 1.5 faltas sofridas ${nome}\n💰 R$${STAKE_VALOR} | [BET365 AGORA](${LINK_BET365})`);
            }
            if (parseFloat(mediaFalta) >= 1.2) {
              await enviarAlerta(`⚡ *TESTE ODDS BAIXA - BRIGADOR* ⚡\n\n⚽ ${casa} x ${fora} - ${Math.round(minsProJogo)} min\n👤 *${nome}* - ${mediaFalta} faltas/j\n\n💎 Over 1.5 faltas ${nome}\n💰 R$${STAKE_VALOR} | [BET365](${LINK_BET365})`);
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
      if (minuto < 10) continue;
      const casa = jogo.homeTeam?.name;
      const fora = jogo.awayTeam?.name;
      const placarCasa = jogo.homeScore?.current || 0;
      const placarFora = jogo.awayScore?.current || 0;
      try {
        const statsRes = await axios.get(`https://api.sofascore.com/api/v1/event/${id}/statistics`, { headers: { 'User-Agent':
