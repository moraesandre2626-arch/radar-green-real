const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;
const PHONE = process.env.PHONE || '555591107861';
const APIKEY = process.env.APIKEY || '5665785';

async function sendZap(msg){
  const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(msg)}&apikey=${APIKEY}`;
  try{ await axios.get(url); console.log('Zap enviado'); } catch(e){ console.log('Erro Zap', e.message) }
}

app.get('/', (req,res)=> res.send('RADAR GREEN ATIVO - Banca R$100'));
app.get('/testar', async (req,res)=>{
  await sendZap('🟢 TESTE RADAR GREEN\n\nSeu número tá OK - Banca base R$100');
  res.send('TESTE ENVIADO pro Zap '+PHONE);
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
      // NOVA LÓGICA DE BANCA R$100
      const BANCA = 100;
      const valorStake = 2.00; // 2% para 5 velas
      const textoStake = "STAKE 1 - PADRÃO (2%)";

      await sendZap(`🚨 RADAR GREEN 🚨\n\n5 VELAS VERDES SEGUIDAS NO BTC!\n\n💰 ${textoStake}\n💵 Valor: R$ ${valorStake.toFixed(2)}\nBanca base: R$${BANCA},00\n\nSinal de COMPRA!`);
    }
  }catch(e){}
}, 60000);

app.listen(PORT, ()=> console.log('Radar ON '+PORT));
