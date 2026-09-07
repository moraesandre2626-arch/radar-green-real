// ============================================================
// ELITE RADAR V6.1 - COMPLETO CORRIGIDO FINAL - FIXED
// ============================================================
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const API_KEYS = [process.env.API_FOOTBALL, process.env.API_FOOTBALL_2, process.env.API_FOOTBALL_3].filter(Boolean);
const TELEGRAM_TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const DAILY_API_BUDGET = Number(process.env.DAILY_API_BUDGET || 90);
const RADAR_INTERVAL_MIN = Number(process.env.RADAR_INTERVAL_MIN || 10);
const STAKE = Number(process.env.STAKE || 5);
const INITIAL_BANK = Number(process.env.INITIAL_BANK || 100);
const MIN_EARLY_SCORE = Number(process.env.MIN_EARLY_SCORE || 82);
const MIN_LATE_SCORE = Number(process.env.MIN_LATE_SCORE || 78);
const MAX_DETAIL_CALLS_DAY = Number(process.env.MAX_DETAIL_CALLS_DAY || 25);
const MAX_CONTEXT_CALLS_DAY = Number(process.env.MAX_CONTEXT_CALLS_DAY || 10);

let apiRequestsToday = 0, detailCallsToday = 0, contextCallsToday = 0, apiKeyIndex = 0, lastRadarRun = null, radarStatus = "INICIANDO", bank = INITIAL_BANK;
const stats = { analisados: 0, candidatos: 0, alertas: 0, greens: 0, reds: 0, voids: 0, greensComOdd: 0, redsComOdd: 0, totalStaked: 0, totalProfit: 0, earlyAlerts: 0, lateAlerts: 0 };
const alertedFixtures = new Set();
const pendingAlerts = new Map();
const history = [];
const statsCache = new Map();
const contextCache = new Map();

function todayKey() { const d = new Date(); return [d.getUTCFullYear(), String(d.getUTCMonth()+1).padStart(2,"0"), String(d.getUTCDate()).padStart(2,"0")].join("-"); }
function resetDailyCountersIfNeeded() {
  if (!global.lastCounterDay) { global.lastCounterDay = todayKey(); return; }
  if (global.lastCounterDay !== todayKey()) {
    global.lastCounterDay = todayKey(); apiRequestsToday = 0; detailCallsToday = 0; contextCallsToday = 0;
    console.log("🔄 Contadores diários resetados.");
  }
}
function remainingApiBudget() { return Math.max(0, DAILY_API_BUDGET - apiRequestsToday); }
function normalizeNumber(value) { if (value == null) return 0; const n = Number(String(value).replace("%","").replace(",",".")); return Number.isFinite(n) ? n : 0; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getApiKey() {
  if (!API_KEYS.length) throw new Error("Nenhuma API_FOOTBALL configurada.");
  const key = API_KEYS[apiKeyIndex % API_KEYS.length]; apiKeyIndex = (apiKeyIndex + 1) % API_KEYS.length; return key;
}
async function apiGet(path, params = {}, options = {}) {
  resetDailyCountersIfNeeded();
  const { type = "normal", force = false } = options;
  if (!force && apiRequestsToday >= DAILY_API_BUDGET) { console.log(`⛔ Orçamento: ${apiRequestsToday}/${DAILY_API_BUDGET}`); return null; }
  if (type === "detail" && !force && detailCallsToday >= MAX_DETAIL_CALLS_DAY) { console.log("⛔ Limite detalhes"); return null; }
  if (type === "context" && !force && contextCallsToday >= MAX_CONTEXT_CALLS_DAY) { console.log("⛔ Limite contexto"); return null; }
  const key = getApiKey();
  try {
    apiRequestsToday++; if(type==="detail") detailCallsToday++; if(type==="context") contextCallsToday++;
    const response = await axios.get(`https://v3.football.api-sports.io${path}`, { params, headers: { "x-apisports-key": key }, timeout: 15000 });
    if (response.data?.errors && Object.keys(response.data.errors).length) console.log("⚠️ Erro API:", response.data.errors);
    return response.data;
  } catch (error) {
    if (error.response) console.log("❌ API HTTP:", error.response.status, error.response.data?.message || "");
    else console.log("❌ Erro API:", error.message);
    return null;
  }
}
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return false;
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true }, { timeout: 10000 }); return true; }
  catch(e){ console.log("❌ Telegram:", e.message); return false; }
}
function parseTeamStatistics(statistics) {
  const result = { corners:0, dangerous:0, shotsOn:0, shotsTotal:0, shotsOff:0, blocked:0, possession:0 };
  if (!Array.isArray(statistics)) return result;
  for (const teamBlock of statistics) {
    for (const item of (teamBlock.statistics||[])) {
      const type = String(item.type||"").toLowerCase(); const value = item.value;
      if (type.includes("corner")) result.corners += normalizeNumber(value);
      if (type.includes("dangerous")) result.dangerous += normalizeNumber(value);
      if (type.includes("shots on goal") || type.includes("shots on target")) result.shotsOn += normalizeNumber(value);
      if (type==="total shots") result.shotsTotal += normalizeNumber(value);
      if (type.includes("shots off goal") || type.includes("shots off target")) result.shotsOff += normalizeNumber(value);
      if (type.includes("blocked shots")) result.blocked += normalizeNumber(value);
      if (type==="ball possession") result.possession += normalizeNumber(value);
    }
  }
  return result;
}
async function getStatsForFixtures(fixtureIds) {
  const result = new Map();
  if (!fixtureIds.length || remainingApiBudget() <= 1) return result;
  for (const id of fixtureIds.slice(0,2)) {
    const data = await apiGet("/fixtures/statistics", { fixture: id }, { type: "detail" });
    if (!data || !Array.isArray(data.response) || data.response.length===0) continue;
    const parsed = parseTeamStatistics(data.response);
    result.set(id, {...parsed, cachedAt: Date.now()});
    statsCache.set(id, {...parsed, cachedAt: Date.now()});
    await sleep(700);
  }
  return result;
}
async function getLiveFixtures() { const data = await apiGet("/fixtures", { live: "all" }); return data?.response||[]; }
function isRadarWindow(fixture) {
  const elapsed = normalizeNumber(fixture.fixture?.status?.elapsed);
  const short = String(fixture.fixture?.status?.short||"").toUpperCase();
  if (short!=="1H" && short!=="2H") return null;
  if (elapsed>=30 && elapsed<=38) return "EARLY";
  if (elapsed>=70 && elapsed<=88) return "LATE";
  return null;
}
function isInterestingFixture(fixture) { return Math.abs(normalizeNumber(fixture.goals?.home)-normalizeNumber(fixture.goals?.away)) <=2; }
function analyzeFixture(fixture, liveStats, windowType) {
  const elapsed = normalizeNumber(fixture.fixture?.status?.elapsed);
  const homeGoals = normalizeNumber(fixture.goals?.home); const awayGoals = normalizeNumber(fixture.goals?.away);
  const corners = normalizeNumber(liveStats.corners); const dangerous = normalizeNumber(liveStats.dangerous);
  const shotsOn = normalizeNumber(liveStats.shotsOn); const shotsTotal = normalizeNumber(liveStats.shotsTotal); const blocked = normalizeNumber(liveStats.blocked);
  const cornerRate = elapsed>0? corners/elapsed:0; const projected90 = cornerRate*90;
  let score = 0; const reasons=[];
  if(windowType==="EARLY"){
    if(corners>=3){ score+=15; reasons.push("3+ cantos"); } if(corners>=4){ score+=7; reasons.push("4+ cantos"); }
    if(projected90>=9){ score+=16; reasons.push("ritmo 9+"); } if(projected90>=11){ score+=
