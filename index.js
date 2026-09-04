const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;
const PHONE = process.env.PHONE || '555591107861';
const APIKEY = process.env.APIKEY || '5665785';
async function sendZap(msg){
  const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(msg)}&apikey=${APIKEY}`;
  try{ await axios.get(url); console.log('Zap enviado'); }catch(e){ console.log(e.message); }
}
app.get('/', (req,res)=> res.send('RADAR GREEN ATIVO - 555591107861 - Vai em /testar'));
app.get('/testar', async (req,res)=>{
  await sendZap('🟢 TESTE RADAR GREEN\n\nSeu numero '+PHONE+' conectado com sucesso!\n\nAgora vou monitorar 5 velas verdes e te avisar 24h.');
  res.send('TESTE ENVIADO pro Zap 555591107861 - checa seu WhatsApp!');
});
setInterval(async ()=>{
  try{
    const {data} = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    let verdes=0;
    for(let i=1;i<6;i++){
      if(parseFloat(data[i][4])>parseFloat(data[i][1])) verdes++; else verdes=0;
    }
    if(verdes>=5){
      await sendZap(`🚨 RADAR GREEN 🚨\n\n5 VELAS VERDES SEGUIDAS BTC!\n${new Date().toLocaleString('pt-BR')}\nhttps://www.binance.com/pt-BR/trade/BTC_USDT`);
    }
  }catch(e){}
}, 60000);
app.listen(PORT, ()=> console.log('Radar ON '+PORT));
