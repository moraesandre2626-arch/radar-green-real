// ============================================================
// ELITE RADAR V6
// Radar Antecipado 30-38' + Radar Final 70-88'
// Odd REAL + ROI + Histórico
// Node.js / Express / API-Football / Telegram
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

const DAILY_API_BUDGET = Number(process.env.DAILY_API_BUDGET || 90);

const RADAR_INTERVAL_MIN = Number(
  process.env.RADAR_INTERVAL_MIN || 30
);

const STAKE = Number(process.env.STAKE || 5);
const INITIAL_BANK = Number(process.env.INITIAL_BANK || 100);

const MIN_EARLY_SCORE = Number(
  process.env.MIN_EARLY_SCORE || 82
);

const MIN_LATE_SCORE = Number(
  process.env.MIN_LATE_SCORE || 78
);

// Quantas chamadas de detalhe podemos fazer por dia.
// /fixtures?ids= pode trazer estatísticas de vários jogos
// em uma única requisição.
const MAX_DETAIL_CALLS_DAY = Number(
  process.env.MAX_DETAIL_CALLS_DAY || 30
);

// Quantas chamadas de contexto podemos fazer.
// Predictions + Odds são chamadas extras.
const MAX_CONTEXT_CALLS_DAY = Number(
  process.env.MAX_CONTEXT_CALLS_DAY || 10
);

// ============================================================
// ESTADO
// ============================================================

let apiRequestsToday = 0;
let detailCallsToday = 0;
let contextCallsToday = 0;

let apiKeyIndex = 0;

let lastRadarRun = null;

let radarStatus = "INICIANDO";

let bank = INITIAL_BANK;

const stats = {
  analisados: 0,
  candidatos: 0,
  alertas: 0,

  greens: 0,
  reds: 0,
  voids: 0,

  greensComOdd: 0,
  redsComOdd: 0,

  totalStaked: 0,
  totalProfit: 0,

  earlyAlerts: 0,
  lateAlerts: 0
};

// Alertas já enviados
const alertedFixtures = new Set();

// Apostas aguardando resultado
const pendingAlerts = new Map();

// Histórico
const history = [];

// Cache de estatísticas
const statsCache = new Map();

// Cache de contexto
const contextCache = new Map();


// ============================================================
// UTILITÁRIOS
// ============================================================

function now() {
  return new Date();
}

function todayKey() {
  const d = new Date();

  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function resetDailyCountersIfNeeded() {
  if (!global.lastCounterDay) {
    global.lastCounterDay = todayKey();
    return;
  }

  if (global.lastCounterDay !== todayKey()) {
    global.lastCounterDay = todayKey();

    apiRequestsToday = 0;
    detailCallsToday = 0;
    contextCallsToday = 0;

    console.log("🔄 Contadores diários da API resetados.");
  }
}

function remainingApiBudget() {
  return Math.max(
    0,
    DAILY_API_BUDGET - apiRequestsToday
  );
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return 0;

  const n = Number(
    String(value)
      .replace("%", "")
      .replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

function percentage(value, total) {
  if (!total) return 0;
  return (value / total) * 100;
}

function goalDifference(home, away) {
  return Math.abs(
    normalizeNumber(home) -
    normalizeNumber(away)
  );
}

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


// ============================================================
// API-FOOTBALL
// ============================================================

function getApiKey() {
  if (!API_KEYS.length) {
    throw new Error(
      "Nenhuma API_FOOTBALL configurada."
    );
  }

  const key = API_KEYS[apiKeyIndex % API_KEYS.length];

  apiKeyIndex =
    (apiKeyIndex + 1) % API_KEYS.length;

  return key;
}

async function apiGet(path, params = {}, options = {}) {
  resetDailyCountersIfNeeded();

  const {
    type = "normal",
    force = false
  } = options;

  if (!force && apiRequestsToday >= DAILY_API_BUDGET) {
    console.log(
      `⛔ Orçamento diário atingido: ${apiRequestsToday}/${DAILY_API_BUDGET}`
    );

    return null;
  }

  if (type === "detail") {
    if (
      !force &&
      detailCallsToday >= MAX_DETAIL_CALLS_DAY
    ) {
      console.log("⛔ Limite interno de detalhes atingido.");
      return null;
    }
  }

  if (type === "context") {
    if (
      !force &&
      contextCallsToday >= MAX_CONTEXT_CALLS_DAY
    ) {
      console.log("⛔ Limite interno de contexto atingido.");
      return null;
    }
  }

  const key = getApiKey();

  try {
    apiRequestsToday++;

    if (type === "detail") {
      detailCallsToday++;
    }

    if (type === "context") {
      contextCallsToday++;
    }

    const response = await axios.get(
      `https://v3.football.api-sports.io${path}`,
      {
        params,
        headers: {
          "x-apisports-key": key
        },
        timeout: 15000
      }
    );

    const remainingHeader =
      response.headers[
        "x-ratelimit-requests-remaining"
      ];

    if (remainingHeader !== undefined) {
      console.log(
        `API restante informado: ${remainingHeader}`
      );
    }

    if (
      response.data &&
      response.data.errors &&
      Object.keys(response.data.errors).length
    ) {
      console.log(
        "⚠️ Erro API:",
        response.data.errors
      );
    }

    return response.data;

  } catch (error) {

    if (error.response) {
      console.log(
        "❌ API HTTP:",
        error.response.status,
        error.response.data || ""
      );

      if (error.response.status === 429) {
        console.log(
          "⏳ API respondeu 429. Reduzindo chamadas."
        );

        await sleep(1500);
      }
    } else {
      console.log(
        "❌ Erro API:",
        error.message
      );
    }

    return null;
  }
}


// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message) {

  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.log(
      "⚠️ Telegram não configurado."
    );
    return false;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true
      },
      {
        timeout: 10000
      }
    );

    return true;

  } catch (error) {

    console.log(
      "❌ Erro Telegram:",
      error.message
    );

    return false;
  }
}


// ============================================================
// EXTRAÇÃO DE ESTATÍSTICAS
// ============================================================

function parseTeamStatistics(statistics) {

  const result = {
    corners: 0,
    dangerous: 0,
    shotsOn: 0,
    shotsTotal: 0,
    shotsOff: 0,
    blocked: 0,
    possession: 0
  };

  if (!Array.isArray(statistics)) {
    return result;
  }

  for (const teamBlock of statistics) {

    const statsArray =
      teamBlock.statistics || [];

    for (const item of statsArray) {

      const type = String(
        item.type || ""
      ).toLowerCase();

      const value = item.value;

      if (
        type.includes("corner")
      ) {
        result.corners +=
          normalizeNumber(value);
      }

      if (
        type.includes("dangerous")
      ) {
        result.dangerous +=
          normalizeNumber(value);
      }

      if (
        type.includes("shots on goal") ||
        type.includes("shots on target")
      ) {
        result.shotsOn +=
          normalizeNumber(value);
      }

      if (
        type === "total shots"
      ) {
        result.shotsTotal +=
          normalizeNumber(value);
      }

      if (
        type.includes("shots off goal") ||
        type.includes("shots off target")
      ) {
        result.shotsOff +=
          normalizeNumber(value);
      }

      if (
        type.includes("blocked shots")
      ) {
        result.blocked +=
          normalizeNumber(value);
      }

      if (
        type === "ball possession"
      ) {
        result.possession +=
          normalizeNumber(value);
      }
    }
  }

  return result;
}

function extractFixtureStatistics(fixture) {

  if (
    fixture &&
    Array.isArray(fixture.statistics)
  ) {
    return parseTeamStatistics(
      fixture.statistics
    );
  }

  return null;
}


// ============================================================
// BUSCA DE ESTATÍSTICAS EM LOTE
// ============================================================

async function getStatsForFixtures(fixtureIds) {

  if (!fixtureIds.length) {
    return new Map();
  }

  const result = new Map();

  // Só fazemos a chamada se ainda houver orçamento
  if (
    remainingApiBudget() <= 1
  ) {
    return result;
  }

  // API-Football permite múltiplos IDs.
  // Limitamos a 20 por segurança.
  const ids = fixtureIds
    .slice(0, 20);

  const data = await apiGet(
    "/fixtures",
    {
      ids: ids.join("-")
    },
    {
      type: "detail"
    }
  );

  if (!data || !Array.isArray(data.response)) {
    return result;
  }

  for (const fixture of data.response) {

    const id =
      fixture.fixture?.id;

    if (!id) continue;

    const parsed =
      extractFixtureStatistics(
        fixture
      );

    if (parsed) {

      result.set(id, {
        ...parsed,
        cachedAt: Date.now()
      });

      statsCache.set(id, {
        ...parsed,
        cachedAt: Date.now()
      });
    }
  }

  return result;
}


// ============================================================
// FIXTURES AO VIVO
// ============================================================

async function getLiveFixtures() {

  const data = await apiGet(
    "/fixtures",
    {
      live: "all"
    }
  );

  if (
    !data ||
    !Array.isArray(data.response)
  ) {
    return [];
  }

  return data.response;
}


// ============================================================
// FILTRO DE JOGOS
// ============================================================

function isRadarWindow(fixture) {

  const elapsed =
    normalizeNumber(
      fixture.fixture?.status?.elapsed
    );

  const period =
    String(
      fixture.fixture?.status?.short || ""
    ).toUpperCase();

  if (period !== "2H" && period !== "1H") {
    return null;
  }

  if (
    elapsed >= 30 &&
    elapsed <= 38
  ) {
    return "EARLY";
  }

  if (
    elapsed >= 70 &&
    elapsed <= 88
  ) {
    return "LATE";
  }

  return null;
}

function isInterestingFixture(
  fixture,
  windowType
) {

  const homeGoals =
    normalizeNumber(
      fixture.goals?.home
    );

  const awayGoals =
    normalizeNumber(
      fixture.goals?.away
    );

  const diff =
    Math.abs(
      homeGoals - awayGoals
    );

  // Evita jogos muito desequilibrados
  if (diff > 2) {
    return false;
  }

  const elapsed =
    normalizeNumber(
      fixture.fixture?.status?.elapsed
    );

  if (windowType === "EARLY") {
    return elapsed >= 30 &&
           elapsed <= 38;
  }

  if (windowType === "LATE") {
    return elapsed >= 70 &&
           elapsed <= 88;
  }

  return false;
}


// ============================================================
// ANÁLISE
// ============================================================

function analyzeFixture(
  fixture,
  liveStats,
  windowType
) {

  const elapsed =
    normalizeNumber(
      fixture.fixture?.status?.elapsed
    );

  const homeGoals =
    normalizeNumber(
      fixture.goals?.home
    );

  const awayGoals =
    normalizeNumber(
      fixture.goals?.away
    );

  const corners =
    normalizeNumber(
      liveStats.corners
    );

  const dangerous =
    normalizeNumber(
      liveStats.dangerous
    );

  const shotsOn =
    normalizeNumber(
      liveStats.shotsOn
    );

  const shotsTotal =
    normalizeNumber(
      liveStats.shotsTotal
    );

  const blocked =
    normalizeNumber(
      liveStats.blocked
    );

  const goalDiff =
    Math.abs(
      homeGoals - awayGoals
    );

  const cornerRate =
    elapsed > 0
      ? corners / elapsed
      : 0;

  const projected90 =
    cornerRate * 90;

  const dangerousRate =
    elapsed > 0
      ? dangerous / elapsed
      : 0;

  const shotsRate =
    elapsed > 0
      ? shotsTotal / elapsed
      : 0;

  let score = 0;

  const reasons = [];

  // ----------------------------------------------------------
  // ESCANTEIOS
  // ----------------------------------------------------------

  if (windowType === "EARLY") {

    if (corners >= 3) {
      score += 15;
      reasons.push("3+ cantos");
    }

    if (corners >= 4) {
      score += 7;
      reasons.push("4+ cantos");
    }

    if (projected90 >= 9) {
      score += 16;
      reasons.push("ritmo 9+ projetado");
    }

    if (projected90 >= 11) {
      score += 7;
      reasons.push("ritmo muito alto");
    }

  } else {

    if (corners >= 5) {
      score += 16;
      reasons.push("5+ cantos");
    }

    if (corners >= 7) {
      score += 8;
      reasons.push("7+ cantos");
    }

    if (projected90 >= 8) {
      score += 12;
      reasons.push("ritmo 8+ projetado");
    }

    if (projected90 >= 10) {
      score += 7;
      reasons.push("ritmo muito alto");
    }
  }

  // ----------------------------------------------------------
  // ATAQUES PERIGOSOS
  // ----------------------------------------------------------

  if (
    windowType === "EARLY"
  ) {

    if (dangerous >= 35) {
      score += 13;
      reasons.push("pressão ofensiva");
    }

    if (dangerous >= 50) {
      score += 7;
      reasons.push("muita pressão");
    }

  } else {

    if (dangerous >= 55) {
      score += 14;
      reasons.push("pressão ofensiva");
    }

    if (dangerous >= 75) {
      score += 7;
      reasons.push("pressão muito alta");
    }
  }

  // ----------------------------------------------------------
  // FINALIZAÇÕES
  // ----------------------------------------------------------

  if (shotsOn >= 2) {
    score += 8;
    reasons.push("2+ no alvo");
  }

  if (shotsOn >= 4) {
    score += 7;
    reasons.push("4+ no alvo");
  }

  if (shotsTotal >= 7) {
    score += 6;
    reasons.push("7+ finalizações");
  }

  if (shotsTotal >= 10) {
    score += 5;
    reasons.push("10+ finalizações");
  }

  if (blocked >= 2) {
    score += 4;
    reasons.push("chutes bloqueados");
  }

  // ----------------------------------------------------------
  // PLACAR
  // ----------------------------------------------------------

  if (goalDiff === 0) {
    score += 7;
    reasons.push("jogo empatado");
  }

  if (goalDiff === 1) {
    score += 4;
    reasons.push("diferença de 1 gol");
  }

  // ----------------------------------------------------------
  // MINUTO
  // ----------------------------------------------------------

  if (
    windowType === "EARLY" &&
    elapsed >= 32 &&
    elapsed <= 37
  ) {
    score += 4;
  }

  if (
    windowType === "LATE" &&
    elapsed >= 75 &&
    elapsed <= 86
  ) {
    score += 4;
  }

  score = Math.min(
    100,
    Math.round(score)
  );

  return {
    fixtureId:
      fixture.fixture?.id,

    window:
      windowType,

    minute:
      elapsed,

    home:
      fixture.teams?.home?.name || "Casa",

    away:
      fixture.teams?.away?.name || "Fora",

    homeGoals,
    awayGoals,

    corners,
    dangerous,
    shotsOn,
    shotsTotal,
    blocked,

    cornerRate,
    projected90,

    score,
    reasons
  };
}


// ============================================================
// LINHA SUGERIDA
// ============================================================

function suggestedLine(analysis) {

  const corners =
    analysis.corners;

  if (
    analysis.window === "EARLY"
  ) {

    if (
      analysis.projected90 >= 11
    ) {
      return corners + 1.5;
    }

    return corners + 0.5;
  }

  return corners + 0.5;
}


// ============================================================
// CAPTURA DA ODD REAL
// ============================================================

function extractCornerOdds(data) {

  if (
    !data ||
    !Array.isArray(data.response)
  ) {
    return [];
  }

  const results = [];

  for (
    const fixtureBlock of data.response
  ) {

    const bookmakers =
      fixtureBlock.bookmakers || [];

    for (
      const bookmaker of bookmakers
    ) {

      const bets =
        bookmaker.bets || [];

      for (
        const bet of bets
      ) {

        const betName =
          String(
            bet.name || ""
          ).toLowerCase();

        if (
          !betName.includes("corner")
        ) {
          continue;
        }

        const values =
          bet.values || [];

        for (
          const value of values
        ) {

          const selection =
            String(
              value.value || ""
            );

          const odd =
            normalizeNumber(
              value.odd
            );

          if (
            !selection ||
            !odd
          ) {
            continue;
          }

          if (
            !/over/i.test(selection)
          ) {
            continue;
          }

          const lineMatch =
            selection.match(
              /(\d+(?:\.\d+)?)/
            );

          const line =
            lineMatch
              ? Number(lineMatch[1])
              : null;

          results.push({
            bookmaker:
              bookmaker.name || "Desconhecida",

            market:
              bet.name || "Corners",

            selection,

            line,

            odd
          });
        }
      }
    }
  }

  return results;
}


async function getRealCornerOdd(
  fixtureId,
  targetLine
) {

  if (
    remainingApiBudget() <= 2
  ) {
    return null;
  }

  const cacheKey =
    `odds_${fixtureId}`;

  const cached =
    contextCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.cachedAt <
      5 * 60 * 1000
  ) {
    return chooseBestOdd(
      cached.odds,
      targetLine
    );
  }

  const data = await apiGet(
    "/odds/live",
    {
      fixture: fixtureId
    },
    {
      type: "context"
    }
  );

  if (!data) {
    return null;
  }

  const odds =
    extractCornerOdds(data);

  contextCache.set(
    cacheKey,
    {
      odds,
      cachedAt: Date.now()
    }
  );

  return chooseBestOdd(
    odds,
    targetLine
  );
}


function chooseBestOdd(
  odds,
  targetLine
) {

  if (!odds.length) {
    return null;
  }

  // Primeiro tenta encontrar a linha exata
  const exact =
    odds.filter(
      x =>
        x.line !== null &&
        Math.abs(
          x.line - targetLine
        ) < 0.01
    );

  if (exact.length) {

    exact.sort(
      (a, b) =>
        b.odd - a.odd
    );

    return exact[0];
  }

  // Caso não exista a linha exata,
  // procura uma linha próxima acima.
  const above =
    odds
      .filter(
        x =>
          x.line !== null &&
          x.line >= targetLine
      )
      .sort(
        (a, b) =>
          a.line - b.line ||
          b.odd - a.odd
      );

  if (above.length) {
    return above[0];
  }

  return null;
}


// ============================================================
// PREDICTION / CONTEXTO
// ============================================================

async function getPrediction(
  fixtureId
) {

  const cacheKey =
    `prediction_${fixtureId}`;

  const cached =
    contextCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.cachedAt <
      60 * 60 * 1000
  ) {
    return cached.data;
  }

  if (
    remainingApiBudget() <= 2
  ) {
    return null;
  }

  const data = await apiGet(
    "/predictions",
    {
      fixture: fixtureId
    },
    {
      type: "context"
    }
  );

  if (
    !data ||
    !Array.isArray(data.response) ||
    !data.response[0]
  ) {
    return null;
  }

  const prediction =
    data.response[0];

  contextCache.set(
    cacheKey,
    {
      data: prediction,
      cachedAt: Date.now()
    }
  );

  return prediction;
}


// ============================================================
// AJUSTE DE CONTEXTO
// ============================================================

function contextAdjustment(
  prediction
) {

  if (!prediction) {
    return 0;
  }

  let adjustment = 0;

  const percent =
    prediction.predictions?.percent || {};

  const home =
    parseFloat(
      String(
        percent.home || ""
      ).replace("%", "")
    );

  const draw =
    parseFloat(
      String(
        percent.draw || ""
      ).replace("%", "")
    );

  const away =
    parseFloat(
      String(
        percent.away || ""
      ).replace("%", "")
    );

  const max =
    Math.max(
      home || 0,
      draw || 0,
      away || 0
    );

  if (max >= 55) {
    adjustment += 2;
  }

  if (max >= 65) {
    adjustment += 1;
  }

  return Math.min(
    3,
    adjustment
  );
}


// ============================================================
// NÍVEL
// ============================================================

function getLevel(score) {

  if (score >= 90) {
    return "🔥 ELITE";
  }

  if (score >= 84) {
    return "🟢 MUITO FORTE";
  }

  if (score >= 78) {
    return "🟡 FORTE";
  }

  return "⚪ MODERADO";
}


// ============================================================
// ALERTA
// ============================================================

async function createAlert(
  analysis,
  oddInfo,
  prediction
) {

  const fixtureId =
    analysis.fixtureId;

  if (
    alertedFixtures.has(fixtureId)
  ) {
    return false;
  }

  const modelLine =
    suggestedLine(analysis);

  const finalScore =
    Math.min(
      100,
      analysis.score +
      contextAdjustment(prediction)
    );

  const minimum =
    analysis.window === "EARLY"
      ? MIN_EARLY_SCORE
      : MIN_LATE_SCORE;

  if (
    finalScore < minimum
  ) {
    return false;
  }

  const level =
    getLevel(finalScore);

  const windowLabel =
    analysis.window === "EARLY"
      ? "🚀 RADAR ANTECIPADO — 1º TEMPO"
      : "🔥 RADAR FINAL — 2º TEMPO";

  const line =
    oddInfo?.line ??
    modelLine;

  const oddText =
    oddInfo
      ? `${oddInfo.odd.toFixed(2)}`
      : "não capturada";

  const bookmaker =
    oddInfo?.bookmaker ||
    "não disponível";

  const market =
    oddInfo?.selection ||
    `Over ${modelLine}`;

  const timestamp =
    new Date().toISOString();

  const alert = {

    fixtureId,

    window:
      analysis.window,

    createdAt:
      timestamp,

    minute:
      analysis.minute,

    home:
      analysis.home,

    away:
      analysis.away,

    score:
      finalScore,

    corners:
      analysis.corners,

    dangerous:
      analysis.dangerous,

    shotsOn:
      analysis.shotsOn,

    shotsTotal:
      analysis.shotsTotal,

    projected90:
      Number(
        analysis.projected90.toFixed(2)
      ),

    modelLine,

    marketLine:
      line,

    odd:
      oddInfo?.odd || null,

    bookmaker,

    selection:
      market,

    status:
      "PENDENTE",

    stake:
      STAKE,

    resultChecked:
      false
  };

  let message = "";

  message +=
    `<b>${windowLabel}</b>\n\n`;

  message +=
    `⚽ <b>${analysis.home}</b> x <b>${analysis.away}</b>\n`;

  message +=
    `⏱️ ${analysis.minute}' | Placar ${analysis.homeGoals} x ${analysis.awayGoals}\n\n`;

  message +=
    `🚩 Cantos: <b>${analysis.corners}</b>\n`;

  message +=
    `⚡ Ataques perigosos: <b>${analysis.dangerous}</b>\n`;

  message +=
    `🎯 No alvo: <b>${analysis.shotsOn}</b>\n`;

  message +=
    `🥅 Finalizações: <b>${analysis.shotsTotal}</b>\n`;

  message +=
    `📈 Projeção 90': <b>${analysis.projected90.toFixed(1)}</b>\n\n`;

  message +=
    `🎯 <b>OVER ${line}</b>\n`;

  message +=
    `📊 Score: <b>${finalScore}/100</b> ${level}\n`;

  message +=
    `💰 Odd real: <b>${oddText}</b>\n`;

  message +=
    `🏦 Casa: ${bookmaker}\n`;

  message +=
    `📌 Mercado: ${market}\n\n`;

  message +=
    `💵 Stake simulada: R$ ${STAKE.toFixed(2)}\n`;

  message +=
    `⚠️ Sinal estatístico, não garantia de resultado.`;

  const sent =
    await sendTelegram(message);

  if (!sent) {
    return false;
  }

  alertedFixtures.add(
    fixtureId
  );

  pendingAlerts.set(
    fixtureId,
    alert
  );

  history.push(alert);

  stats.alertas++;

  if (
    analysis.window === "EARLY"
  ) {
    stats.earlyAlerts++;
  } else {
    stats.lateAlerts++;
  }

  console.log(
    `🚨 ALERTA ${analysis.home} x ${analysis.away} | ${analysis.minute}' | ${finalScore}`
  );

  return true;
}


// ============================================================
// RESULTADO
// ============================================================

function getFixtureFinalStatus(
  fixture
) {

  const short =
    String(
      fixture.fixture?.status?.short || ""
    ).toUpperCase();

  const finished = [
    "FT",
    "AET",
    "PEN"
  ];

  const voidStatus = [
    "PST",
    "CANC",
    "ABD",
    "AWD",
    "WO"
  ];

  if (
    finished.includes(short)
  ) {
    return "FINISHED";
  }

  if (
    voidStatus.includes(short)
  ) {
    return "VOID";
  }

  return "LIVE";
}


function getFinalCorners(
  fixture
) {

  const parsed =
    extractFixtureStatistics(
      fixture
    );

  if (!parsed) {
    return null;
  }

  return parsed.corners;
}


async function settlePendingAlerts(
  liveFixtures
) {

  if (!pendingAlerts.size) {
    return;
  }

  const liveIds =
    new Set(
      liveFixtures
        .map(
          x => x.fixture?.id
        )
        .filter(Boolean)
    );

  const finishedCandidates = [];

  for (
    const [
      fixtureId,
      alert
    ] of pendingAlerts
  ) {

    // Ainda está ao vivo
    if (
      liveIds.has(fixtureId)
    ) {
      continue;
    }

    finishedCandidates.push(
      fixtureId
    );
  }

  if (
    !finishedCandidates.length
  ) {
    return;
  }

  if (
    remainingApiBudget() <= 1
  ) {
    console.log(
      "⚠️ Sem orçamento para fechar resultados."
    );
    return;
  }

  const ids =
    finishedCandidates.slice(
      0,
      20
    );

  const data =
    await apiGet(
      "/fixtures",
      {
        ids: ids.join("-")
      },
      {
        type: "detail"
      }
    );

  if (
    !data ||
    !Array.isArray(data.response)
  ) {
    return;
  }

  for (
    const fixture of data.response
  ) {

    const fixtureId =
      fixture.fixture?.id;

    const alert =
      pendingAlerts.get(
        fixtureId
      );

    if (!alert) {
      continue;
    }

    const status =
      getFixtureFinalStatus(
        fixture
      );

    if (status === "VOID") {

      settleAlert(
        alert,
        "VOID",
        null
      );

      pendingAlerts.delete(
        fixtureId
      );

      continue;
    }

    if (
      status !== "FINISHED"
    ) {
      continue;
    }

    const finalCorners =
      getFinalCorners(
        fixture
      );

    if (
      finalCorners === null
    ) {
      console.log(
        `⚠️ Não foi possível obter cantos finais ${fixtureId}`
      );
      continue;
    }

    const needed =
      Number(alert.marketLine);

    let result;

    if (
      finalCorners > needed
    ) {
      result = "GREEN";
    } else {
      result = "RED";
    }

    settleAlert(
      alert,
      result,
      finalCorners
    );

    pendingAlerts.delete(
      fixtureId
    );
  }
}


// ============================================================
// LIQUIDAÇÃO FINANCEIRA
// ============================================================

function settleAlert(
  alert,
  result,
  finalCorners
) {

  alert.status =
    result;

  alert.finalCorners =
    finalCorners;

  alert.resultChecked =
    true;

  if (result === "GREEN") {

    stats.greens++;

    if (alert.odd) {

      stats.greensComOdd++;

      const profit =
        alert.stake *
        (alert.odd - 1);

      stats.totalProfit +=
        profit;

      stats.totalStaked +=
        alert.stake;

      bank += profit;

      alert.profit =
        Number(
          profit.toFixed(2)
        );

    } else {

      alert.profit = null;
    }

  } else if (
    result === "RED"
  ) {

    stats.reds++;

    if (alert.odd) {

      stats.redsComOdd++;

      const profit =
        -alert.stake;

      stats.totalProfit +=
        profit;

      stats.totalStaked +=
        alert.stake;

      bank += profit;

      alert.profit =
        Number(
          profit.toFixed(2)
        );

    } else {

      alert.profit = null;
    }

  } else {

    stats.voids++;

    alert.profit = 0;
  }

  const roi =
    stats.totalStaked > 0
      ? (
          stats.totalProfit /
          stats.totalStaked
        ) * 100
      : 0;

  console.log(
    `📊 RESULTADO ${result} | ${alert.home} x ${alert.away} | cantos finais: ${finalCorners} | banco: R$ ${bank.toFixed(2)} | ROI: ${roi.toFixed(2)}%`
  );
}


// ============================================================
// RADAR PRINCIPAL
// ============================================================

async function runRadar() {

  resetDailyCountersIfNeeded();

  if (!API_KEYS.length) {

    radarStatus =
      "SEM API_FOOTBALL";

    console.log(
      "❌ Configure API_FOOTBALL."
    );

    return;
  }

  radarStatus =
    "ANALISANDO";

  lastRadarRun =
    new Date().toISOString();

  console.log(
    "\n================================================="
  );

  console.log(
    `🔎 ELITE RADAR V6 | ${lastRadarRun}`
  );

  console.log(
    `📊 API: ${apiRequestsToday}/${DAILY_API_BUDGET}`
  );

  console.log(
    "================================================="
  );

  const liveFixtures =
    await getLiveFixtures();

  if (!liveFixtures.length) {

    radarStatus =
      "SEM JOGOS AO VIVO";

    console.log(
      "Nenhum jogo ao vivo."
    );

    return;
  }

  console.log(
    `⚽ ${liveFixtures.length} jogos ao vivo`
  );

  // ----------------------------------------------------------
  // PRIMEIRO: fecha apostas antigas
  // ----------------------------------------------------------

  await settlePendingAlerts(
    liveFixtures
  );

  // ----------------------------------------------------------
  // ENCONTRA CANDIDATOS
  // ----------------------------------------------------------

  const candidates = [];

  for (
    const fixture of liveFixtures
  ) {

    const windowType =
      isRadarWindow(
        fixture
      );

    if (!windowType) {
      continue;
    }

    if (
      alertedFixtures.has(
        fixture.fixture?.id
      )
    ) {
      continue;
    }

    if (
      !isInterestingFixture(
        fixture,
        windowType
      )
    ) {
      continue;
    }

    candidates.push({
      fixture,
      windowType
    });
  }

  stats.candidatos +=
    candidates.length;

  console.log(
    `🎯 Candidatos: ${candidates.length}`
  );

  if (!candidates.length) {

    radarStatus =
      "SEM CANDIDATOS";

    return;
  }

  // ----------------------------------------------------------
  // PRIORIZAÇÃO
  // ----------------------------------------------------------

  candidates.sort(
    (a, b) => {

      const aMinute =
        normalizeNumber(
          a.fixture.fixture?.status?.elapsed
        );

      const bMinute =
        normalizeNumber(
          b.fixture.fixture?.status?.elapsed
        );

      // Prioriza janela final ligeiramente
      // por ter sinal mais próximo do fechamento.
      if (
        a.windowType !==
        b.windowType
      ) {
        return (
          a.windowType === "LATE"
            ? -1
            : 1
        );
      }

      return bMinute - aMinute;
    }
  );

  // ----------------------------------------------------------
  // LIMITA DETALHES
  // ----------------------------------------------------------

  const availableDetail =
    Math.min(
      candidates.length,
      5
    );

  if (
    availableDetail <= 0
  ) {
    radarStatus =
      "SEM ORÇAMENTO";

    return;
  }

  // Uma única chamada pode trazer
  // estatísticas de vários fixtures.
  const selected =
    candidates.slice(
      0,
      availableDetail
    );

  const ids =
    selected
      .map(
        x => x.fixture.fixture?.id
      )
      .filter(Boolean);

  const statsMap =
    await getStatsForFixtures(
      ids
    );

  // ----------------------------------------------------------
  // ANALISA
  // ----------------------------------------------------------

  const analyzed = [];

  for (
    const item of selected
  ) {

    const fixture =
      item.fixture;

    const fixtureId =
      fixture.fixture?.id;

    let liveStats =
      statsMap.get(
        fixtureId
      );

    // Tenta cache caso já exista
    if (!liveStats) {

      const cached =
        statsCache.get(
          fixtureId
        );

      if (
        cached &&
        Date.now() -
          cached.cachedAt <
          8 * 60 * 1000
      ) {
        liveStats = cached;
      }
    }

    if (!liveStats) {
      continue;
    }

    stats.analisados++;

    const analysis =
      analyzeFixture(
        fixture,
        liveStats,
        item.windowType
      );

    analyzed.push(
      analysis
    );
  }

  // ----------------------------------------------------------
  // ORDENA PELO SCORE
  // ----------------------------------------------------------

  analyzed.sort(
    (a, b) =>
      b.score - a.score
  );

  if (!analyzed.length) {

    radarStatus =
      "SEM DADOS SUFICIENTES";

    return;
  }

  // ----------------------------------------------------------
  // APENAS OS MELHORES
  // ----------------------------------------------------------

  // Contexto/odds são caros.
  // Trabalhamos apenas com os melhores 1-2.
  const best =
    analyzed.slice(
      0,
      2
    );

  for (
    const analysis of best
  ) {

    const minimum =
      analysis.window === "EARLY"
        ? MIN_EARLY_SCORE
        : MIN_LATE_SCORE;

    // Não gastar odds/contexto em score fraco
    if (
      analysis.score <
      minimum - 3
    ) {
      continue;
    }

    let prediction = null;

    // Só busca prediction quando ainda
    // existe espaço de orçamento.
    if (
      remainingApiBudget() >= 4
    ) {
      prediction =
        await getPrediction(
          analysis.fixtureId
        );
    }

    const adjustment =
      contextAdjustment(
        prediction
      );

    const estimatedScore =
      Math.min(
        100,
        analysis.score +
        adjustment
      );

    if (
      estimatedScore <
      minimum
    ) {
      continue;
    }

    const modelLine =
      suggestedLine(
        analysis
      );

    let oddInfo = null;

    // Captura odd real somente no candidato forte.
    if (
      remainingApiBudget() >= 3
    ) {

      oddInfo =
        await getRealCornerOdd(
          analysis.fixtureId,
          modelLine
        );
    }

    await createAlert(
      analysis,
      oddInfo,
      prediction
    );
  }

  radarStatus =
    `OK | ${analyzed.length} analisados`;
}


// ============================================================
// LOOP
// ============================================================

let radarRunning = false;

async function safeRadar() {

  if (radarRunning) {
    console.log(
      "⏳ Radar anterior ainda executando."
    );
    return;
  }

  radarRunning = true;

  try {

    await runRadar();

  } catch (error) {

    console.log(
      "❌ Erro no radar:",
      error.message
    );

    radarStatus =
      "ERRO";

  } finally {

    radarRunning = false;
  }
}


// ============================================================
// RESET DIÁRIO
// ============================================================

setInterval(
  resetDailyCountersIfNeeded,
  60 * 1000
);


// ============================================================
// INÍCIO
// ============================================================

setTimeout(
  safeRadar,
  5000
);

setInterval(
  safeRadar,
  RADAR_INTERVAL_MIN *
    60 *
    1000
);


// ============================================================
// ROTAS
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({
      sistema:
        "ELITE RADAR V6",

      status:
        radarStatus,

      radarIntervalMin:
        RADAR_INTERVAL_MIN,

      windows: [
        "30-38",
        "70-88"
      ],

      api: {
        used:
          apiRequestsToday,

        budget:
          DAILY_API_BUDGET,

        remaining:
          remainingApiBudget()
      },

      bank:
        Number(
          bank.toFixed(2)
        ),

      stats
    });
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (req, res) => {

    res.json({
      ok: true,

      status:
        radarStatus,

      uptime:
        process.uptime(),

      lastRadarRun,

      apiRequestsToday,

      dailyBudget:
        DAILY_API_BUDGET,

      detailCallsToday,

      contextCallsToday,

      pending:
        pendingAlerts.size,

      alerts:
        alertedFixtures.size
    });
  }
);


// ============================================================
// TESTE
// ============================================================

app.get(
  "/teste",
  async (req, res) => {

    try {

      const data =
        await apiGet(
          "/status"
        );

      res.json({
        ok:
          !!data,

        api:
          data
            ? "CONECTADA"
            : "ERRO",

        requestsToday:
          apiRequestsToday,

        budget:
          DAILY_API_BUDGET
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);


// ============================================================
// RADAR MANUAL
// ============================================================

app.get(
  "/radar",
  async (req, res) => {

    if (radarRunning) {

      return res.json({
        ok: false,
        message:
          "Radar já está executando."
      });
    }

    safeRadar();

    res.json({
      ok: true,
      message:
        "Radar iniciado.",
      status:
        radarStatus
    });
  }
);


// ============================================================
// ALERTAS
// ============================================================

app.get(
  "/alertas",
  (req, res) => {

    res.json({
      total:
        history.length,

      pendentes:
        Array.from(
          pendingAlerts.values()
        ),

      ultimos:
        history.slice(-20)
    });
  }
);


// ============================================================
// HISTÓRICO
// ============================================================

app.get(
  "/historico",
  (req, res) => {

    res.json({
      total:
        history.length,

      historico:
        history
    });
  }
);


// ============================================================
// ROI
// ============================================================

app.get(
  "/roi",
  (req, res) => {

    const resolved =
      history.filter(
        x =>
          x.resultChecked
      );

    const withOdd =
      resolved.filter(
        x =>
          x.odd &&
          Number.isFinite(
            Number(x.odd)
          )
      );

    const greens =
      resolved.filter(
        x =>
          x.status === "GREEN"
      ).length;

    const reds =
      resolved.filter(
        x =>
          x.status === "RED"
      ).length;

    const voids =
      resolved.filter(
        x =>
          x.status === "VOID"
      ).length;

    const winRate =
      (greens + reds) > 0
        ? (
            greens /
            (greens + reds)
          ) * 100
        : 0;

    const roi =
      stats.totalStaked > 0
        ? (
            stats.totalProfit /
            stats.totalStaked
          ) * 100
        : 0;

    const early =
      resolved.filter(
        x =>
          x.window === "EARLY"
      );

    const late =
      resolved.filter(
        x =>
          x.window === "LATE"
      );

    const earlyGreen =
      early.filter(
        x =>
          x.status === "GREEN"
      ).length;

    const earlyRed =
      early.filter(
        x =>
          x.status === "RED"
      ).length;

    const lateGreen =
      late.filter(
        x =>
          x.status === "GREEN"
      ).length;

    const lateRed =
      late.filter(
        x =>
          x.status === "RED"
      ).length;

    res.json({

      sistema:
        "ELITE RADAR V6",

      bancaInicial:
        INITIAL_BANK,

      bancaAtual:
        Number(
          bank.toFixed(2)
        ),

      resultadoFinanceiro:
        Number(
          stats.totalProfit.toFixed(2)
        ),

      totalApostas:
        resolved.length,

      apostasComOdd:
        withOdd.length,

      greens,

      reds,

      voids,

      winRate:
        Number(
          winRate.toFixed(2)
        ),

      totalStaked:
        Number(
          stats.totalStaked.toFixed(2)
        ),

      lucro:
        Number(
          stats.totalProfit.toFixed(2)
        ),

      roi:
        Number(
          roi.toFixed(2)
        ),

      janelas: {

        antecipado: {
          total:
            early.length,

          greens:
            earlyGreen,

          reds:
            earlyRed,

          winRate:
            earlyGreen + earlyRed > 0
              ? Number(
                  (
                    earlyGreen /
                    (
                      earlyGreen +
                      earlyRed
                    )
                  * 100
                  ).toFixed(2)
                )
              : 0
        },

        final: {
          total:
            late.length,

          greens:
            lateGreen,

          reds:
            lateRed,

          winRate:
            lateGreen + lateRed > 0
              ? Number(
                  (
                    lateGreen /
                    (
                      lateGreen +
                      lateRed
                    )
                  * 100
                  ).toFixed(2)
                )
              : 0
        }
      },

      api: {
        requestsToday:
          apiRequestsToday,

        budget:
          DAILY_API_BUDGET,

        remaining:
          remainingApiBudget()
      }
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
      "================================================="
    );

    console.log(
      "🚀 ELITE RADAR V6 ONLINE"
    );

    console.log(
      `🌐 Porta: ${PORT}`
    );

    console.log(
      `⏱️ Intervalo: ${RADAR_INTERVAL_MIN} minutos`
    );

    console.log(
      "🚀 Janela antecipada: 30-38'"
    );

    console.log(
      "🔥 Janela final: 70-88'"
    );

    console.log(
      `💰 Banca inicial: R$ ${INITIAL_BANK.toFixed(2)}`
    );

    console.log(
      `💵 Stake: R$ ${STAKE.toFixed(2)}`
    );

    console.log(
      `📊 Score antecipado mínimo: ${MIN_EARLY_SCORE}`
    );

    console.log(
      `📊 Score final mínimo: ${MIN_LATE_SCORE}`
    );

    console.log(
      `🔢 Orçamento API: ${DAILY_API_BUDGET}/dia`
    );

    console.log(
      "================================================="
    );
  }
);
