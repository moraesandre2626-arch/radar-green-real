// ============================================================
// ELITE RADAR V24 - PRESSÃO INTELIGENTE
// ============================================================
// FOCO:
// PRESSÃO REAL NO 1º TEMPO
// -> CHUTES
// -> CHUTES NO ALVO
// -> POSSE
// -> ATAQUES PERIGOSOS
// -> xG
// -> CHUTES DENTRO DA ÁREA
// -> CHUTES BLOQUEADOS
// -> GRANDES CHANCES
// -> DIFERENÇA DE VOLUME
// -> PLACAR
//
// OBJETIVO:
// Encontrar jogos com forte pressão ofensiva no 1º tempo
// visando oportunidade de ESCANTEIOS NO 2º TEMPO.
//
// IMPORTANTE:
// A quantidade de escanteios do 1º tempo NÃO influencia
// o score e NÃO elimina o jogo.
//
// SCORE MÍNIMO: 65
// VARREDURA: 20 MINUTOS
// RELATÓRIO: 23H BRT
//
// EFO_IDS:
// Chave de análise configurada no Render.
// A chave é lida por process.env.EFO_IDS
// e NÃO fica exposta no código.
//
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
// CHAVE DE ANÁLISE
// ============================================================

const EFO_IDS = (
  process.env.EFO_IDS ||
  ""
).trim();

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const SCORE_MINIMO = 65;

const INTERVALO_MINUTOS = 20;

const DELAY_SOFASCORE = 6000;

const TIMEOUT = 12000;

const TIMEOUT_PROXY = 18000;

const CACHE_TTL = 30000;

const COOLDOWN_403 = 120000;

let ULTIMO_CHECK = "Nunca";

let TOTAL_ENVIADOS = 0;

let TOTAL_ANALISADOS = 0;

let TOTAL_CANDIDATOS = 0;

let TOTAL_ERROS_403 = 0;

let ULTIMO_ERRO = "Nenhum";

let ULTIMO_STATUS_API = "Nunca";

let BLOQUEADO_ATE = 0;

let JOGOS_JA_AVISADOS = new Set();

let CACHE_STATS = new Map();

let RELATORIO_ENVIADO_HOJE = false;

let DIA_RELATORIO = "";

// ============================================================
// FUNÇÕES BÁSICAS
// ============================================================

function dormir(ms) {

  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });

}

// ============================================================
// NÚMERO SEGURO
// ============================================================

function numero(v) {

  if (v == null) {
    return 0;
  }

  if (typeof v === "number") {

    return isFinite(v)
      ? v
      : 0;

  }

  const n = parseFloat(
    String(v)
      .replace("%", "")
      .replace(",", ".")
  );

  return isFinite(n)
    ? n
    : 0;

}

// ============================================================
// TEXTO SEGURO
// ============================================================

function textoSeguro(v) {

  return String(v || "")
    .replace(/[*_`\[\]]/g, "");

}

// ============================================================
// HORÁRIO BRASIL
// ============================================================

function agoraBrasil() {

  return new Date(
    new Date().toLocaleString(
      "en-US",
      {
        timeZone:
          "America/Sao_Paulo"
      }
    )
  );

}

// ============================================================
// PODE RODAR
// ============================================================

function podeRodarAgora() {

  const agora =
    agoraBrasil();

  const h =
    agora.getHours();

  const d =
    agora.getDay();

  const fimDeSemana =
    d === 0 ||
    d === 6;

  if (fimDeSemana) {

    return (
      h >= 8 &&
      h < 24
    );

  }

  return (
    h >= 12 &&
    h < 24
  );

}

// ============================================================
// HORÁRIO TEXTO
// ============================================================

function horarioTexto() {

  const d =
    agoraBrasil().getDay();

  return (
    d === 0 ||
    d === 6
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
        chat_id:
          CHAT_ID,

        text:
          texto,

        parse_mode:
          "Markdown"
      },
      {
        timeout:
          10000
      }
    );

    TOTAL_ENVIADOS++;

    return true;

  } catch (e) {

    console.log(
      "ERRO TELEGRAM:",
      e.response?.data ||
      e.message
    );

    return false;
  }

}

// ============================================================
// HEADERS SOFASCORE
// ============================================================

const HEADERS = {

  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",

  "Accept":
    "application/json,text/plain,*/*",

  "Referer":
    "https://www.sofascore.com/",

  "Origin":
    "https://www.sofascore.com",

  "Connection":
    "keep-alive"
};

// ============================================================
// CACHE
// ============================================================

function cacheGet(url) {

  const item =
    CACHE_STATS.get(url);

  if (!item) {
    return null;
  }

  if (
    Date.now() -
    item.timestamp >
    CACHE_TTL
  ) {

    CACHE_STATS.delete(url);

    return null;
  }

  return item.data;

}

function cacheSet(url, data) {

  CACHE_STATS.set(
    url,
    {
      timestamp:
        Date.now(),

      data
    }
  );

}

// ============================================================
// GET SOFASCORE
// ============================================================

async function getSofascore(url) {

  // ----------------------------------------------------------
  // COOLDOWN GLOBAL
  // ----------------------------------------------------------

  if (
    Date.now() <
    BLOQUEADO_ATE
  ) {

    const segundos =
      Math.ceil(
        (
          BLOQUEADO_ATE -
          Date.now()
        ) / 1000
      );

    throw new Error(
      `SofaScore em cooldown por 403 (${segundos}s)`
    );
  }

  // ----------------------------------------------------------
  // CACHE
  // ----------------------------------------------------------

  const cached =
    cacheGet(url);

  if (cached) {

    console.log(
      "CACHE OK:",
      url
    );

    return cached;
  }

  // ----------------------------------------------------------
  // ACESSO DIRETO
  // ----------------------------------------------------------

  try {

    const resposta =
      await axios.get(
        url,
        {
          headers:
            HEADERS,

          timeout:
            TIMEOUT,

          validateStatus:
            status =>
              status >= 200 &&
              status < 500
        }
      );

    if (
      resposta.status === 200
    ) {

      cacheSet(
        url,
        resposta.data
      );

      ULTIMO_STATUS_API =
        "SofaScore direto OK";

      return resposta.data;
    }

    if (
      resposta.status === 403
    ) {

      TOTAL_ERROS_403++;

      BLOQUEADO_ATE =
        Date.now() +
        COOLDOWN_403;

      console.log(
        "403 SofaScore direto."
      );

      console.log(
        `Cooldown: ${COOLDOWN_403 / 1000}s`
      );

    } else {

      console.log(
        `SofaScore HTTP ${resposta.status}`
      );
    }

  } catch (e) {

    console.log(
      "Erro acesso direto:",
      e.message
    );
  }

  // ----------------------------------------------------------
  // PROXY 1
  // ----------------------------------------------------------

  if (
    Date.now() <
    BLOQUEADO_ATE
  ) {

    console.log(
      "Tentando proxy apesar do cooldown..."
    );

  }

  try {

    const proxyUrl =
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

    const resposta =
      await axios.get(
        proxyUrl,
        {
          timeout:
            TIMEOUT_PROXY
        }
      );

    let dados =
      resposta.data;

    if (
      typeof dados ===
      "string"
    ) {

      dados =
        JSON.parse(dados);

    }

    cacheSet(
      url,
      dados
    );

    ULTIMO_STATUS_API =
      "Proxy 1 OK";

    console.log(
      "Proxy 1 funcionou!"
    );

    return dados;

  } catch (e) {

    console.log(
      "Proxy 1 falhou:",
      e.message
    );
  }

  // ----------------------------------------------------------
  // PROXY 2
  // ----------------------------------------------------------

  try {

    const proxyUrl2 =
      `https://corsproxy.io/?${encodeURIComponent(url)}`;

    const resposta3 =
      await axios.get(
        proxyUrl2,
        {
          headers:
            HEADERS,

          timeout:
            TIMEOUT_PROXY
        }
      );

    let dados =
      resposta3.data;

    if (
      typeof dados ===
      "string"
    ) {

      dados =
        JSON.parse(dados);

    }

    cacheSet(
      url,
      dados
    );

    ULTIMO_STATUS_API =
      "Proxy 2 OK";

    console.log(
      "Proxy 2 funcionou!"
    );

    return dados;

  } catch (e) {

    console.log(
      "Proxy 2 falhou:",
      e.message
    );
  }

  throw new Error(
    "SofaScore indisponível após acesso direto + proxies"
  );

}

// ============================================================
// EXTRAIR ESTATÍSTICAS
// ============================================================

function extrairEstatisticas(periodo) {

  const dados = {

    escanteios: 0,

    cantosCasa: 0,
    cantosFora: 0,

    chutes: 0,

    chutesCasa: 0,
    chutesFora: 0,

    chutesNoAlvo: 0,

    alvoCasa: 0,
    alvoFora: 0,

    bloqueadosCasa: 0,
    bloqueadosFora: 0,

    dentroAreaCasa: 0,
    dentroAreaFora: 0,

    foraAreaCasa: 0,
    foraAreaFora: 0,

    ataquesPerigososCasa: 0,
    ataquesPerigososFora: 0,

    ataquesCasa: 0,
    ataquesFora: 0,

    posseCasa: 0,
    posseFora: 0,

    xGCasa: 0,
    xGFora: 0,

    grandesChancesCasa: 0,
    grandesChancesFora: 0

  };

  for (
    const grupo of
    periodo?.groups || []
  ) {

    for (
      const item of
      grupo.statisticsItems || []
    ) {

      const nome =
        String(
          item.name || ""
        )
          .toLowerCase()
          .trim();

      const home =
        numero(item.home);

      const away =
        numero(item.away);

      // ------------------------------------------------------
      // ESCANTEIOS
      // NÃO ENTRA NO SCORE
      // ------------------------------------------------------

      if (
        nome.includes("corner") ||
        nome.includes("escanteio")
      ) {

        dados.escanteios +=
          home + away;

        dados.cantosCasa +=
          home;

        dados.cantosFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // xG
      // ------------------------------------------------------

      if (
        nome === "expected goals" ||
        nome === "xg" ||
        nome.includes(
          "expected goals"
        )
      ) {

        dados.xGCasa =
          home;

        dados.xGFora =
          away;

        continue;
      }

      // ------------------------------------------------------
      // TOTAL SHOTS
      // ------------------------------------------------------

      if (
        nome === "total shots" ||
        nome === "shots" ||
        nome.includes(
          "total shots"
        )
      ) {

        dados.chutes +=
          home + away;

        dados.chutesCasa +=
          home;

        dados.chutesFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS ON TARGET
      // ------------------------------------------------------

      if (
        nome.includes(
          "shots on target"
        ) ||
        nome.includes(
          "shots on goal"
        ) ||
        nome === "on target"
      ) {

        dados.chutesNoAlvo +=
          home + away;

        dados.alvoCasa +=
          home;

        dados.alvoFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // BLOCKED SHOTS
      // ------------------------------------------------------

      if (
        nome.includes(
          "blocked shots"
        ) ||
        nome.includes(
          "shots blocked"
        )
      ) {

        dados.bloqueadosCasa +=
          home;

        dados.bloqueadosFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS INSIDE BOX
      // ------------------------------------------------------

      if (
        nome.includes(
          "shots inside box"
        ) ||
        nome.includes(
          "shots inside penalty area"
        ) ||
        nome.includes(
          "inside box"
        )
      ) {

        dados.dentroAreaCasa +=
          home;

        dados.dentroAreaFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // SHOTS OUTSIDE BOX
      // ------------------------------------------------------

      if (
        nome.includes(
          "shots outside box"
        ) ||
        nome.includes(
          "outside box"
        )
      ) {

        dados.foraAreaCasa +=
          home;

        dados.foraAreaFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // ATAQUES PERIGOSOS
      // ------------------------------------------------------

      if (
        nome.includes(
          "dangerous attacks"
        )
      ) {

        dados.ataquesPerigososCasa +=
          home;

        dados.ataquesPerigososFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // ATAQUES
      // ------------------------------------------------------

      if (
        nome === "attacks"
      ) {

        dados.ataquesCasa +=
          home;

        dados.ataquesFora +=
          away;

        continue;
      }

      // ------------------------------------------------------
      // POSSE
      // ------------------------------------------------------

      if (
        nome.includes(
          "ball possession"
        ) ||
        nome === "possession"
      ) {

        dados.posseCasa =
          home;

        dados.posseFora =
          away;

        continue;
      }

      // ------------------------------------------------------
      // GRANDES CHANCES
      // ------------------------------------------------------

      if (
        nome.includes(
          "big chances"
        )
      ) {

        dados.grandesChancesCasa +=
          home;

        dados.grandesChancesFora +=
          away;

        continue;
      }

    }
  }

  return dados;

}

// ============================================================
// ANALISAR PRESSÃO V24
// ============================================================

function analisarPressao(
  dados,
  jogo
) {

  let bonus = 0;

  const motivos = [];

  const casa =
    dados.chutesCasa;

  const fora =
    dados.chutesFora;

  const totalChutes =
    dados.chutes;

  const totalAlvo =
    dados.chutesNoAlvo;

  const maiorChute =
    Math.max(
      casa,
      fora
    );

  const menorChute =
    Math.min(
      casa,
      fora
    );

  const diferencaChutes =
    maiorChute -
    menorChute;

  const maiorPosse =
    Math.max(
      dados.posseCasa,
      dados.posseFora
    );

  const diferencaPosse =
    Math.abs(
      dados.posseCasa -
      dados.posseFora
    );

  // ==========================================================
  // VOLUME TOTAL
  // ==========================================================

  if (
    totalChutes >= 18
  ) {

    bonus += 12;

    motivos.push(
      "💥 volume muito alto de chutes"
    );

  } else if (
    totalChutes >= 15
  ) {

    bonus += 10;

    motivos.push(
      "🔥 volume alto de chutes"
    );

  } else if (
    totalChutes >= 12
  ) {

    bonus += 8;

    motivos.push(
      "🎯 bom volume de chutes"
    );

  } else if (
    totalChutes >= 9
  ) {

    bonus += 5;

    motivos.push(
      "🎯 volume interessante"
    );

  }

  // ==========================================================
  // PRESSÃO FORTE DE UM LADO
  // ==========================================================

  if (
    maiorChute >= 10 &&
    diferencaChutes >= 5
  ) {

    bonus += 15;

    motivos.push(
      "🔥 pressão muito forte de um lado"
    );

  } else if (
    maiorChute >= 9 &&
    diferencaChutes >= 4
  ) {

    bonus += 12;

    motivos.push(
      "🔥 pressão forte de um lado"
    );

  } else if (
    maiorChute >= 7 &&
    diferencaChutes >= 3
  ) {

    bonus += 8;

    motivos.push(
      "📈 vantagem clara nas finalizações"
    );

  }

  // ==========================================================
  // PRESSÃO BILATERAL
  // ==========================================================

  if (
    casa >= 6 &&
    fora >= 6
  ) {

    bonus += 10;

    motivos.push(
      "🔥 pressão ofensiva bilateral"
    );

  } else if (
    casa >= 5 &&
    fora >= 4
  ) {

    bonus += 7;

    motivos.push(
      "⚔️ jogo com pressão dos dois lados"
    );

  }

  // ==========================================================
  // CHUTES NO ALVO
  // ==========================================================

  if (
    totalAlvo >= 7
  ) {

    bonus += 10;

    motivos.push(
      "🥅 muitos chutes no alvo"
    );

  } else if (
    totalAlvo >= 5
  ) {

    bonus += 8;

    motivos.push(
      "🥅 bom volume no alvo"
    );

  } else if (
    totalAlvo >= 3
  ) {

    bonus += 5;

    motivos.push(
      "🥅 presença no alvo"
    );

  } else if (
    maiorChute >= 9
  ) {

    motivos.push(
      "⚠️ volume alto apesar de poucos no alvo"
    );

  }

  // ==========================================================
  // POSSE + CHUTES
  // ==========================================================

  if (
    maiorPosse >= 65 &&
    maiorChute >= 8
  ) {

    bonus += 10;

    motivos.push(
      "📊 domínio de posse + finalizações"
    );

  } else if (
    maiorPosse >= 60 &&
    maiorChute >= 7
  ) {

    bonus += 7;

    motivos.push(
      "📊 posse favorável + volume"
    );

  }

  // ==========================================================
  // DIFERENÇA DE POSSE
  // ==========================================================

  if (
    diferencaPosse >= 20 &&
    maiorChute >= 7
  ) {

    bonus += 7;

    motivos.push(
      "📈 grande domínio territorial"
    );

  }

  // ==========================================================
  // ATAQUES PERIGOSOS
  // ==========================================================

  const ataquesPerigosos =
    dados.ataquesPerigososCasa +
    dados.ataquesPerigososFora;

  if (
    ataquesPerigosos >= 80
  ) {

    bonus += 10;

    motivos.push(
      "⚔️ ataques perigosos muito altos"
    );

  } else if (
    ataquesPerigosos >= 60
  ) {

    bonus += 8;

    motivos.push(
      "⚔️ ataques perigosos elevados"
    );

  } else if (
    ataquesPerigosos >= 40
  ) {

    bonus += 4;

    motivos.push(
      "⚔️ ataques perigosos presentes"
    );

  }

  // ==========================================================
  // ATAQUE PERIGOSO DE UM LADO
  // ==========================================================

  const maiorAtaque =
    Math.max(
      dados.ataquesPerigososCasa,
      dados.ataquesPerigososFora
    );

  const menorAtaque =
    Math.min(
      dados.ataquesPerigososCasa,
      dados.ataquesPerigososFora
    );

  if (
    maiorAtaque >= 45 &&
    maiorAtaque >=
      menorAtaque + 20
  ) {

    bonus += 8;

    motivos.push(
      "🔥 forte domínio territorial de um lado"
    );

  }

  // ==========================================================
  // xG
  // ==========================================================

  const xGTotal =
    dados.xGCasa +
    dados.xGFora;

  if (
    xGTotal >= 1.20
  ) {

    bonus += 10;

    motivos.push(
      `🧠 xG muito bom (${xGTotal.toFixed(2)})`
    );

  } else if (
    xGTotal >= 0.80
  ) {

    bonus += 8;

    motivos.push(
      `🧠 xG bom (${xGTotal.toFixed(2)})`
    );

  } else if (
    xGTotal >= 0.45
  ) {

    bonus += 5;

    motivos.push(
      `🧠 xG presente (${xGTotal.toFixed(2)})`
    );

  }

  // ==========================================================
  // xG DOMINANTE
  // ==========================================================

  const maiorXG =
    Math.max(
      dados.xGCasa,
      dados.xGFora
    );

  const menorXG =
    Math.min(
      dados.xGCasa,
      dados.xGFora
    );

  if (
    maiorXG >= 0.55 &&
    maiorXG >=
      menorXG + 0.35
  ) {

    bonus += 7;

    motivos.push(
      "🎯 superioridade clara de xG"
    );

  }

  // ==========================================================
  // DENTRO DA ÁREA
  // ==========================================================

  const dentroArea =
    dados.dentroAreaCasa +
    dados.dentroAreaFora;

  if (
    dentroArea >= 8
  ) {

    bonus += 8;

    motivos.push(
      "🎯 muitas finalizações dentro da área"
    );

  } else if (
    dentroArea >= 5
  ) {

    bonus += 5;

    motivos.push(
      "🎯 presença dentro da área"
    );

  }

  // ==========================================================
  // BLOQUEADOS
  // ==========================================================

  const bloqueados =
    dados.bloqueadosCasa +
    dados.bloqueadosFora;

  if (
    bloqueados >= 6
  ) {

    bonus += 6;

    motivos.push(
      "🧱 muitas finalizações bloqueadas"
    );

  } else if (
    bloqueados >= 4
  ) {

    bonus += 4;

    motivos.push(
      "🧱 finalizações bloqueadas"
    );

  }

  // ==========================================================
  // GRANDES CHANCES
  // ==========================================================

  const grandesChances =
    dados.grandesChancesCasa +
    dados.grandesChancesFora;

  if (
    grandesChances >= 3
  ) {

    bonus += 8;

    motivos.push(
      "🚨 muitas grandes chances"
    );

  } else if (
    grandesChances >= 2
  ) {

    bonus += 5;

    motivos.push(
      "🚨 grandes chances criadas"
    );

  }

  // ==========================================================
  // PLACAR
  // ==========================================================

  const golsCasa =
    numero(
      jogo.homeScore?.current
    );

  const golsFora =
    numero(
      jogo.awayScore?.current
    );

  const diferencaGols =
    Math.abs(
      golsCasa -
      golsFora
    );

  // ----------------------------------------------------------
  // 0 X 0
  // ----------------------------------------------------------

  if (
    golsCasa === 0 &&
    golsFora === 0
  ) {

    bonus += 8;

    motivos.push(
      "⚖️ 0–0 mantém necessidade de gol"
    );

  } else if (
    golsCasa === golsFora
  ) {

    bonus += 5;

    motivos.push(
      "⚖️ jogo empatado"
    );

  }

  // ==========================================================
  // PERDEDOR PRESSIONANDO
  // ==========================================================

  if (
    diferencaGols === 1
  ) {

    const casaPerdendo =
      golsCasa < golsFora;

    const foraPerdendo =
      golsFora < golsCasa;

    const casaPressiona =
      casaPerdendo &&
      casa >= fora + 3;

    const foraPressiona =
      foraPerdendo &&
      fora >= casa + 3;

    if (
      casaPressiona ||
      foraPressiona
    ) {

      bonus += 8;

      motivos.push(
        "🔥 equipe perdedora está pressionando"
      );

    }

  }

  // ==========================================================
  // PLACAR MUITO LARGO
  // ==========================================================

  if (
    diferencaGols >= 3
  ) {

    bonus -= 8;

    motivos.push(
      "🧊 placar muito largo"
    );

  }

  // ==========================================================
  // POSSE SEM PRODUÇÃO
  // ==========================================================

  if (
    maiorPosse >= 65 &&
    maiorChute <= 5
  ) {

    bonus -= 12;

    motivos.push(
      "⚠️ posse alta sem finalização"
    );

  }

  // ==========================================================
  // VOLUME MUITO BAIXO
  // ==========================================================

  if (
    totalChutes <= 5
  ) {

    bonus -= 15;

    motivos.push(
      "🧊 ritmo ofensivo muito baixo"
    );

  }

  return {

    bonus,

    motivos

  };

}

// ============================================================
// SCORE V24
// ============================================================

function calcularScore(
  dados,
  jogo
) {

  let score = 25;

  const motivos = [];

  motivos.push(
    "🧠 análise combinada de pressão"
  );

  const pressao =
    analisarPressao(
      dados,
      jogo
    );

  score +=
    pressao.bonus;

  motivos.push(
    ...pressao.motivos
  );

  // ==========================================================
  // ESCANTEIOS NÃO ALTERAM SCORE
  // ==========================================================

  motivos.push(
    "🚩 escanteios do 1ºT não interferem no score"
  );

  score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
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
    JOGOS_JA_AVISADOS.has(
      jogo.id
    )
  ) {

    return;

  }

  TOTAL_ANALISADOS++;

  await dormir(
    DELAY_SOFASCORE
  );

  try {

    const url =
      `https://api.sofascore.com/api/v1/event/${jogo.id}/statistics`;

    const data =
      await getSofascore(
        url
      );

    // ========================================================
    // PRIMEIRO TEMPO
    // ========================================================

    const periodo =
      (
        data?.statistics ||
        []
      ).find(
        p =>
          p.period === "1ST"
      );

    if (!periodo) {

      console.log(
        `Jogo ${jogo.id} sem estatísticas do 1º tempo.`
      );

      return;

    }

    const dados =
      extrairEstatisticas(
        periodo
      );

    // ========================================================
    // FILTRO MÍNIMO
    //
    // SOMENTE VOLUME.
    // ESCANTEIOS NÃO ENTRAM.
    // ========================================================

    if (
      dados.chutes < 7
    ) {

      console.log(
        `${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} | ` +
        `descartado: ${dados.chutes} chutes`
      );

      return;

    }

    TOTAL_CANDIDATOS++;

    // ========================================================
    // SCORE
    // ========================================================

    const resultado =
      calcularScore(
        dados,
        jogo
      );

    console.log(
      `\n${jogo.homeTeam?.name} x ${jogo.awayTeam?.name}`
    );

    console.log(
      `C:${dados.escanteios} | ` +
      `CH:${dados.chutes} | ` +
      `ALVO:${dados.chutesNoAlvo} | ` +
      `POSSE:${dados.posseCasa}%/${dados.posseFora}% | ` +
      `ATAQUES:${dados.ataquesPerigososCasa}/${dados.ataquesPerigososFora} | ` +
      `xG:${dados.xGCasa.toFixed(2)}/${dados.xGFora.toFixed(2)} | ` +
      `SCORE:${resultado.score}`
    );

    console.log(
      "MOTIVOS:",
      resultado.motivos.join(
        " | "
      )
    );

    // ========================================================
    // SCORE MÍNIMO
    // ========================================================

    if (
      resultado.score <
      SCORE_MINIMO
    ) {

      console.log(
        `❌ abaixo do mínimo: ${resultado.score}`
      );

      return;

    }

    // ========================================================
    // DADOS DO JOGO
    // ========================================================

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

    // ========================================================
    // MENSAGEM TELEGRAM
    // ========================================================

    const mensagem =
`🚨 *ELITE RADAR V24 — PRESSÃO DETECTADA* 🚨

⚽ *${casa} ${golsCasa} x ${golsFora} ${fora}*

⏱️ *INTERVALO*

━━━━━━━━━━━━━━━━━━

📊 *ESTATÍSTICAS DO 1º TEMPO*

🎯 Chutes: *${dados.chutes}*
🥅 No alvo: *${dados.chutesNoAlvo}*

🏠 *${casa}*
🎯 ${dados.chutesCasa} chutes
🥅 ${dados.alvoCasa} no alvo
📊 ${dados.posseCasa}% posse
⚔️ ${dados.ataquesPerigososCasa} ataques perigosos

✈️ *${fora}*
🎯 ${dados.chutesFora} chutes
🥅 ${dados.alvoFora} no alvo
📊 ${dados.posseFora}% posse
⚔️ ${dados.ataquesPerigososFora} ataques perigosos

🧠 xG:
🏠 ${dados.xGCasa.toFixed(2)} x ${dados.xGFora.toFixed(2)} ✈️

🎯 Dentro da área:
🏠 ${dados.dentroAreaCasa} x ${dados.dentroAreaFora} ✈️

🧱 Bloqueados:
🏠 ${dados.bloqueadosCasa} x ${dados.bloqueadosFora} ✈️

🚨 Grandes chances:
🏠 ${dados.grandesChancesCasa} x ${dados.grandesChancesFora} ✈️

🚩 Escanteios 1ºT:
*${dados.escanteios}*

━━━━━━━━━━━━━━━━━━

🔥 *PRESSÃO IDENTIFICADA*

${resultado.motivos.join("\n")}

━━━━━━━━━━━━━━━━━━

⭐ *SCORE: ${resultado.score}/100*

${classificacao(resultado.score)}

🎯 *PERFIL*
*PRESSÃO → ESCANTEIOS NO 2º TEMPO*

🚩 Escanteios já ocorridos:
*IGNORADOS NO SCORE*

⚠️ *Sinal estatístico. Não é garantia de entrada.*

🕐 ${ULTIMO_CHECK}`;

    // ========================================================
    // ENVIAR
    // ========================================================

    if (
      await sendTelegram(
        mensagem
      )
    ) {

      JOGOS_JA_AVISADOS.add(
        jogo.id
      );

      console.log(
        "✅ SINAL V24 ENVIADO"
      );

    }

    // ========================================================
    // LIMPAR CACHE ANTIGO
    // ========================================================

    if (
      JOGOS_JA_AVISADOS.size >
      300
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

  if (
    !podeRodarAgora()
  ) {

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
    `\n[${ULTIMO_CHECK}] V24 buscando jogos...`
  );

  try {

    const data =
      await getSofascore(
        "https://api.sofascore.com/api/v1/sport/football/events/live"
      );

    const jogos =
      data?.events ||
      [];

    console.log(
      `Ao vivo: ${jogos.length}`
    );

    // ========================================================
    // SOMENTE INTERVALO
    // ========================================================

    const intervalo =
      jogos.filter(
        j =>
          j.status?.code === 31 ||
          j.status?.type ===
            "halftime"
      );

    console.log(
      `Intervalo: ${intervalo.length}`
    );

    // ========================================================
    // ANALISAR
    // ========================================================

    for (
      const jogo of intervalo
    ) {

      await analisarJogo(
        jogo
      );

    }

    ULTIMO_ERRO =
      "Nenhum - SofaScore OK";

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
// RELATÓRIO DIÁRIO
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
    DIA_RELATORIO !==
    diaAtual
  ) {

    RELATORIO_ENVIADO_HOJE =
      false;

    DIA_RELATORIO =
      diaAtual;

    TOTAL_ANALISADOS =
      0;

    TOTAL_CANDIDATOS =
      0;

    TOTAL_ENVIADOS =
      0;

    TOTAL_ERROS_403 =
      0;

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
`📊 *ELITE RADAR V24 — RELATÓRIO DIÁRIO*

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
*PRESSÃO → ESCANTEIOS 2º TEMPO*

📊 Fatores analisados:
*chutes*
*no alvo*
*posse*
*ataques perigosos*
*xG*
*dentro da área*
*bloqueados*
*grandes chances*
*placar*

🚩 Escanteios do 1º tempo:
*IGNORADOS NO SCORE*

⏱️ Varredura:
*a cada 20 minutos*

🛡️ Proteções:
*volume mínimo + placar + anti-spam*

🛡️ 403 detectados:
*${TOTAL_ERROS_403}*

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

setInterval(
  verificarJogosAoVivo,
  INTERVALO_MINUTOS *
    60 *
    1000
);

setInterval(
  verificarRelatorioDiario,
  30 *
    1000
);

// ============================================================
// PRIMEIRA EXECUÇÃO
// ============================================================

verificarJogosAoVivo();

verificarRelatorioDiario();

// ============================================================
// STATUS
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      status:
        "ELITE RADAR V24 ONLINE",

      versao:
        "V24",

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

      ultimo_status_api:
        ULTIMO_STATUS_API,

      erros_403:
        TOTAL_ERROS_403,

      cooldown_403:
        Date.now() <
        BLOQUEADO_ATE,

      efo_ids_configurado:
        !!EFO_IDS,

      intervalo:
        "20 minutos",

      estrategia:
        "Pressão ofensiva -> escanteios 2º tempo",

      estatisticas:
        "Chutes + alvo + posse + ataques perigosos + xG + domínio + placar",

      escanteios_no_score:
        false,

      horario:
        "Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",

      relatorio:
        "Todos os dias às 23h BRT",

      pode_rodar:
        podeRodarAgora()

    });

  }
);

// ============================================================
// API STATUS
// ============================================================

app.get(
  "/api-status",
  (req, res) => {

    res.json({

      online:
        true,

      versao:
        "V24",

      efo_ids:
        EFO_IDS
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO",

      telegram:
        TOKEN && CHAT_ID
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO",

      sofascore:
        ULTIMO_STATUS_API,

      ultimo_erro:
        ULTIMO_ERRO,

      erros_403:
        TOTAL_ERROS_403,

      cooldown:
        Date.now() <
        BLOQUEADO_ATE,

      ultimo_check:
        ULTIMO_CHECK,

      analisados:
        TOTAL_ANALISADOS,

      candidatos:
        TOTAL_CANDIDATOS,

      enviados:
        TOTAL_ENVIADOS,

      cache:
        CACHE_STATS.size,

      jogos_avistados:
        JOGOS_JA_AVISADOS.size

    });

  }
);

// ============================================================
// TESTE TELEGRAM
// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {

    const ok =
      await sendTelegram(
`✅ *ELITE RADAR V24 — TESTE OK*

🔥 PRESSÃO INTELIGENTE

🎯 Chutes
🥅 No alvo
📊 Posse
⚔️ Ataques perigosos
🧠 xG
🎯 Dentro da área
🧱 Bloqueados
🚨 Grandes chances
⚽ Placar

🚩 Escanteios do 1ºT:
*IGNORADOS NO SCORE*

⭐ Score mínimo:
${SCORE_MINIMO}

🎯 Estratégia:
*PRESSÃO → ESCANTEIOS 2º TEMPO*

⏱️ Varredura:
20 minutos

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
// LIMPAR CACHE DE JOGOS AVISADOS
// ============================================================

app.get(
  "/limpar-cache",
  (req, res) => {

    const antes =
      JOGOS_JA_AVISADOS.size;

    JOGOS_JA_AVISADOS.clear();

    res.json({

      ok:
        true,

      antes,

      depois:
        0

    });

  }
);

// ============================================================
// LIMPAR CACHE DE ESTATÍSTICAS
// ============================================================

app.get(
  "/limpar-stats-cache",
  (req, res) => {

    const antes =
      CACHE_STATS.size;

    CACHE_STATS.clear();

    res.json({

      ok:
        true,

      antes,

      depois:
        0

    });

  }
);

// ============================================================
// RESETAR COOLDOWN
// ============================================================

app.get(
  "/reset-api",
  (req, res) => {

    BLOQUEADO_ATE =
      0;

    ULTIMO_ERRO =
      "Cooldown resetado manualmente";

    res.json({

      ok:
        true,

      cooldown:
        false,

      mensagem:
        "Cooldown da API resetado"

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
      `🚀 ELITE RADAR V24 RODANDO NA PORTA ${PORT}`
    );

    console.log(
      `⭐ Score mínimo: ${SCORE_MINIMO}`
    );

    console.log(
      `⏱️ Varredura: ${INTERVALO_MINUTOS} minutos`
    );

    console.log(
      `🚩 Escanteios no score: NÃO`
    );

    console.log(
      `🔑 EFO_IDS: ${
        EFO_IDS
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      `📱 Telegram: ${
        TOKEN && CHAT_ID
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

  }
);
