const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando V32...';
let enviadosHT = new Set();
let enviados2T = new Set();
let memoriaHT = {};

async function enviarTelegram(msg){
  try{
    const t=process.env.TELEGRAM_TOKEN;
    const c=process.env.TELEGRAM_CHAT_ID;
    if(!t||!c) return;
    await axios.get(`https://api.telegram.org/bot${t}/sendMessage`,{params:{chat_id:c,text:msg,parse_mode:'HTML'}});
  }catch(e){ ultimoErro='Erro TG: '+e.message; }
}

async function getJogos(){
  const ligas=['bra.1','conmebol.libertadores','conmebol.sudamericana','eng.1','esp.1','ita.1','ger.1','uefa.champions','uefa.europa','usa.1'];
  let todos=[];
  for(const l of ligas){
    try{
      const r=await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l}/scoreboard`,{timeout:10000});
      if(r.data.events) todos=todos.concat(r.data.events);
    }catch{}
  }
  return todos;
}

async function analisar(){
  ultimoScan=new Date().toLocaleString('pt-BR');
  const todos=await getJogos();
  let htCount=0;

  for(const ev of todos){
    try{
      const comp=ev.competitions[0];
      const status=comp.status.type.name;
      const clock=comp.status.displayClock||"";
      const minuto=parseInt(clock)||0;
      const home=comp.competitors.find(c=>c.homeAway==='home');
      const away=comp.competitors.find(c=>c.homeAway==='away');

      // PEGA ESTATÍSTICAS
      let sh=0,sa=0,ah=0,aa=0,dh=0,da=0;
      try{
        const getStat = (teamIdx, name) => {
          const stats = comp.competitors[teamIdx].statistics||[];
          const s = stats.find(x=>x.name===name||x.displayName===name);
          return parseInt(s?.displayValue)||0;
        };
        sh=getStat(0,'shots'); sa=getStat(1,'shots');
        // tenta pegar ataques
        ah=getStat(0,'attacks'); aa=getStat(1,'attacks');
        dh=getStat(0,'dangerousAttacks'); da=getStat(1,'dangerousAttacks');
