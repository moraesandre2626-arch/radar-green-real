// ============================================================
// ELITE RADAR V18 - EXPLOSÃO DE ESCANTEIOS 2º TEMPO
// FIX 403 + 20MIN + HORÁRIO INTELIGENTE
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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

const SCORE_MINIMO = 75;
const INTERVALO_MINUTOS = 20;
const DELAY_SOFASCORE = 2500;

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let TOTAL_ANALISADOS = 0;
let TOTAL_CANDIDATOS = 0;
let ULTIMO_ERRO = "Nenhum";
let JOGOS_JA_AVISADOS = new Set();

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numero(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const n = parseFloat(String(valor).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function textoSeguro(valor) {
  return String(valor || "").replace(/[*_`\[\]]/g, "");
}

function podeRodarAgora() {
  const agora = new Date();
  const brasil = new Date(
    agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const hora = brasil.getHours();
  const dia = brasil.getDay();
  const ehFimDeSemana = dia === 0 || dia === 6;
  if (ehFimDeSemana) return hora >= 8 && hora < 24;
  else return hora >= 12 && hora < 24;
}

function horarioTexto() {
  const agora = new Date();
  const brasil = new Date(
    agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const dia = brasil.getDay();
  const ehFimDeSemana = dia === 0 || dia === 6;
  return ehFimDeSemana ? "Sab-Dom 08h-00h BRT" : "Seg-Sex 12h-00h BRT";
}

async function sendTelegram(texto) {
  if (!TOKEN || !CHAT_ID) return false;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      { chat_id: CHAT_ID, text: texto, parse_mode: "Markdown" },
      { timeout: 10000 }
    );
    TOTAL_ENVIADOS++;
    return true;
  } catch (e) {
    console.log("ERRO TELEGRAM:", e.response?.data || e.message);
    return false;
  }
}

function extrairEstatisticas(periodo) {
  let escanteios = 0, chutes = 0, chutesNoAlvo = 0, chutesCasa = 0, chutesFora = 0, alvoCasa = 0, alvoFora = 0, cantosCasa = 0, cantosFora = 0, ataquesPerigososCasa = 0, ataquesPerigososFora = 0, posseCasa = 0, posseFora = 0;
  const grupos = periodo?.groups || [];
  for (const grupo of grupos) {
    const itens = grupo.statisticsItems || [];
    for (const item of itens) {
      const nome = String(item.name || "").toLowerCase();
      const home = numero(item.home);
      const away = numero(item.away);
      if (nome.includes("corner") || nome.includes("escanteio")) {
        escanteios += home + away; cantosCasa += home; cantosFora += away; continue;
      }
      if (nome === "total shots" || nome === "shots" || nome.includes("total shots")) {
        chutes += home + away; chutesCasa += home; chutesFora += away; continue;
      }
      if (nome.includes("shots on target") || nome.includes("shots on goal") || nome.includes("chutes no alvo")) {
        chutesNoAlvo += home + away; alvoCasa += home; alvoFora += away; continue;
      }
      if (nome.includes("dangerous attacks") || nome.includes("ataques perigosos")) {
        ataquesPerigososCasa += home; ataquesPerigososFora += away; continue;
      }
      if (nome.includes("ball possession") || nome.includes("possession") || nome.includes("posse")) {
        posseCasa = home; posseFora = away; continue;
      }
    }
  }
  return { escanteios, chutes, chutesNoAlvo, chutesCasa, chutesFora, alvoCasa, alvoFora, cantosCasa, cantosFora, ataquesPerigososCasa, ataquesPerigososFora, posseCasa, posseFora };
}

function calcularScore(dados, jogo) {
  let score = 0; const motivos = [];
  const { escanteios, chutes, chutesNoAlvo, chutesCasa, chutesFora, alvoCasa, alvoFora, cantosCasa, cantosFora, ataquesPerigososCasa, ataquesPerigososFora, posseCasa, posseFora } = dados;
  if (escanteios <= 2) { score += 20; motivos.push("poucos cantos"); }
  else if (escanteios <= 3) { score += 16; motivos.push("cantos baixos"); }
  else if (escanteios <= 5) { score += 10; motivos.push("até 5 cantos"); }
  else { return { score: 0, motivos: ["cantos acima do limite"] }; }
  if (chutes >= 20) { score += 25; motivos.push("20+ chutes"); }
  else if (chutes >= 17) { score += 21; motivos.push("17+ chutes"); }
  else if (chutes >= 14) { score += 16; motivos.push("14+ chutes"); }
  else { return { score: 0, motivos: ["poucos chutes"] }; }
  if (chutesNoAlvo >= 8) { score += 20; motivos.push("8+ no alvo"); }
  else if (chutesNoAlvo >= 6) { score += 16; motivos.push("6+ no alvo"); }
  else if (chutesNoAlvo >= 4) { score += 10; motivos.push("4+ no alvo"); }
  else { score -= 5; motivos.push("poucos no alvo"); }
  const maiorVolume = Math.max(chutesCasa, chutesFora); const menorVolume = Math.min(chutesCasa, chutesFora);
  if (maiorVolume >= 10 && maiorVolume - menorVolume >= 4) { score += 10; motivos.push("forte domínio de chutes
