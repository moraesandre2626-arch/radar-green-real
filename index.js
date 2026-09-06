const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

// Só do Render - SEM NÚMERO AQUI
const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WPP_PHONE = process.env.WPP_PHONE;
const WPP_APIKEY = process.env.WPP_APIKEY;

const STAKE = (100 * 0.02).toFixed(2);
const LINK_BET365 = 'https://www.bet365.bet.br';

let jaAnalisados = new Set();

async function enviarAlerta(texto){
  console.log('Enviando:', texto);
  try{
    if(TOKEN && CHAT_ID){
      await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
        chat_id: CHAT_ID,
        text: texto,
        parse_mode: 'Markdown',
        disable_notification: true
      });
      console.log('✅ Telegram OK');
    } else {
      console.log('SEM TOKEN/CHAT_ID no Render');
    }
  }catch(e){
    console.log('Erro TG:', e.response?.data || e.message);
  }
}

app.get('/', (req,res)=>{
  res.send('Radar Green Real ON - Live ✅');
});

app.get('/teste', async (req,res)=>{
  await enviarAlerta(`🔔 *TESTE VIBRAÇÃO SEM SOM* - Radar Live!

Se vibrou, tá 100%
💰 Stake: R$${STAKE}

🔗 [Bet365](${LINK_BET365})`);
  res.send('Teste enviado! Olha seu canal @radar_green_real_bot');
});

// Aqui depois a gente coloca o loop de faltas + escanteios
app.listen(PORT, ()=> console.log('Rodando na porta '+PORT));
