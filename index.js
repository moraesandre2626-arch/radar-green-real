// ============================================================
// ELITE RADAR V6.4 - CORRIGIDO RODÍZIO 2 CHAVES
// - Corrige erro 403 (bloqueio por troca rápida de chave)
// - Usa 1 chave por vez, só troca se falhar
// - Delay entre requests pra não queimar crédito
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const API_KEYS = [
  process.env.API_FOOTBALL,
  process.env.API_FOOTBALL_2,
  process.env.API_FOOTBALL_3
].filter(Boolean);

const TELEGRAM_TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const DAILY_API_BUDGET = Number(process.env.DAILY_API_BUDGET || 200);
const RADAR_INTERVAL_MIN = Number(process.env.RADAR_INTERVAL_MIN || 15);
const MIN_EARLY_SCORE = Number(process.env.MIN_EARLY_SCORE || 78);
const MIN_LATE_SCORE = Number(process.env.MIN_LATE_SCORE || 78);
const MAX_STATS_PER_CYCLE = Number(process.env.MAX_STATS_PER_CYCLE || 6);

const API_BASE = "https://v3.football.api-sports.io";

// ============================================================
// ESTADO
// ============================================================

let apiRequestsToday = 0;
let apiKeyIndex = 0;
let blockedKeys = new Map();

let lastRadarRun = null;
let radarStatus = "INICIANDO";
let lastReportDate = null;
let radarRunning = false;
let currentDay = null;

const alertedFixtures = new Set();
const history = [];
const liveCache = new Map();

const stats = {
  analisados: 0, janelas: 0, candidatos: 0, alertas: 0,
  earlyAlerts: 0, lateAlerts: 0, elite: 0, fortes: 0,
  greens: 0, reds: 0, lastAlert: null, creditZeroHour: null
};

// ============================================================
// DATA / HORA BRASIL
// ============================================================

function getBRTNow() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}
function todayBRTKey() {
  const d = getBRTNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============================================================
// RESET DIÁRIO
// ============================================================

function resetDailyIfNeeded() {
  const today = todayBRTKey();
  if (currentDay !== today) {
    currentDay = today;
    apiRequestsToday = 0;
    apiKeyIndex = 0;
    blockedKeys.clear();
    stats.analisados = 0; stats.janelas = 0; stats.candidatos = 0; stats.alertas = 0;
    stats.earlyAlerts = 0; stats.lateAlerts = 0; stats.elite = 0; stats.fortes = 0;
    stats.greens = 0; stats.reds = 0; stats.lastAlert = null; stats.creditZeroHour = null;
    alertedFixtures.clear();
    liveCache.clear();
    console.log("🔄 NOVO DIA BRT — CONTADORES RESETADOS");
  }
}

// ============================================================
// CONTROLE DA API
// ============================================================

function apiAvailable() {
  if (!API_KEYS.length) return false;
  if (apiRequestsToday >= DAILY_API_BUDGET) {
    if (!stats.creditZeroHour) stats.creditZeroHour = new Date().toISOString();
    return false;
  }
  return true;
}

// ============================================================
// REQUISIÇÃO API-FOOTBALL - CORRIGIDA
// ============================================================

async function apiGet(path) {
  resetDailyIfNeeded();
  if (!apiAvailable()) throw new Error("LIMITE_DIARIO_API_ATINGIDO");

  const totalKeys = API_KEYS.length;

  for (let tentativa = 0; tentativa < totalKeys; tentativa++) {
    let key = API_KEYS[apiKeyIndex];

    if (blockedKeys.has(key)) {
      const blockedAt = blockedKeys.get(key);
      if (Date.now() - blockedAt < 15 * 60 * 1000) {
        console.log(`⏭️ Chave ${apiKeyIndex + 1} bloqueada, pulando...`);
        apiKeyIndex = (apiKeyIndex + 1) % totalKeys;
        continue;
      } else {
        blockedKeys.delete(key);
      }
    }

    try {
      apiRequestsToday++;
      console.log(`🌐 API ${apiRequestsToday}/${DAILY_API_BUDGET} | Chave ${apiKeyIndex + 1} | ${path}`);

      const response = await axios.get(`${API_BASE}${path}`, {
        headers: { "x-apisports-key": key },
        timeout: 15000
      });
      return response.data;

    } catch (error) {
      const status = error.response?.status;
      console.log(`⚠️ Erro API chave ${apiKeyIndex + 1}: ${status || error.message}`);
      if (status === 403 || status === 429) {
        console.log(`🚫 Bloqueando chave ${apiKeyIndex + 1} por 15 min`);
        blockedKeys.set(key, Date.now());
      }
      apiKeyIndex = (apiKeyIndex + 1) % totalKeys;
      if (apiRequestsToday >= DAILY_API_BUDGET) throw new Error("LIMITE_DIARIO_API_ATINGIDO");
    }
  }
  throw new Error("FALHA_NAS_CHAVES_API");
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true
    }, { timeout: 10000 });
    return true;
  } catch (error) {
    console.log("❌ Erro Telegram:", error.response?.data || error.message);
    return false;
  }
}

// ============================================================
// NORMALIZAÇÃO E STATS
// ============================================================

function number(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function emptyStats() {
  return { corners: 0, dangerousHome: 0, dangerousAway: 0, dangerous: 0, attacksHome: 0, attacksAway: 0, shotsOnHome: 0, shotsOnAway: 0, shotsOn: 0, shotsHome: 0, shotsAway: 0, shotsTotal: 0, possessionHome: 0, possessionAway: 0 };
}
function parseStatistics(data, fixture) {
  const result = emptyStats();
  const response = data?.response || [];
  if (!response.length) return result;
  response.forEach((teamBlock, index) => {
    const teamStats = teamBlock.statistics || [];
    let corners = 0, dangerous = 0, attacks = 0, shotsOn = 0, shotsTotal = 0, possession = 0;
    for (const item of teamStats) {
      if (item.type === "Corner Kicks") corners = number(item.value);
