const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando V34...';
let enviadosHT = new Set();

async function enviarTelegram(msg){
  try{
    const t=process.env.TELEGRAM_TOKEN;
    const c=process.env.TELEGRAM_CHAT_ID;
    if(!t||!c) return;
    await axios.get(`https://api.telegram.org/bot${t}/sendMessage`,{params:{chat_id:c,text:msg,parse_mode:'HTML'}});
  }catch(e){}
}

function pegaStat(stats, nomes){
  for(const n of nomes){
    const f = stats.find(s => s.name.toLowerCase().includes(n));
    if(f){
      let v = f.displayValue;
      if(typeof v==='string' && v.includes('%')) v = v.replace('%','');
      const num = parseInt(v);
      if(!isNaN(num)) return num;
    }
  }
  return 0;
}

async function getJogos(){
  const ligas=['bra.1','eng.1','esp.1','ita.1','ger.1','fra.1','por.1','arg.1','conmebol.libertadores','conmebol.sudamericana','uefa.champions','uefa.europa'];
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
  let debugLast = '';
  for(const ev of todos){
    try{
      const comp=ev.competitions[0];
      const status=comp.status.type.name;
      if(!status.includes('HALFTIME')) continue;
      htCount++;
      const home=comp.competitors.find(c=>c.homeAway==='home');
      const away=comp.competitors.find(c=>c.homeAway==='away');
      const s0=home.statistics||comp.competitors[0].statistics||[];
      const s1=away.statistics||comp.competitors[1].statistics||[];

      const sh = pegaStat(s0, ['shot','total']);
      const sa = pegaStat(s1, ['shot','total']);
      const posseH = pegaStat(s0, ['possession','posse']);

      debugLast = `${home.team.abbreviation} ${home.score}x${away.score} ${away.team.abbreviation} CH:${sh}x${sa} POS:${posseH}%`;

      const id=ev.id;
      if(enviadosHT.has(id)) continue;

      const golH=parseInt(home.score)||0;
      const golA=parseInt(away.score)||0;
      const placarMagro = Math.abs(golH-golA)<=1;

      // NOVA REGRA V34: dispara em 0x0 ou placar magro com amasso leve
      const diffChutes = sh - sa;
      const amasso =
        (Math.abs(diffChutes) >= 3) || // 7x4 = dispara
        (Math.abs(diffChutes) >= 2 && posseH >= 58) || // 2 chutes + 58% posse
        (Math.abs(diffChutes) >= 2 && (golH+golA)<=1); // 0x0 ou 1x0 com 2 chutes a mais

      if(amasso && placarMagro){
        const time = (sh>=sa)? home.team.displayName : away.team.displayName;
        const placar = `${golH}x${golA}`;
        await enviarTelegram(`📊 RAIO-X V34\n⚽ ${home.team.displayName} ${placar} ${away.team.displayName}\n🔥 ${time} AMASSOU no 1ºT!\n🎯 Chutes: ${sh}x${sa}\n📈 Posse: ${posseH}%\n💰 ENTRADA: ${time} DNB / OVER 0.5 HT 2ºT`);
        enviadosHT.add(id);
      }
    }catch{}
  }
  jogosAoVivo=htCount;
  ultimoErro=`OK V34 - ${htCount} HT - ${debugLast} - ${new Date().toLocaleTimeString('pt-BR')}`;
  console.log(ultimoErro);
}

app.get('/',(req,res)=>{res.json({versao:'V34 - ATACA 0x0',ultimo_scan:ultimoScan,jogos_intervalo:jogosAoVivo,erro:ultimoErro});});
app.get('/teste',async(req,res)=>{await enviarTelegram(`✅ TESTE V34 OK - ${ultimoErro}`);res.send('ok v34');});
setInterval(analisar,30000);
analisar();
app.listen(PORT,()=>console.log('V34 NO AR '+PORT));
