const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
let CHAT_ID = '8086662653';

async function mandaTelegram(texto) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' });
}

app.get('/meu-id', async (req,res)=>{
  const r = await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
  res.json(r.data);
});

app.get('/teste', async (req,res)=>{
  await mandaTelegram('🚀 *RADAR GREEN TESTE OK!*');
  res.send('Teste enviado!');
});

app.get('/', (req,res)=> res.send('Radar Green ON'));
app.listen(process.env.PORT || 10000, ()=>console.log('ON'));
