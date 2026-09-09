// ============================================================
// ELITE RADAR V18 - EXPLOSÃO DE ESCANTEIOS 2º TEMPO
// SOFASCORE AO VIVO + SCORE DE PRESSÃO + TELEGRAM
//
// REGRA BASE:
// INTERVALO
// <= 5 escanteios
// >= 14 chutes
// + pressão ofensiva real
//
// SINAL:
// SCORE >= 75
// HORÁRIO: Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// CONFIGURAÇÕES
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

const SCORE_MINIMO = 75;
const INTERVALO_MINUTOS = 20;
const DELAY_SOFASCORE = 2500;

// ============================================================
// CONTROLE
// ============================================================

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let TOTAL_ANALISADOS = 0;
let TOTAL_CANDIDATOS = 0;
let ULTIMO_ERRO = "Nenhum";
let JOGOS_JA_AVISADOS = new Set();

// ============================================================
// UTILITÁRIOS
// ============================================================

function dormir(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numero(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }
  const n = parseFloat(String(valor).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function textoSeguro(valor) {
  return String(valor || "").replace(/[*_`\[\]]/g, "");
}

// ============================================================
// HORÁRIO INTELIGENTE
// ============================================================

function podeRodarAgora() {
  const agora = new Date();
  const brasil = new Date(
    agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const hora = brasil.getHours();
  const dia = brasil.getDay(); // 0 = Dom, 6 = Sab

  const ehFimDeSemana = dia === 0 || dia === 6;

  if (ehFimDeSemana) {
    // Sab e Dom: 08h às 00h
    return hora >= 8 && hora < 24;
  } else {
    // Seg a Sex: 12h às 00h
    return hora >= 12 && hora < 24;
  }
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

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(texto) {
  if (!TOKEN || !CHAT_ID) {
    console.log("Telegram não configurado.");
    return false;
  }
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

// ============================================================
// EXTRAI ESTATÍSTICAS DO 1º TEMPO
// ============================================================

function extrairEstatisticas(periodo) {
  let escanteios = 0;
  let chutes = 0;
  let chutesNoAlvo = 0;
  let chutesCasa = 0;
  let chutesFora = 0;
  let alvoCasa = 0;
  let alvoFora = 0;
  let cantosCasa = 0;
  let cantosFora = 0;
  let ataquesPerigososCasa = 0;
  let ataquesPerigososFora = 0;
  let posseCasa = 0;
  let posseFora = 0;

  const grupos = periodo?.groups || [];
  for (const grupo of grupos) {
    const itens = grupo.statisticsItems || [];
    for (const item of itens) {
      const nome = String(item.name || "").toLowerCase();
      const home = numero(item.home);
      const away = numero(item.away);

      if (nome.includes("corner") || nome.includes("escanteio")) {
        escanteios += home + away;
        cantosCasa += home;
        cantosFora += away;
        continue;
      }
      if (nome === "total shots" || nome === "shots" || nome.includes("total shots")) {
        chutes += home + away;
        chutesCasa += home;
        chutesFora += away;
        continue;
      }
      if (nome.includes("shots on target") || nome.includes("shots on goal") || nome.includes("chutes no alvo")) {
        chutesNoAlvo += home + away;
        alvoCasa += home;
        alvoFora += away;
        continue;
      }
      if (nome.includes("dangerous attacks") || nome.includes("ataques perigosos")) {
        ataquesPerigososCasa += home;
        ataquesPerigososFora += away;
        continue;
      }
      if (nome.includes("ball possession") || nome.includes("possession") || nome.includes("posse")) {
        posseCasa = home;
        posseFora = away;
        continue;
      }
    }
  }
  return {
    escanteios, chutes, chutesNoAlvo,
    chutesCasa, chutesFora, alvoCasa, alvoFora,
    cantosCasa, cantosFora,
    ataquesPerigososCasa, ataquesPerigososFora,
    posseCasa, posseFora
  };
}

// ============================================================
// SCORE PRINCIPAL
// ============================================================

function calcularScore(dados, jogo) {
  let score = 0;
  const motivos = [];
  const {
    escanteios, chutes, chutesNoAlvo,
    chutesCasa, chutesFora, alvoCasa, alvoFora,
    cantosCasa, cantosFora,
    ataquesPerigososCasa, ataquesPerigososFora,
    posseCasa, posseFora
  } = dados;

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

  const maiorVolume = Math.max(chutesCasa, chutesFora);
  const menorVolume = Math.min(chutesCasa, chutesFora);
  if (maiorVolume >= 10 && maiorVolume - menorVolume >= 4) {
    score += 10; motivos.push("forte domínio de chutes");
  } else if (maiorVolume >= 8) {
    score += 6; motivos.push("domínio ofensivo");
  }

  const maiorAlvo = Math.max(alvoCasa, alvoFora);
  const menorAlvo = Math.min(alvoCasa, alvoFora);
  if (maiorAlvo >= 4 && maiorAlvo - menorAlvo >= 2) {
    score += 8; motivos.push("pressão no alvo");
  }

  const ataquesTotal = ataquesPerigososCasa + ataquesPerigososFora;
  if (ataquesTotal >= 70) { score += 8; motivos.push("muitos ataques perigosos"); }
  else if (ataquesTotal >= 50) { score += 5; motivos.push("ataques perigosos"); }

  const maiorPosse = Math.max(posseCasa, posseFora);
  if (maiorPosse >= 65) { score += 5; motivos.push("posse dominante"); }
  else if (maiorPosse >= 58) { score += 3; motivos.push("posse favorável"); }

  const maiorCanto = Math.max(cantosCasa, cantosFora);
  if (maiorCanto >= 4) { score += 4; motivos.push("equipe já gerando cantos"); }

  const golsCasa = numero(jogo.homeScore?.current);
  const golsFora = numero(jogo.awayScore?.current);
  const diferenca = Math.abs(golsCasa - golsFora);
  if (diferenca === 0) { score += 5; motivos.push("jogo empatado"); }
  else if (diferenca === 1) { score += 3; motivos.push("diferença de 1 gol"); }
  else if (diferenca >= 3) { score -= 8; motivos.push("placar muito aberto"); }

  score = Math.max(0, Math.min(100, score));
  return { score, motivos };
}

function classificacao(score) {
  if (score >= 90) return "🔥🔥 EXCEPCIONAL";
  if (score >= 85) return "🔥 MUITO FORTE";
  if (score >= 75) return "🟢 SINAL FORTE";
  if (score >= 65) return "🟡 OBSERVAÇÃO";
  return "⚪ FRACO";
}

async function buscarEstatisticas(id) {
  const resposta = await axios.get(
    `https://api.sofascore.com/api/v1/event/${id}/statistics`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*" },
      timeout: 12000
    }
  );
  const periodos = resposta.data?.statistics || [];
  const primeiroTempo = periodos.find(p => p.period === "1ST" || p.period === "ALL");
  if (!primeiroTempo) return null;
  return extrairEstatisticas(primeiroTempo);
}

async function analisarJogo(jogo) {
  const id = jogo.id;
  if (!id) return;
  if (JOGOS_JA_AVISADOS.has(id)) return;
  TOTAL_ANALISADOS++;
  await dormir(DELAY_SOFASCORE);
  try {
    const dados = await buscarEstatisticas(id);
    if (!dados) { console.log(`Sem estatísticas: ${id}`); return; }

    console.log(`\n${jogo.homeTeam?.name} x ${jogo.awayTeam?.name}`);
    console.log(`Cantos: ${dados.escanteios} | Chutes: ${dados.chutes} | No alvo: ${dados.chutesNoAlvo}`);

    if (dados.escanteios > 5) { console.log("Descartado: >5 cantos"); return; }
    if (dados.chutes < 14) { console.log("Descartado: <14 chutes"); return; }

    TOTAL_CANDIDATOS++;
    const resultado = calcularScore(dados, jogo);
    const score = resultado.score;
    console.log(`SCORE: ${score}/100 | ${resultado.motivos.join(", ")}`);

    if (score < SCORE_MINIMO) { console.log(`Descartado: score ${score} < ${SCORE_MINIMO}`); return; }

    const casa = textoSeguro(jogo.homeTeam?.name);
    const fora = textoSeguro(jogo.awayTeam?.name);
    const golsCasa = numero(jogo.homeScore?.current);
    const golsFora = numero(jogo.awayScore?.current);
    const nivel = classificacao(score);
    const motivos = resultado.motivos.slice(0, 6).map(x => `• ${x}`).join("\n");

    const mensagem =
`🚨 *ELITE RADAR V18 — SINAL AO VIVO* 🚨

⚽ *${casa} ${golsCasa} x ${golsFora} ${fora}*

⏱️ *INTERVALO*

📊 *1º TEMPO*
🚩 Escanteios: *${dados.escanteios}*
🎯 Chutes: *${dados.chutes}*
🥅 No alvo: *${dados.chutesNoAlvo}*

📈 *SCORE DE PRESSÃO*
⭐ *${score}/100*
${nivel}

🔎 *FATORES*
${motivos}

🎯 *MERCADO ANALISADO*
*OVER 4.5 ESCANTEIOS — 2º TEMPO*

⚠️ Sinal estatístico, não garantia.

🕐 ${ULTIMO_CHECK}`;

    const enviado = await sendTelegram(mensagem);
    if (enviado) {
      JOGOS_JA_AVISADOS.add(id);
      console.log(`✅ ALERTA ENVIADO: ${casa} x ${fora}`);
    }
    if (JOGOS_JA_AVISADOS.size > 300) { JOGOS_JA_AVISADOS.clear(); console.log("Cache limpo."); }
  } catch (e) {
    console.log(`Erro jogo ${id}:`, e.response?.data || e.message);
  }
}

async function verificarJogosAoVivo() {
  if (!podeRodarAgora()) {
    ULTIMO_CHECK = `Dormindo - ${new Date().toLocaleString("pt-BR")} - ${horarioTexto()}`;
    console.log(ULTIMO_CHECK);
    return;
  }
  ULTIMO_CHECK = new Date().toLocaleString("pt-BR");
  console.log(`\n================================================`);
  console.log(`[${ULTIMO_CHECK}] ELITE RADAR V18 - 20MIN`);
  console.log(`Buscando jogos ao vivo...`);
  try {
    const resposta = await axios.get(
      "https://api.sofascore.com/api/v1/sport/football/events/live",
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "*/*" },
        timeout: 15000
      }
    );
    const jogos = resposta.data?.events || [];
    console.log(`Total ao vivo: ${jogos.length}`);
    const jogosIntervalo = jogos.filter(j => j.status?.code === 31 || j.status?.type === "halftime");
    console.log(`No intervalo: ${jogosIntervalo.length}`);
    for (const jogo of jogosIntervalo) { await analisarJogo(jogo); }
  } catch (e) {
    ULTIMO_ERRO = e.response?.data || e.message || "Erro";
    console.log("ERRO AO BUSCAR JOGOS:", ULTIMO_ERRO);
  }
  console.log(`================================================\n`);
}

app.get("/", (req, res) => {
  res.json({
    status: "ELITE RADAR V18 ONLINE - 20MIN",
    estrategia: "Intervalo + até 5 cantos + 14+ chutes + pressão + Score >= 75",
    score_minimo: SCORE_MINIMO,
    mercado: "Over 4.5 escanteios no 2º tempo",
    ultimo_check: ULTIMO_CHECK,
    total_enviados: TOTAL_ENVIADOS,
    total_analisados: TOTAL_ANALISADOS,
    total_candidatos: TOTAL_CANDIDATOS,
    jogos_avistados: JOGOS_JA_AVISADOS.size,
    ultimo_erro: ULTIMO_ERRO,
    intervalo: `${INTERVALO_MINUTOS} minutos`,
    horario: "Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",
    pode_rodar: podeRodarAgora(),
    horario_atual: horarioTexto()
  });
});

app.get("/telegram-test", async (req, res) => {
  const enviado = await sendTelegram(
`✅ *ELITE RADAR V18 — TESTE OK - 20MIN*

📊 Regra: ≤5 cantos + ≥14 chutes + pressão + Score ≥ ${SCORE_MINIMO}
🎯 Mercado: OVER 4.5 ESCANTEIOS 2º TEMPO
⏱️ Intervalo: ${INTERVALO_MINUTOS}min
🕐 Horário: Seg-Sex 12h-00h / Sab-Dom 08h-00h

🕐 ${ULTIMO_CHECK}`
  );
  res.json({ ok: enviado, total_enviados: TOTAL_ENVIADOS });
});

app.get("/limpar-cache", (req, res) => {
  const antes = JOGOS_JA_AVISADOS.size;
  JOGOS_JA_AVISADOS.clear();
  res.json({ limpo: true, antes, depois: 0 });
});

app.get("/reset-stats", (req, res) => {
  TOTAL_ANALISADOS = 0; TOTAL_CANDIDATOS = 0; TOTAL_ENVIADOS = 0;
  res.json({ resetado: true });
});

setInterval(verificarJogosAoVivo, INTERVALO_MINUTOS * 60 * 1000);
verificarJogosAoVivo();

app.listen(PORT, () => {
  console.log(`🚀 ELITE RADAR V18 RODANDO NA PORTA ${PORT}`);
  console.log(`🎯 Score mínimo: ${SCORE_MINIMO}`);
  console.log(`⏱️ Intervalo: ${INTERVALO_MINUTOS} minutos`);
  console.log(`🕐 Horário: Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT`);
});
