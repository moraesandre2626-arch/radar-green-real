const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Iniciando V33...';
let enviadosHT = new Set();
let memoriaHT = {};

async function enviarTelegram(msg){
  try{
    const t=process.env.TELEGRAM_TOKEN;
    const c=process.env.TELEGRAM_CHAT_ID;
    if(!t||!c) return;
    await axios.get(`https://api.telegram.org/bot${t}/sendMessage`,{params:{chat_id:c,text:msg,parse_mode:'HTML'}});
  }catch(e){}
}

async function getJogos(){
  const ligas=[
    'bra.1','conmebol.libertadores','conmebol.sudamericana',
    'eng.1','esp.1','ita.1','ger.1','fra.1','por.1','arg.1',
    'uefa.champions','uefa.europa'
  ];
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
      const home=comp.competitors.find(c=>c.homeAway==='home');
      const away=comp.competitors.find(c=>c.homeAway==='away');
      let sh=0,sa=0,dh=0,da=0,ah=0,aa=0;
      try{
        const s0=comp.competitors[0].statistics||[];
        const s1=comp.competitors[1].statistics||[];
        sh=parseInt((s0.find(x=>x.name==='shots')||{}).displayValue)||0;
        sa=parseInt((s1.find(x=>x.name==='shots')||{}).displayValue)||0;
        dh=parseInt((s0.find(x=>x.name==='dangerousAttacks')||{}).displayValue)||0;
        da=parseInt((s1.find(x=>x.name==='dangerousAttacks')||{}).displayValue)||0;
        ah=parseInt((s0.find(x=>x.name==='attacks')||{}).displayValue)||0;
        aa=parseInt((s1.find(x=>x.name==='attacks')||{}).displayValue)||0;
      }catch{}
      const id=ev.id;
      const golH=parseInt(home.score)||0;
      const golA=parseInt(away.score)||0;
      const placar=golH+'x'+golA;
      if(status.includes('HALFTIME')){
        htCount++;
        if(enviadosHT.has(id)) continue;
        const placarMagro=Math.abs(golH-golA)<=1;
        const amasso=(Math.abs(sh-sa)>=2)||(Math.abs(dh-da)>=5)||(Math.abs(ah-aa)>=15);
        if(amasso&&placarMagro){
          const time=(sh>=sa)?home.team.displayName:away.team.displayName;
          memoriaHT[id]=time;
          await enviarTelegram('📊 RAIO-X V33\n⚽ '+home.team.displayName+' '+placar+' '+away.team.displayName+'\n🔥 '+time+' AMASSOU!\n🎯 Chutes: '+sh+'x'+sa+'\n💥 Perigosos: '+dh+'x'+da+'\n⚔️ Ataques: '+ah+'x'+aa);
          enviadosHT.add(id);
        }
      }
    }catch{}
  }
  jogosAoVivo=htCount;
  ultimoErro='OK V33 - '+htCount+' HT - '+new Date().toLocaleTimeString('pt-BR');
  console.log(ultimoErro);
}

app.get('/',(req,res)=>{res.json({versao:'V33 - 12 LIGAS',ultimo_scan:ultimoScan,jogos_intervalo:jogosAoVivo,erro:ultimoErro,ligas:['BR','Liberta','Sula','ENG','ESP','ITA','GER','FRA','POR','ARG','Champions','Europa']});});
app.get('/teste',async(req,res)=>{await enviarTelegram('✅ TESTE V33 OK - 12 LIGAS\n'+ultimoErro);res.send('ok v33');});
setInterval(analisar,40000);
analisar();
app.listen(PORT,()=>console.log('V33 NO AR '+PORT));
