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
 return {need,lado,alvo,tot:j.gc+j.gf,po,score,zona:cr>=8?'Lateral '+cr+'c':es>=3?'Abafa '+es+'esc':'Meio'};
}
async function send(j,a,R){
 if(!TOKEN||!CHAT)return false;
 let pC=R.poC+R.poF>0?Math.round(R.poC/(R.poC+R.poF)*100):50;
 let txt='RAIO-X GOL 2T V34.7\n\n'+j.liga.toUpperCase()+'\n'+j.nc+' '+j.gc+'x'+j.gf+' '+j.nf+'\n'+j.mt+'\n\nHT: '+R.chC+'x'+R.chF+' chutes | '+R.alC+'x'+R.alF+' alvo\nPosse '+pC+'% x '+(100-pC)+'%\nEsc '+R.esC+'x'+R.esF+'\nPressao: '+a.zona+' Score '+a.score.toFixed(1)+'\nPosse time '+a.po+'%\n\nPrecisa: '+a.need;
 try{let r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT,text:txt})});let d=await r.json();if(!d.ok)throw Error(d.description);
 envi++;rel.sinais.push({id:j.id,liga:j.liga,jogo:j.nc+' '+j.gc+'x'+j.gf+' '+j.nf,ht:j.gc+'x'+j.gf,need:a.need,lado:a.lado,gC:j.gc,gF:j.gf,status:'pendente',final:null});return true;}catch(e){return false;}
}
async function scan(){
 let lista=[];
 for(let liga of LIGAS){try{let sb=await getJ('https://site.api.espn.com/apis/site/v2/sports/soccer/'+liga+'/scoreboard');if(!Array.isArray(sb.events))continue;
 for(let ev of sb.events){try{let comp=ev.competitions?.[0];if(!comp)continue;let st=comp.status?.type?.name;if(!['STATUS_HALFTIME','STATUS_SECOND_HALF'].includes(st))continue;let min=num(comp.status?.clock);if(st==='STATUS_HALFTIME')min=45;if(min<40||min>55)continue;
 let ca=comp.competitors?.find(c=>c.homeAway==='home'),fo=comp.competitors?.find(c=>c.homeAway==='away');if(!ca||!fo)continue;await sleep(400);let {R}=await raioX(liga,ev.id);
 let jogo={id:String(ev.id),liga,nc:ca.team?.displayName||'Casa',nf:fo.team?.displayName||'Fora',gc:num(ca.score),gf:num(fo.score),alC:R.alC,alF:R.alF,mt:st==='STATUS_HALFTIME'?'INTERVALO':Math.floor(min)+"'",R};
 let an=checa(jogo,R);if(!an)continue;aprov++;lista.push({jogo,an,R});}catch(e){}}}catch(e){}}
 return lista;
}
async function verifica(){
 for(let s of rel.sinais){if(s.status!=='pendente')continue;try{let {fC,fF,st}=await raioX(s.liga,s.id);if(fC===null)continue;if(st&&st.includes('STATUS_FINAL')){let g=s.lado==='home'?fC>s.gC:fF>s.gF;s.status=g?'green':'red';s.final=fC+'x'+fF;}await sleep(500);}catch(e){}}
}
async function radar(){ultimo=new Date().toISOString();console.log('varrendo...');let r=await scan();for(let {jogo,an,R} of r){let k=jogo.liga+'_'+jogo.id;if(ja.has(k))continue;if(await send(jogo,an,R))ja.set(k,Date.now());}}
async function relatorio(){await verifica();if(!TOKEN||!CHAT)return;let tot=rel.sinais.length,gre=rel.sinais.filter(s=>s.status==='green').length,red=rel.sinais.filter(s=>s.status==='red').length;let taxa=tot?Math.round(gre/tot*100):0;
 let lis=rel.sinais.length?rel.sinais.map((s,i)=>{let ic=s.status==='green'?'[G]':s.status==='red'?'[R]':'[P]';return ic+' '+(i+1)+'. '+s.jogo+' HT '+s.ht+' -> '+(s.final||'?')+' '+s.need;}).join('\n'):'Nenhum sinal hoje - filtro 60% rigoroso';
 let msg='RELATORIO '+rel.data+'\nTotal:'+tot+' GREEN:'+gre+' RED:'+red+' Taxa:'+taxa+'%\n\n'+lis;await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT,text:msg})});rel={data:new Date().toLocaleDateString('pt-BR'),sinais:[]};}
const srv=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'online',robo:'V34.7 FIX CURTO',ultimo,aprov,envi,hoje:rel}));});
srv.listen(PORT,()=>{console.log('ONLINE '+PORT);radar();setInterval(radar,60000);setInterval(verifica,900000);cron.schedule('59 23 * * *',relatorio,{timezone:'America/Sao_Paulo'});});
