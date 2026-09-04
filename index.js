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
  try{ await axios.get(url); } catch(e){}
}

app.get('/', (req,res)=> res.send('RADAR GREEN ON'));
app.get('/testar', async (req,res)=>{
  await sendZap(`TESTE RADAR GREEN\n\nBanca: ${BANCA} reais\nSTAKE: 2 reais\n\nAPOSTAR AGORA: https://www.bet365.bet.br/casino\n\nProcura por Stock Market ou Crash\n\nAnti-spam 15min ON`);
  res.send('OK');
});

setInterval(async ()=>{
  try{
    const {data} = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=6');
    let verdes=0;
    for(let i=1;i<6;i++){ if(parseFloat(data[i][4])>parseFloat(data[i][1])){ verdes++; } }
    if(verdes>=5 && (Date.now()-ultimoAlerta)>900000){
      ultimoAlerta = Date.now();
      await sendZap(`RADAR 5 VERDES! COMPRA AGORA!\n\nBanca: ${BANCA} reais\nStake: 2 reais\n\nENTRAR: https://www.bet365.bet.br/casino\n\nClica em UP/COMPRA`);
    }
  }catch(e){}
}, 60000);

app.listen(PORT, ()=> console.log('ON'));
