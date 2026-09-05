const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// COLOCA SEU NUMERO AQUI COM +55
const PHONE = '+5555912345678';
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
