const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;
const PHONE = process.env.PHONE || '555591107861';
const APIKEY = process.env.APIKEY || '5665785';
const BANCA = 100;
let ultimoAlerta = 0;

async function sendZap(msg){
  const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(msg)}&apikey=${APIKEY}`;
  try{ await axios.get(url); console.log('Zap OK'); } catch(e){}
}

app.get('/', (req,res)=> res.send('RADAR GREEN ON - 100 reais'));
app.get('/testar', async (req,res)=>{
  await sendZap(`TESTE RADAR GREEN\n\nBanca base: ${BANCA} reais\nSTAKE 1: 2 reais (2 porcento)\n\nLink: https://www.bet365.com\n\nAnti-spam 15min ATIVO 24h`);
  res.send('TESTE ENVIADO');
});

setInterval(async ()=>{
  try{
    const {data} = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    let verdes=0;
    for(let i=1;i<6;i++){
      if(parseFloat(data[i][4])>parseFloat(data[i][1])){ verdes++; }
    }
    const agora = Date.now();
    if(verdes>=5 && (agora - ultimoAlerta) > 900000){
      ultimoAlerta = agora;
      await sendZap(`RADAR GREEN - 5 VELAS VERDES BTC!\n\nBanca: ${BANCA} reais\nSTAKE 1: 2 reais\n\nENTRADA CONFIRMADA!\n\nApostar: https://www.bet365.com`);
    }
  }catch(e){}
}, 60000);

app.listen(PORT, ()=> console.log('Radar ON'));
