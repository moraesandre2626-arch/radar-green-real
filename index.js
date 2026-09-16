const http = require('http');
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT = process.env.CHAT_ID || '';
const LIGAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
const F = { maxGol:2, minAlvo:2, minChutes:8, minMin:40, maxMin:55, minPosse:60, minScore:6 };
let ultimoScan=null, totalAprovados=0, totalEnviados=0, sinaisDia=[], resultadosDia=[], relatorioOk=false;
const enviados=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){
 const c=new AbortController();
 const t=setTimeout(()=>c.abort(),8000);
 try{
  const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"},signal:c.signal});
  if(!r.ok) throw new Error("http "+r.status);
  return await r.json();
 }finally{clearTimeout(t);}
}
function num(v){
 const s=String(v||0).replace(",",".").replace("%","");
 const n=parseFloat(s); return isFinite(n)?n:0;
}
function stat(S,nomes){
 if(!Array.isArray(S)) return 0;
 for(const nome of nomes){
  for(const it of S){
   const a=(it.name||"").toLowerCase();
   const b=(it.abbreviation||"").toLowerCase();
   if(a===nome.toLowerCase()||b===nome.toLowerCase()){
    return num(it.displayValue||it.value||0);
   }
  }
 }
 return 0;
}
async function buscaRaio(liga,eventId){
 const raio={chCasa:0,chFora:0,alCasa:0,alFora:0,posseCasa:0,posseFora:0,escCasa:0,escFora:0,cruzCasa:0,cruzFora:0,apCasa:0,apFora:0};
 try{
  const base="https://site.api.espn.com/apis/site/v2/sports/soccer/";
  const sum=await getJson(base+liga+"/summary?event="+eventId);
  const teams=sum.boxscore?.teams||[];
  const comps=sum.header?.competitions?.[0]?.competitors||[];
  for(let i=0;i<teams.length;i++){
   const bloco=teams[i];
   const id=String(bloco.team?.id||"");
   let lado=i===0?"home":"away";
   const f=comps.find(c=>String(c.team?.id)===id);
   if(f) lado=f.homeAway;
   const S=bloco.statistics||[];
   const ch=stat(S,["totalShots","shots"]);
   const al=stat(S,["shotsOnTarget","shotsOnGoal"]);   const posse=stat(S,["possessionPct","possession"]);
   const esc=stat(S,["wonCorners","cornerKicks"]);
   const cruz=stat(S,["crosses","totalCrosses"]);
   const ap=stat(S,["dangerousAttacks","dangerousAttack","attack"]);
   if(lado==="home"){raio.chCasa=ch;raio.alCasa=al;raio.posseCasa=posse;raio.escCasa=esc;raio.cruzCasa=cruz;raio.apCasa=ap;}
   else{raio.chFora=ch;raio.alFora=al;raio.posseFora=posse;raio.escFora=esc;raio.cruzFora=cruz;raio.apFora=ap;}
  }
 }catch(e){}
 return raio;
}
function checa(jogo,raio){
 if(!LIGAS.includes(jogo.liga)) return {ok:false};
 if(Math.abs(jogo.gc-jogo.gf)>F.maxGol) return {ok:false};
 if((jogo.chCasa+jogo.chFora)<F.minChutes) return {ok:false};
 const totPos=raio.posseCasa+raio.posseFora;
 const pCasa=totPos>0?Math.round((raio.posseCasa/totPos)*100):50;async function enviaSinal(jogo,analise,raio){
 const pCasa=analise.pCasa; const pFora=100-pCasa;
 let msg="";
 msg+="🚨 RAIO-X GOL 2T V35.1 PREMIUM\n\n";
 msg+="🏆 "+jogo.liga.toUpperCase()+"\n";
 msg+="⚽ "+jogo.casa+" "+jogo.gc+"x"+jogo.gf+" "+jogo.fora+"\n";
 msg+="⏱️ "+jogo.minTxt+"\n\n";
 msg+="📊 ESTATISTICAS HT:\n";
 msg+="🥅 Chutes: "+raio.chCasa+"x"+raio.chFora+"\n";
 msg+="🎯 No Alvo: "+raio.alCasa+"x"+raio.alFora+"\n";
 msg+="🚩 Escanteios: "+raio.escCasa+"x"+raio.escFora+"\n";
 msg+="📈 Posse: "+pCasa+"% x "+pFora+"%\n\n";
 msg+="📍 PRESSAO: "+analise.zona+"\n";
 msg+="📈 Score: "+analise.score.toFixed(1)+" | Posse: "+analise.posseTime+"% ✅\n\n";
 msg+="🎯 Precisa: "+analise.precisa+" ("+analise.chPrecisa+" alvo)\n";
 msg+="✅ ENTRADA Over 0.5 GOL 2T";
 const ok=await envia(msg);
 if(ok){
  sinaisDia.push(jogo.casa+" x "+jogo.fora);
  resultadosDia.push({jogo:jogo.casa+" x "+jogo.fora, gc:jogo.gc, gf:jogo.gf, id:jogo.id, liga:jogo.liga, hora:Date.now(), status:"pendente"});
 }
 return ok;
}
async function buscaJogos(){
 const lista=[];
 for(const liga of LIGAS){
  try{
   const base="https://site.api.espn.com/apis/site/v2/sports/soccer/";
   const data=await getJson(base+liga+"/scoreboard");
   if(!Array.isArray(data.events)) continue;
   for(const ev of data.events){
    const comp=ev.competitions?.[0]; if(!comp) continue;
    const st=comp.status?.type?.name||"";
    if(st!=="STATUS_HALFTIME"&&st!=="STATUS_SECOND_HALF") continue;
    let minuto=num(comp.status?.clock); if(st==="STATUS_HALFTIME") minuto=45;
    if(minuto<F.minMin||minuto>F.maxMin) continue;
    const casaObj=comp.competitors?.find(c=>c.homeAway==="home");
    const foraObj=comp.competitors?.find(c=>c.homeAway==="away");
    if(!   const comp=ev.competitions?.[0]; if(!comp) continue;
   const casaObj=comp.competitors?.find(c=>c.homeAway==="home");
   const foraObj=comp.competitors?.find(c=>c.homeAway==="away");
   const gcFinal=num(casaObj?.score); const gfFinal=num(foraObj?.score);
   const gol2T=(gcFinal+gfFinal)>(r.gc+r.gf);
   r.status=gol2T?"green":"red";
   r.placarFinal=gcFinal+"x"+gfFinal;
  }catch(e){}
 }
}
async function enviaRelatorio(){
 await verificaResultados();
 const data=new Date().toLocaleDateString("pt-BR");
 const greens=resultadosDia.filter(r=>r.status==="green").length;
 const reds=resultadosDia.filter(r=>r.status==="red").length;
 const pend=resultadosDia.filter(r=>r.status==="pendente").length;
 const total=greens+reds;
 const perc=total>0?Math.round((greens/total)*100):0;
 let txt="📋 RELATORIO DIARIO V35.1 - "+data+"\n\n";
 txt+="🎯 Entradas: "+resultadosDia.length+"\n";
 txt+="✅ Greens: "+greens+"\n";
 txt+="❌ Reds: "+reds+"\n";
 if(pend>0) txt+="⏳ Pendentes: "+pend+"\n";
 if(total>0) txt+="📈 Assertividade: "+perc+"%\n";
 txt+="\n";
 if(resultadosDia.length===0){ txt+="Nenhum sinal hoje.\n"; } else {
  txt+="📋 DETALHES:\n";
  for(let i=0;i<resultadosDia.length;i++){
   const r=resultadosDia[i];
   let ic="⏳"; if(r.status==="green") ic="✅"; if(r.status==="red") ic="❌";
   txt+=ic+" "+r.jogo+" "+(r.placarFinal?r.placarFinal:"")+"\n";
  }
 }
 txt+="\n🤖 Robo V35.1 PREMIUM";
 await envia(txt);
 sinaisDia=[]; resultadosDia=[]; totalAprovados=0;
}
function verificaHora(){
 const agora=new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
 const hora=(agora.split(", ")[1]||"").split(":");
 const h=parseInt(hora[0]||"0"); const m=parseInt(hora[1]||"0");
 if(h===23&&m===59&&!relatorioOk){relatorioOk=true; enviaRelatorio();}
 if(h===0&&m===0) relatorioOk=false;
}
async function radar(){
 ultimoScan=new Date().toISOString();
 for(const [k,v] of enviados.entries()) if(Date.now()-v>3*60*60*1000) enviados.delete(k);
 try{const res=await buscaJogos(); for(const it of res){const chave=it.jogo.liga+"_"+it.jogo.id+"_HT"; if(enviados.has(chave)) continue; if(await enviaSinal(it.jogo,it.analise,it.raio)) enviados.set(chave,Date.now());}}catch(e){console.log(e.message);}
}
const server=http.createServer((req,res)=>{
 res
 const pFora=100-pCasa;
 let precisa="",chPrecisa=0,posseTime=0,cruzTime=0,escTime=0,apTime=0;
 if(jogo.gc<jogo.gf){precisa=jogo.casa;chPrecisa=jogo.alCasa;posseTime=pCasa;cruzTime=raio.cruzCasa;escTime=raio.escCasa;apTime=raio.apCasa;}
 else if(jogo.gf<jogo.gc){precisa=jogo.fora;chPrecisa=jogo.alFora;pos
