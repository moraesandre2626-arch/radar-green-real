// ============================================================
// ELITE RADAR V6.3
// ============================================================
// Melhorias:
// ✅ Score real 0-100
// ✅ Early: 30-38'
// ✅ Late: 70-88'
// ✅ Filtros de intensidade
// ✅ Ritmo de escanteios
// ✅ Pressão / chutes / chutes no alvo
// ✅ Placar considerado
// ✅ Proteção contra sinais duplicados
// ✅ Cache de estatísticas
// ✅ Economia de API
// ✅ Budget diário
// ✅ Rotação de API Keys
// ✅ Relatório diário fixo às 23:00 BRT
// ✅ Telegram
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

const DAILY_API_BUDGET = Number(
  process.env.DAILY_API_BUDGET || 90
);

const RADAR_INTERVAL_MIN = Number(
  process.env.RADAR_INTERVAL_MIN || 10
);

// Score mínimo
const MIN_EARLY_SCORE = Number(
  process.env.MIN_EARLY_SCORE || 82
);

const MIN_LATE_SCORE = Number(
  process.env.MIN_LATE_SCORE || 78
);

// ============================================================
// ESTADO
// ============================================================

let apiRequestsToday = 0;
let apiKeyIndex = 0;
let lastRadarRun = null;
let radarStatus = "INICIANDO";
let lastReportDate = null;

const stats = {
  analisados: 0,
  candidatos: 0,
  alertas: 0,

  greens: 0,
  reds: 0,

  earlyAlerts: 0,
  lateAlerts: 0,

  creditZeroHour: null
};

const alertedFixtures = new Set();
const history = [];
const statsCache = new Map();

global.lastDay = null;

// ============================================================
// DATA / HORA BRT
// ============================================================

function getBRTNow() {
  const now = new Date();

  return new Date(
    now.toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo"
    })
  );
}

function todayBRTKey() {
  const d = getBRTNow();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ============================================================
// RESET DIÁRIO
// ============================================================

function resetIfNewDay() {
  const today = todayBRTKey();

  if (global.lastDay !== today) {

    if (global.lastDay) {
      console.log(
        `🔄 Novo dia BRT: ${today} - resetando contadores`
      );
    }

    global.lastDay = today;

    apiRequestsToday = 0;

    stats.analisados = 0;
    stats.candidatos = 0;
    stats.alertas = 0;

    stats.greens = 0;
    stats.reds = 0;

    stats.earlyAlerts = 0;
    stats.lateAlerts = 0;

    stats.creditZeroHour = null;

    alertedFixtures.clear();
    history.length = 0;

    // Limpa cache antigo
    statsCache.clear();
  }
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function remainingBudget() {
  return Math.max(
    0,
    DAILY_API_BUDGET - apiRequestsToday
  );
}

function normalizeNumber(v) {

  if (v == null) return 0;

  const n = Number(
    String(v)
      .replace("%", "")
      .replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// API KEY ROTATION
// ============================================================

function getApiKey() {

  if (!API_KEYS.length) {
    return null;
  }

  const key =
    API_KEYS[
      apiKeyIndex % API_KEYS.length
    ];

  apiKeyIndex =
    (apiKeyIndex + 1) %
    API_KEYS.length;

  return key;
}

// ============================================================
// API FOOTBALL
// ============================================================

async function apiGet(path, params = {}) {

  resetIfNewDay();

  if (apiRequestsToday >= DAILY_API_BUDGET) {

    if (!stats.creditZeroHour) {

      stats.creditZeroHour =
        getBRTNow().toLocaleTimeString("pt-BR");
    }

    console.log(
      `⛔ Budget zerado ${apiRequestsToday}/${DAILY_API_BUDGET} às ${stats.creditZeroHour}`
    );

    return null;
  }

  const key = getApiKey();

  if (!key) {

    console.log(
      "⛔ Nenhuma API key configurada"
    );

    return null;
  }

  try {

    apiRequestsToday++;

    const response = await axios.get(
      `https://v3.football.api-sports.io${path}`,
      {
        params,

        headers: {
          "x-apisports-key": key
        },

        timeout:
