// ============================================================
// ELITE RADAR V24 - PRESSÃO INTELIGENTE - CORRIGIDO
// FOCO: PERFIL DE JOGO PARA ESCANTEIOS NO 2º TEMPO
// ============================================================
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN || "").trim();
const CHAT_ID = (process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || "").trim();

const SCORE_MINIMO = 65;
const INTERVALO_MINUTOS = 20;
const DELAY_SOFASCORE = 4000;

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let TOTAL_ANALISADOS = 0;
let TOTAL_CANDIDATOS = 0;
let ULTIMO_ERRO = "Nenhum";
let JOGOS_JA_AVISADOS = new Set();
let RELATORIO_ENVIADO_HOJE = false;
let DIA_RELATORIO = "";

function dormir(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function numero(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace("%", "").replace(",", "."));
  return isFinite(n) ? n : 0;
}
function textoSeguro(v) { return String(v || "").replace(/[*_`\[\]]/g, ""); }

function agoraBrasil() { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })); }
function podeRodarAgora() {
  const agora = agoraBrasil();
  const h = agora.getHours(); const d = agora.getDay();
  const fimDeSemana = d === 0 || d === 6;
  if (fimDeSemana) return h >= 8 && h < 24;
  return h >= 12 && h < 24;
}
function horarioTexto() {
  const d = agoraBrasil().getDay();
  return (d === 0 || d === 6) ? "Sab-Dom 08h-00h BRT" : "Seg-Sex 12h-00h BRT";
}

async function sendTelegram(texto) {
  if (!TOKEN || !CHAT_ID) { console.log("Telegram não configurado."); return false; }
  try {
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: texto, parse_mode: "Markdown" }, { timeout: 10000 });
    TOTAL_ENVIADOS++; return true;
  } catch (e) { console.log("ERRO TELEGRAM:", e.response?.data || e.message); return false; }
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.sofascore.com/",
  "Origin": "https://www.sofascore.com"
};

async function getSofascore(url) {
  try {
    const resposta = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    return resposta.data;
  } catch (e) {
    if (e.response?.status !== 403) throw e;
    console.log("403 direto. Tentando proxy 1...");
  }
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const resposta = await axios.get(proxyUrl, { timeout: 15000 });
    console.log("Proxy 1 funcionou!");
    return typeof resposta.data === "string" ? JSON.parse(resposta.data) : resposta.data;
  } catch (e) { console.log("Proxy 1 falhou. Tentando proxy 2..."); }
  const proxyUrl2 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  const resposta3 = await axios.get(proxyUrl2, { headers: HEADERS, timeout: 15000 });
  console.log("Proxy 2 funcionou!");
  return typeof resposta3.data === "string" ? JSON.parse(resposta3.data) : resposta3.data;
}

function extrairEstatisticas(periodo) {
  const dados = {
    escanteios: 0, cantosCasa: 0, cantosFora: 0,
    chutes: 0, chutesCasa: 0, chutesFora: 0,
    chutesNoAlvo: 0, alvoCasa: 0, alvoFora: 0,
    bloqueadosCasa: 0, bloqueadosFora: 0,
    dentroAreaCasa: 0, dentroAreaFora: 0,
    foraAreaCasa: 0, foraAreaFora: 0,
    ataquesPerigososCasa: 0, ataquesPerigososFora: 0,
    ataquesCasa: 0, ataquesFora: 0,
    posseCasa: 0, posseFora: 0,
    xGCasa: 0, xGFora: 0,
    grandesChancesCasa: 0, grandesChancesFora: 0,
  };

  for (const grupo of periodo?.groups || []) {
    for (const item of grupo.statisticsItems || []) {
      const nome = String(item.name || "").toLowerCase().trim();
      const home = numero(item.home); const away = numero(item.away);

      if (nome.includes("corner") || nome.includes("escanteio")) {
        dados.escanteios += home +
