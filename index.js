const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.3 - GREEN REAL ANTI-BAN
// ============================================================
const API_BASE = "https://v3.football.api-sports.io";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || "";

const rawKeys = [process.env.API_FOOTBALL_KEY || "", process.env.API_FOOTBALL_KEY2 || ""].join(",").split(",").map(k => k.trim()).filter(Boolean);
const API_KEYS = [...new Set(rawKeys)];

const REQUEST_TIMEOUT_MS = 12000;
const LIVE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min = 56 req/dia
const STATS_CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_KEY_INTERVAL_MS = 12000;
const MAX_STATS_PER_CYCLE = 2;
const MAX_STATS_PER_DAY = 20;
const SCORE_MINIMO = 82;
const SCORE_FORTE = 90;

let keysStatus = API_KEYS.map((key, index) => ({
  id: index + 1, key, blockedUntil: 0, lastUsed: 0, uses: 0, statsUses: 0,
  consecutive429: 0, cooldownMs: 30000, minuteRemaining: null, minuteLimit: null,
  dailyRemaining: null, dailyLimit: null, lastStatus: null, lastError: null, lastResponse: 0
}));

let liveCache = { data: null, timestamp: 0 };
const statsCache = new Map();
let requestInProgress = false;
const enviados = new Map();
let contadorStatsDia = 0;
let diaControle = "";
let ultimaExecucao = null;

function now() { return Date.now(); }
function hojeBrasil() { return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); }
function horaBrasil() { return parseInt(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }), 10); }
function isHorarioAtivo() { const h = horaBrasil(); return h >= 9 && h <= 23; }
function resetarContadorDiario() {
  const hoje = hojeBrasil();
  if (diaControle !== hoje) { diaControle = hoje; contadorStatsDia = 0; console.log(`📅 Novo dia ${hoje} - zerado contador stats`); }
}
function keyPreview(key) { if (!key) return "N/A"; if (key.length <= 8) return "********"; return key.slice(0, 8) + "..." + key.slice(-4); }
function limparSinaisAntigos() {
  const limite = now() - 24 * 60 * 60 * 1000;
  for (const [id, timestamp] of enviados.entries()) { if (timestamp < limite) enviados.delete(id); }
}
function releaseExpiredKeys() { const c = now(); for (const k of keysStatus) { if (k.blockedUntil > 0 && k.blockedUntil <= c) { k.blockedUntil = 0; k.lastError = null; } } }
function getValidKeys() {
  releaseExpiredKeys(); const c = now();
  return keysStatus.filter(k => {
    if (k.blockedUntil > c) return false;
    if (k.lastUsed > 0 && c - k.lastUsed < MIN_KEY_INTERVAL_MS) return false;
    if (k.minuteRemaining !== null && k.minuteRemaining <= 1) return false;
    if (k.dailyRemaining !== null && k.dailyRemaining <= 1) return false;
    return true;
  }).sort((a, b) => {
    if (a.dailyRemaining !== null && b.dailyRemaining !== null && a.dailyRemaining !== b.dailyRemaining) return b.dailyRemaining - a.dailyRemaining;
    if (a.minuteRemaining !== null && b.minuteRemaining !== null && a.minuteRemaining !== b.minuteRemaining) return b.minuteRemaining - a.minuteRemaining;
    return a.lastUsed - b.lastUsed;
  });
}
function registerUse(k) { k.lastUsed = now(); k.uses++; }
function registerStatsUse(k) { k.lastUsed = now(); k.uses++; k.statsUses++; contadorStatsDia++; }
function updateRateHeaders(k, headers) {
  if (!headers) return;
  if (headers["x-ratelimit-remaining"] !== undefined) k.minuteRemaining = Number(headers["x-ratelimit-remaining"]);
  if (headers["x-ratelimit-limit"] !== undefined) k.minuteLimit = Number(headers["x-ratelimit-limit"]);
  if (headers["x-ratelimit-requests-remaining"] !== undefined) k.dailyRemaining = Number(headers["x-ratelimit-requests-remaining"]);
  if (headers["x-ratelimit-requests-limit"] !== undefined) k.dailyLimit = Number(headers["x-ratelimit-requests-limit"]);
}
function getRetryAfter(headers) {
  if (!headers || headers["retry-after"] === undefined) return null;
  const seconds = Number(headers["retry-after"]); if (!Number.isFinite(seconds)) return null; return seconds * 1000;
}
function cooldownKey(k, custom = null) {
  k.consecutive429++; let cooldown = 30000 * Math.pow(2, Math.min(k.consecutive429 - 1, 4));
  cooldown = Math.min(cooldown, 15 * 60 * 1000);
  if (custom !== null) cooldown = Math.min(Math.max(custom, cooldown), 15 * 60 * 1000);
  k.cooldownMs = cooldown; k.blockedUntil = now() + cooldown;
}
function markKeyHealthy(k) { k.consecutive429 = 0; k.cooldownMs = 30000; k.lastError = null; k.lastStatus = 200; }

async function callAPI(endpoint, isStats = false) {
  if (!API_KEYS.length) return { success: false, status: 500, error: "Nenhuma API_FOOTBALL_KEY configurada." };
  resetarContadorDiario();
  if (isStats && contadorStatsDia >= MAX_STATS_PER_DAY) return { success: false, status: 429, error: "Limite econômico diário de estatísticas atingido." };
  const attempted = new Set();
  for (let tentativa = 0; tentativa < API_KEYS.length; tentativa++) {
    const disponiveis = getValidKeys().filter(k => !attempted.has(k.id));
    if (!disponiveis.length) break;
    const keyObj = disponiveis[0]; attempted.add(keyObj.id);
    if (isStats) registerStatsUse(keyObj); else registerUse(keyObj);
    try {
      const response = await axios.get(API_BASE + endpoint, { headers: { "x-apisports-key": keyObj.key }, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
      keyObj.lastResponse = now(); keyObj.lastStatus = response.status; updateRateHeaders(keyObj, response.headers);
      if (response.status === 200) {
        const body = response.data || {};
        if (body.errors && Object.keys(body.errors).length) {
          const txt = JSON.stringify(body.errors).toLowerCase();
          if (txt.includes("rate") || txt.includes("limit") || txt.includes("too many")) { keyObj.lastError = body.errors; cooldownKey(keyObj); continue; }
          keyObj.lastError = body.errors; return { success: false, status: 400, error: body.errors };
        }
        markKeyHealthy(keyObj); return { success: true, data: body, keyObj };
      }
      if (response.status === 429) { keyObj.lastError = "429"; cooldownKey(keyObj, getRetryAfter(response.headers)); continue; }
      if (response.status === 401 || response.status === 403) { keyObj.lastError = "Chave inválida"; keyObj.blockedUntil = now() + 60 * 60 * 1000; continue; }
      if (response.status >= 500) { keyObj.lastError = "API 5xx"; keyObj.blockedUntil = now() + 5000; continue; }
      keyObj.lastError = "HTTP " + response.status; return { success: false, status: response.status, error: keyObj.lastError };
    } catch (error) { keyObj.lastStatus = "NETWORK_ERROR"; keyObj.lastError = error.message; keyObj.blockedUntil = now() + 5000; continue; }
  }
  return { success: false, status: 429, error: "Nenhuma chave disponível no momento." };
}

function getLiveCache() { if (!liveCache.data) return null; if (now() - liveCache.timestamp > LIVE_CACHE_TTL_MS) return null; return liveCache.data; }
function saveLiveCache(data) { liveCache = { data, timestamp: now() }; }
function getStatsCache(fixtureId) { const item = statsCache.get(String(fixtureId)); if (!item) return null; if (now() - item.timestamp > STATS_CACHE_TTL_MS) { statsCache.delete(String(fixtureId)); return null; } return item.data; }
function saveStatsCache(fixtureId, data) { statsCache.set(String(fixtureId), { data, timestamp: now() }); }

function valorStat(time, tipo) {
  if (!time || !time.statistics) return 0;
  const s = time.statistics.find(st => st.type === tipo);
  if (!s || s.value === null) return 0;
  if (typeof s.value === "string" && s.value.includes("%")) return parseInt(s.value) || 0;
  return Number(s.value) || 0;
}

// ============================================================
// ANALISE GREEN REAL COM FALTA E ATAQUE
// ============================================================
function calcularScore(fixture, stats) {
  const elapsed = fixture.fixture?.status?.elapsed || 0;
  if (elapsed < 15) return null;
  const home = stats[0]; const away = stats[1];
  if (!home || !away) return null;

  let score = 0; let motivos = [];

  const chutesGolCasa = valorStat(home, "Shots on Goal");
  const chutesGolFora = valorStat(away, "Shots on Goal");
  const chutesCasa = valorStat(home, "Total Shots");
  const chutesFora = valorStat(away, "Total Shots");
  const escCasa = valorStat(home, "Corner Kicks");
  const escFora = valorStat(away, "Corner Kicks");
  const ataquesCasa = valorStat(home, "Dangerous Attacks");
  const ataquesFora = valorStat(away, "Dangerous Attacks");
  const faltasCasa = valorStat(home, "Fouls");
  const faltasFora = valorStat(away, "Fouls");

  const totalChutesGol = chutesGolCasa + chutesGolFora;
  const totalEsc = escCasa + escFora;
  const totalAtaques = ataquesCasa + ataquesFora;
  const totalFaltas = faltasCasa + faltasFora;

  // JANELA EARLY 25-38
  if (elapsed >= 25 && elapsed <= 38) {
    if (totalChutesGol >= 2) { score += 20; motivos.push(`${totalChutesGol} chutes no gol`); }
    if (totalEsc >= 3) { score += 15; motivos.push(`${totalEsc} escanteios`); }
    if (totalAtaques >= 30) { score += 15; motivos.push(`${totalAtaques} ataques perigosos`); }
    if (totalFaltas >= 8) { score += 10; motivos.push(`${totalFaltas} faltas - jogo truncado`); }
    score += 25; motivos.push(`Janela EARLY ${elapsed}'`);
  }
  // JANELA LATE 70-88
  else if (elapsed >= 70 && elapsed <= 88) {
    if (totalChutesGol >= 3) { score += 25; motivos.push(`${totalChutesGol} chutes no gol`); }
    if (totalEsc >= 5) { score += 20; motivos.push(`${totalEsc} escanteios - pressão`); }
    if (totalAtaques >= 50) { score += 20; motivos.push(`${totalAtaques} ataques perigosos`); }
    if (totalFaltas >= 12) { score += 10; motivos.push(`${totalFaltas} faltas - cansaço`); }
    score += 30; motivos.push(`Pressão final ${elapsed}'`);
  }
  // ESCANTEIO 85-90
  else if (elapsed >= 85) {
    if (totalEsc >= 6) { score += 35; motivos.push(`${totalEsc} escanteios`); }
    if (totalAtaques >= 60) { score += 25; motivos.push(`${totalAtaques} ataques`); }
    score += 30; motivos.push(`ABAFAMENTO ${elapsed}'`);
  } else return null;

  if ((fixture.goals.home + fixture.goals.away) >= 5) score -= 25;

  return { score, motivos, elapsed, totalChutesGol, totalEsc, totalAtaques, totalFaltas };
}

async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return;
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: texto, parse_mode: "Markdown" }); }
  catch (e) { console.log("Erro TG:", e.message); }
}

// ROTAS
app.get("/", (req, res) => res.send("Radar V7.3 ANTI-BAN ONLINE - 56 req/dia"));

app.get("/health", (req, res) => {
  releaseExpiredKeys();
  res.json({
    status: "OPERACIONAL", versao: "V7.3 ANTI-BAN", chaves: API_KEYS.length,
    livres: keysStatus.filter(k => k.blockedUntil <= now()).length,
    cache_live: getLiveCache() ? `ativo - expira em ${Math.ceil((LIVE_CACHE_TTL_MS - (now() - liveCache.timestamp))/1000)}s` : "vazio",
    horario: isHorarioAtivo() ? "ATIVO 09h-23h" : "DORMINDO 00h-08h",
    stats_hoje: `${contadorStatsDia}/${MAX_STATS_PER_DAY}`, ultima_exec: ultimaExecucao
  });
});

app.get("/keys", (req, res) => {
  res.json({ total: API_KEYS.length, keys: keysStatus.map(k => ({
    id: k.id, preview: keyPreview(k.key), livre: k.blockedUntil <= now(),
    desbloqueia_em: k.blockedUntil > now() ? Math.ceil((k.blockedUntil - now())/1000) + "s" : "AGORA",
    usos: k.uses, stats_usos: k.statsUses, restante_dia: k.dailyRemaining, status: k.lastStatus
  }))});
});

app.get("/creditos", (req, res) => {
  res.json({ economia: "Live 15min = 56/dia + Stats max 20/dia = total ~76/dia", chaves: keysStatus.map(k=>({ id:k.id, restante_dia:k.dailyRemaining, usos:k.uses })), stats_hoje: contadorStatsDia });
});

app.get("/radar", async (req, res) => {
  if (!isHorarioAtivo()) return res.json({ status: "DORMINDO 00h-08h - 0 crédito gasto" });
  if (requestInProgress) return res.status(202).json({ status: "JA EM ANDAMENTO" });
  requestInProgress = true; limparSinaisAntigos(); resetarContadorDiario();
  try {
    let liveData = getLiveCache(); let origem = "CACHE";
    if (!liveData) {
      const r = await callAPI("/fixtures?live=all", false);
      if (!r.success) { requestInProgress = false; return res.status(429).json({ status: "SEM CHAVE", erro: r.error }); }
      liveData = r.data; saveLiveCache(liveData); origem = "API";
    }
    const jogos = liveData.response || []; let sinais = []; let statsBuscados = 0;
    for (const f of jogos) {
      if (statsBuscados >= MAX_STATS_PER_CYCLE) break;
      const elapsed = f.fixture?.status?.elapsed; if (!elapsed || elapsed < 25) continue;
      const idKey = `${f.fixture.id}-${Math.floor(elapsed/5)}`;
      if (enviados.has(idKey)) continue;

      let statsData = getStatsCache(f.fixture.id);
      if (!statsData) {
        const sRes = await callAPI(`/fixtures/statistics?fixture=${f.fixture.id}`, true);
        if (!sRes.success) continue;
        statsData = sRes.data.response; saveStatsCache(f.fixture.id, statsData); statsBuscados++;
      }
      if (!statsData || statsData.length < 2) continue;
      const analise = calcularScore(f, statsData); if (!analise) continue; if (analise.score < SCORE_MINIMO) continue;

      sinais.push({ jogo: `${f.teams.home.name} x ${f.teams.away.name}`, score: analise.score, minuto: elapsed, motivos: analise.motivos });
      enviados.set(idKey, now());

      const emoji = analise.score >= SCORE_FORTE ? "🔥🔥🔥" : "🟢";
      const msg = `${emoji} *GREEN REAL V7.3 - ${analise.score} PTS*\n\n⚽ ${f.teams.home.name} ${f.goals.home} x ${f.goals.away} ${f.teams.away.name}\n⏱️ ${elapsed}' | 🏆 ${f.league.name}\n\n📊 ${analise.motivos.join(" | ")}\n\n📈 Chutes gol: ${analise.totalChutesGol} | Esc: ${analise.totalEsc} | Ataques: ${analise.totalAtaques} | Faltas: ${analise.totalFaltas}\n\n💡 *${analise.score >= 90 ? "FORTE - ENTRADA OVER" : "POSSÍVEL GOL"}*\n🆔 ${f.fixture.id}`;
      await enviarTelegram(msg);
    }
    ultimaExecucao = new Date().toISOString(); requestInProgress = false;
    return res.json({ status: `V7.3 - ${sinais.length} sinais`, origem, jogos_ao_vivo: jogos.length, stats_buscados_no_ciclo: statsBuscados, stats_hoje: contadorStatsDia, sinais, timestamp: ultimaExecucao });
  } catch (e) { requestInProgress = false; console.error(e); return res.status(500).json({ status: "ERRO", error: e.message }); }
});

app.listen(PORT, () => console.log(`V7.3 ANTI-BAN NA PORTA ${PORT} - CHAVES: ${API_KEYS.length}`));
