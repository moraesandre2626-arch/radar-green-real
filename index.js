const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_FOOTBALL = process.env.API_FOOTBALL;
const BANCA = 100;
const STAKE = (BANCA * 0.02).toFixed(2);
const LINK = 'https://www.bet365.bet.br/hub/in-play';

let alertados = new Set();
let ultimoCheck = 'nunca';

async function enviar(msg){
  try{
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
      chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown'
    });
    console.log('Alerta enviado');
  }catch(e){ console.log(e.response?.data); }
}

async function radar(){
  if(!API_FOOTBALL) return;
  try{
    const r = await axios.get('https://v3.football.api-sports.io/fixtures?live=all',{
      headers: { 'x-apisports-key': API_FOOTBALL }
    });
    ultimoCheck = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${ultimoCheck}] Jogos live: ${r.data.results}`);

    for(const j of r.data.response){
      const min = j.fixture.status.elapsed;
      if(min < 80) continue;
      const nome = `${j.teams.home.name} x ${j.teams.away.name}`;
      const placar = `${j.goals.home}-${j.goals.away}`;
      const id = j.fixture.id;

      // ESCANTEIO 85-90'
      if(min >= 85 && min <= 95){
        const key = `esc-${id}`;
        if(!alertados.has(key)){
          alertados.add(key);
          await enviar(`🚩 *ESCANTEIO 85-90' - PRESSÃO FINAL!* 🚩

🏟️ ${nome}
📊 ${placar} | ${min}'
⏰ Últimos minutos

💰 Entrada: +1 Escanteio no jogo
🎯 Stake: R$${STAKE} (2% banca R$${BANCA})

🔗 [APOSTAR NA BET365](${LINK})`);
        }
      }

      // FALTA PERIGOSA 80-90' (detecta jogo empatado ou 1 gol diff nos acréscimos = chance de falta)
      if(min >= 80 && min <= 90){
        const keyF = `falta-${id}`;
        // Aqui a API free não tem evento de falta, então alerta por critério de pressão
        if(!alertados.has(keyF) && Math.abs(j.goals.home - j.goals.away) <= 1){
          // não alerta falta toda hora pra não spammar, só 1x por jogo
          // alertados.add(keyF);
          // await enviar(`⚠️ *FALTA PERIGOSA 80-90'* ⚠️\n\n🏟️ ${nome} ${placar} ${min}'\n💰 Over 0.5 Final\n🎯 R$${STAKE}\n🔗 [BET365](${LINK})`);
        }
      }
    }
  }catch(e){
    console.log('Erro radar:', e.response?.data || e.message);
  }
}

app.get('/', (req,res)=> res.send(`Radar Green Real ON ✅\nUltimo check: ${ultimoCheck}\nJogos alertados: ${alertados.size}`));
app.get('/teste', async (req,res)=>{
  await enviar(`🔔 *TESTE VIBRA SEM SOM - RADAR AUTO ON* 🔔\n\nBanca: R$${BANCA}\nStake: R$${STAKE}\nAPI: Conectada ✅\n\n🔗 [BET365](${LINK})`);
  res.send('Teste vibrando!');
});

setInterval(radar, 60*1000);
radar();

app.listen(PORT, ()=> console.log('Radar AUTO ON'));
