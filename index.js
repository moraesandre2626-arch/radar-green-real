const http = require('http');
const cron = require('node-cron');
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
const LIGAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];

let ultimo = null, aprov = 0, envi = 0;
let rel = { data: new Date().toLocaleDateString('pt-BR'), sinais: [] };
const ja = new Map();
const sleep = function(m){ return new Promise(function(r){ setTimeout(r,m); }); };

async function getJ(u){
  const c = new AbortController();
  setTimeout(function(){ c.abort(); }, 8000);
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: c.signal });
  return r.json();
}
function num(v){
  let n = parseFloat(String(v==null?0:v).replace(',','.').replace('%',''));
  return isFinite(n)? n : 0;
}
function stat(S, a){
  if(!Array.isArray(S)) return 0;
  for(let i=0;i<a.length;i++){
    let nome = a[i].toLowerCase();
    let s = S.find(function(x){ return (x.name&&x.name.toLowerCase()===nome) || (x.abbreviation&&x.abbreviation.toLowerCase()===nome); });
    if(s) return num(s.displayValue || s.value);
  }
  return 0;
}
async function raioX(liga, id){
  let R = { chC:0,chF:0,alC:0,alF:0,poC:0,poF:0,esC:0,esF:0,crC:0,crF:0,apC:0,apF:0 };
  let fC = null, fF = null, st = null;
  try{
    let j = await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/summary?event='+id);
    let teams = j.boxscore && j.boxscore.teams? j.boxscore.teams : [];
    for(let i=0;i<teams.length;i++){
      let b = teams[i];
      let S = b.statistics || [];
      let lado = i===0? 'home' : 'away';
      if(j.header && j.header.competitions && j.header.competitions[0] && j.header.competitions[0].competitors){
        let comp = j.header.competitions[0].competitors.find(function(c){ return String(c.team.id)===String(b.team.id); });
        if(comp) lado = comp.homeAway;
      }
      let ch = stat(S, ['totalShots','shots']);
      let al = stat(S, ['shotsOnTarget']);
      let po = stat(S, ['possessionPct','possession']);
      let es = stat(S, ['wonCorners','cornerKicks']);
      let cr = stat(S, ['crosses','totalCrosses']);
      let ap = stat(S, ['dangerousAttacks']);
      if(lado==='home'){ R.chC=ch;R.alC=al;R.poC=po;R.esC=es;R.crC=cr;R.apC=ap; }
      else { R.chF=ch;R.alF=al;R.poF=po;R.esF=es;R.crF=cr;R.apF=ap; }
    }
    let compH = j.header && j.header.competitions? j.header.competitions[0] : null;
    if(compH){
      let casa = compH.competitors.find(function(c){ return c.homeAway==='home'; });
      let fora = compH.competitors.find(function(c){ return c.homeAway==='away'; });
      fC = num(casa? casa.score : 0);
      fF = num(fora? fora.score : 0);
      st = compH.status && compH.status.type? compH.status.type.name : null;
    }
  }catch(e){}
  return { R: R, fC: fC, fF: fF, st: st };
}
function checa(j, R){
  if(LIGAS.indexOf(j.liga)===-1) return null;
  if(Math.abs(j.gc-j.gf)>2) return null;
  if((R.chC+R.chF)<8) return null;
  let tot = R.poC+R.poF;
  let pc = tot>0? Math.round(R.poC/tot*100) : 50;
  let pf = 100-pc;
  let need='', lado='', alvo=0, po=0, cr=0, es=0, ap=0;
  if(j.gc<j.gf){ need=j.nc; lado='home'; alvo=j.alC; po=pc; cr=R.crC; es=R.esC; ap=R.apC; }
  else if(j.gf<j.gc){ need=j.nf; lado='away'; alvo=j.alF; po=pf; cr=R.crF; es=R.esF; ap=R.apF; }
  else { let cm=j.alC>=j.alF; need=cm?j.nc:j.nf; lado=cm?'home':'away'; alvo=Math.max(j.alC,j.alF); po=cm?pc:pf; cr=cm?R.crC:R.crF; es=cm?R.esC:R.esF; ap=cm?R.apC:R.apF; }
  if(alvo<2) return null;
  let score = cr + (es*2) + (ap/10);
  if(score<6) return null;
  if(po<60) return null;
  let zona = cr>=8? 'Lateral ('+cr+' cruz)' : es>=3? 'Abafa Area ('+es+' esc)' : 'Meio ('+ap+' AP)';
  return { need: need, lado: lado, alvo: alvo, po: po, score: score, zona: zona };
}
async function send(j, a, R){
  if(!TOKEN ||!CHAT) return false;
  let pC = (R.poC+R.poF)>0? Math.round(R.poC/(R.poC+R.poF)*100) : 50;
  let link = 'https://www.espn.com/soccer/match/_/gameId/'+j.id;
  let txt = '';
  txt += '\uD83D\uDEA8 RAIO-X GOL 2T - 60% POSSE\n\n';
  txt += j.liga.toUpperCase()+'\n';
  txt += j.nc+' '+j.gc+'x'+j.gf+' '+j.nf+'\n';
  txt += j.mt+'\n\n';
  txt += 'Chutes '+R.chC+'x'+R.chF+' | Alvo '+R.alC+'x'+R.alF+'\n';
  txt += 'Posse '+pC+'% x '+(100-pC)+'% | Esc '+R.esC+'x'+R.esF+'\n';
  txt += 'PRESSAO: '+a.zona+'\n';
  txt += 'Score '+a.score.toFixed(1)+' | Posse '+a.po+'%\n\n';
  txt += 'PRECISA: '+a.need+'\n';
  txt += 'Link: '+link+'\n';
  txt += 'ENTRADA: Over 0.5 GOL 2T';
  try{
    let r = await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: CHAT, text: txt }) });
    let d = await r.json();
    if(!d.ok) throw new Error(d.description);
    envi++;
    rel.sinais.push({ id: j.id, liga: j.liga, jogo: j.nc+' '+j.gc+'x'+j.gf+' '+j.nf, ht: j.gc+'x'+j.gf, need: a.need, lado: a.lado, gC: j.gc, gF: j.gf, status: 'pendente', final: null, link: link });
    return true;
  }catch(e){ return false; }
}
async function scan(){
  let lista = [];
  for(let li=0; li<LIGAS.length; li++){
    let liga = LIGAS[li];
    try{
      let sb = await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/scoreboard');
      if(!Array.isArray(sb.events)) continue;
      for(let ev=0; ev<sb.events.length; ev++){
        try{
          let event = sb.events[ev];
          let comp = event.competitions? event.competitions[0] : null;
          if(!comp) continue;
          let st = comp.status && comp.status.type? comp.status.type.name : '';
          if(st!=='STATUS_HALFTIME' && st!=='STATUS_SECOND_HALF') continue;
          let min = num(comp.status && comp.status.clock? comp.status.clock : 0);
          if(st==='STATUS_HALFTIME') min
