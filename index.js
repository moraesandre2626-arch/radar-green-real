const http = require('http');
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';
const LIGAS_PERMITIDAS = ["bra.1","bra.2","por.1","eng.1","esp.1","ger.1","ita.1","fra.1","ned.1","bel.1","tur.1","sco.1","conmebol.libertadores","conmebol.sudamericana","usa.1","mex.1","arg.1","uefa.champions","uefa.europa"];
const FILTROS = { max_diferenca_gols: 2, min_chutes_gol_time_precisa: 2, min_total_chutes_jogo: 8, minuto_minimo: 40, minuto_maximo: 55 };
let ultimoScan = null; let totalAprovados = 0; let totalEnviados = 0; let totalErros = 0;
const enviados = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url){
    const c = new AbortController(); const t = setTimeout(()=>c.abort(), 8000);
    try{ const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, signal:c.signal }); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    finally{ clearTimeout(t); }
}
function numero(v){ const n=parseFloat(String(v??0).replace(',','.').replace('%','')); return Number.isFinite(n)?n:0; }
function pegaStat(S, nomes){
    if(!Array.isArray(S)) return null;
    for(let nome of nomes){
        const s = S.find(x => x.name?.toLowerCase()===nome.toLowerCase() || x.abbreviation?.toLowerCase()===nome.toLowerCase());
        if(s) return numero(s.displayValue??s.value??0);
    }
    return null;
}
async function buscarRaioXCompleto(liga, eventId){
    const raio = { chutesCasa:0,chutesFora:0, alvoCasa:0,alvoFora:0, posseCasa:0,posseFora:0, escCasa:0,escFora:0, amarelosCasa:0,amarelosFora:0, cruzCasa:0,cruzFora:0, apCasa:null,ap
