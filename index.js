// ============================================================
// ELITE RADAR V6.4
// RADAR DE ESCANTEIOS AO VIVO
//
// - 2 chaves API-Football
// - Até 200 requisições/dia configuráveis
// - Janela 30–38' e 70–88'
// - Eventos + paralisações para estimativa de acréscimos
// - Escanteios
// - Ataques perigosos
// - Finalizações
// - Finalizações no alvo
// - Projeção de escanteios
// - Score 0–100
// - ELITE / FORTE / IGNORAR
// - Telegram
// - Relatório diário
// - Cache curto, sem estatística velha
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

const DAILY_API_BUDGET =
  Number(process.env.DAILY_API_BUDGET || 200);

const RADAR_INTERVAL_MIN =
  Number(process.env.RADAR_INTERVAL_MIN || 10);

const MIN_EARLY_SCORE =
  Number(process.env.MIN_EARLY_SCORE || 78);

const MIN_LATE_SCORE =
  Number(process.env.MIN_LATE_SCORE || 78);

const MAX_STATS_PER_CYCLE =
  Number(process.env.MAX_STATS_PER_CYCLE || 8);

const API_BASE =
  "https://v3.football.api-sports.io";

// ============================================================
// ESTADO
// ============================================================

let apiRequestsToday = 0;
let apiKeyIndex = 0;

let lastRadarRun = null;
let radarStatus = "INICIANDO";
let lastReportDate = null;
let radarRunning = false;

let currentDay = null;

// Evita alertas duplicados
const alertedFixtures = new Set();

// Histórico dos sinais
const history = [];

// Cache curto:
// fixtureId -> {
//   minute,
//   stats,
//   events,
//   timestamp
// }
const liveCache = new Map();

// ============================================================
// ESTATÍSTICAS
// ============================================================

const stats = {
  analisados: 0,
  janelas: 0,
  candidatos: 0,
  alertas: 0,

  earlyAlerts: 0,
  lateAlerts: 0,

  elite: 0,
  fortes: 0,

  greens: 0,
  reds: 0,

  lastAlert: null,
  creditZeroHour: null
};

// ============================================================
// DATA / HORA BRASIL
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
  ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

    stats.analisados = 0;
    stats.janelas = 0;
    stats.candidatos = 0;
    stats.alertas = 0;

    stats.earlyAlerts = 0;
    stats.lateAlerts = 0;

    stats.elite = 0;
    stats.fortes = 0;

    stats.greens = 0;
    stats.reds = 0;

    stats.lastAlert = null;
    stats.creditZeroHour = null;

    alertedFixtures.clear();
    liveCache.clear();

    console.log("🔄 NOVO DIA BRT — CONTADORES RESETADOS");
  }
}

// ============================================================
// CONTROLE DA API
// ============================================================

function apiAvailable() {
  if (!API_KEYS.length) {
    return false;
  }

  if (apiRequestsToday >= DAILY_API_BUDGET) {
    if (!stats.creditZeroHour) {
      stats.creditZeroHour = new Date().toISOString();
    }

    return false;
  }

  return true;
}

// ============================================================
// REQUISIÇÃO API-FOOTBALL
// ============================================================

async function apiGet(path) {
  resetDailyIfNeeded();

  if (!apiAvailable()) {
    throw new Error("LIMITE_DIARIO_API_ATINGIDO");
  }

  const totalKeys = API_KEYS.length;

  for (let tentativa = 0; tentativa < totalKeys; tentativa++) {
    const key = API_KEYS[apiKeyIndex];

    apiKeyIndex =
      (apiKeyIndex + 1) % totalKeys;

    apiRequestsToday++;

    try {
      console.log(
        `🌐 API ${apiRequestsToday}/${DAILY_API_BUDGET} | ${path}`
      );

      const response = await axios.get(
        `${API_BASE}${path}`,
        {
          headers: {
            "x-apisports-key": key
          },
          timeout: 15000
        }
      );

      return response.data;

    } catch (error) {
      console.log(
        `⚠️ Erro API: ${
          error.response?.status ||
          error.message
        }`
      );

      // Se acabou o orçamento, para
      if (apiRequestsToday >= DAILY_API_BUDGET) {
        throw new Error("LIMITE_DIARIO_API_ATINGIDO");
      }
    }
  }

  throw new Error("FALHA_NAS_CHAVES_API");
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.log("⚠️ Telegram não configurado.");
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
      error.response?.data || error.message
    );

    return false;
  }
}

// ============================================================
// NORMALIZAÇÃO
// ============================================================

function number(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  const n = Number(
    String(value)
      .replace("%", "")
      .replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

// ============================================================
// ESTATÍSTICAS
// ============================================================

function emptyStats() {
  return {
    corners: 0,

    dangerousHome: 0,
    dangerousAway: 0,
    dangerous: 0,

    attacksHome: 0,
    attacksAway: 0,

    shotsOnHome: 0,
    shotsOnAway: 0,
    shotsOn: 0,

    shotsHome: 0,
    shotsAway: 0,
    shotsTotal: 0,

    possessionHome: 0,
    possessionAway: 0
  };
}

function parseStatistics(data, fixture) {
  const result = emptyStats();

  const response = data?.response || [];

  if (!response.length) {
    return result;
  }

  response.forEach((teamBlock, index) => {
    const teamStats = teamBlock.statistics || [];

    let corners = 0;
    let dangerous = 0;
    let attacks = 0;
    let shotsOn = 0;
    let shotsTotal = 0;
    let possession = 0;

    for (const item of teamStats) {
      const type = item.type;
      const value = item.value;

      if (type === "Corner Kicks") {
        corners = number(value);
      }

      if (type === "Dangerous Attacks") {
        dangerous = number(value);
      }

      if (type === "Attacks") {
        attacks = number(value);
      }

      if (type === "Shots on Goal") {
        shotsOn = number(value);
      }

      if (type === "Total Shots") {
        shotsTotal = number(value);
      }

      if (type === "Ball Possession") {
        possession = number(value);
      }
    }

    // Primeiro bloco = mandante
    if (index === 0) {
      result.dangerousHome = dangerous;
      result.attacksHome = attacks;
      result.shotsOnHome = shotsOn;
      result.shotsHome = shotsTotal;
      result.possessionHome = possession;
    }

    // Segundo bloco = visitante
    if (index === 1) {
      result.dangerousAway = dangerous;
      result.attacksAway = attacks;
      result.shotsOnAway = shotsOn;
      result.shotsAway = shotsTotal;
      result.possessionAway = possession;
    }

    result.corners += corners;
  });

  result.dangerous =
    result.dangerousHome +
    result.dangerousAway;

  result.shotsOn =
    result.shotsOnHome +
    result.shotsOnAway;

  result.shotsTotal =
    result.shotsHome +
    result.shotsAway;

  return result;
}

// ============================================================
// EVENTOS / PARALISAÇÕES
// ============================================================

function analyzeEvents(eventsResponse) {
  const events = eventsResponse?.response || [];

  let stoppageScore = 0;

  let injuries = 0;
  let substitutions = 0;
  let varEvents = 0;
  let goals = 0;
  let cards = 0;

  for (const event of events) {
    const type = String(event.type || "").toLowerCase();
    const detail = String(
      event.detail || ""
    ).toLowerCase();

    if (type === "goal") {
      goals++;
      stoppageScore += 1;
    }

    if (type === "subst") {
      substitutions++;
      stoppageScore += 1;
    }

    if (
      detail.includes("injury") ||
      detail.includes("injured") ||
      detail.includes("lesion")
    ) {
      injuries++;
      stoppageScore += 3;
    }

    if (
      type.includes("var") ||
      detail.includes("var") ||
      detail.includes("video")
    ) {
      varEvents++;
      stoppageScore += 3;
    }

    if (
      type === "card" ||
      detail.includes("yellow") ||
      detail.includes("red")
    ) {
      cards++;
      stoppageScore += 0.5;
    }
  }

  // Estimativa conservadora.
  // Não representa o acréscimo oficial do árbitro.
  let estimatedAdded = 0;

  if (stoppageScore >= 10) {
    estimatedAdded = 6;
  } else if (stoppageScore >= 7) {
    estimatedAdded = 5;
  } else if (stoppageScore >= 4) {
    estimatedAdded = 4;
  } else if (stoppageScore >= 2) {
    estimatedAdded = 3;
  } else if (stoppageScore >= 1) {
    estimatedAdded = 2;
  }

  return {
    injuries,
    substitutions,
    varEvents,
    goals,
    cards,
    stoppageScore,
    estimatedAdded
  };
}

// ============================================================
// BUSCAR DADOS AO VIVO
// ============================================================

async function getLiveData(fixture) {
  const id = fixture.fixture.id;

  const cached = liveCache.get(id);

  const currentMinute = number(
    fixture.fixture?.status?.elapsed
  );

  // Cache máximo de 2 minutos.
  // Como o radar roda normalmente a cada 10 minutos,
  // na prática os dados serão renovados.
  if (
    cached &&
    Date.now() - cached.timestamp < 120000 &&
    Math.abs(
      currentMinute - cached.minute
    ) <= 1
  ) {
    return cached;
  }

  const [statsData, eventsData] =
    await Promise.all([
      apiGet(`/fixtures/statistics?fixture=${id}`),
      apiGet(`/fixtures/events?fixture=${id}`)
    ]);

  const parsedStats =
    parseStatistics(
      statsData,
      fixture
    );

  const eventInfo =
    analyzeEvents(eventsData);

  const data = {
    minute: currentMinute,
    stats: parsedStats,
    events: eventInfo,
    timestamp: Date.now()
  };

  liveCache.set(id, data);

  return data;
}

// ============================================================
// JANELAS DO RADAR
// ============================================================

function getWindow(minute) {
  if (minute >= 30 && minute <= 38) {
    return "EARLY";
  }

  if (minute >= 70 && minute <= 88) {
    return "LATE";
  }

  return null;
}

// ============================================================
// TEMPO EFETIVO
// ============================================================

function calculateTimeContext(minute, events) {
  const added =
    number(events?.estimatedAdded);

  let estimatedEffectiveMinute = minute;

  // IMPORTANTE:
  // NÃO altera o minuto oficial.
  // É apenas uma variável auxiliar para o modelo.
  if (minute >= 30 && minute <= 45) {
    estimatedEffectiveMinute =
      minute + added;
  }

  if (minute >= 70 && minute <= 90) {
    estimatedEffectiveMinute =
      minute + added;
  }

  let timeFactor = 0;

  if (minute >= 30 && minute <= 38) {
    if (estimatedEffectiveMinute >= 36) {
      timeFactor += 5;
    }

    if (estimatedEffectiveMinute >= 40) {
      timeFactor += 7;
    }
  }

  if (minute >= 70 && minute <= 88) {
    if (estimatedEffectiveMinute >= 82) {
      timeFactor += 4;
    }

    if (estimatedEffectiveMinute >= 87) {
      timeFactor += 6;
    }
  }

  return {
    officialMinute: minute,
    estimatedAdded: added,
    estimatedEffectiveMinute,
    timeFactor
  };
}

// ============================================================
// PROJEÇÃO DE ESCANTEIOS
// ============================================================

function calculateProjection(corners, minute) {
  if (!minute || minute <= 0) {
    return 0;
  }

  // Não projeta além de 90 de maneira agressiva.
  const effectiveMinute =
    Math.min(minute, 90);

  const projection =
    (corners / effectiveMinute) * 90;

  return Number(
    projection.toFixed(2)
  );
}

// ============================================================
// SCORE
// ============================================================

function calculateScore(
  fixture,
  liveData
) {
  const minute =
    number(
      fixture.fixture?.status?.elapsed
    );

  const window =
    getWindow(minute);

  if (!window) {
    return null;
  }

  const s = liveData.stats;
  const e = liveData.events;

  const time =
    calculateTimeContext(
      minute,
      e
    );

  const projection =
    calculateProjection(
      s.corners,
      minute
    );

  let score = 0;

  const reasons = [];

  // ----------------------------------------------------------
  // ESCANTEIOS
  // ----------------------------------------------------------

  if (window === "EARLY") {
    if (s.corners >= 5) {
      score += 30;
      reasons.push("5+ escanteios");
    } else if (s.corners >= 4) {
      score += 25;
      reasons.push("4 escanteios");
    } else if (s.corners >= 3) {
      score += 20;
      reasons.push("3 escanteios");
    } else if (s.corners >= 2) {
      score += 12;
    }
  }

  if (window === "LATE") {
    if (s.corners >= 7) {
      score += 30;
      reasons.push("7+ escanteios");
    } else if (s.corners >= 6) {
      score += 26;
      reasons.push("6 escanteios");
    } else if (s.corners >= 5) {
      score += 21;
      reasons.push("5 escanteios");
    } else if (s.corners >= 4) {
      score += 12;
    }
  }

  // ----------------------------------------------------------
  // PROJEÇÃO
  // ----------------------------------------------------------

  if (projection >= 12) {
    score += 25;
    reasons.push("projeção muito alta");
  } else if (projection >= 10) {
    score += 21;
    reasons.push("projeção alta");
  } else if (projection >= 8.5) {
    score += 16;
    reasons.push("projeção boa");
  } else if (projection >= 7) {
    score += 8;
  } else {
    score -= 8;
  }

  // ----------------------------------------------------------
  // ATAQUES PERIGOSOS
  // ----------------------------------------------------------

  if (window === "EARLY") {
    if (s.dangerous >= 70) {
      score += 22;
      reasons.push("pressão muito alta");
    } else if (s.dangerous >= 55) {
      score += 18;
      reasons.push("pressão alta");
    } else if (s.dangerous >= 40) {
      score += 12;
    } else if (s.dangerous >= 30) {
      score += 6;
    }
  }

  if (window === "LATE") {
    if (s.dangerous >= 100) {
      score += 22;
      reasons.push("pressão muito alta");
    } else if (s.dangerous >= 75) {
      score += 18;
      reasons.push("pressão alta");
    } else if (s.dangerous >= 55) {
      score += 12;
    } else if (s.dangerous >= 40) {
      score += 6;
    }
  }

  // ----------------------------------------------------------
  // FINALIZAÇÕES NO ALVO
  // ----------------------------------------------------------

  if (s.shotsOn >= 6) {
    score += 16;
    reasons.push("6+ no alvo");
  } else if (s.shotsOn >= 4) {
    score += 13;
    reasons.push("4+ no alvo");
  } else if (s.shotsOn >= 3) {
    score += 9;
  } else if (s.shotsOn >= 2) {
    score += 5;
  }

  // ----------------------------------------------------------
  // TOTAL DE FINALIZAÇÕES
  // ----------------------------------------------------------

  if (s.shotsTotal >= 16) {
    score += 12;
    reasons.push("muitas finalizações");
  } else if (s.shotsTotal >= 12) {
    score += 9;
  } else if (s.shotsTotal >= 8) {
    score += 5;
  }

  // ----------------------------------------------------------
  // ATAQUES
  // ----------------------------------------------------------

  const totalAttacks =
    s.attacksHome +
    s.attacksAway;

  if (totalAttacks >= 100) {
    score += 7;
  } else if (totalAttacks >= 75) {
    score += 4;
  }

  // ----------------------------------------------------------
  // POSSE
  // ----------------------------------------------------------

  const possessionDiff =
    Math.abs(
      s.possessionHome -
      s.possessionAway
    );

  if (
    s.possessionHome > 0 &&
    s.possessionAway > 0
  ) {
    if (possessionDiff <= 20) {
      score += 4;
    }
  }

  // ----------------------------------------------------------
  // TEMPO / PARALISAÇÕES
  // ----------------------------------------------------------

  score += time.timeFactor;

  if (time.estimatedAdded >= 5) {
    reasons.push(
      `paralisações: +${time.estimatedAdded} estimados`
    );
  }

  // ----------------------------------------------------------
  // PENALIZAÇÕES
  // ----------------------------------------------------------

  if (
    s.corners === 0 &&
    s.shotsOn === 0
  ) {
    score -= 20;
    reasons.push("jogo sem produção");
  }

  if (
    s.corners <= 1 &&
    s.dangerous < 25
  ) {
    score -= 10;
  }

  // Muitos gols podem mudar totalmente
  // a dinâmica do mercado.
  const homeGoals =
    number(
      fixture.goals?.home
    );

  const awayGoals =
    number(
      fixture.goals?.away
    );

  const totalGoals =
    homeGoals + awayGoals;

  if (totalGoals >= 4) {
    score -= 10;
  } else if (totalGoals >= 3) {
    score -= 5;
  }

  // ----------------------------------------------------------
  // LIMITES
  // ----------------------------------------------------------

  score = Math.max(
    0,
    Math.min(100, Math.round(score))
  );

  let level = "IGNORAR";

  if (score >= 85) {
    level = "ELITE";
  } else if (score >= 78) {
    level = "FORTE";
  }

  return {
    score,
    level,
    window,

    minute,

    officialMinute:
      time.officialMinute,

    estimatedAdded:
      time.estimatedAdded,

    estimatedEffectiveMinute:
      time.estimatedEffectiveMinute,

    corners:
      s.corners,

    projection,

    dangerous:
      s.dangerous,

    shotsOn:
      s.shotsOn,

    shotsTotal:
      s.shotsTotal,

    attacks:
      totalAttacks,

    goals:
      totalGoals,

    reasons
  };
}

// ============================================================
// FILTRO INICIAL
// ============================================================

function preFilter(fixture) {
  const minute =
    number(
      fixture.fixture?.status?.elapsed
    );

  const window =
    getWindow(minute);

  if (!window) {
    return false;
  }

  const homeGoals =
    number(
      fixture.goals?.home
    );

  const awayGoals =
    number(
      fixture.goals?.away
    );

  const totalGoals =
    homeGoals + awayGoals;

  // Evita partidas muito fora do perfil
  if (totalGoals >= 5) {
    return false;
  }

  return true;
}

// ============================================================
// NOME DOS TIMES
// ============================================================

function teamNames(fixture) {
  return {
    home:
      fixture.teams?.home?.name ||
      "Mandante",

    away:
      fixture.teams?.away?.name ||
      "Visitante"
  };
}

// ============================================================
// ALERTA TELEGRAM
// ============================================================

async function sendRadarAlert(
  fixture,
  analysis
) {
  const teams =
    teamNames(fixture);

  const icon =
    analysis.level === "ELITE"
      ? "👑"
      : "🔥";

  const message = `
${icon} <b>ELITE RADAR V6.4</b>

<b>${analysis.level}</b> — Score ${analysis.score}/100

⚽ <b>${teams.home}</b>
🆚
<b>${teams.away}</b>

⏱️ Minuto oficial: <b>${analysis.officialMinute}'</b>
➕ Acréscimo estimado: <b>+${analysis.estimatedAdded}'</b>
🕐 Tempo efetivo estimado: <b>${analysis.estimatedEffectiveMinute}'</b>

🚩 Escanteios: <b>${analysis.corners}</b>
📈 Projeção: <b>${analysis.projection}</b>

🔥 Ataques perigosos: <b>${analysis.dangerous}</b>
🎯 Finalizações no alvo: <b>${analysis.shotsOn}</b>
🥅 Finalizações totais: <b>${analysis.shotsTotal}</b>

⚽ Gols: <b>${analysis.goals}</b>

📊 Janela: <b>${analysis.window}</b>

🧠 <b>Indicadores:</b>
${analysis.reasons.length
    ? analysis.reasons
        .map(x => `• ${x}`)
        .join("\n")
    : "• Sem indicador dominante"
}

🔄 API: ${apiRequestsToday}/${DAILY_API_BUDGET}

⚠️ <i>Sinal estatístico. Não representa garantia de resultado.</i>
`;

  const sent =
    await sendTelegram(message);

  if (sent) {
    stats.alertas++;
    stats.lastAlert =
      new Date().toISOString();

    if (
      analysis.window === "EARLY"
    ) {
      stats.earlyAlerts++;
    }

    if (
      analysis.window === "LATE"
    ) {
      stats.lateAlerts++;
    }

    if (
      analysis.level === "ELITE"
    ) {
      stats.elite++;
    } else {
      stats.fortes++;
    }

    history.push({
      timestamp:
        new Date().toISOString(),

      fixtureId:
        fixture.fixture.id,

      home:
        teamNames(fixture).home,

      away:
        teamNames(fixture).away,

      minute:
        analysis.minute,

      window:
        analysis.window,

      score:
        analysis.score,

      level:
        analysis.level,

      corners:
        analysis.corners,

      projection:
        analysis.projection
    });

    if (history.length > 200) {
      history.shift();
    }
  }

  return sent;
}

// ============================================================
// RADAR PRINCIPAL
// ============================================================

async function runRadar() {
  resetDailyIfNeeded();

  if (radarRunning) {
    console.log(
      "⏳ Radar já está executando."
    );

    return;
  }

  if (!apiAvailable()) {
    radarStatus =
      "LIMITE API ATINGIDO";

    return;
  }

  radarRunning = true;
  radarStatus = "ANALISANDO";

  try {
    console.log(
      "\n=============================="
    );

    console.log(
      "🚨 ELITE RADAR V6.4"
    );

    console.log(
      "=============================="
    );

    const liveData =
      await apiGet(
        "/fixtures?live=all"
      );

    const fixtures =
      liveData?.response || [];

    stats.analisados +=
      fixtures.length;

    console.log(
      `⚽ Jogos ao vivo: ${fixtures.length}`
    );

    const candidates =
      fixtures
        .filter(preFilter)
        .sort((a, b) => {
          const ga =
            number(a.goals?.home) +
            number(a.goals?.away);

          const gb =
            number(b.goals?.home) +
            number(b.goals?.away);

          return ga - gb;
        });

    console.log(
      `🎯 Jogos dentro das janelas: ${candidates.length}`
    );

    let processed = 0;

    for (const fixture of candidates) {
      if (
        processed >= MAX_STATS_PER_CYCLE
      ) {
        break;
      }

      const id =
        fixture.fixture.id;

      // Não busca dados novamente para
      // um jogo que já recebeu alerta.
      if (
        alertedFixtures.has(id)
      ) {
        continue;
      }

      try {
        const data =
          await getLiveData(
            fixture
          );

        processed++;

        const analysis =
          calculateScore(
            fixture,
            data
          );

        if (!analysis) {
          continue;
        }

        stats.janelas++;

        console.log(
          `📊 ${teamNames(fixture).home} x ${teamNames(fixture).away} | ` +
          `${analysis.minute}' | ` +
          `${analysis.corners} cantos | ` +
          `Proj ${analysis.projection} | ` +
          `Score ${analysis.score}`
        );

        const minimum =
          analysis.window === "EARLY"
            ? MIN_EARLY_SCORE
            : MIN_LATE_SCORE;

        if (
          analysis.score >=
          minimum - 8
        ) {
          stats.candidatos++;
        }

        if (
          analysis.score >=
          minimum
        ) {
          const sent =
            await sendRadarAlert(
              fixture,
              analysis
            );

          if (sent) {
            alertedFixtures.add(id);
          }
        }

      } catch (error) {
        console.log(
          `⚠️ Erro no jogo ${id}:`,
          error.message
        );
      }
    }

    lastRadarRun =
      new Date().toISOString();

    radarStatus =
      "OPERACIONAL";

    console.log(
      `✅ Radar concluído | API ${apiRequestsToday}/${DAILY_API_BUDGET}`
    );

  } catch (error) {
    console.log(
      "❌ Erro geral Radar:",
      error.message
    );

    radarStatus =
      error.message ===
      "LIMITE_DIARIO_API_ATINGIDO"
        ? "LIMITE API ATINGIDO"
        : "ERRO";
  } finally {
    radarRunning = false;
  }
}

// ============================================================
// RELATÓRIO DIÁRIO
// ============================================================

async function sendDailyReport() {
  resetDailyIfNeeded();

  const today =
    todayBRTKey();

  if (
    lastReportDate === today
  ) {
    return;
  }

  const lastSignals =
    history.slice(-5);

  let signalsText =
    "Nenhum sinal registrado.";

  if (lastSignals.length) {
    signalsText =
      lastSignals
        .map(
          (x, i) =>
            `${i + 1}. ${x.home} x ${x.away} — ${x.minute}' — ${x.level} ${x.score}/100`
        )
        .join("\n");
  }

  const message = `
📊 <b>RELATÓRIO ELITE RADAR V6.4</b>

📅 ${today}

⚽ Jogos analisados: <b>${stats.analisados}</b>
⏱️ Janelas encontradas: <b>${stats.janelas}</b>
🎯 Candidatos: <b>${stats.candidatos}</b>

🚨 Alertas: <b>${stats.alertas}</b>
👑 ELITE: <b>${stats.elite}</b>
🔥 FORTES: <b>${stats.fortes}</b>

🌅 Early: <b>${stats.earlyAlerts}</b>
🌙 Late: <b>${stats.lateAlerts}</b>

💰 Greens registrados: <b>${stats.greens}</b>
🔴 Reds registrados: <b>${stats.reds}</b>

🔄 API utilizada:
<b>${apiRequestsToday}/${DAILY_API_BUDGET}</b>

🔑 Chaves disponíveis:
<b>${API_KEYS.length}</b>

⏱️ Intervalo:
<b>${RADAR_INTERVAL_MIN} minutos</b>

🎯 Score mínimo Early:
<b>${MIN_EARLY_SCORE}</b>

🎯 Score mínimo Late:
<b>${MIN_LATE_SCORE}</b>

📌 <b>Últimos sinais:</b>

${signalsText}

⚠️ <i>O relatório mostra desempenho do radar, não garantia de lucro.</i>
`;

  const sent =
    await sendTelegram(message);

  if (sent) {
    lastReportDate = today;
  }
}

// ============================================================
// VERIFICAÇÃO DO RELATÓRIO 23:00 BRT
// ============================================================

function checkDailyReport() {
  const now =
    getBRTNow();

  const hour =
    now.getHours();

  const minute =
    now.getMinutes();

  if (
    hour === 23 &&
    minute >= 0 &&
    minute <= 10
  ) {
    sendDailyReport()
      .catch(error =>
        console.log(
          "Erro relatório:",
          error.message
        )
      );
  }
}

// ============================================================
// ROTAS
// ============================================================

app.get("/", (req, res) => {
  res.json({
    system:
      "ELITE RADAR V6.4",

    status:
      radarStatus,

    apiKeys:
      API_KEYS.length,

    apiUsed:
      apiRequestsToday,

    apiBudget:
      DAILY_API_BUDGET,

    intervalMinutes:
      RADAR_INTERVAL_MIN,

    earlyScore:
      MIN_EARLY_SCORE,

    lateScore:
      MIN_LATE_SCORE,

    lastRadarRun,

    alerts:
      stats.alertas
  });
});

// ============================================================
// EXECUTAR RADAR MANUALMENTE
// ============================================================

app.get("/radar/run", async (req, res) => {
  if (radarRunning) {
    return res.json({
      ok: false,
      message:
        "Radar já está executando."
    });
  }

  runRadar();

  res.json({
    ok: true,
    message:
      "Radar iniciado.",
    apiUsed:
      apiRequestsToday,
    apiBudget:
      DAILY_API_BUDGET
  });
});

// ============================================================
// TESTE RELATÓRIO
// ============================================================

app.get(
  "/report/test",
  async (req, res) => {
    try {
      const old =
        lastReportDate;

      lastReportDate = null;

      await sendDailyReport();

      // Se quiser testar novamente,
      // pode chamar a rota novamente.
      if (!old) {
        lastReportDate = old;
      }

      res.json({
        ok: true,
        message:
          "Relatório de teste enviado."
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
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,

    system:
      "ELITE RADAR V6.4",

    status:
      radarStatus,

    running:
      radarRunning,

    apiKeys:
      API_KEYS.length,

    apiRequestsToday,

    dailyBudget:
      DAILY_API_BUDGET,

    remaining:
      Math.max(
        0,
        DAILY_API_BUDGET -
        apiRequestsToday
      ),

    lastRadarRun,

    alerts:
      stats.alertas,

    history:
      history.length,

    uptime:
      Math.round(
        process.uptime()
      )
  });
});

// ============================================================
// SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log(
    "===================================="
  );

  console.log(
    "🚨 ELITE RADAR V6.4 ONLINE"
  );

  console.log(
    `🌐 Porta: ${PORT}`
  );

  console.log(
    `🔑 Chaves API: ${API_KEYS.length}`
  );

  console.log(
    `📊 Limite diário configurado: ${DAILY_API_BUDGET}`
  );

  console.log(
    `⏱️ Intervalo: ${RADAR_INTERVAL_MIN} min`
  );

  console.log(
    `🎯 Early: ${MIN_EARLY_SCORE}`
  );

  console.log(
    `🎯 Late: ${MIN_LATE_SCORE}`
  );

  console.log(
    "===================================="
  );

  resetDailyIfNeeded();

  // Primeira execução
  setTimeout(() => {
    runRadar();
  }, 5000);
});

// ============================================================
// LOOP PRINCIPAL
// ============================================================

setInterval(
  () => {
    runRadar().catch(error => {
      console.log(
        "Erro no loop:",
        error.message
      );
    });
  },
  RADAR_INTERVAL_MIN * 60 * 1000
);

// ============================================================
// VERIFICA RELATÓRIO A CADA MINUTO
// ============================================================

setInterval(() => {
  checkDailyReport();
}, 60 * 1000);
