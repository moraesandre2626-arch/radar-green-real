const express = require('express');
const axios = require('axios');
const app = express();

const TOKEN = '8747793901:AAFojHwX3j-tNjWKGw34QpO51-iRAvI1tYE';
// depois que me mandar o ID eu te falo o que por aqui
const CHAT_ID = 'COLOCAR_SEU_ID_AQUI'; 

async function mandaTelegram(texto) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await axios.post(url, { chat_id: CHAT_ID, text: texto, parse_mode: 'Markdown' });
  console.log('ENVIADO');
}

app.get('/teste', async (req, res) => {
  await mandaTelegram('🚀 *RADAR GREEN TESTE OK!*\n\nBanca: 100\nSTAKE: 2\nLink: https://www.bet365.bet.br');
  res.send('Teste enviado!');
});

app.get('/', (req,res)=> res.send('Radar Green ON'));
app.listen(process.env.PORT || 10000, ()=>console.log('ON'));
