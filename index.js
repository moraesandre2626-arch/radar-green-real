const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const BANCA = 100;
const STAKE_PCT = 0.02;
const LINK_BET = 'https://www.bet365.bet.br/hub/in-play';

let alertados = new Set();

async function enviar(texto){
  if(!TOKEN || !CHAT_ID){ console.log('Sem TOKEN/CHAT_ID'); return; }
  try{
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
      chat_id: CHAT_ID,
      text: texto,
      parse_mode: 'Markdown',
      // REMOVI o disable_notification - agora vibra!
    });
    console.log('Enviado OK');
  }catch(e){
    console.log('Erro TG:', e.response?.data || e.message);
  }
}

function getStake(){ return (BANCA * STAKE_PCT).toFixed(2); }

app.get('/', (req,res)=> res.send('Radar Green Real ON - Vibra sem som ✅') );

app.get('/teste', async (req,res)=>{
  await enviar(`🔔 *TESTE - VIBRA SEM SOM*

Se vibrou e NÃO fez som, tá 100%!
Vibrou ai? 👀

💰 Stake: R$${getStake()}

🔗 [Bet365](${LINK_BET})`);
  res.send('Teste enviado! Tem que VIBRAR agora.');
});

app.get('/alerta-falta', async (req,res)=>{
  await enviar(`⚠️ *FALTA PERIGOSA 80-90'!* ⚠️

🏟️ Flamengo x Palmeiras - 87'
📍 Falta frontal 22m
🎯 Entrada: Gol na falta / Over 0.5 Final
💰 Stake: R$${getStake()} (2%)

🔗 [APOSTAR](${LINK_BET})`);
  res.send('Falta enviado vibrando!');
});

app.get('/alerta-escanteio', async (req,res)=>{
  await enviar(`🚩 *ESCANTEIO 85-90'!* 🚩

🏟️ Real Madrid x Barca - 88'
📊 Pressão total
🎯 Entrada: +1 Escanteio
💰 Stake: R$${getStake()} (2%)

🔗 [APOSTAR](${LINK_BET})`);
  res.send('Escanteio enviado vibrando!');
});

app.listen(PORT, ()=> console.log('ON '+PORT));
