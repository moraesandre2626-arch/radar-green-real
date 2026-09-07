// ELITE RADAR V3 - OTIMIZADO ANTI-LIMITE 100 req/dia
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEYS = [
  process.env.API_FOOTBALL,
  process.env.API_FOOTBALL_2,
  process.env.API_FOOTBALL_3
].filter(Boolean);

let keyIndex = 0;
let stats = { analisadosHoje:0, alertasHoje:0, greens:0, reds:0, voids:0, pendentes:0, banca:100, lastReset: new Date().toDateString() };

function getKey(){ 
  const k = API_KEYS[keyIndex % API_KEYS.length]; 
  keyIndex++; 
  return k; 
}

async function apiGet(url){
  for(let i=0; i<API_KEYS.length; i++){
    try{
      const key = getKey();
      const res = await axios.get(url, { 
        headers: { 'x-apisports-key': key },
        timeout: 10000
      });
      if(res.data.errors && Object.keys(res.data.errors).length > 0){
        console.log('Chave estourou, trocando...', res.data.errors);
        continue;
      }
      return res.data.response;
    }catch(e){
      console.log('Falha API, trocando chave:', e.message);
      continue;
    }
  }
  throw new Error('Todas as chaves estouraram');
}

async function sendTelegram(msg){
  if(!TOKEN || !CHAT_ID) return;
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: msg,
    parse_mode: 'Markdown'
  });
}

async function radar(){
  try{
    if(stats.lastReset !== new Date().toDateString()){
      stats = { analisadosHoje:0, alertasHoje:0, greens:0, reds:0, voids:0, pendentes:0, banca:100, lastReset: new Date().toDateString() };
    }
    const live = await apiGet('https://v3.football.api-sports.io/fixtures?live=all');
    if(!live || live.length === 0){
      console.log(`[${new Date().toLocaleTimeString('pt-BR')}] Radar: 0 jogos ao vivo`);
      return;
    }
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] Radar: ${live.length} jogos ao vivo`);

    const candidatos = live.filter(f => {
      const min = f.fixture?.status?.elapsed || 0;
      return min >= 75 && min <= 88;
    });

    if(candidatos.length === 0) return;

    for(const jogo of candidatos.slice(0, 3)){
      stats.analisadosHoje++;
      const fixtureId = jogo.fixture.id;
      const stat = await apiGet(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`);
      if(!stat || stat.length < 2) continue;

      const getVal = (teamIdx, type) => {
        const s = stat[teamIdx]?.statistics?.find(x => x.type === type);
        return s ? (s.value || 0) : 0;
      };

      const corners = getVal(0, 'Corner Kicks') + getVal(1, 'Corner Kicks');
      const dangerous = getVal(0, 'Dangerous Attacks') + getVal(1, 'Dangerous Attacks');
      const onTarget = getVal(0, 'Shots on Goal') + getVal(1, 'Shots on Goal');
      const elapsed = jogo.fixture.status.elapsed;
      const diff = Math.abs((jogo.goals.home||0) - (jogo.goals.away||0));

      if(corners >= 5 && corners <= 9 && dangerous >= 55 && onTarget >= 4 && diff <= 1){
        stats.alertasHoje++;
        const msg = `💎 *ELITE CORNER V3* 💎\n\n⚽ ${jogo.teams.home.name} x ${jogo.teams.away.name}\n⏱️ ${elapsed}' | ${jogo.goals.home}-${jogo.goals.away}\n🚩 Escanteios: ${corners}\n🔥 Ataques Perigosos: ${dangerous}\n🎯 Chutes no gol: ${onTarget}\n\n✅ ENTRADA: Over ${corners}.5 Escanteios`;
        await sendTelegram(msg);
        await new Promise(r=>setTimeout(r, 2000));
      }
    }
  }catch(e){
    console.log('Erro radar:', e.message);
  }
}

app.get('/', (req,res)=>{
  const assert = stats.analisadosHoje ? ((stats.greens/(stats.greens+stats.reds||1))*100).toFixed(1) : '0.0';
  res.json({status:'ELITE RADAR V3 ONLINE', hora: new Date().toLocaleTimeString('pt-BR'), data: new Date().toLocaleDateString('pt-BR'), analisadosHoje: stats.analisadosHoje, alertasHoje: stats.alertasHoje, greens: stats.greens, reds: stats.reds, voids: stats.voids, pendentes: stats.pendentes, assertividade: assert+'%', bancaAtual: stats.banca, chavesAtivas: API_KEYS.length});
});

app.get('/teste', async (req,res)=>{
  await sendTelegram('🔔 TESTE RADAR ELITE V3 - Telegram OK!');
  res.send('Teste enviado!');
});

setInterval(radar, 6 * 60 * 1000);
radar();

setInterval(async ()=>{
  const now = new Date();
  const brt = new Date(now.toLocaleString('en-US', {timeZone:'America/Sao_Paulo'}));
  if(brt.getHours() === 23 && brt.getMinutes() === 1){
    await sendTelegram(`📊 *RELATÓRIO 23H - V3*\n\nJogos analisados: ${stats.analisadosHoje}\nAlertas: ${stats.alertasHoje}\nBanca: R$${stats.banca}\nChaves: ${API_KEYS.length} ativas`);
  }
}, 60*1000);

app.listen(PORT, ()=>console.log('V3 ONLINE na porta', PORT));
