const http=require('http'),cron=require('node-cron');
const PORT=process.env.PORT||3000;
const TOKEN=process.env.TELEGRAM_TOKEN||process.env.TOKEN||'';
const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||'';
const LIGAS=["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
let ultimo=null,aprov=0,envi=0,rel={data:new Date().toLocaleDateString('pt-BR'),sinais:[]};
const ja=new Map();
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function getJ(u){const c=new AbortController();setTimeout(()=>c.abort(),8000);const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'},signal:c.signal});return r.json();}
function num(v){let n=parseFloat(String(v??0).replace(',','.').replace('%',''));return isFinite(n)?n:0;}
function stat(S,a){if(!Array.isArray(S))return 0;for(let n of a){let s=S.find(x=>x.name?.toLowerCase()===n||x.abbreviation?.toLowerCase()===n);if(s)return num(s.displayValue||s.value);}return 0;}
async function raioX(liga,id){
 let R={chC:0,chF:0,alC:0,alF:0,poC:0,poF:0,esC:0,esF:0,crC:0,crF:0,apC:0,apF:0},fC=null,fF=null,st=null;
 try{let j=await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/summary?event='+id);
 let t=j?.boxscore?.teams||[];
 for(let i=0;i<t.length;i++){let b=t[i],S=b.statistics||[],idT=String(b.team?.id||''),lado=i===0?'home':'away';let comp=j?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===idT);if(comp)lado=comp.homeAway;
 let ch=stat(S,['totalShots','shots']),al=stat(S,['shotsOnTarget']),po=stat(S,['possessionPct','possession']),es=stat(S,['wonCorners','cornerKicks']),cr=stat(S,['crosses','totalCrosses']),ap=stat(S,['dangerousAttacks']);
 if(lado==='home'){R.chC=ch;R.alC=al;R.poC=po;R.esC=es;R.crC=cr;R.apC=ap;}else{R.chF=ch;R.alF=al;R.poF=po;R.esF=es;R.crF=cr;R.apF=ap;}}
 let comp=j?.header?.competitions?.[0];if(comp){fC=num(comp.competitors?.find(c=>c.homeAway==='home')?.score);fF=num(comp.competitors?.find(c=>c.homeAway==='away')?.score);st=comp?.status?.type?.name;}
 }catch(e){}
 return {R,fC,fF,st};
}
function checa(j,R){
 if(!LIGAS.includes(j.liga))return null;
 if(Math.abs(j.gc-j.gf)>2)return null;
 if((R.chC+R.chF)<8)return null;
 let tot=R.poC+R.poF,pc=tot>0?Math.round(R.poC/tot*100):50,pf=100-pc,need='',lado='',alvo=0,po=0,cr=0,es=0,ap=0;
 if(j.gc<j.gf){need=j.nc;lado='home';alvo=j.alC;po=pc;cr=R.crC;es=R.esC;ap=R.apC;}
 else if(j.gf<j.gc){need=j.nf;lado='away';alvo=j.alF;po=pf;cr=R.crF;es=R.esF;ap=R.apF;}
 else{let cm=j.alC>=j.alF;need=cm?j.nc:j.nf;lado=cm?'home':'away';alvo=Math.max(j.alC,j.alF);po=cm?pc:pf;cr=cm?R.crC:R.crF;es=cm?R.esC:R.esF;ap=cm?R.apC:R.apF;}
 if(alvo<2)return null;
 let score=cr+(es*2)+(ap/10);if(score<6)return null;if(po<60)return null;
 return {need,lado,alvo,po,score,zona:cr>=8?'Lateral ('+cr+' cruz)':es>=3?'Abafa Area ('+es+' esc)':'Meio-Perigoso ('+ap+' AP)'};
}
async function send(j,a,R){
 if(!TOKEN||!CHAT)return false;
 let pC=R.poC+R.poF>0?Math.round(R.poC/(R.poC+R.poF)*100):50;
 let link='https://www.espn.com/soccer/match/_/gameId/'+j.id;
 let txt='';
 txt+='\uD83D\uDEA8 RAIO-X GOL 2T - 60% POSSE\n\n';
 txt+='\uD83C\uDFC6 '+j.liga.toUpperCase()+'\n';
 txt+='\u26BD '+j.nc+' '+j.gc+'x'+j.gf+' '+j.nf+'\n';
 txt+='\u23F1\uFE0F '+j.mt+'\n\n';
 txt+='\uD83D\uDCCA HT: '+R.chC+'x'+R.chF+' chutes | '+R.alC+'x'+R.alF+' alvo\n';
 txt+='Posse: '+pC+'% x '+(100-pC)+'% | Esc: '+R.esC+'x'+R.esF+'\n\n';
 txt+='\uD83D\uDCCD PRESSAO: '+a.zona+'\n';
 txt+='\uD83D\uDCC8 Score: '+a.score.toFixed(1)+' | Posse time: '+a.po+'%\n\n';
 txt+='\uD83C\uDFAF PRECISA: '+a.need+' ('+a.alvo+' no alvo)\n';
 txt+='\uD83D\uDD17 Ver lance: '+link+'\n\n';
 txt+='\uD83D\uDCB0 ENTRADA: Over 0.5 GOL 2T / '+a.need+' marca';
 try{let r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT,text:txt})});let d=await r.json();if(!d.ok)throw Error(d.description);
 envi++;rel.sinais.push({id:j.id,liga:j.liga,jogo:j.nc+' '+j.gc+'x'+j.gf+' '+j.nf,ht:j.gc+'x'+j.gf,need:a.need,lado:a.lado,gC:j.gc,gF:j.gf,status:'pendente',final:null,link:link});return true;}catch(e){return false;}
}
async function scan(){
 let lista=[];
 for(let liga of LIGAS){try{let sb=await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/scoreboard');if(!Array.isArray(sb.events))continue;
 for(let ev of sb.events){try{let comp=ev.competitions?.[0];if(!comp)continue;let st=comp.status?.type?.name;if(!['STATUS_HALFTIME','STATUS_SECOND_HALF'].includes(st))continue;let min=num(comp.status?.clock
