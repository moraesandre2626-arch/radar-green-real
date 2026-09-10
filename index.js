// ============================================================
// ELITE RADAR V23 - PRESSÃO INTELIGENTE
// REFERÊNCIA: PALMEIRAS x LDU
// ============================================================
// PRESSÃO FORTE:
// 9+ chutes
// 4+ no alvo
// vantagem de 4+ chutes
// até 4 escanteios
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
    console.log("Telegram não configurado.");
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

  for (
    const grupo of periodo?.groups || []
  ) {

    for (
      const item of grupo.statisticsItems || []
    ) {

      const nome =
        String(item.name || "")
          .toLowerCase();

      const home =
        numero(item.home);

      const away =
        numero(item.away);

      // ------------------------------------------------------
      // ESCANTEIOS
      // ------------------------------------------------------

      if (
        nome.includes("corner") ||
        nome.includes("escanteio")
      ) {

        escanteios +=
          home + away;

        cantosCasa += home;
        cantosFora += away;

        continue;
      }

      // ------------------------------------------------------
      // CHUTES
      // ------------------------------------------------------

      if (
        nome === "total shots" ||
        nome === "shots" ||
        nome.includes("total shots")
      ) {

        chutes +=
          home + away;

        chutesCasa += home;
        chutesFora += away;

        continue;
      }

      // ------------------------------------------------------
      // NO ALVO
      // ------------------------------------------------------

      if (
        nome.includes("shots on target") ||
        nome.includes("shots on goal") ||
        nome.includes("on target")
      ) {

        chutesNoAlvo +=
          home + away;

        alvoCasa += home;
        alvoFora += away;

        continue;
      }

      // ------------------------------------------------------
      // ATAQUES PERIGOSOS
      // ------------------------------------------------------

      if (
        nome.includes("dangerous attacks")
      ) {

        ataquesPerigososCasa += home;
        ataquesPerigososFora += away;

        continue;
      }

      // ------------------------------------------------------
      // POSSE
      // ------------------------------------------------------

      if (
        nome.includes("ball possession") ||
        nome.includes("possession")
      ) {

        posseCasa = home;
        posseFora = away;

        continue;
      }
    }
  }

  return {

    escanteios,

    chutes,
    chutesNoAlvo,

    chutesCasa,
    chutesFora,

    alvoCasa,
    alvoFora,

    cantosCasa,
    cantosFora,

    ataquesPerigososCasa,
    ataquesPerigososFora,

    posseCasa,
    posseFora
  };
}

// ============================================================
// PRESSÃO INTELIGENTE V23
// ============================================================

function analisarPressao(dados, jogo) {

  const motivos = [];
  let bonus = 0;

  const chutesCasa =
    dados.chutesCasa;

  const chutesFora =
    dados.chutesFora;

  const alvoCasa =
    dados.alvoCasa;

  const alvoFora =
    dados.alvoFora;

  const posseCasa =
    dados.posseCasa;

  const posseFora =
    dados.posseFora;

  const totalChutes =
    dados.chutes;

  const totalAlvo =
    dados.chutesNoAlvo;

  const golsCasa =
    numero(jogo.homeScore?.current);

  const golsFora =
    numero(jogo.awayScore?.current);

  // ==========================================================
  // PRESSÃO BILATERAL
  // ==========================================================

  if (
    chutesCasa >= 6 &&
    chutesFora >= 6 &&
    alvoCasa >= 2 &&
    alvoFora >= 2
  ) {

    bonus += 12;

    motivos.push(
      "🔥 pressão bilateral forte"
    );
  }

  // ==========================================================
  // NOVA REGRA PRINCIPAL
  // REFERÊNCIA PALMEIRAS x LDU
  //
  // 9+ chutes
  // 4+ no alvo
  // 4+ chutes de vantagem
  // ==========================================================

  const mandantePressaoForte =
    chutesCasa >= 9 &&
    alvoCasa >= 4 &&
    chutesCasa >= chutesFora + 4;

  const visitantePressaoForte =
    chutesFora >= 9 &&
    alvoFora >= 4 &&
    chutesFora >= chutesCasa + 4;

  if (mandantePressaoForte) {

    bonus += 16;

    motivos.push(
      "🏠 PRESSÃO FORTE DO MANDANTE"
    );

    motivos.push(
      `🔥 ${chutesCasa} chutes / ${alvoCasa} no alvo`
    );
  }

  if (visitantePressaoForte) {

    bonus += 16;

    motivos.push(
      "✈️ PRESSÃO FORTE DO VISITANTE"
    );

    motivos.push(
      `🔥 ${chutesFora} chutes / ${alvoFora} no alvo`
    );
  }

  // ==========================================================
  // VOLUME MUITO FORTE
  // ==========================================================

  if (
    totalChutes >= 18 &&
    totalAlvo >= 6
  ) {

    bonus += 7;

    motivos.push(
      "💥 volume ofensivo muito alto"
    );
  }

  // ==========================================================
  // DOMÍNIO + FINALIZAÇÃO
  // ==========================================================

  if (
    Math.max(
      posseCasa,
      posseFora
    ) >= 62 &&
    Math.max(
      chutesCasa,
      chutesFora
    ) >= 8
  ) {

    bonus += 5;

    motivos.push(
      "📈 domínio convertido em finalizações"
    );
  }

  // ==========================================================
  // DOMÍNIO SEM FINALIZAÇÃO
  // ==========================================================

  const posseDominante =
    Math.max(
      posseCasa,
      posseFora
    ) >= 65;

  const poucaFinalizacao =
    totalChutes <= 15 ||
    totalAlvo <= 3;

  if (
    posseDominante &&
    poucaFinalizacao
  ) {

    bonus -= 10;

    motivos.push(
      "⚠️ domínio sem finalizações"
    );
  }

  // ==========================================================
  // PLACAR
  // ==========================================================

  const diferenca =
    Math.abs(
      golsCasa - golsFora
    );

  // 3+ gols de diferença
  if (diferenca >= 3) {

    bonus -= 12;

    motivos.push(
      "🧊 placar de 3+ gols reduz pressão"
    );
  }

  // 2 gols de diferença
  else if (diferenca === 2) {

    const perdedorCasaPressiona =
      golsCasa < golsFora &&
      chutesCasa >= chutesFora + 4 &&
      alvoCasa >= alvoFora;

    const perdedorForaPressiona =
      golsFora < golsCasa &&
      chutesFora >= chutesCasa + 4 &&
      alvoFora >= alvoCasa;

    if (
      perdedorCasaPressiona ||
      perdedorForaPressiona
    ) {

      bonus += 4;

      motivos.push(
        "🔥 perdedor reagindo"
      );

    } else {

      bonus -= 6;

      motivos.push(
        "🧊 placar reduz pressão"
      );
    }
  }

  return {
    bonus,
    motivos
  };
}

// ============================================================
// SCORE V23
// ============================================================

function calcularScore(dados, jogo) {

  let score = 0;

  const motivos = [];

  const escanteios =
    dados.escanteios;

  const chutes =
    dados.chutes;

  const chutesNoAlvo =
    dados.chutesNoAlvo;

  // ==========================================================
  // ESCANTEIOS
  // ==========================================================

  if (escanteios <= 2) {

    score += 20;

    motivos.push(
      "🚩 poucos cantos"
    );

  } else if (escanteios <= 3) {

    score += 16;

    motivos.push(
      "🚩 cantos baixos"
    );

  } else if (escanteios <= 4) {

    score += 12;

    motivos.push(
      "🚩 até 4 cantos"
    );

  } else if (escanteios <= 5) {

    score += 8;

    motivos.push(
      "🚩 5 cantos"
    );

  } else {

    return {
      score: 0,
      motivos: [
        "muitos cantos"
      ]
    };
  }

  // ==========================================================
  // CHUTES
  // ==========================================================

  if (chutes >= 20) {

    score += 25;

    motivos.push(
      "🎯 20+ chutes"
    );

  } else if (chutes >= 17) {

    score += 21;

    motivos.push(
      "🎯 17+ chutes"
    );

  } else if (chutes >= 14) {

    score += 16;

    motivos.push(
      "🎯 14+ chutes"
    );

  } else if (chutes >= 12) {

    score += 12;

    motivos.push(
      "🎯 12+ chutes"
    );

  } else {

    return {
      score: 0,
      motivos: [
        "poucos chutes"
      ]
    };
  }

  // ==========================================================
  // NO ALVO
  // ==========================================================

  if (chutesNoAlvo >= 8) {

    score += 20;

    motivos.push(
      "🥅 8+ no alvo"
    );

  } else if (chutesNoAlvo >= 6) {

    score += 16;

    motivos.push(
      "🥅 6+ no alvo"
    );

  } else if (chutesNoAlvo >= 4) {

    score += 12;

    motivos.push(
      "🥅 4+ no alvo"
    );

  } else {

    score -= 5;

    motivos.push(
      "⚠️ poucos no alvo"
    );
  }

  // ==========================================================
  // FORTE VOLUME DE UM LADO
  // ==========================================================

  const maiorVolume =
    Math.max(
      dados.chutesCasa,
      dados.chutesFora
    );

  if (maiorVolume >= 9) {

    score += 12;

    motivos.push(
      "💥 9+ chutes de um lado"
    );
  }

  // ==========================================================
  // ATAQUES PERIGOSOS
  // ==========================================================

  const ataquesTotal =
    dados.ataquesPerigososCasa +
    dados.ataquesPerigososFora;

  if (ataquesTotal >= 60) {

    score += 8;

    motivos.push(
      "⚔️ ataques perigosos"
    );
  }

  // ==========================================================
  // POSSE
  // ==========================================================

  if (
    Math.max(
      dados.posseCasa,
      dados.posseFora
    ) >= 65
  ) {

    score += 5;

    motivos.push(
      "📊 posse dominante"
    );
  }

  // ==========================================================
  // EMPATE
  // ==========================================================

  const golsCasa =
    numero(
      jogo.homeScore?.current
    );

  const golsFora =
    numero(
      jogo.awayScore?.current
    );

  if (
    golsCasa === golsFora
  ) {

    score += 5;

    motivos.push(
      "⚖️ jogo empatado"
    );
  }

  // ==========================================================
  // PRESSÃO
  // ==========================================================

  const pressao =
    analisarPressao(
      dados,
      jogo
    );

  score += pressao.bonus;

  motivos.push(
    ...pressao.motivos
  );

  // ==========================================================
  // LIMITAR
  // ==========================================================

  score =
    Math.max(
      0,
      Math.min(100, score)
    );

  return {
    score,
    motivos
  };
}

// ============================================================
// CLASSIFICAÇÃO
// ============================================================

function classificacao(score) {

  if (score >= 90)
    return "🔥🔥 EXCEPCIONAL";

  if (score >= 85)
    return "🔥 MUITO FORTE";

  if (score >= 75)
    return "🟢 SINAL FORTE";

  if (score >= 65)
    return "🟡 SINAL ATIVADO";

  return "⚪ FRACO";
}

// ============================================================
// ANALISAR JOGO
// ============================================================

async function analisarJogo(jogo) {

  if (!jogo?.id)
    return;

  if (
    JOGOS_JA_AVISADOS.has(jogo.id)
  )
    return;

  TOTAL_ANALISADOS++;

  await dormir(
    DELAY_SOFASCORE
  );

  try {

    const data =
      await getSofascore(
        `https://api.sofascore.com/api/v1/event/${jogo.id}/statistics`
      );

    const periodo =
      (data?.statistics || [])
        .find(
          p =>
            p.period === "1ST" ||
            p.period === "ALL"
        );

    if (!periodo)
      return;

    const dados =
      extrairEstatisticas(
        periodo
      );

    // ========================================================
    // FILTRO PRINCIPAL
    // ========================================================

    if (
      dados.escanteios > 5
    )
      return;

    if (
      dados.chutes < 12
    )
      return;

    TOTAL_CANDIDATOS++;

    const resultado =
      calcularScore(
        dados,
        jogo
      );

    console.log(
      `${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} | ` +
      `C:${dados.escanteios} ` +
      `CH:${dados.chutes} ` +
      `ALVO:${dados.chutesNoAlvo} ` +
      `SCORE:${resultado.score}`
    );

    console.log(
      "MOTIVOS:",
      resultado.motivos.join(" | ")
    );

    // ========================================================
    // SCORE MÍNIMO
    // ========================================================

    if (
      resultado.score <
      SCORE_MINIMO
    )
      return;

    const casa =
      textoSeguro(
        jogo.homeTeam?.name
      );

    const fora =
      textoSeguro(
        jogo.awayTeam?.name
      );

    const golsCasa =
      numero(
        jogo.homeScore?.current
      );

    const golsFora =
      numero(
        jogo.awayScore?.current
      );

    const mensagem =
`🚨 *ELITE RADAR V23 — SINAL ATIVADO* 🚨

⚽ *${casa} ${golsCasa} x ${golsFora} ${fora}*

⏱️ *INTERVALO*

📊 *1º TEMPO*

🚩 Escanteios: *${dados.escanteios}*
🎯 Chutes: *${dados.chutes}*
🥅 No alvo: *${dados.chutesNoAlvo}*

🏠 ${casa}: ${dados.chutesCasa} chutes | ${dados.alvoCasa} no alvo

✈️ ${fora}: ${dados.chutesFora} chutes | ${dados.alvoFora} no alvo

📈 *PRESSÃO*

${resultado.motivos.join("\n")}

⭐ *SCORE: ${resultado.score}/100*

${classificacao(resultado.score)}

🎯 *OVER 4.5 ESCANTEIOS — 2º TEMPO*

⚠️ *Sinal estatístico. Não é garantia de entrada.*

🕐 ${ULTIMO_CHECK}`;

    if (
      await sendTelegram(
        mensagem
      )
    ) {

      JOGOS_JA_AVISADOS.add(
        jogo.id
      );

      console.log(
        "✅ SINAL ENVIADO"
      );
    }

    if (
      JOGOS_JA_AVISADOS.size > 300
    ) {

      JOGOS_JA_AVISADOS.clear();
    }

  } catch (e) {

    console.log(
      `Erro jogo ${jogo.id}:`,
      e.message
    );
  }
}

// ============================================================
// BUSCAR JOGOS AO VIVO
// ============================================================

async function verificarJogosAoVivo() {

  if (!podeRodarAgora()) {

    ULTIMO_CHECK =
      `Dormindo - ${new Date().toLocaleString("pt-BR")} - ${horarioTexto()}`;

    console.log(
      ULTIMO_CHECK
    );

    return;
  }

  ULTIMO_CHECK =
    new Date().toLocaleString(
      "pt-BR"
    );

  console.log(
    `\n[${ULTIMO_CHECK}] V23 buscando jogos...`
  );

  try {

    const data =
      await getSofascore(
        "https://api.sofascore.com/api/v1/sport/football/events/live"
      );

    const jogos =
      data?.events || [];

    console.log(
      `Ao vivo: ${jogos.length}`
    );

    const intervalo =
      jogos.filter(
        j =>
          j.status?.code === 31 ||
          j.status?.type === "halftime"
      );

    console.log(
      `Intervalo: ${intervalo.length}`
    );

    for (
      const jogo of intervalo
    ) {

      await analisarJogo(
        jogo
      );
    }

    ULTIMO_ERRO =
      "Nenhum - Proxy OK";

  } catch (e) {

    ULTIMO_ERRO =
      e.message;

    console.log(
      "ERRO BUSCAR:",
      ULTIMO_ERRO
    );
  }
}

// ============================================================
// RELATÓRIO DIÁRIO 23H
// ============================================================

async function verificarRelatorioDiario() {

  const agora =
    agoraBrasil();

  const hora =
    agora.getHours();

  const minutos =
    agora.getMinutes();

  const diaAtual =
    `${agora.getFullYear()}-${agora.getMonth() + 1}-${agora.getDate()}`;

  // ----------------------------------------------------------
  // NOVO DIA
  // ----------------------------------------------------------

  if (
    DIA_RELATORIO !== diaAtual
  ) {

    RELATORIO_ENVIADO_HOJE =
      false;

    DIA_RELATORIO =
      diaAtual;
  }

  // ----------------------------------------------------------
  // 23:00 ATÉ 23:04
  // ----------------------------------------------------------

  if (
    hora === 23 &&
    minutos >= 0 &&
    minutos <= 4 &&
    !RELATORIO_ENVIADO_HOJE
  ) {

    const mensagem =
`📊 *ELITE RADAR V23 — RELATÓRIO DIÁRIO*

📅 ${agora.toLocaleDateString("pt-BR")}

🔎 Jogos analisados:
*${TOTAL_ANALISADOS}*

🎯 Candidatos:
*${TOTAL_CANDIDATOS}*

🚨 Sinais enviados:
*${TOTAL_ENVIADOS}*

⭐ Score mínimo:
*${SCORE_MINIMO}*

🎯 Estratégia:
*OVER 4.5 ESCANTEIOS — 2º TEMPO*

🔥 Pressão:
*9+ chutes + 4+ no alvo + vantagem de 4+*

🚩 Máximo de escanteios:
*5*

⏱️ Varredura:
*a cada 20 minutos*

🛡️ Proteções:
*placar + domínio sem finalizações + anti-spam*

⚠️ Último erro:
${textoSeguro(ULTIMO_ERRO)}

🕚 Relatório automático — 23h BRT`;

    const ok =
      await sendTelegram(
        mensagem
      );

    if (ok) {

      RELATORIO_ENVIADO_HOJE =
        true;

      console.log(
        "📊 RELATÓRIO 23H ENVIADO"
      );
    }
  }
}

// ============================================================
// ROTINAS
// ============================================================

// Radar
setInterval(
  verificarJogosAoVivo,
  INTERVALO_MINUTOS *
  60 *
  1000
);

// Relógio do relatório
setInterval(
  verificarRelatorioDiario,
  30 * 1000
);

// Primeira execução
verificarJogosAoVivo();

verificarRelatorioDiario();

// ============================================================
// STATUS
// ============================================================

app.get("/", (req, res) => {

  res.json({

    status:
      "ELITE RADAR V23 ONLINE",

    score_minimo:
      SCORE_MINIMO,

    ultimo_check:
      ULTIMO_CHECK,

    total_enviados:
      TOTAL_ENVIADOS,

    total_analisados:
      TOTAL_ANALISADOS,

    total_candidatos:
      TOTAL_CANDIDATOS,

    jogos_avistados:
      JOGOS_JA_AVISADOS.size,

    ultimo_erro:
      ULTIMO_ERRO,

    intervalo:
      "20 minutos",

    pressao:
      "9+ chutes + 4+ no alvo + 4+ vantagem",

    relatorio:
      "Todos os dias às 23h BRT",

    horario:
      "Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",

    pode_rodar:
      podeRodarAgora()
  });
});

// ============================================================
// TESTE TELEGRAM
// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {

    const ok =
      await sendTelegram(
`✅ *ELITE RADAR V23 — TESTE OK*

🔥 Pressão bilateral
🏠 Pressão forte mandante
✈️ Pressão forte visitante

🎯 Regra principal:
9+ chutes
4+ no alvo
4+ vantagem

🚩 Até 5 escanteios

⭐ Score mínimo:
${SCORE_MINIMO}

📊 Relatório diário:
23h BRT

🕐 ${ULTIMO_CHECK}`
      );

    res.json({

      ok,

      total_enviados:
        TOTAL_ENVIADOS
    });
  }
);

// ============================================================
// LIMPAR CACHE
// ============================================================

app.get(
  "/limpar-cache",
  (req, res) => {

    const antes =
      JOGOS_JA_AVISADOS.size;

    JOGOS_JA_AVISADOS.clear();

    res.json({

      ok: true,

      antes,

      depois: 0
    });
  }
);

// ============================================================
// SERVIDOR
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `🚀 ELITE RADAR V23 RODANDO NA PORTA ${PORT}`
    );

  }
);
