const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;
const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API = process.env.API_FOOTBALL;
const BANCA = 100;
const STAKE = (BANCA * 0.02).toFixed(2);
const LINK = 'https://www.bet365.bet.br/hub/in-play';
let alertados = new Set();

async function enviar(msg){
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown'
  }).catch(()=>{});
}

async function analisaPro(jogo){
  const min = jogo.fixture.status.elapsed;
  if(min < 75 || min > 88) return null;
  const id = jogo.fixture.id;
  const key = `pro-${id}`;
  if(alertados.has(key)) return null;
  try{
    const r = await axios.get(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${id}`,{
      headers: { 'x-apisports-key': API }
    });
    const stats = r.data.response;
    if(!stats || stats.length < 2) return null;
    const get = (arr, t) => {
      const s = arr.find(x => x.type === t);
      if(!s || !s.value) return 0;
      return parseInt(s.value) || 0;
    };
    const home = stats[0].statistics;
    const away = stats[1].statistics;
    const esc = get(home,'Corner Kicks') + get(away,'Corner Kicks');
    const danger = get(home,'Dangerous Attacks') + get(away,'Dangerous Attacks');
    const blocked = get(home,'Blocked Shots') + get(away,'Blocked Shots');
    const diff = Math.abs(jogo.goals.home - jogo.goals.away);
    if(esc < 5 || esc > 8) return null;
    if(diff > 1) return null;
    if(danger < 60) return null;
    let score = 0;
    score += 30;
    score += danger >= 80 ? 20 : 10;
    score += blocked >= 4 ? 15 : 0;
    score += diff <= 1 ? 25 : 0;
    if(score >= 70){
      alertados.add(key);
      return { nome: `${jogo.teams.home.name} x ${jogo.teams.away.name}`, placar: `${jogo.goals.home}-${jogo.goals.away}`, min, esc, danger, score };
    }
    return null;
  }catch(e){ return null; }
}

async function radar(){
  if(!API) return;
  try{
    const r = await axios.get('https://v3.football.api-sports.io/fixtures?live=all',{
      headers: { 'x-apisports-key': API }
    });
    for(const j of r.data.response){
      const a = await analisaPro(j);
      if(a){
        await enviar(`💎 *ESCANTEIO ELITE 75-88' - ${a.score}/100* 💎\n\n🏟️ ${a.nome}\n📊 ${a.placar} | ${a.min}'\n📈 ${a.esc} escanteios | ${a.danger} ataques perigosos\n\n💰 Entrada: +1 escanteio\n🎯 Stake: R$${STAKE}\n🔗 [BET365](${LINK})`);
      }
    }
  }catch(e){}
}

app.get('/', (req,res)=> res.send(`ELITE ON | ${alertados.size}`));
app.get('/teste', async (req,res)=>{ await enviar(`🔔 TESTE ELITE ON - Stake R$${STAKE}`); res.send('ok'); });
setInterval(radar, 120*1000);
radar();
app.listen(PORT, ()=> console.log('ON'));
