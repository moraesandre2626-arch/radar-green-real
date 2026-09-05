const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// COLOCA SEU NUMERO AQUI COM +55
const PHONE = '+5555991107861';
const APIKEY = '3307798';
const BANCA = 270.85;

async function sendZap(msg){
  try{
    const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(msg)}&apikey=${APIKEY}`;
    await axios.get(url);
  }catch(e){ console.log(e.message) }
}

// --- RADAR BINANCE 5 VERDES ---
async function checkBinance(){
  try{
    const r = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    const closes = r.data.map(c=>parseFloat(c[4]));
    if(closes[4] > closes[3] && closes[3] > closes[2] && closes[2] > closes[1] && closes[1] > closes[0]){
      const stake = (BANCA*0.02).toFixed(2);
      sendZap(`🚀 RADAR BINANCE\n5 VERDES SEGUIDOS BTC\nStake sugerida: R$ ${stake}\nBanca: R$ ${BANCA}`);
    }
  }catch(e){}
}

setInterval(checkBinance, 60000);
app.get('/', (req,res)=>res.send('ROBO COMPLETAO ON - BINANCE + FUTEBOL'));
app.listen(PORT, ()=>console.log('ON'));
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
      mandaZap(`🚀 BINANCE ALERTA: 5 VERDES SEGUIDOS NO BTC 1M! Hora de entrar! https://www.binance.com`);
    }
    console.log('Verdes seguidos:', verdes);
  } catch(e){ console.log('Erro binance', e.message); }
}

setInterval(checaBinance, 60000);

app.get('/', (req,res) => res.send('ROBO COMPLETAO ON - BINANCE + FUTEBOL - APIKEY 5665785'));
app.get('/teste', (req,res) => { mandaZap('TESTE ROBO COMPLETAO ON - FUNCIONOU MORAES!'); res.send('teste enviado'); });

app.listen(PORT, () => console.log('Rodando na porta '+PORT));
