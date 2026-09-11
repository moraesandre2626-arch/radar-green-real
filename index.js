// ============================================================
// ELITE RADAR V24 - PRESSÃO INTELIGENTE
// FOCO: PERFIL DE JOGO PARA ESCANTEIOS NO 2º TEMPO
// ============================================================
//
// PRINCÍPIO DA V24:
//
// A QUANTIDADE DE ESCANTEIOS JÁ SAÍDOS NÃO É FILTRO.
// NÃO ELIMINA O JOGO.
// NÃO DÁ BÔNUS.
// NÃO DÁ PUNIÇÃO.
//
// O ROBÔ PROCURA:
// 🎯 volume de chutes
// 🥅 chutes no alvo
// 📊 posse
// ⚔️ ataques perigosos
// 📈 diferença de volume
// 🧠 xG
// 🎯 chutes dentro da área
// 🧱 chutes bloqueados
// ⚽ placar
// 🔥 pressão unilateral/bilateral
//
// OBJETIVO:
// Encontrar jogos com pressão ofensiva real no 1º tempo
// e potencial estatístico para escanteios no 2º tempo.
//
// SCORE MÍNIMO: 65
// VARREDURA: 20 MINUTOS
// RELATÓRIO: TODOS OS DIAS ÀS 23H BRT
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// TELEGRAM
// ============================================================

const TOKEN = (
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  ""
).trim();

const CHAT_ID = (
  process.env.CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID ||
  ""
).trim();

// ============================================================
// CONFIGURAÇÕES
// ============================================================

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

// ============================================================
// FUNÇÕES BÁSICAS
// ============================================================

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numero(v) {

  if (v == null) return 0;

  if (typeof v === "number") {
    return isFinite(v) ? v : 0;
  }

  const n = parseFloat(
    String(v)
      .replace("%", "")
      .replace(",", ".")
  );

  return isFinite(n) ? n : 0;
}

function textoSeguro(v) {

  return String(v || "")
    .replace(/[*_`\[\]]/g, "");
}

// ============================================================
// HORÁRIO BRASIL
// ============================================================

function agoraBrasil() {

  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo"
    })
  );
}

function podeRodarAgora() {

  const agora = agoraBrasil();

  const h = agora.getHours();
  const d = agora.getDay();

  const fimDeSemana =
    d === 0 || d === 6;

  if (fimDeSemana) {
    return h >= 8 && h < 24;
  }

  return h >= 12 && h < 24;
}

function horarioTexto() {

  const agora = agoraBrasil();
  const d = agora.getDay();

  return (
    d === 0 || d === 6
  )
    ? "Sab-Dom 08h-00h BRT"
    : "Seg-Sex 12h-00h BRT";
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(texto) {

  if (!TOKEN || !CHAT_ID) {

    console.log(
      "Telegram não configurado."
    );

    return false;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: texto,
        parse_mode: "Markdown"
      },
      {
        timeout: 10000
      }
    );

    TOTAL_ENVIADOS++;

    return true;

  } catch (e) {

    console.log(
      "ERRO TELEGRAM:",
      e.response?.data || e.message
    );

    return false;
  }
}

// ============================================================
// SOFASCORE
// ============================================================

const HEADERS = {

  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",

  "Accept":
    "application/json",

  "Referer":
    "https://www.sofascore.com/",

  "Origin":
    "https://www.sofascore.com"
};

async function getSofascore(url) {

  // ----------------------------------------------------------
  // ACESSO DIRETO
  // ----------------------------------------------------------

  try {

    const resposta =
      await axios.get(
        url,
        {
          headers: HEADERS,
          timeout: 12000
        }
      );

    return resposta.data;

  } catch (e) {

    if (e.response?.status !== 403) {
      throw e;
    }

    console.log(
      "403 direto. Tentando proxy 1..."
    );
  }

  // ----------------------------------------------------------
  // PROXY 1
  // ----------------------------------------------------------

  try {

    const proxyUrl =
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

    const resposta =
      await axios.get(
        proxyUrl,
        {
          timeout: 15000
        }
      );

    console.log(
      "Proxy 1 funcionou!"
    );

    return typeof resposta.data === "string"
      ? JSON.parse(resposta.data)
      : resposta.data;

  } catch (e) {

    console.log(
      "Proxy 1 falhou. Tentando proxy 2..."
    );
  }

  // ----------------------------------------------------------
  // PROXY 2
  // ----------------------------------------------------------

  const proxyUrl2 =
    `https://corsproxy.io/?${encodeURIComponent(url)}`;

  const resposta3 =
    await axios.get(
      proxyUrl2,
      {
        headers: HEADERS,
        timeout: 15000
      }
    );

  console.log(
    "Proxy 2 funcionou!"
  );

  return typeof resposta3.data === "string"
    ? JSON.parse(resposta3.data)
    : resposta3.data;
}

// ============================================================
// EXTRAIR ESTATÍSTICAS
// ============================================================

function extrairEstatisticas(periodo) {

  const dados = {

    // Escanteios = APENAS INFORMAÇÃO
    escanteios: 0,
    cantosCasa: 0,
    cantosFora: 0,

    // Chutes
    chutes: 0,
    chutesCasa: 0,
    chutesFora: 0,

    // No alvo
    chutesNoAlvo: 0,
    alvoCasa: 0,
    alvoFora: 0,

    // Bloqueados
    bloqueadosCasa: 0,
    bloqueadosFora: 0,

    // Dentro da área
    dentroAreaCasa: 0,
    dentroAreaFora: 0,

    // Fora da área
    foraAreaCasa: 0,
    foraAreaFora: 0,

    // Ataques
    ataquesPerigososCasa: 0,
    ataquesPerigososFora: 0,

    ataquesCasa: 0,
    ataquesFora: 0,

    // Posse
    posseCasa: 0,
    posseFora: 0,

    // xG
    xGCasa: 0,
    xGFora: 0,

    // Grandes chances
    grandesChancesCasa: 0,
    grandesChancesFora: 0,

    // Passes
    passesCasa: 0,
    passesFora: 0
  };

  for (
    const grupo of periodo?.groups || []
  ) {

    for (
      const item of grupo.statisticsItems || []
    ) {

      const nome =
        String(item.name || "")
          .toLowerCase()
          .trim();

      const home =
        numero(item.home);

      const away =
        numero(item.away);

      // ------------------------------------------------------
      // ESCANTEIOS
      // IMPORTANTE:
      // NÃO PARTICIPAM DO SCORE.
      // ------------------------------------------------------

      if (
        nome.includes("corner") ||
        nome.includes("escanteio")
      ) {

        dados.escanteios +=
          home + away;

        dados.cantosCasa += home;
        dados.cantosFora += away;

        continue;
      }

      // ------------------------------------------------------
      // XG
      // ------------------------------------------------------

      if (
        nome === "expected goals" ||
        nome === "xg" ||
        nome.includes("expected goals")
      ) {

        dados.xGCasa = home;
        dados.xGFora = away;

        continue;
      }

      // ------------------------------------------------------
      // TOTAL SHOTS
      // ------------------------------------------------------

      if (
        nome === "total shots" ||
        nome === "shots" ||
        nome.includes("total shots")
      ) {

        dados.chutes +=
          home + away;

        dados.chutesCasa += home;
        dados.chutesFora += away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS ON TARGET
      // ------------------------------------------------------

      if (
        nome.includes("shots on target") ||
        nome.includes("shots on goal") ||
        nome === "on target"
      ) {

        dados.chutesNoAlvo +=
          home + away;

        dados.alvoCasa += home;
        dados.alvoFora += away;

        continue;
      }

      // ------------------------------------------------------
      // BLOCKED SHOTS
      // ------------------------------------------------------

      if (
        nome.includes("blocked shots") ||
        nome.includes("shots blocked")
      ) {

        dados.bloqueadosCasa += home;
        dados.bloqueadosFora += away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS INSIDE BOX
      // ------------------------------------------------------

      if (
        nome.includes("shots inside box") ||
        nome.includes("shots inside penalty area") ||
        nome.includes("inside box")
      ) {

        dados.dentroAreaCasa += home;
        dados.dentroAreaFora += away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS OUTSIDE BOX
      // ------------------------------------------------------

      if (
        nome.includes("shots outside box") ||
        nome.includes("outside box")
      ) {

        dados.foraAreaCasa += home;
        dados.foraAreaFora += away;

        continue;
      }

      // ------------------------------------------------------
      // DANGEROUS ATTACKS
      // ------------------------------------------------------

      if (
        nome.includes("dangerous attacks")
      ) {

        dados.ataquesPerigososCasa += home;
        dados.ataquesPerigososFora += away;

        continue;
      }

      // ------------------------------------------------------
      // TOTAL ATTACKS
      // ------------------------------------------------------

      if (
        nome === "attacks" ||
        nome.includes("attacks")
      ) {

        dados.ataquesCasa += home;
        dados.ataquesFora += away;

        continue;
      }

      // ------------------------------------------------------
      // POSSE
      // ------------------------------------------------------

      if (
        nome.includes("ball possession") ||
        nome === "possession" ||
        nome.includes("possession")
      ) {

        dados.posseCasa = home;
        dados.posseFora = away;

        continue;
      }

      // ------------------------------------------------------
      // GRANDES CHANCES
      // ------------------------------------------------------

      if (
        nome.includes("big chances")
      ) {

        dados.grandesChancesCasa = home;
        dados.gr
