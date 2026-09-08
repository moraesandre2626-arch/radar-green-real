const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.8 - FIX 403
// SOFASCORE LIVE
// PRESSÃO + MOMENTUM + EVOLUÇÃO ENTRE CICLOS
// OVER LIVE + ESCANTEIOS LIVE
// ============================================================

const SOFA_BASE = "https://www.sofascore.com/api/v1";

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  "";

const CHAT_ID =
  process.env.TELEGRAM_CHAT_ID ||
  process.env.CHAT_ID ||
  "";

const POLL_MINUTES = Number(process.env.POLL_MINUTES || 5);
const SCORE_MIN = Number(process.env.SCORE_MIN || 82);
const SCORE_FORTE = Number(process.env.SCORE_FORTE || 90);
const MAX_ALERTAS = Number(process.env.MAX_ALERTAS || 3);
const MAX_STATS = Number(process.env.MAX_STATS || 4);
const HORARIO_INICIO = Number(process.env.HORARIO_INICIO || 9);
const HORARIO_FIM = Number(process.env.HORARIO_FIM || 23);

// ============================================================
// MEMÓRIA
// ============================================================
const historico = new Map();
const enviados = new Map();
const cacheStats = new Map();
const cacheMomentum = new Map();
const cacheIncidentes = new Map();

let radarRodando = false;
let ultimoRadar = null;
let ultimoErro = null;

// ============================================================
// HTTP - FIX 403 COM HEADERS DE NAVEGADOR REAL
// ============================================================
const http = axios.create({
  baseURL: SOFA_BASE,
  timeout: 12000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.sofascore.com/",
    "Origin": "https://www.sofascore.com",
    "X-Requested-With": "XMLHttpRequest",
    "Connection": "keep-alive"
  }
});

// ============================================================
// HORA
// ============================================================
function horaBrasil() {
  try {
    return parseInt(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }), 10);
  } catch { return new Date().getHours(); }
}
function isHorarioAtivo() {
  const h = horaBrasil();
  if (HORARIO_INICIO <= HORARIO_FIM) return h >= HORARIO_INICIO && h <= HORARIO_FIM;
  return h >= HORARIO_INICIO || h <= HORARIO_FIM;
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function num(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const n = parseFloat(String(valor).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}
function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ============================================================
// TELEGRAM
// ============================================================
async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: CHAT_ID, text: texto, parse_mode: "Markdown", disable_web_page_preview: true },
      { timeout: 10000 }
    );
    return true;
  } catch (e) {
    console.log("[TELEGRAM] Erro:", e.response?.data || e.message);
    return false;
  }
}

// ============================================================
// MINUTO DO JOGO
// ============================================================
function obterMinuto(jogo) {
  const status = jogo.status?.type;
  if (status === "finished" || status === "canceled" || status === "postponed") return 0;
  const minuto = num(jogo.time?.minute);
  if (minuto > 0) return Math.floor(minuto);
  const inicio = jogo.time?.currentPeriodStartTimestamp || jogo.time?.period1StartTimestamp;
  if (inicio) {
    const agora = Math.floor(Date.now() / 1000);
    const diferenca = agora - Number(inicio);
    if (diferenca >= 0 && diferenca < 120 * 60) return Math.floor(diferenca / 60);
  }
  return 0;
}

// ============================================================
// ESTATÍSTICAS
// ============================================================
function extrairStats(data) {
  const stats = { shots: 0, shotsOnTarget: 0, corners: 0, dangerousAttacks: 0, attacks: 0, possessionHome: 0, possessionAway: 0 };
  const lista = data?.statistics || [];
  let grupos = [];
  const all = lista.find(x => String(x.period).toUpperCase() === "ALL");
  if (all) grupos = all.groups || [];
  else grupos = lista.flatMap(x => x.groups || []);
  for (const grupo of grupos) {
    for (const item of grupo.statisticsItems || []) {
      const nome = String(item.name || item.statisticsType || "").toLowerCase();
      const home = num(item.home);
      const away = num(item.away);
      if (nome.includes("total shots") || nome.includes("shots total")) stats.shots = home + away;
      if (nome.includes("shots on target") || nome.includes("shots on goal")) stats.shotsOnTarget = home + away;
      if (nome.includes("corner")) stats.corners = home + away;
      if (nome.includes("dangerous attack")) stats.dangerousAttacks = home + away;
      if (nome === "attacks" || nome.includes("total attacks")) stats.attacks = home + away;
      if (nome.includes("ball possession") || nome.includes("possession")) { stats.possessionHome = home; stats.possessionAway = away; }
    }
  }
  return stats;
}

async function buscarStats(eventId) {
  const agora
