const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;
const PHONE = process.env.PHONE || '555591107861';
const APIKEY = process.env.APIKEY || '5665785';

async function sendZap(msg){
  const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(msg)}&apikey=${APIKEY}`;
  try{ await axios.get(url); console.log('Zap enviado'); } catch(e){ console.log('Erro', e.message) }
}

app.get('/', (req,res)=> res.send('RADAR GREEN ATIVO - Banca 100 reais'));
app.get('/testar', async (req,res)=>{
  await sendZap('TESTE RADAR GREEN\n\nSeu numero 555591107861 conectado!\n\nBanca base: 100 reais\nSTAKE 1: 2 reais (2 porcento)\n\nMonitorando 5 velas verdes 24h');
  res.send('TESTE ENVIADO');
});

setInterval(async ()=>{
  try{
    const {data} = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    let verdes=0;
    for(let i=1;i<6;i++){
      if(parseFloat(data[i][4])>parseFloat(data[i][1])){
        verdes++;
      }
    }
    if(verdes>=5){
      await sendZap('RADAR GREEN - 5 VELAS VERDES NO BTC!\n\nBanca 100 reais\nSTAKE 1 - 2 reais (2 porcento)\nSINAL DE COMPRA!');
    }
  }catch(e){}
}, 60000);

app.listen(PORT, ()=> console.log('Radar ON '+PORT));
