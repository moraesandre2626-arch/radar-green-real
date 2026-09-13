const http = require('http');
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
const LIGAS_PERMITIDAS = [
  "bra.1","bra.2","por.1","eng.1","esp.1","ger.1",
  "ita.1","fra.1","ned.1","bel.1","tur.1","sco.1",
  "conmebol.libertadores","conmebol.sudamericana",
  "usa.1","mex.1","arg.1","uefa.champions","uefa.europa"
];
const FILTROS = {
  max_diferenca_gols: 2,
  min_chutes_gol_time_precisa: 2,
  min_total_chutes_jogo: 8,
  minuto_minimo: 40,
  minuto_maximo: 55,
  posse_esteril_limite: 58,
  min_pressao_score: 6
};
let ultimoScan = null;
let totalAprovados = 0;
let totalEnviados = 0;
let totalErros = 0;
const enviados = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url){
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), 8000);
  try{
    const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, signal:c.signal });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
function numero(v){
  const n=parseFloat(String(v??0).replace(',','.').replace('%',''));
  return Number.isFinite(n)?n:0;
}
function pegaStat(S, nomes){
  if(!Array.isArray(S)) return null;
  for(let nome of nomes){
    const s = S.find(x => x.name?.toLowerCase()===nome.toLowerCase() || x.abbreviation?.toLowerCase()===nome.toLowerCase());
    if(s) return numero(s.displayValue??s.value??0);
  }
  return null;
}async function buscarRaioXCompleto(liga, eventId){
  const raio = { chutesCasa:0,chutesFora:0, alvoCasa:0,alvoFora:0, posseCasa:0,posseFora:0, escCasa:0,escFora:0, amarelosCasa:0,amarelosFora:0, cruzCasa:0,cruzFora:0, apCasa:null,apFora:null, temAP:false, temCruz:false };
  try{
    const summary = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`);
    const teams = summary?.boxscore?.teams || [];
    for(let i=0;i<teams.length;i++){
      const bloco = teams[i]; const id = String(bloco?.team?.id||''); let lado = i===0?'home':'away';
      const comp = summary?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id); if(comp) lado = comp.homeAway;
      const S = bloco?.statistics||[];
      const chutes = pegaStat(S, ['totalShots','shots'])??0; const alvo = pegaStat(S, ['shotsOnTarget','shotsOnGoal'])??0;
      const posse = pegaStat(S, ['possessionPct','possession'])??0; const esc = pegaStat(S, ['wonCorners','cornerKicks'])??0;
      const amarelos = pegaStat(S, ['yellowCards'])??0; const ap = pegaStat(S, ['dangerousAttacks','dangerousAttack','attack']);
      const cruz = pegaStat(S, ['crosses','totalCrosses','totalCross','cross']);
      if(lado==='home'){ raio.chutesCasa=chutes; raio.alvoCasa=alvo; raio.posseCasa=posse; raio.escCasa=esc; raio.amarelosCasa=amarelos; if(cruz!==null){raio.cruzCasa=cruz; raio.temCruz=true;} if(ap!==null){raio.apCasa=ap; raio.temAP=true;} }
      else { raio.chutesFora=chutes; raio.alvoFora=alvo; raio.posseFora=posse; raio.escFora=esc; raio.amarelosFora=amarelos; if(cruz!==null){raio.cruzFora=cruz; raio.temCruz=true;} if(ap!==null){raio.apFora=ap; raio.temAP=true;} }
    }
  }catch(e){}
  return raio;
}
function checaJogo(jogo, raio){
  if(!LIGAS_PERMITIDAS.includes(jogo.liga)) return {aprovado:false, motivo:'liga'};
  if(Math.abs(jogo.gols_casa-jogo.gols_fora)>FILTROS.max_diferenca_gols) return {aprovado:false, motivo:'placar'};
  if((jogo.chutes_casa+jogo.chutes_fora)<FILTROS.min_total_chutes_jogo) return {aprovado:false, motivo:'chutes'};
  let timePrecisa='', chutesPrecisa=0, posseTime=0, cruzTime=0, escTime=0, apTime=0;
  if(jogo.gols_casa<jogo.gols_fora){ timePrecisa=jogo.nome_casa; chutesPrecisa=jogo.alvo_casa; posseTime=raio.posseCasa; cruzTime=raio.cruzCasa; escTime=raio.escCasa; apTime=raio.apCasa||0; }
  else if(jogo.gols_fora<jogo.gols_casa){ timePrecisa=jogo.nome_fora; chutesPrecisa=jogo.alvo_fora; posseTime=raio.posseFora; cruzTime=raio.cruzFora; escTime=raio.escFora; apTime=raio.apFora||0; }
  else {
    const casaMelhor = jogo.alvo_casa>=jogo.alvo_fora;
    timePrecisa=casaMelhor?jogo.nome_casa:jogo.nome_fora;
    chutesPrecisa=Math.max(jogo.alvo_casa,jogo.alvo_fora);
    posseTime=casaMelhor?raio.posseCasa:raio.posseFora;
    cruzTime=casaMelhor?raio.cruzCasa:raio.cruzFora;
    escTime=casaMelhor?raio.escCasa:raio.escFora;
    apTime=casaMelhor?raio.apCasa||0:raio.apFora||0;
  }
  if(chutesPrecisa<FILTROS.min_chutes_gol_time_precisa) return {aprovado:false, motivo:'alvo'};
  const posseTotal = raio.posseCasa+raio.posseFora;
  const possePct = posseTotal>0? Math.round((posseTime/posseTotal)*100) : 50;
  const scorePressao = cruzTime + (escTime*2) + (apTime/10);
  if(possePct >= FILTROS.posse_esteril_limite && scorePressao < FILTROS.min_pressao_score){
    return {aprovado:false, motivo:`posse esteril ${possePct}% score ${scorePressao.toFixed(1)}`};
  }
  let zonaPressao = 'Meio';
  if(cruzTime>=8 || (cruzTime>=5 && escTime>=2)) zonaPressao = `Lateral (${cruzTime} cruz)`;
  else if(escTime>=3) zonaPressao = `Abafa Área (${escTime} esc)`;
  else if(apTime>=15) zonaPressao = `Meio-Perigoso (${apTime} AP)`;
  return {aprovado:true, timePrecisa, chutesPrecisa, totalChutes:jogo.chutes_casa+jogo.chutes_fora, possePct, scorePressao, zonaPressao};
}
async function enviarTelegram(jogo, analise, raio){
  if(!TELEGRAM_TOKEN||!CHAT_ID) return false;
  const pCasa = (raio.posseCasa+raio.posseFora)>0? Math.round((raio.posseCasa/(raio.posseCasa+raio.posseFora))*100) : 50;
  const linhaAP = raio.temAP? `🔥 Ataques Perigosos: ${raio.apCasa??0}x${raio.apFora??0}\n` : ``;
  const linhaCruz = raio.temCruz? `↗️ Cruzamentos: ${raio.cruzCasa}x${raio.cruzFora}\n` : ``;
  const msg = `🚨 RAIO-X GOL 2T — V34.4 ANTI-ESTERIL\n\n🏆 ${jogo.liga.toUpperCase()}\n⚽ ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}\n⏱️ ${jogo.minutoTexto}\n\n📊 ESTATÍSTICAS HT:\n🥅 Chutes: ${raio.chutesCasa}x${raio.chutesFora} (Total: ${analise.totalChutes})\n🎯 No Alvo: ${raio.alvoCasa}x${raio.alvoFora}\n${linhaAP}${linhaCruz}🚩 Escanteios: ${raio.escCasa}x${raio.escFora}\n📊 Posse: ${pCasa}% x ${100-pCasa}%\n🟨 Amarelos: ${raio.amarelosCasa}x${raio.amarelosFora}\n\n📍 PRESSÃO: ${analise.zonaPressao}\n📈 Score Pressão: ${analise.scorePressao.toFixed(1)} | Posse time: ${analise.possePct}%\n\n🎯 Precisa: ${analise.timePrecisa} (${analise.chutesPrecisa} no alvo)\n✅ FILTRO: 2x0 MANDA | 3x0 NÃO | Anti-Toca-Toca`;
  try{
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:msg})});
    const d = await r.json(); if(!d.ok) throw new Error(d.description);
    totalEnviados++; console.log(`📨 Enviado: ${jogo.nome_casa} x ${jogo.nome_fora} | ${analise.zonaPressao}`); return true;
  }catch(e){ totalErros++; console.log(`❌ Telegram: ${e.message}`); return false; }
}
async function buscarJogosESPN(){
  const aprovados=[];
  for(const liga of LIGAS_PERMITIDAS){
    try{
      const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`);
      if(!Array.isArray(data.events)) continue;
      for(const ev of data.events){
        try{
          const comp=ev?.competitions?.[0]; if(!comp) continue;
          const status=comp?.status?.type?.name||''; if(!['STATUS_HALFTIME','STATUS_SECOND_HALF'].includes(status)) continue;
          let minuto=numero(comp?.status?.clock); if(status==='STATUS_HALFTIME') minuto=45;
          if(minuto<FILTROS.minuto_minimo||minuto>FILTROS.minuto_maximo) continue;
          const casa=comp.competitors?.find(c=>c.homeAway==='home'); const fora=comp.competitors?.find(c=>c.homeAway==='away'); if(!casa||!fora) continue;
          await sleep(400);
          const raioTemp = await buscarRaioXCompleto(liga, ev.id);
          const jogo={id:String(ev.id),liga,nome_casa:casa?.team?.displayName||'Casa',nome_fora:fora?.team?.displayName||'Fora',gols_casa:numero(casa.score),gols_fora:numero(fora.score),chutes_casa:raioTemp.chutesCasa,chutes_fora:raioTemp.chutesFora,alvo_casa:raioTemp.alvoCasa,alvo_fora:raioTemp.alvoFora,minuto,minutoTexto:status==='STATUS_HALFTIME'?'INTERVALO':`${Math.floor(minuto)}'`};
          const analise=checaJogo(jogo, raioTemp); if(!analise.aprovado){ if(analise.motivo?.includes('esteril')) console.log(`🚫 Esteril bloqueado: ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora} - ${analise.motivo}`); continue; }
          totalAprovados++; aprovados.push({jogo,analise,raio:raioTemp});
        }catch(e){}
      }
    }catch(e){ totalErros++; }
  }
  return aprovados;
}
async function executarRadar(){
  ultimoScan=new Date().toISOString(); console.log(`\n🔎 Radar V34.4 varrendo...`);
  for(const [id,t] of enviados.entries()) if(Date.now()-t>3*60*60*1000) enviados.delete(id);
  try{
    const res=await buscarJogosESPN(); if(!res.length){ console.log('Nenhum aprovado (filtro anti-esteril ativo).'); return; }
    for(const {jogo,analise,raio} of res){
      const chave=`${jogo.liga}_${jogo.id}_HT`; if(enviados.has(chave)) continue;
      if(await enviarTelegram(jogo,analise,raio)) enviados.set(chave, Date.now());
    }
  }catch(e){ console.log(`❌ Radar: ${e.message}`); }
}
const server = http.createServer((req,res)=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({status:'online',robo:'V34.4 ANTI-ESTERIL + ZONA PRESSAO',ultimoScan,aprovados:totalAprovados,enviados:totalEnviados, filtros:FILTROS},null,2)); });
server.listen(PORT, ()=>{ console.log(`🚀 V34.4 ONLINE porta ${PORT}`); executarRadar(); setInterval(executarRadar,60000); });
