const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const PHONE = '+5555991107861';
const APIKEY = '5665785';

let ultimoAlerta = 0;

async function mandaZap(texto) {
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(texto)}&apikey=${APIKEY}`;
    await axios.get(url);
    console.log('ZAP ENVIADO:', texto);
  } catch (e) { console.log('Erro zap', e.message); }
}

async function checaBinance() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    const velas = res.data;
    let verdes = 0;
    for(let i=1; i<6; i++) {
      const open = parseFloat(velas[i][1]);
      const close = parseFloat(velas[i][4]);
      if(close > open) verdes++; else verdes = 0;
    }
    if(verdes >= 5 && Date.now() - ultimoAlerta > 600000) {
      ultimoAlerta = Date.now();
      mandaZap(`🚀 BINANCE: 5 VERDES SEGUIDOS BTC 1M!`);
    }
    console.log('Verdes:', verdes);
  } catch(e){ console.log('Erro binance', e.message); }
}

setInterval(checaBinance, 60000);

app.get('/', (req,res) => res.send('ROBO ON - APIKEY 5665785 - BINANCE'));
app.get('/teste', (req,res) => { mandaZap('TESTE ROBO ON MORAES - FUNCIONOU!'); res.send('teste enviado'); });

app.listen(PORT, () => console.log('Rodando '+PORT));
