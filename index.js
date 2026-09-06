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
let jogosAnalisadosHoje = 0;
let alertasEnviadosHoje = 0;
let greens = 0;
let reds = 0;
let pendentes = [];
let ultimoRelatorioEnviado = "";

async function enviar(msg){
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown'
  }).catch(()=>{});
}

async function analisaPro(jogo){
  const min = jogo.fixture.status.elapsed;
  if(min < 75 || min > 88) return null;
  const id = jogo.fixture.id;
  if(alertados.has(`pro-${id}`)) return null;
  try{
    const r = await axios.get(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${id}`,{ headers: { 'x-apisports-key': API } });
    const stats = r.data.response;
    if(!stats || stats.length < 2) return null;
    const get = (arr, t) => {
      const s = arr.find(x => x.type === t);
      return s ? parseInt(s.value) || 0 : 0;
    };
    const esc = get(stats[0].statistics,'Corner Kicks') + get(stats[1].statistics,'Corner Kicks');
    const danger = get(stats[0].statistics,'Dangerous Attacks') + get(stats[1].statistics,'Dangerous Attacks');
    const blocked = get(stats[0].statistics,'Blocked Shots') + get(stats[1].statistics,'Blocked Shots');
    const diff = Math.abs(jogo.goals.home - jogo.goals.away);

    jogosAnalisadosHoje++;

    if(esc < 5 || esc > 8) return null;
    if(diff > 1) return null;
    if(danger < 60) return null;
    
    let score = 55 + (danger >= 80 ? 20 : 10) + (blocked >= 4 ? 15 : 0);
    if(score >= 70){
      alertados.add(`pro-${id}`);
      alertasEnviadosHoje++;
      pendentes.push({ id, nome: `${jogo.teams.home.name} x ${jogo.teams.away.name}`, escInicial: esc, hora: Date.now() });
      return { nome: `${jogo.teams.home.name} x ${jogo.teams.away.name}`, placar: `${jogo.goals.home}-${jogo.goals.away}`, min, esc, danger, score };
    }
    return null;
  }catch(e){ return null; }
}

async function confereGreen(){
  const paraConferir = pendentes.filter(p => Date.now() - p.hora > 15*60*1000);
  for(const p of paraConferir){
    try{
      const r = await axios.get(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${p.id}`,{ headers: { 'x-apisports-key': API } });
      const s = r.data.response;
      if(!s) continue;
      const get = (arr, t) => arr.find(x=>x.type===t)?.value ? parseInt(arr.find(x=>x.type===t).value) : 0;
      const escFinal = get(s[0].statistics,'Corner Kicks') + get(s[1].statistics,'Corner Kicks');
      if(escFinal > p.escInicial){
        greens++;
        await enviar(`✅ *GREEN!* ${p.nome}\n📈 ${p.escInicial} ➡️ ${escFinal} cantos | +R$${(STAKE*0.8).toFixed(2)}`);
      } else {
        reds++;
        await enviar(`❌ *RED* ${p.nome}\n📈 ${p.escInicial} ➡️ ${escFinal}`);
      }
      pendentes = pendentes.filter(x=>x.id!==p.id);
    }catch(e){}
  }
}

async function radar(){
  if(!API) return;
  try{
    const r = await axios.get('https://v3.football.api-sports.io/fixtures?live=all',{ headers: { 'x-apisports-key': API } });
    for(const j of r.data.response){
      const a = await analisaPro(j);
      if(a) await enviar(`💎 *ELITE ${a.min}' - ${a.score}/100*\n\n🏟️ ${a.nome}\n📊 ${a.placar} | ${a.esc} cantos | ${a.danger} ataques\n\n💰 +1 escanteio | R$${STAKE}\n🔗 [BET365](${LINK})`);
    }
  }catch(e){}
}

// RELATÓRIO FIXO 23:00 HORÁRIO DE BRASÍLIA
async function verificaHorarioRelatorio(){
  const agoraBR = new Date().toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"});
  const [data, hora] = agoraBR.split(', ');
  const [h, m] = hora.split(':').map(Number);
  
  // Manda às 23:00 e só uma vez por dia
  if(h === 23 && m >= 0 && m < 5 && ultimoRelatorioEnviado !== data){
    const total = greens + reds;
    const taxa = total > 0 ? ((greens/total)*100).toFixed(1) : 0;
    const lucro = (greens*parseFloat(STAKE)*0.8 - reds*parseFloat(STAKE)).toFixed(2);
    
    await enviar(`📊 *RELATÓRIO 23H - RADAR ELITE* 📊\n\n📅 ${data}\n\n🔍 Jogos analisados: ${jogosAnalisadosHoje}\n💎 Alertas enviados: ${alertasEnviadosHoje}\n\n✅ GREEN: ${greens}\n❌ RED: ${reds}\n🎯 *ASSERTIVIDADE DO DIA: ${taxa}%*\n\n💰 Lucro do dia: R$${lucro} (stake R$${STAKE})\n\n_Bot resetado para amanhã._`);
    
    ultimoRelatorioEnviado = data;
    jogosAnalisadosHoje = 0;
    alertasEnviadosHoje = 0;
    greens = 0;
    reds = 0;
    alertados.clear();
  }
}

app.get('/', (req,res)=> res.send(`ELITE 23H ON | ${jogosAnalisadosHoje} analisados hoje | ${greens}G ${reds}R`));
app.get('/teste', async (req,res)=>{ 
  const taxa = (greens+reds)>0?((greens/(greens+reds))*100).toFixed(1):0;
  await enviar(`🔔 TESTE 23H\nAnalisados: ${jogosAnalisadosHoje}\nAlertas: ${alertasEnviadosHoje}\nAssertividade: ${taxa}% (${greens}G ${reds}R)`); 
  res.send('ok'); 
});
app.get('/relatorio', async (req,res)=>{
  const taxa = (greens+reds)>0?((greens/(greens+reds))*100).toFixed(1):0;
  await enviar(`📊 *RELATÓRIO AGORA 23H*\n\n🔍 ${jogosAnalisadosHoje} analisados\n💎 ${alertasEnviadosHoje} alertas\n✅ ${greens} GREEN | ❌ ${reds} RED\n🎯 *ASSERTIVIDADE: ${taxa}%*`);
  res.send('ok');
});

setInterval(radar, 120*1000);
setInterval(confereGreen, 5*60*1000);
setInterval(verificaHorarioRelatorio, 60*1000); // verifica a cada 1 min se é 23h

radar();
app.listen(PORT, ()=> console.log('ELITE 23H FIXO ON'));
