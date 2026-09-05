const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
let CHAT_ID = '8086662653'; // vou colocar seu ID assim que me mandar, por enquanto vou tentar pegar auto

async function mandaTelegram(texto) {
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' });
    console.log('ENVIADO');
  } catch(e){ console.log('Erro:', e.response?.data); }
}

// NOVA ROTA PRA PEGAR SEU ID AUTOMATICO
app.get('/meu-id', async (req,res)=>{
  try{
    const r = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    res.json(r.data);
  }catch(e){ res.send('Erro: '+e.message); }
});

app.get('/teste', async (req, res) => {
  await mandaTelegram('🚀 *RADAR GREEN TESTE OK!*\n\nBanca: 100\nSTAKE: 2\nLink: https://www.bet365.bet.br');
  res.send('Teste enviado! Olha no Telegram');
});

app.get('/', (req,res)=> res.send('Radar Green ON'));
app.listen(process.env.PORT || 10000, ()=>console.log('ON'));
