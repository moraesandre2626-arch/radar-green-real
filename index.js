const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
const CHAT_ID = '2051406570'; // SEU ID CORRETO!

async function mandaTelegram(texto) {
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' });
    console.log('ENVIADO');
  } catch(e){ console.log('Erro:', e.response?.data); }
}

app.get('/teste', async (req,res)=>{
  await mandaTelegram('🚀 *RADAR GREEN TESTE OK!* \n\n✅ Seu bot tá 100% funcionando!\n\n👤 ID: 2051406570\n💰 Banca: R$ 100\n🎯 Stake: 2% = R$ 2,00\n🔗 [Bet365](https://www.bet365.bet.br)');
  res.send('Teste enviado! Olha seu Telegram @Moraescoelhobot');
});

app.get('/', (req,res)=> res.send('Radar Green ON - ID 2051406570'));

// Aqui depois a gente coloca seu radar de Over
app.listen(process.env.PORT || 10000, ()=>console.log('ON'));
