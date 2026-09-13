// ROBÔ GOL 2T - V34.3 FREE - FIX RENDER - MORAES
const http = require('http');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const LIGAS_PERMITIDAS = [
    "bra.1","bra.2","conmebol.libertadores","conmebol.sudamericana",
    "eng.1","esp.1","ger.1","ita.1","fra.1","ned.1"
];
const FILTROS = { max_diferenca_gols: 2, min_chutes_gol_time_precisa: 2, min_total_chutes_jogo: 8, minuto_minimo: 40, minuto_maximo: 55 };

let ultimoScan = null; let totalAprovados = 0; let totalEnviados = 0; let totalErros = 0;
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
function numero(v){ const n=parseFloat(String(v??0).replace(',','.').replace('%','')); return Number.isFinite(n)?n:0; }
function pegaStat(arr, nomes){ if(!Array.isArray(arr)) return 0; for(const nome of nomes){ const it=arr.find(s=>s.name===nome||s.abbreviation===nome); if(it) return numero(it.value??it.displayValue??0);} return 0; }

async function buscarEstatisticas(liga, eventId){
    const res={chutesCasa:0,chutesFora:0,alvoCasa:0,alvoFora:0};
    try{
        const summary = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`);
        const teams = summary?.boxscore?.teams||[];
        for(const bloco of teams){
            const id = String(bloco?.team?.id||'');
            const comp = summary?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id);
            const lado = comp?.homeAway;
            const chutes = pegaStat(bloco?.statistics, ['shots','totalShots']);
            const alvo = pegaStat(bloco?.statistics, ['shotsOnTarget','shotsOnGoal']);
            if(lado==='home'){ res.chutesCasa=chutes; res.alvoCasa=alvo; }
            if(lado==='away'){ res.chutesFora=chutes; res.alvoFora=alvo; }
        }
    }catch(e){ console.log(`⚠️ Erro summary ${eventId}: ${e.message}`); }
    return res;
}

function checaJogoV34_3_FREE(jogo){
    if(!LIGAS_PERMITIDAS.includes(jogo.liga)) return {aprovado:false};
    if(Math.abs(jogo.gols_casa-jogo.gols_fora)>FILTROS.max_diferenca_gols) return {aprovado:false, motivo:'diferenca'};
    if((jogo.chutes_casa+jogo.chutes_fora)<FILTROS.min_total_chutes_jogo) return {aprovado:false, motivo:'chutes'};
    let timePrecisa='', chutesPrecisa=0;
    if(jogo.gols_casa<jogo.gols_fora){ timePrecisa=jogo.nome_casa; chutesPrecisa=jogo.alvo_casa; }
    else if(jogo.gols_fora<jogo.gols_casa){ timePrecisa=jogo.nome_fora; chutesPrecisa=jogo.alvo_fora; }
    else { timePrecisa=jogo.alvo_casa>=jogo.alvo_fora?jogo.nome_casa:jogo.nome_fora; chutesPrecisa=Math.max(jogo.alvo_casa,jogo.alvo_fora); }
    if(chutesPrecisa<FILTROS.min_chutes_gol_time_precisa) return {aprovado:false, motivo:'alvo'};
    return {aprovado:true, timePrecisa, chutesPrecisa, totalChutes:jogo.chutes_casa+jogo.chutes_fora};
}

async function enviarTelegram(jogo, analise){
    if(!TELEGRAM_TOKEN||!CHAT_ID){ console.log('⚠️ Telegram não configurado'); return false; }
    const url=`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const msg=`🚨 GOL 2T — V34.3 FREE\n\n🏆 Liga: ${jogo.liga}\n⚽ ${jogo.nome_casa} ${jogo.gols_casa} x ${jogo.gols_fora} ${jogo.nome_fora}\n⏱️ ${jogo.minutoTexto}\n\n🎯 Precisa: ${analise.timePrecisa}\n🥅 Alvo: ${analise.chutesPrecisa}\n🔥 Total: ${analise.totalChutes}\n\n✅ 2x0 MANDA | 🚫 3x0 NÃO`;
    try{
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:msg})});
        const d=await r.json(); if(!d.ok) throw new Error(d.description); totalEnviados++; console.log(`📨 Enviado: ${jogo.nome_casa} x ${jogo.nome_fora}`); return true;
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
                    const status=comp?.status?.type?.name||'';
                    if(!['STATUS_HALFTIME','STATUS_SECOND_HALF'].includes(status)) continue;
                    let minuto=numero(comp?.status?.clock); if(status==='STATUS_HALFTIME') minuto=45;
                    if(minuto<FILTROS.minuto_minimo||minuto>FILTROS.minuto_maximo) continue;
                    const casa=comp.competitors?.find(c=>c.homeAway==='home'); const fora=comp.competitors?.find(c=>c.homeAway==='away'); if(!casa||!fora) continue;
                    await sleep(400);
                    const stats=await buscarEstatisticas(liga, ev.id);
                    const jogo={id:String(ev.id),liga,nome_casa:casa?.team?.displayName||'Casa',nome_fora:fora?.team?.displayName||'Fora',gols_casa:numero(casa.score),gols_fora:numero(fora.score),chutes_casa:stats.chutesCasa,chutes_fora:stats.chutesFora,alvo_casa:stats.alvoCasa,alvo_fora:stats.alvoFora,minuto,minutoTexto:status==='STATUS_HALFTIME'?'INTERVALO':`${Math.floor(minuto)}'`};
                    const analise=checaJogoV34_3_FREE(jogo); if(!analise.aprovado) continue;
                    totalAprovados++; console.log(`✅ APROVADO ${liga} | ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}`); aprovados.push({jogo,analise});
                }catch(e){ totalErros++; console.log(`⚠️ Erro evento ${ev?.id}: ${e.message}`); }
            }
        }catch(e){ totalErros++; console.log(`❌ Erro liga ${liga}: ${e.message}`); }
    }
    return aprovados;
}

async function executarRadar(){
    ultimoScan=new Date().toISOString(); console.log(`\n🔎 [${new Date().toLocaleTimeString()}] Radar varrendo...`); 
    for(const [id,tempo] of enviados.entries()){ if(Date.now()-tempo>3*60*60*1000) enviados.delete(id); }
    try{
        const resultados=await buscarJogosESPN(); if(!resultados.length){ console.log('Nenhum aprovado agora.'); return; }
        for(const {jogo,analise} of resultados){
            const chave=`${jogo.liga}_${jogo.id}_HT`; if(enviados.has(chave)){ console.log(`⏭️ Já enviado: ${jogo.nome_casa} x ${jogo.nome_fora}`); continue; }
            if(await enviarTelegram(jogo,analise)) enviados.set(chave, Date.now());
        }
    }catch(e){ console.log(`❌ Erro radar: ${e.message}`); } 
}

const server=http.createServer((req,res)=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({status:'online',robo:'V34.3 FREE',ultimoScan,aprovados:totalAprovados,enviados:totalEnviados,erros:totalErros},null,2)); });
server.listen(PORT, ()=>{ console.log(`🚀 V34.3 ONLINE porta ${PORT}`); executarRadar(); setInterval(executarRadar,60000); });
