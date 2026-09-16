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
   const al=stat(S,["shotsOnTarget","shotsOnGoal"]);
   const posse=stat(S,["possessionPct","possession"]);
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
 const pCasa=totPos>0?Math.round((raio.posseCasa/totPos)*100):50;
 const pFora=100-pCasa;
 let precisa="",chPrecisa=0,posseTime=0,cruzTime=0,escTime=0,apTime=0;
 if(jogo.gc<jogo.gf){precisa=jogo.casa;chPrecisa=jogo.alCasa;posseTime=pCasa;cruzTime=raio.cruzCasa;escTime=raio.escCasa;apTime=raio.apCasa;}
 else if(jogo.gf<jogo.gc){precisa=jogo.fora;chPrecisa=jogo.alFora;posseTime=pFora;cruzTime=raio.cruzFora;escTime=raio.escFora;apTime=raio.apFora;}
 else{const m=jogo.alCasa>=jogo.alFora;precisa=m?jogo.casa:jogo.fora;chPrecisa=Math.max(jogo.alCasa,jogo.alFora);posseTime=m?pCasa:pFora;cruzTime=m?raio.cruzCasa:raio.cruzFora;escTime=m?raio.escCasa:raio.escFora;apTime=m?raio.apCasa:raio.apFora;}
 if(chPrecisa<F.minAlvo) return {ok:false};
 const score=cruzTime+(escTime*2)+(apTime/10);
 if(score<F.minScore) return {ok:false};
 if(posseTime<F.minPosse) return {ok:false};
 let zona="Meio";
 if(cruzTime>=8) zona="Lateral ("+cruzTime+" cruz)";
 else if(cruzTime>=5&&escTime>=2) zona="Lateral ("+cruzTime+" cruz)";
 else if(escTime>=3) zona="Abafa Area ("+escTime+" esc)";
 else if(apTime>=15) zona="Meio-Perigoso ("+apTime+" AP)";
 return {ok:true,precisa,chPrecisa,posseTime,score,zona,cruzTime,escTime,pCasa};
}async function envia(texto){
 if(!TOKEN||!CHAT) return false;
 try{
  const r=await fetch("https://api.telegram.org/bot"+TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:CHAT,text:texto})});
  const d=await r.json(); if(!d.ok) throw new Error(d.description);
  totalEnviados++; return true;
 }catch(e){console.log("Erro:",e.message); return false;}
}
async function enviaSinal(jogo,analise,raio){
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
    if(!casaObj||!foraObj) continue;
    await sleep(400);
    const raio=await buscaRaio(liga,String(ev.id));
    const jogo={id:String(ev.id),liga,casa:casaObj.team?.displayName||"Casa",fora:foraObj.team?.displayName||"Fora",gc:num(casaObj.score),gf:num(foraObj.score),chCasa:raio.chCasa,chFora:raio.chFora,alCasa:raio.alCasa,alFora:raio.alFora,minuto,minTxt:st==="STATUS_HALFTIME"?"INTERVALO":Math.floor(minuto)+"' "};
    const analise=checa
