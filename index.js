const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.1 PRO - GREEN REAL
// PROTEÇÃO V7.0 + ANÁLISE V6.7 + TELEGRAM
// ============================================================

const API_URL = "https://v3.football.api-sports.io/fixtures?live=all";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || "2051406570";

const API_KEYS_RAW = process.env.API_FOOTBALL_KEY || "";
const API_KEYS = API_KEYS_RAW.split(",").map(k => k.trim()).filter(Boolean);

const CACHE_TTL_MS = 15000;
const MIN_KEY_INTERVAL_MS = 12000;
const INITIAL_COOLDOWN_MS = 30000;
const MAX_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const SCORE_MINIMO = 75;

let keysStatus = API_KEYS.map((key, index) => ({
  id: index + 1, key, blockedUntil: 0, lastUsed: 0, uses: 0,
  consecutive429: 0, cooldownMs: INITIAL_COOLDOWN_MS,
  minuteRemaining: null, minuteLimit: null, dailyRemaining: null, dailyLimit: null,
  lastStatus: null, lastError: null, lastResponse: 0
}));

let liveCache = { data: null, timestamp: 0 };
let requestInProgress = false;
let ultimosSinais = new Set(); // evita spam do mesmo jogo

function now() { return Date.now(); }
function keyPreview(key) { return!key? "N/A" : key.length <= 8? "********" : key.slice(0,8)+"..."+key.slice(-4); }
function releaseExpiredKeys() {
  const c = now();
  keysStatus = keysStatus.map(k => k.blockedUntil > 0 && k.blockedUntil <= c? {...k, blockedUntil: 0, lastError: null} : k);
}
function getValidKeys() {
  releaseExpiredKeys();
  const c = now();
  return keysStatus.filter(k => {
    if (k.blockedUntil > c) return false;
    if (k.lastUsed > 0 && c - k.lastUsed < MIN_KEY_INTERVAL_MS) return false;
    if (k.minuteRemaining!== null && k.minuteRemaining <= 1) return false;
    return true;
  }).sort((a,b) => {
    if (a.minuteRemaining!== null && b.minuteRemaining!== null && a.minuteRemaining!== b.minuteRemaining) return b.minuteRemaining - a.minuteRemaining;
    return a.lastUsed - b.lastUsed;
  });
}
function registerUse(k) { k.lastUsed = now(); k.uses += 1; }
function updateRateHeaders(k, h) {
  if(!h) return;
  if(h["x-ratelimit-remaining"]!== undefined) k.minuteRemaining = Number(h["x-ratelimit-remaining"]);
  if(h["x-ratelimit-limit"]!== undefined) k.minuteLimit = Number(h["x-ratelimit-limit"]);
  if(h["x-ratelimit-requests-remaining"]!== undefined) k.dailyRemaining = Number(h["x-ratelimit-requests-remaining"]);
  if(h["x-ratelimit-requests-limit"]!== undefined) k.dailyLimit = Number(h["x-ratelimit-requests-limit"]);
}
function getRetryAfter(h) {
  if(!h || h["retry-after"] === undefined) return null;
  const s = Number(h["retry-after"]);
  return Number.isFinite(s)? s*1000 : null;
}
function cooldownKey(k, custom=null) {
  k.consecutive429 += 1;
  let cd = Math.min(INITIAL_COOLDOWN_MS * Math.pow(2, Math.min(k.consecutive429-1,4)), MAX_COOLDOWN_MS);
  if(custom!== null) cd = Math.min(Math.max(custom, cd), MAX_COOLDOWN_MS);
  k.cooldownMs = cd; k.blockedUntil = now() + cd;
}
function markKeyHealthy(k) { k.consecutive429 = 0; k.cooldownMs = INITIAL_COOLDOWN_MS; k.lastError = null; k.lastStatus = 200; }
function getCachedData() { if(!liveCache.data) return null; if(now() - liveCache.timestamp > CACHE_TTL_MS) return null; return liveCache.data; }
function saveCache(d) { liveCache = { data: d, timestamp: now() }; }

async function callFootballAPI() {
  const attempted = new Set();
  const maxAttempts = Math.min(API_KEYS.length, 2);
  for(let i=0; i<maxAttempts; i++) {
    const avail = getValidKeys().filter(k =>!attempted.has(k.id));
    if(avail.length === 0) break;
    const keyObj = avail[0];
    attempted.add(keyObj.id);
    registerUse(keyObj);
    try {
      const res = await axios.get(API_URL, { headers: { "x-apisports-key": keyObj.key }, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
      keyObj.lastResponse = now(); keyObj.lastStatus = res.status;
      updateRateHeaders(keyObj, res.headers);
      if(res.status === 200) {
        const body = res.data || {};
        if(body.errors && Object.keys(body.errors).length > 0) {
          const txt = JSON.stringify(body.errors).toLowerCase();
          if(txt.includes("rate") || txt.includes("limit") || txt.includes("too many")) { keyObj.lastError = body.errors; cooldownKey(keyObj); continue; }
          keyObj.lastError = body.errors;
          return { success: false, status: 400, error: body.errors };
        }
        markKeyHealthy(keyObj);
        return { success: true, data: body, keyObj };
      }
      if(res.status === 429) { keyObj.lastError = "429"; cooldownKey(keyObj, getRetryAfter(res.headers)); continue; }
      if(res.status === 401 || res.status === 403) { keyObj.lastError = "Auth"; keyObj.blockedUntil = now() + MAX_COOLDOWN_MS; continue; }
      if(res.status >= 500) { keyObj.lastError = "API 5xx"; keyObj.blockedUntil = now() + 5000; continue; }
      keyObj.lastError = "HTTP "+res.status;
      return { success: false, status: res.status, error: keyObj.lastError };
    } catch(e) { keyObj.lastStatus = "NETWORK_ERROR"; keyObj.lastError = e.message; keyObj.blockedUntil = now() + 5000; continue; }
  }
  return { success: false, status: 429, error: "Nenhuma chave disponível." };
}

// ============================================================
// ANÁLISE GREEN REAL V6.7
// ============================================================
function analisarJogo(fixture) {
  const elapsed = fixture.fixture?.status?.elapsed;
  const golsCasa = fixture.goals?.home?? 0;
  const golsFora = fixture.goals?.away?? 0;
  const totalGols = golsCasa + golsFora;
  const league = fixture.league?.name || "Liga";

  if(!elapsed) return null;

  let score = 0;
  let motivo = [];
  let tipo = null;

  // JANELA 25-38' EARLY
  if(elapsed >= 25 && elapsed <= 38) {
    tipo = "EARLY 25-38'";
    score += 60;
    motivo.push(`Janela early ${elapsed}'`);
    if(totalGols <= 2) { score += 15; motivo.push("Jogo amarrado ideal p/ gol"); }
    if(league.toLowerCase().includes("pro") || league.toLowerCase().includes("1")) score += 10;
  }
  // JANELA 70-88' LATE
  else if(elapsed >= 70 && elapsed <= 88) {
    tipo = "LATE 70-88'";
    score += 65;
    motivo.push(`Pressão final ${elapsed}'`);
    if(totalGols <= 3) { score += 15; motivo.push("Placar aberto"); }
  }
  // JANELA 85-90' ESCANTEIO
  else if(elapsed >= 85 && elapsed <= 90) {
    tipo = "ESCANTEIO 85-90'";
    score += 70;
    motivo.push(`PRESSÃO FINAL ${elapsed}'`);
  } else {
    return null;
  }

  // Filtros extras simples
  if(totalGols >= 5) score -= 20; // jogo já estourado

  return { score, tipo, elapsed, golsCasa, golsFora, league, motivo, fixture };
}

async function enviarTelegram(msg) {
  if(!TELEGRAM_TOKEN ||!CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: "Markdown"
    });
  } catch(e) { console.log("Erro Telegram:", e.message); }
}

// ============================================================
// ROTAS
// ============================================================
app.get("/", (req,res) => res.send("Radar GREEN Real - V7.1 PRO ATIVO"));

app.get("/health", (req,res) => {
  releaseExpiredKeys();
  const c = now();
  res.json({
    status: "OPERACIONAL", version: "V7.1 PRO", total_keys: API_KEYS.length,
    livres: keysStatus.filter(k=>k.blockedUntil<=c).length,
    bloqueadas: keysStatus.filter(k=>k.blockedUntil>c).length,
    cache:!!getCachedData(), score_minimo: SCORE_MINIMO
  });
});

app.get("/keys", (req,res) => {
  releaseExpiredKeys();
  res.json({ total: API_KEYS.length, keys: keysStatus.map(k=>({
    id:k.id, preview:keyPreview(k.key), livre:k.blockedUntil<=now(),
    desbloqueia_em: k.blockedUntil>now()? Math.ceil((k.blockedUntil-now())/1000)+"s" : "AGORA",
    usos:k.uses, restante_min:k.minuteRemaining, ult_status:k.lastStatus, ult_erro:k.lastError
  }))});
});

app.get("/radar", async (req,res) => {
  if(requestInProgress) return res.status(202).json({ status: "JA EM ANDAMENTO" });
  requestInProgress = true;
  try {
    const cached = getCachedData();
    let apiData = cached;
    let origem = "CACHE";
    let keyEmUso = "CACHE";

    if(!cached) {
      const result = await callFootballAPI();
      if(!result.success) { requestInProgress = false; return res.status(result.status===429?429:500).json({ status:"SEM CHAVE", erro: result.error }); }
      apiData = result.data;
      origem = "API";
      keyEmUso = keyPreview(result.keyObj.key);
      saveCache(apiData);
    }

    const jogos = apiData.response || [];
    let sinais = [];

    for(const f of jogos) {
      const analise = analisarJogo(f);
      if(!analise) continue;
      if(analise.score < SCORE_MINIMO) continue;

      const idUnico = `${f.fixture.id}-${analise.tipo}`;
      if(ultimosSinais.has(idUnico)) continue; // evita repetir

      sinais.push(analise);
      ultimosSinais.add(idUnico);

      const mensagem = `🟢 *RADAR GREEN REAL - ${analise.tipo} - ${analise.score} PTS*\n\n`+
      `⚽ ${f.teams.home.name} ${analise.golsCasa} x ${analise.golsFora} ${f.teams.away.name}\n`+
      `⏱️ ${analise.elapsed}' | 🏆 ${analise.league}\n`+
      `📊 ${analise.motivo.join(" | ")}\n\n`+
      `🔥 *ENTRADA:* ${analise.tipo.includes("ESCANTEIO")? "ESCANTEIO HT" : "OVER GOL LIVE"}\n`+
      `🆔 ID: ${f.fixture.id}`;

      await enviarTelegram(mensagem);
    }

    // limpa cache de sinais a cada 10 min
    if(ultimosSinais.size > 100) ultimosSinais.clear();

    requestInProgress = false;
    return res.json({
      status: `RADAR V7.1 - ${sinais.length} SINAIS`,
      key_em_uso: keyEmUso, jogos_ao_vivo: jogos.length, sinais_encontrados: sinais.length,
      sinais: sinais.map(s=>({ jogo: `${s.fixture.teams.home.name} x ${s.fixture.teams.away.name}`, tipo:s.tipo, score:s.score, minuto:s.elapsed })),
      origem, timestamp: new Date().toISOString()
    });

  } catch(e) {
    requestInProgress = false;
    console.error(e);
    return res.status(500).json({ status:"ERRO INTERNO", error:e.message });
  }
});

app.listen(PORT, () => console.log(`V7.1 PRO RODANDO NA PORTA ${PORT} - CHAVES: ${API_KEYS.length}`));
