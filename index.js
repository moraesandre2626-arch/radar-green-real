const http=require('http'),cron=require('node-cron');
const PORT=process.env.PORT||3000;
const TOKEN=process.env.TELEGRAM_TOKEN||process.env.TOKEN||'';
const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||'';
const LIGAS=["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
let ultimo=null,aprov=0,envi=0,rel={data:new Date().toLocaleDateString('pt-BR'),sinais:[]};
const ja=new Map();
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function getJ(u){const c=new AbortController();setTimeout(()=>c.abort(),8000);const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'},signal:c.signal});return r.json();}
function num(v){let n=parseFloat(String(v==null?0:v).replace(',','.').replace('%',''));return isFinite(n)?n:0;}
function stat(S,a){if(!Array.isArray(S))return 0;for(let n of a){let s=S.find(x=>x.name&&x.name.toLowerCase()===n||x.abbreviation&&x.abbreviation.toLowerCase()===n);if(s)return num(s.displayValue||s.value);}return 0;}
async function raioX(liga,id){
 let R={chC:0,chF:0,alC:0,alF:0,poC:0,poF:0,esC:0,esF:0,crC:0,crF:0,apC:0,apF:0},fC=null,fF=null,st=null;
 try{let j=await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/summary?event='+id);
 let t=j.boxscore&&j.boxscore.teams?j.boxscore.teams:[];for(let i=0;i<t.length;i++){let b=t[i],S=b.statistics||[];let lado=i==0?'home':'away';
 let comp=j.header&&j.header.competitions&&j.header.competitions[0]&&j.header.competitions[0].competitors?j.header.competitions[0].competitors.find(c=>String(c.team.id)==String(b.team.id)):null;if(comp)lado=comp.homeAway;
 let ch=stat(S,['totalShots','shots']),al=stat(S,['shotsOnTarget']),po=stat(S,['possessionPct','possession']),es=stat(S,['wonCorners','cornerKicks']),cr=stat(S,['crosses','totalCrosses']),ap=stat(S,['dangerousAttacks']);
 if(lado=='home'){R.chC=ch;R.alC=al;R.poC=po;R.esC=es;R.crC=cr;R.apC=ap;}else{R.chF=ch;R.alF=al;R.poF=po;R.esF=es;R.crF=cr;R.apF=ap;}}
 let compH=j.header&&j.header.competitions?j.header.competitions[0]:null;if(compH){let ca=compH.competitors.find(c=>c.homeAway=='home'),fo=compH.competitors.find(c=>c.homeAway=='away');fC=num(ca?ca.score:0);fF=num(fo?fo.score:0);st=compH.status&&compH.status.type?compH.status.type.name:null;}}catch(e){}
 return {R:R,fC:fC,fF:fF,st:st};
}
function checa(j,R){
 if(LIGAS.indexOf(j.liga)===-1)return null;if(Math.abs(j.gc-j.gf)>2)return null;if((R.chC+R.chF)<8)return null;
 let tot=R.poC+R.poF,pc=tot>0?Math.round(R.poC/tot*100):50,pf=100-pc,need='',lado='',alvo=0,po=0,cr=0,es=0,ap=0;
 if(j.gc<j.gf){need=j.nc;lado='home';alvo=j.alC;po=pc;cr=R.crC;es=R.esC;ap=R.apC;}else if(j.gf<j.gc){need=j.nf;lado='away';alvo=j.alF;po=pf;cr=R.crF;es=R.esF;ap=R.apF;}else{let cm=j.alC>=j.alF;need=cm?j.nc:j.nf;lado=cm?'home':'away';alvo=Math.max(j.alC,j.alF);po=cm?pc:pf;cr=cm?R.crC:R.crF;es=cm?R.esC:R.esF;ap=cm?R.apC:R.apF;}
 if(alvo<2)return null;let score=cr+(es*2)+(ap/10);if(score<6)return null;if(po<60)return null;
 return {need:need,lado:lado,alvo:alvo,po:po,score:score,zona:cr>=8?'Lateral '+cr+'c':es>=3?'Abafa '+es+'esc':'Meio '+ap+'AP'};
}
async function send(j,a,R){
 if(!TOKEN||!CHAT)return false;let pC=(R.poC+R.poF)>0?Math.round(R.poC/(R.poC+R.poF)*100):50;let link='https://www.espn.com/soccer/match/_/gameId/'+j.id;
 let txt='RAIO-X GOL 2T V34.8 PREMIUM\n\n'+j.liga.toUpperCase()+'\n'+j.nc+' '+j.gc+'x'+j.gf+' '+j.nf+'\n'+j.mt+'\n\nChutes '+R.chC+'x'+R.chF+' Alvo '+R.alC+'x'+R.alF+'\nPosse '+pC+'% x '+(100-pC)+'% Esc '+R.esC+'x'+R.esF+'\nPressao: '+a.zona+' Score '+a.score.toFixed(1)+'\nPrecisa: '+a.need+'\nLink: '+link+'\nENTRADA Over 0.5 GOL';
 try{let r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT,text:txt})});let d=await r.json();if(!d.ok)throw Error(d.description);
 envi++;rel.sinais.push({id:j.id,liga:j.liga,jogo:j.nc+' '+j.gc+'x'+j.gf+' '+j.nf,ht:j.gc+'x'+j.gf,need:a.need,lado:a.lado,gC:j.gc,gF:j.gf,status:'pendente',final:null,link:link});return true;}catch(e){return false;}
}
async function scan(){
 let lista=[];for(let li=0;li<LIGAS.length;li++){let liga=LIGAS[li];try{let sb=await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/scoreboard');if(!Array.isArray(sb.events))continue;
 for(let ev=0;ev<sb.events.length;ev++){let event=sb.events[ev],comp=event.competitions?event.competitions[0]:null;if(!comp)continue;let st=comp.status&&comp.status.type?comp.status.type.name:'';if(st!='STATUS_HALFTIME'&&st!='STATUS_SECOND_HALF')continue;
 let min=num(comp.status&&comp.status.clock?comp.status.clock:0);if(st=='STATUS_HALFTIME')min=45;if(min<40||min>55)continue;let ca=comp.competitors.find(c=>c.homeAway=='home'),fo=comp.competitors.find(c=>c.homeAway=='away');if(!ca||!fo)continue;
 await sleep(400);let dados=await raioX(liga,event.id),R=dados.R;let jogo={id:String(event.id),liga:liga,nc:ca.team.displayName,nf:fo.team.displayName,gc:num(ca.score),gf:num(fo.score),alC:R.alC,alF:R.alF,mt:st=='STATUS_HALFTIME'?'INTERVALO':Math.floor(min)+"'"};
 let an=checa(jogo,R);if(!an)continue;aprov++;lista.push({jogo:jogo,an:an,R:R});}}catch(e){}}return lista;
}
async function verifica(){for(let i=0;i<rel.sinais.length;i++){let s=rel.sinais[i];if(s.status!='pendente')continue;try{let dados=await raioX(s.liga,s.id);if(dados.fC==null)continue;if(dados.st&&dados.st.indexOf('STATUS_FINAL')!=-1){let g=s.lado=='home'?dados.fC>s.gC:dados.fF>s.gF;s.status=g?'green':'red';s.final=dados.fC+'x'+dados.fF;}await sleep(500);}catch(e){}}}
async function radar(){ultimo=new Date().toISOString();let r=await scan();for(let i=0;i<r.length;i++){let it=r[i],k=it.jogo.liga+'_'+it.jogo.id;if(ja.has(k))continue;if(await send(it.jogo,it.an,it.R))ja.set(k,Date.now());}}
async function relatorio(){await verifica();if(!TOKEN||!CHAT)return;let tot=rel.sinais.length,gre=rel.sinais.filter(s=>s.status=='green').length,red=rel.sinais.filter(s=>s.status=='red').length;let taxa=tot?Math.round(gre/tot*100):0;
 let lis=rel.sinais.length?rel.sinais.map((s,i)=>{let ic=s.status=='green'?'[GREEN]':s.status=='red'?'[RED]':'[PEND]';return ic+' '+(i+1)+'. '+s.jogo+' HT '+s.ht+' -> '+(s.final||'?')+' '+s.need+'\n '+s.link;}).join('\n\n'):'Nenhum sinal hoje';
 let msg='RELATORIO '+rel.data+'\nTotal:'+tot+' GREEN:'+gre+' RED:'+red+' Taxa:'+taxa+'% Lucro:'+(gre-red)+' un\n\n'+lis;await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT,text:msg})});rel={data:new Date().toLocaleDateString('pt-BR'),sinais:[]};}
const srv=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'online',robo:'V34.8 PREMIUM CURTO',ultimo:ultimo,aprov:aprov,envi:envi,hoje:rel}));});
srv.listen(PORT,()=>{console.log('PREMIUM ONLINE '+PORT);radar();setInterval(radar,60000);setInterval(verifica,900000);cron.schedule('59 23 * * *',relatorio,{timezone:'America/Sao_Paulo'});});
