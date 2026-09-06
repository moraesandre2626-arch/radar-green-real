const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API = process.env.API_FOOTBALL;

const BANKROLL_START = Number(process.env.BANCA || 100);
const STAKE_PERCENT = Number(process.env.STAKE_PERCENT || 0.02);
const ODDS = Number(process.env.ODDS || 1.80);

// Linha asiática de escanteios:
// 1.0 = Over 1.0
// 0.5 = Over 0.5
// 1.5 = Over 1.5
const CORNERS_LINE = Number(process.env.CORNERS_LINE || 1.0);

const LINK = "https://www.bet365.bet.br/hub/in-play";

const DATA_DIR = process.env.RENDER
  ? "/tmp/elite-radar-data"
  : path.join(__dirname, "data");

const DATA_FILE = path.join(DATA_DIR, "signals.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

let sinais = loadSignals();
let alertados = new Set();
let pendentes = new Map();

let ultimoDia = getDateBR();
let ultimoRelatorioEnviado = "";

let jogosAnalisadosHoje = 0;
let alertasEnviadosHoje = 0;
let greensHoje = 0;
let redsHoje = 0;
let voidsHoje = 0;


// ======================================================
// BANCO DE DADOS
// ======================================================

function loadSignals() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];

    return JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

  } catch (e) {
    console.error("Erro ao carregar banco:", e.message);
    return [];
  }
}


function saveSignals() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(sinais, null, 2)
    );

  } catch (e) {
    console.error("Erro ao salvar banco:", e.message);
  }
}


// ======================================================
// DATA / HORA
// ======================================================

function getDateBR(date = new Date()) {
  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}


function getTimeBR(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });
}


function resetIfNewDay() {

  const hoje = getDateBR();

  if (hoje !== ultimoDia) {

    ultimoDia = hoje;

    alertados.clear();
    pendentes.clear();

    jogosAnalisadosHoje = 0;
    alertasEnviadosHoje = 0;
    greensHoje = 0;
    redsHoje = 0;
    voidsHoje = 0;

    console.log("Novo dia:", hoje);
  }
}


// ======================================================
// TELEGRAM
// ======================================================

async function enviar(msg) {

  if (!TOKEN || !CHAT_ID) {
    console.log("Telegram não configurado.");
    return false;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: msg,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      },
      {
        timeout: 10000
      }
    );

    return true;

  } catch (e) {

    console.error(
      "Erro Telegram:",
      e.response?.data || e.message
    );

    return false;
  }
}


// ======================================================
// API FOOTBALL
// ======================================================

async function apiGet(url, params = {}) {

  const r = await axios.get(url, {

    params,

    headers: {
      "x-apisports-key": API
    },

    timeout: 15000
  });

  return r.data;
}


// ======================================================
// UTILITÁRIOS
// ======================================================

function num(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const n = parseInt(
    String(value).replace("%", ""),
    10
  );

  return Number.isFinite(n)
    ? n
    : 0;
}


function getStat(teamStats, type) {

  const item = teamStats?.find(
    x => x.type === type
  );

  return item
    ? num(item.value)
    : 0;
}


// ======================================================
// EXTRAÇÃO DAS ESTATÍSTICAS
// ======================================================

function extractStats(response) {

  if (
    !Array.isArray(response) ||
    response.length < 2
  ) {
    return null;
  }

  const home =
    response[0].statistics || [];

  const away =
    response[1].statistics || [];


  return {

    home: {

      corners:
        getStat(home, "Corner Kicks"),

      shots:
        getStat(home, "Total Shots"),

      shotsOn:
        getStat(home, "Shots on Goal"),

      shotsOff:
        getStat(home, "Shots off Goal"),

      blocked:
        getStat(home, "Blocked Shots"),

      dangerous:
        getStat(home, "Dangerous Attacks"),

      attacks:
        getStat(home, "Attacks"),

      possession:
        getStat(home, "Ball Possession")
    },


    away: {

      corners:
        getStat(away, "Corner Kicks"),

      shots:
        getStat(away, "Total Shots"),

      shotsOn:
        getStat(away, "Shots on Goal"),

      shotsOff:
        getStat(away, "Shots off Goal"),

      blocked:
        getStat(away, "Blocked Shots"),

      dangerous:
        getStat(away, "Dangerous Attacks"),

      attacks:
        getStat(away, "Attacks"),

      possession:
        getStat(away, "Ball Possession")
    }
  };
}


function total(stats, key) {

  return (
    (stats.home[key] || 0) +
    (stats.away[key] || 0)
  );
}


// ======================================================
// PRESSÃO
// ======================================================

function calculatePressure(stats, minute) {

  const dangerous =
    total(stats, "dangerous");

  const attacks =
    total(stats, "attacks");

  const shots =
    total(stats, "shots");

  const shotsOn =
    total(stats, "shotsOn");

  const blocked =
    total(stats, "blocked");


  const minutes =
    Math.max(minute, 1);


  const dangerousPerMinute =
    dangerous / minutes;

  const attacksPerMinute =
    attacks / minutes;

  const shotsPerMinute =
    shots / minutes;


  let score = 0;


  // Ataques perigosos por minuto

  if (dangerousPerMinute >= 1.2) {

    score += 18;

  } else if (dangerousPerMinute >= 0.9) {

    score += 13;

  } else if (dangerousPerMinute >= 0.65) {

    score += 8;
  }


  // Ataques por minuto

  if (attacksPerMinute >= 2.5) {

    score += 12;

  } else if (attacksPerMinute >= 1.8) {

    score += 8;

  } else if (attacksPerMinute >= 1.2) {

    score += 5;
  }


  // Finalizações por minuto

  if (shotsPerMinute >= 0.16) {

    score += 15;

  } else if (shotsPerMinute >= 0.11) {

    score += 10;

  } else if (shotsPerMinute >= 0.08) {

    score += 5;
  }


  // Chutes no alvo

  if (shotsOn >= 5) {

    score += 10;

  } else if (shotsOn >= 3) {

    score += 6;
  }


  // Bloqueios

  if (blocked >= 4) {

    score += 10;

  } else if (blocked >= 2) {

    score += 5;
  }


  return Math.min(score, 65);
}


// ======================================================
// SCORE PRINCIPAL
// ======================================================

function calculateScore(jogo, stats) {

  const minute =
    jogo.fixture.status.elapsed || 0;


  const corners =
    total(stats, "corners");

  const dangerous =
    total(stats, "dangerous");

  const shots =
    total(stats, "shots");

  const shotsOn =
    total(stats, "shotsOn");

  const blocked =
    total(stats, "blocked");


  const diff =
    Math.abs(
      num(jogo.goals.home) -
      num(jogo.goals.away)
    );


  let score = 0;


  // ====================================================
  // 1. RITMO DE ESCANTEIOS
  // ====================================================

  const cornerRate =
    corners /
    Math.max(minute, 1);


  if (cornerRate >= 0.105) {

    score += 20;

  } else if (cornerRate >= 0.085) {

    score += 16;

  } else if (cornerRate >= 0.07) {

    score += 10;

  } else if (cornerRate >= 0.055) {

    score += 5;
  }


  // ====================================================
  // 2. PRESSÃO
  // ====================================================

  score += Math.round(
    calculatePressure(
      stats,
      minute
    ) * 0.35
  );


  // ====================================================
  // 3. FINALIZAÇÕES
  // ====================================================

  if (shots >= 18) {

    score += 10;

  } else if (shots >= 13) {

    score += 7;

  } else if (shots >= 9) {

    score += 4;
  }


  // ====================================================
  // 4. CHUTES NO ALVO
  // ====================================================

  if (shotsOn >= 7) {

    score += 8;

  } else if (shotsOn >= 5) {

    score += 5;

  } else if (shotsOn >= 3) {

    score += 2;
  }


  // ====================================================
  // 5. CHUTES BLOQUEADOS
  // ====================================================

  if (blocked >= 5) {

    score += 8;

  } else if (blocked >= 3) {

    score += 5;
  }


  // ====================================================
  // 6. ATAQUES PERIGOSOS
  // ====================================================

  if (dangerous >= 100) {

    score += 12;

  } else if (dangerous >= 80) {

    score += 9;

  } else if (dangerous >= 60) {

    score += 5;
  }


  // ====================================================
  // 7. PLACAR
  // ====================================================

  if (diff === 0) {

    score += 10;

  } else if (diff === 1) {

    score += 6;

  } else {

    score -= 8;
  }


  // ====================================================
  // 8. MINUTAGEM
  // ====================================================

  if (minute >= 82) {

    score += 6;

  } else if (minute >= 78) {

    score += 4;

  } else {

    score += 2;
  }


  return Math.max(
    0,
    Math.min(100, score)
  );
}


// ======================================================
// CLASSIFICAÇÃO
// ======================================================

function classify(score) {

  if (score >= 82)
    return "ELITE";

  if (score >= 76)
    return "FORTE";

  if (score >= 70)
    return "OBSERVAÇÃO";

  return null;
}


// ======================================================
// PROBABILIDADE DO MODELO
// ======================================================

function modelProbability(score) {

  if (score >= 90)
    return 0.86;

  if (score >= 85)
    return 0.83;

  if (score >= 82)
    return 0.80;

  if (score >= 79)
    return 0.77;

  if (score >= 76)
    return 0.74;

  if (score >= 73)
    return 0.71;

  return 0.68;
}


// ======================================================
// BANCA
// ======================================================

function getStake() {

  const current =
    getCurrentBankroll();

  return Number(
    (
      current *
      STAKE_PERCENT
    ).toFixed(2)
  );
}


function getCurrentBankroll() {

  let banca =
    BANKROLL_START;


  for (const s of sinais) {

    if (s.status === "GREEN") {

      banca +=
        Number(s.profit || 0);

    } else if (s.status === "RED") {

      banca -=
        Number(
          s.loss ||
          s.stake ||
          0
        );
    }
  }


  return Number(
    banca.toFixed(2)
  );
}


function formatStake(value) {

  return Number(value)
    .toFixed(2)
    .replace(".", ",");
}


// ======================================================
// ANÁLISE DO JOGO
// ======================================================

async function analisaPro(jogo) {

  const minute =
    jogo.fixture.status.elapsed;


  if (
    !minute ||
    minute < 75 ||
    minute > 88
  ) {
    return null;
  }


  const status =
    jogo.fixture.status.short;


  if (
    ![
      "1H",
      "2H",
      "ET",
      "LIVE"
    ].includes(status)
  ) {
    return null;
  }


  const id =
    jogo.fixture.id;


  if (
    alertados.has(id)
  ) {
    return null;
  }


  try {

    const data =
      await apiGet(
        "https://v3.football.api-sports.io/fixtures/statistics",
        {
          fixture: id
        }
      );


    const stats =
      extractStats(
        data.response
      );


    if (!stats)
      return null;


    jogosAnalisadosHoje++;


    const corners =
      total(
        stats,
        "corners"
      );


    const dangerous =
      total(
        stats,
        "dangerous"
      );


    const shots =
      total(
        stats,
        "shots"
      );


    const shotsOn =
      total(
        stats,
        "shotsOn"
      );


    const blocked =
      total(
        stats,
        "blocked"
      );


    const diff =
      Math.abs(
        num(jogo.goals.home) -
        num(jogo.goals.away)
      );


    // ==================================================
    // FILTROS
    // ==================================================

    if (
      corners < 5 ||
      corners > 9
    ) {
      return null;
    }


    if (diff >= 2) {
      return null;
    }


    if (dangerous < 55) {
      return null;
    }


    if (shots < 7) {
      return null;
    }


    const pressureScore =
      calculatePressure(
        stats,
        minute
      );


    const score =
      calculateScore(
        jogo,
        stats
      );


    const nivel =
      classify(score);


    if (!nivel) {
      return null;
    }


    const prob =
      modelProbability(
        score
      );


    // Filtro especial ELITE

    if (nivel === "ELITE") {

      if (pressureScore < 25)
        return null;

      if (dangerous < 70)
        return null;
    }


    const nome =
      `${jogo.teams.home.name} x ${jogo.teams.away.name}`;


    const sinal = {

      id,

      fixtureId: id,

      nome,

      data:
        getDateBR(),

      hora:
        getTimeBR(),

      minute,

      placar:
        `${jogo.goals.home}-${jogo.goals.away}`,

      cornersInitial:
        corners,

      dangerousInitial:
        dangerous,

      shotsInitial:
        shots,

      shotsOnInitial:
        shotsOn,

      blockedInitial:
        blocked,

      pressureScore,

      score,

      nivel,

      probability:
        prob,

      oddsReference:
        ODDS,

      stake:
        getStake(),

      status:
        "PENDENTE",

      createdAt:
        Date.now()
    };


    alertados.add(id);

    pendentes.set(
      id,
      sinal
    );


    sinais.push(sinal);

    saveSignals();


    alertasEnviadosHoje++;


    return sinal;


  } catch (e) {

    console.error(
      `Erro análise ${jogo.fixture.id}:`,
      e.message
    );

    return null;
  }
}


// ======================================================
// ENVIO DO ALERTA
// ======================================================

async function enviarAlerta(sinal) {

  const emoji =
    sinal.nivel === "ELITE"
      ? "💎"
      : "🔥";


  const prob =
    Math.round(
      sinal.probability * 100
    );


  const msg =
`${emoji} *${sinal.nivel} — ${sinal.score}/100*

🏟️ *${sinal.nome}*
⏱️ ${sinal.minute}'
⚽ Placar: ${sinal.placar}

🚩 Escanteios: *${sinal.cornersInitial}*
🔥 Ataques perigosos: ${sinal.dangerousInitial}
🎯 Finalizações: ${sinal.shotsInitial}
🥅 No alvo: ${sinal.shotsOnInitial}
🛡️ Bloqueados: ${sinal.blockedInitial}
📈 Pressão: ${sinal.pressureScore}/65

🧠 Prob. estimada do modelo: *${prob}%*

💰 Stake: *R$${formatStake(sinal.stake)}*
🎯 Mercado: *Over ${CORNERS_LINE} escanteio(s)*

🔗 [BET365](${LINK})

_Probabilidade é estimativa interna do modelo e não garantia de resultado._`;


  await enviar(msg);
}


// ======================================================
// STATUS FINAL DA PARTIDA
// ======================================================

async function getFixtureStatus(
  fixtureId
) {

  try {

    const data =
      await apiGet(
        "https://v3.football.api-sports.io/fixtures",
        {
          id: fixtureId
        }
      );


    return (
      data.response?.[0]
        ?.fixture?.status?.short
      || null
    );


  } catch (e) {

    console.error(
      `Erro status ${fixtureId}:`,
      e.message
    );

    return null;
  }
}


// ======================================================
// LIQUIDAÇÃO ASIÁTICA
// ======================================================

function settleAsianOver1(
  addedCorners,
  line
) {

  // ================================================
  // OVER 0.5
  // 1+ = GREEN
  // 0 = RED
  // ================================================

  if (line === 0.5) {

    return addedCorners >= 1
      ? "GREEN"
      : "RED";
  }


  // ================================================
  // OVER 1.0 ASIÁTICO
  //
  // 2+ = GREEN
  // 1 = DEVOLUÇÃO
  // 0 = RED
  // ================================================

  if (line === 1) {

    if (addedCorners >= 2)
      return "GREEN";

    if (addedCorners === 1)
      return "VOID";

    return "RED";
  }


  // ================================================
  // OVER 1.5
  //
  // 2+ = GREEN
  // 0/1 = RED
  // ================================================

  if (line === 1.5) {

    return addedCorners >= 2
      ? "GREEN"
      : "RED";
  }


  // Fallback para outras linhas

  if (
    addedCorners > line
  ) {
    return "GREEN";
  }


  if (
    Number.isInteger(line) &&
    addedCorners === line
  ) {
    return "VOID";
  }


  return "RED";
}


// ======================================================
// CONFERÊNCIA DOS RESULTADOS
// ======================================================

async function confereGreen() {

  resetIfNewDay();


  for (
    const [id, sinal]
    of pendentes
  ) {

    try {

      /*
        A partida precisa terminar antes
        de ser liquidada.
      */

      const status =
        await getFixtureStatus(id);


      const finalStatuses = [
        "FT",
        "AET",
        "PEN"
      ];


      if (
        !finalStatuses.includes(
          status
        )
      ) {
        continue;
      }


      const data =
        await apiGet(
          "https://v3.football.api-sports.io/fixtures/statistics",
          {
            fixture: id
          }
        );


      const stats =
        extractStats(
          data.response
        );


      if (!stats)
        continue;


      const finalCorners =
        total(
          stats,
          "corners"
        );


      const diffCorners =
        finalCorners -
        sinal.cornersInitial;


      const resultado =
        settleAsianOver1(
          diffCorners,
          CORNERS_LINE
        );


      sinal.finalCorners =
        finalCorners;


      sinal.cornersAdded =
        diffCorners;


      sinal.finishedAt =
        Date.now();


      sinal.fixtureStatus =
        status;


      sinal.marketLine =
        CORNERS_LINE;


      sinal.status =
        resultado;


      // ==============================================
      // GREEN
      // ==============================================

      if (
        resultado === "GREEN"
      ) {

        sinal.profit =
          Number(
            (
              sinal.stake *
              (ODDS - 1)
            ).toFixed(2)
          );


        greensHoje++;


        await enviar(
`✅ *GREEN — ${sinal.nivel}!*

🏟️ ${sinal.nome}
⏱️ Entrada: ${sinal.minute}'
🚩 ${sinal.cornersInitial} ➡️ ${finalCorners} cantos
📈 +${diffCorners} canto(s)

🎯 Linha: Over ${CORNERS_LINE}
💰 Lucro estimado: *R$${formatStake(sinal.profit)}*`
        );
      }


      // ==============================================
      // DEVOLUÇÃO
      // ==============================================

      else if (
        resultado === "VOID"
      ) {

        sinal.profit = 0;

        voidsHoje++;


        await enviar(
`↩️ *DEVOLUÇÃO — ${sinal.nivel}*

🏟️ ${sinal.nome}
⏱️ Entrada: ${sinal.minute}'
🚩 ${sinal.cornersInitial} ➡️ ${finalCorners} cantos
📈 +${diffCorners} canto

🎯 Linha: Over ${CORNERS_LINE}
💰 Stake devolvida: *R$${formatStake(sinal.stake)}*`
        );
      }


      // ==============================================
      // RED
      // ==============================================

      else {

        sinal.loss =
          sinal.stake;


        redsHoje++;


        await enviar(
`❌ *RED — ${sinal.nivel}*

🏟️ ${sinal.nome}
⏱️ Entrada: ${sinal.minute}'
🚩 ${sinal.cornersInitial} ➡️ ${finalCorners} cantos
📉 +${diffCorners} canto(s)

🎯 Linha: Over ${CORNERS_LINE}`
        );
      }


      saveSignals();

      pendentes.delete(id);


    } catch (e) {

      console.error(
        `Erro conferindo ${id}:`,
        e.message
      );
    }
  }
}


// ======================================================
// ESTATÍSTICAS DO DIA
// ======================================================

function statsDoDia() {

  const hoje =
    getDateBR();


  const arr =
    sinais.filter(
      s => s.data === hoje
    );


  const greens =
    arr.filter(
      s => s.status === "GREEN"
    ).length;


  const reds =
    arr.filter(
      s => s.status === "RED"
    ).length;


  const voids =
    arr.filter(
      s => s.status === "VOID"
    ).length;


  const pendentesCount =
    arr.filter(
      s => s.status === "PENDENTE"
    ).length;


  const total =
    greens + reds;


  const taxa =
    total > 0
      ? (greens / total) * 100
      : 0;


  const lucro =
    arr.reduce(
      (sum, s) => {

        if (
          s.status === "GREEN"
        ) {
          return (
            sum +
            Number(
              s.profit || 0
            )
          );
        }


        if (
          s.status === "RED"
        ) {
          return (
            sum -
            Number(
              s.loss ||
              s.stake ||
              0
            )
          );
        }


        return sum;

      },
      0
    );


  const elite =
    arr.filter(
      s => s.nivel === "ELITE"
    );


  const eliteG =
    elite.filter(
      s => s.status === "GREEN"
    ).length;


  const eliteR =
    elite.filter(
      s => s.status === "RED"
    ).length;


  const forte =
    arr.filter(
      s => s.nivel === "FORTE"
    );


  const forteG =
    forte.filter(
      s => s.status === "GREEN"
    ).length;


  const forteR =
    forte.filter(
      s => s.status === "RED"
    ).length;


  return {

    arr,

    greens,

    reds,

    voids,

    pendentes:
      pendentesCount,

    total,

    taxa,

    lucro,

    eliteG,

    eliteR,

    forteG,

    forteR
  };
}


// ======================================================
// RELATÓRIO 23H
// ======================================================

async function verificaHorarioRelatorio() {

  resetIfNewDay();


  const agora =
    new Date();


  const partes =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Sao_Paulo",

        hour: "2-digit",

        minute: "2-digit",

        hour12: false
      }
    ).formatToParts(
      agora
    );


  const h =
    Number(
      partes.find(
        x => x.type === "hour"
      )?.value
    );


  const m =
    Number(
      partes.find(
        x => x.type === "minute"
      )?.value
    );


  const data =
    getDateBR();


  if (
    h === 23 &&
    m >= 0 &&
    m < 5 &&
    ultimoRelatorioEnviado !== data
  ) {

    const s =
      statsDoDia();


    const msg =
`📊 *RELATÓRIO 23H — RADAR ELITE*

📅 ${data}

🔍 Jogos analisados: *${jogosAnalisadosHoje}*
💎 Alertas: *${alertasEnviadosHoje}*

✅ GREEN: *${s.greens}*
❌ RED: *${s.reds}*
↩️ DEVOLUÇÕES: *${s.voids}*
⏳ Pendentes: *${s.pendentes}*

🎯 *ASSERTIVIDADE: ${s.taxa.toFixed(1)}%*

🎯 Linha: *Over ${CORNERS_LINE}*

💎 ELITE: ${s.eliteG}G / ${s.eliteR}R
🔥 FORTE: ${s.forteG}G / ${s.forteR}R

💰 Resultado estimado: *R$${formatStake(s.lucro)}*
🏦 Banca estimada: *R$${formatStake(getCurrentBankroll())}*

_Números servem para avaliação do modelo; não representam garantia de lucro._`;


    await enviar(msg);


    ultimoRelatorioEnviado =
      data;
  }
}


// ======================================================
// RADAR
// ======================================================

async function radar() {

  resetIfNewDay();


  if (!API) {

    console.error(
      "API_FOOTBALL não configurada."
    );

    return;
  }


  try {

    const data =
      await apiGet(
        "https://v3.football.api-sports.io/fixtures",
        {
          live: "all"
        }
      );


    const jogos =
      data.response || [];


    console.log(
      `[${getTimeBR()}] Radar: ${jogos.length} jogos ao vivo`
    );


    for (
      const jogo of jogos
    ) {

      const sinal =
        await analisaPro(
          jogo
        );


      if (sinal) {

        await enviarAlerta(
          sinal
        );
      }
    }


  } catch (e) {

    console.error(
      "Erro no radar:",
      e.response?.data ||
      e.message
    );
  }
}


// ======================================================
// ROTAS
// ======================================================

app.get("/", (req, res) => {

  resetIfNewDay();

  const s =
    statsDoDia();


  res.json({

    status:
      "ELITE RADAR V2 ONLINE",

    hora:
      getTimeBR(),

    data:
      getDateBR(),

    analisadosHoje:
      jogosAnalisadosHoje,

    alertasHoje:
      alertasEnviadosHoje,

    greens:
      s.greens,

    reds:
      s.reds,

    voids:
      s.voids,

    pendentes:
      s.pendentes,

    assertividade:
      `${s.taxa.toFixed(1)}%`,

    bancaAtual:
      getCurrentBankroll()
  });
});


app.get(
  "/teste",
  async (req, res) => {

    const s =
      statsDoDia();


    await enviar(
`🔔 *TESTE RADAR ELITE V2*

🔍 Analisados: ${jogosAnalisadosHoje}
💎 Alertas: ${alertasEnviadosHoje}
✅ ${s.greens} GREEN
❌ ${s.reds} RED
↩️ ${s.voids} DEVOLUÇÕES
🎯 Assertividade: ${s.taxa.toFixed(1)}%
🏦 Banca estimada: R$${formatStake(getCurrentBankroll())}`
    );


    res.send(
      "Teste enviado."
    );
  }
);


app.get(
  "/relatorio",
  async (req, res) => {

    const s =
      statsDoDia();


    await enviar(
`📊 *RELATÓRIO MANUAL — RADAR ELITE*

🔍 ${jogosAnalisadosHoje} analisados
💎 ${alertasEnviadosHoje} alertas

✅ ${s.greens} GREEN
❌ ${s.reds} RED
↩️ ${s.voids} DEVOLUÇÕES
⏳ ${s.pendentes} pendentes

🎯 Assertividade: *${s.taxa.toFixed(1)}%*
🎯 Linha: *Over ${CORNERS_LINE}*

💰 Resultado: *R$${formatStake(s.lucro)}*
🏦 Banca: *R$${formatStake(getCurrentBankroll())}*`
    );


    res.send(
      "Relatório enviado."
    );
  }
);


app.get(
  "/stats",
  (req, res) => {

    const s =
      statsDoDia();


    res.json({

      data:
        getDateBR(),

      analisadosHoje:
        jogosAnalisadosHoje,

      alertasHoje:
        alertasEnviadosHoje,

      greens:
        s.greens,

      reds:
        s.reds,

      voids:
        s.voids,

      pendentes:
        s.pendentes,

      assertividade:
        Number(
          s.taxa.toFixed(2)
        ),

      lucroEstimado:
        Number(
          s.lucro.toFixed(2)
        ),

      bancaAtual:
        getCurrentBankroll(),

      elite: {

        green:
          s.eliteG,

        red:
          s.eliteR
      },

      forte: {

        green:
          s.forteG,

        red:
          s.forteR
      }
    });
  }
);


app.get(
  "/sinais",
  (req, res) => {

    res.json(
      sinais
        .slice(-100)
        .reverse()
    );
  }
);


// ======================================================
// INTERVALOS
// ======================================================

// Analisa jogos a cada 2 minutos
setInterval(
  radar,
  2 * 60 * 1000
);


// Confere resultados a cada 5 minutos
setInterval(
  confereGreen,
  5 * 60 * 1000
);


// Verifica relatório das 23h
setInterval(
  verificaHorarioRelatorio,
  60 * 1000
);


// ======================================================
// INICIALIZAÇÃO
// ======================================================

(async () => {

  console.log(
    "===================================="
  );

  console.log(
    "   ELITE RADAR V2 INICIANDO..."
  );

  console.log(
    "===================================="
  );


  console.log(
    "Data:",
    getDateBR()
  );


  console.log(
    "Hora:",
    getTimeBR()
  );


  console.log(
    "Banca inicial:",
    BANKROLL_START
  );


  console.log(
    "Stake:",
    STAKE_PERCENT * 100 + "%"
  );


  console.log(
    "Odds referência:",
    ODDS
  );


  console.log(
    "Linha de escanteios:",
    `Over ${CORNERS_LINE}`
  );


  console.log(
    "API configurada:",
    !!API
  );


  console.log(
    "Telegram configurado:",
    !!TOKEN && !!CHAT_ID
  );


  await radar();


  app.listen(
    PORT,
    () => {

      console.log(
        `ELITE RADAR V2 ON na porta ${PORT}`
      );

    }
  );

})();
