// ============================================================
// ELITE RADAR V24 - API-FOOTBALL
// PRESSÃO INTELIGENTE -> ESCANTEIOS NO 2º TEMPO
// ============================================================
// FONTE:
// API-FOOTBALL / API-SPORTS
//
// REGRAS:
// - API key somente no Render: EFO_IDS
// - Máximo local: 99 requisições/dia
// - Varredura: a cada 20 minutos
// - 1 chamada para jogos ao vivo
// - 1 chamada em lote para até 20 jogos HT
// - Estatísticas de escanteios NÃO entram no score
// - Score mínimo: 65
// - Relatório diário: 23:00 BRT
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const API_KEY = (process.env.EFO_IDS || "").trim();

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  "";

const CHAT_ID =
  process.env.CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID ||
  "";

const API_BASE = "https://v3.football.api-sports.io";

const MAX_REQUESTS_DAY = 99;

const INTERVALO_SCAN_MS = 20 * 60 * 1000;

const SCORE_MINIMO = 65;

const TIMEOUT_API = 12000;

const MAX_FIXTURES_BATCH = 20;

// ============================================================
// ESTADO
// ============================================================

let requisicoesHoje = 0;
let ultimaRespostaAPI = null;
let ultimoErro = null;
let ultimoScan = null;
let proximoScan = null;

let jogosAnalisados = 0;
let candidatosEncontrados = 0;
let alertasEnviados = 0;

let protecoes = 0;
let erros403 = 0;

let ultimoResetUTC = null;

const JOGOS_JA_AVISADOS = new Set();

const CACHE_FIXTURES = new Map();

const CACHE_TTL = 60 * 1000;

// ============================================================
// LOG
// ============================================================

function log(...args) {
  console.log(
    new Date().toISOString(),
    ...args
  );
}

// ============================================================
// DATA / HORA
// ============================================================

function agoraUTC() {
  return new Date();
}

function dataUTC() {
  return new Date().toISOString().slice(0, 10);
}

function horaBRT() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function dataBRT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// ============================================================
// RESET DIÁRIO
// IMPORTANTE:
// API-FOOTBALL trabalha com quota diária.
// O reset oficial é baseado no sistema deles.
// Mantemos nosso contador separado para nunca passar de 99.
// ============================================================

function verificarResetDiario() {
  const hoje = dataUTC();

  if (ultimoResetUTC !== hoje) {
    ultimoResetUTC = hoje;

    requisicoesHoje = 0;

    jogosAnalisados = 0;
    candidatosEncontrados = 0;
    alertasEnviados = 0;

    protecoes = 0;
    erros403 = 0;

    JOGOS_JA_AVISADOS.clear();

    log("🔄 CONTADOR DIÁRIO RESETADO:", hoje);
  }
}

// ============================================================
// PODE CONSULTAR API?
// ============================================================

function podeConsultarAPI() {
  verificarResetDiario();

  if (!API_KEY) {
    ultimoErro = "EFO_IDS não configurado no Render.";
    return false;
  }

  if (requisicoesHoje >= MAX_REQUESTS_DAY) {
    protecoes++;

    ultimoErro =
      `Limite interno de segurança atingido: ${MAX_REQUESTS_DAY}/dia.`;

    log("🛑 LIMITE DE SEGURANÇA ATINGIDO");

    return false;
  }

  return true;
}

// ============================================================
// REGISTRA REQUISIÇÃO
// ============================================================

function registrarRequisicao(response) {
  requisicoesHoje++;

  ultimaRespostaAPI = new Date();

  if (response && response.headers) {
    const restante =
      response.headers["x-ratelimit-requests-remaining"];

    if (restante !== undefined) {
      log(
        `📊 API informou restante: ${restante}`
      );
    }
  }

  log(
    `📡 REQUISIÇÃO API ${requisicoesHoje}/${MAX_REQUESTS_DAY}`
  );
}

// ============================================================
// CLIENTE API-FOOTBALL
// ============================================================

async function apiGet(endpoint, params = {}) {
  if (!podeConsultarAPI()) {
    throw new Error("LIMITE_API_INTERNO");
  }

  try {
    const response = await axios.get(
      `${API_BASE}${endpoint}`,
      {
        params,
        timeout: TIMEOUT_API,
        headers: {
          "x-apisports-key": API_KEY,
          "Accept": "application/json"
        },
        validateStatus: () => true
      }
    );

    registrarRequisicao(response);

    if (response.status === 403) {
      erros403++;

      ultimoErro =
        "API respondeu 403.";

      throw new Error("API_403");
    }

    if (response.status === 429) {
      ultimoErro =
        "API respondeu 429 - limite de requisições.";

      throw new Error("API_429");
    }

    if (response.status < 200 || response.status >= 300) {
      ultimoErro =
        `API respondeu HTTP ${response.status}`;

      throw new Error(
        `API_HTTP_${response.status}`
      );
    }

    const data = response.data;

    if (data.errors && Object.keys(data.errors).length > 0) {
      ultimoErro =
        JSON.stringify(data.errors);

      throw new Error(
        "API_ERRORS"
      );
    }

    return data;

  } catch (error) {

    if (
      error.message !== "API_403" &&
      error.message !== "API_429" &&
      error.message !== "LIMITE_API_INTERNO" &&
      error.message !== "API_ERRORS"
    ) {
      ultimoErro = error.message;
    }

    throw error;
  }
}

// ============================================================
// BUSCAR JOGOS AO VIVO
// ============================================================

async function buscarJogosAoVivo() {

  const cacheKey = "live";

  const cache = CACHE_FIXTURES.get(cacheKey);

  if (
    cache &&
    Date.now() - cache.timestamp < CACHE_TTL
  ) {
    return cache.data;
  }

  const data = await apiGet(
    "/fixtures",
    {
      live: "all"
    }
  );

  const jogos =
    Array.isArray(data.response)
      ? data.response
      : [];

  CACHE_FIXTURES.set(
    cacheKey,
    {
      timestamp: Date.now(),
      data: jogos
    }
  );

  return jogos;
}

// ============================================================
// IDENTIFICAR INTERVALO
// ============================================================

function estaNoIntervalo(jogo) {

  const status =
    jogo?.fixture?.status?.short;

  return status === "HT";
}

// ============================================================
// BUSCA DADOS EM LOTE
// ATÉ 20 IDS POR CHAMADA
// ============================================================

async function buscarDetalhesEmLote(ids) {

  if (!ids.length) {
    return [];
  }

  const resultados = [];

  for (
    let i = 0;
    i < ids.length;
    i += MAX_FIXTURES_BATCH
  ) {

    const lote =
      ids.slice(
        i,
        i + MAX_FIXTURES_BATCH
      );

    if (!podeConsultarAPI()) {
      break;
    }

    const idsString =
      lote.join("-");

    log(
      `📦 Buscando lote com ${lote.length} jogos`
    );

    const data =
      await apiGet(
        "/fixtures",
        {
          ids: idsString
        }
      );

    if (
      Array.isArray(data.response)
    ) {
      resultados.push(
        ...data.response
      );
    }
  }

  return resultados;
}

// ============================================================
// PEGAR ESTATÍSTICA PELO NOME
// ============================================================

function numero(valor) {

  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  if (
    typeof valor === "number"
  ) {
    return valor;
  }

  const texto =
    String(valor)
      .replace("%", "")
      .replace(",", ".")
      .trim();

  const n =
    parseFloat(texto);

  return Number.isFinite(n)
    ? n
    : 0;
}

// ============================================================
// NORMALIZAR ESTATÍSTICAS
// ============================================================

function extrairEstatisticas(jogo) {

  const lista =
    jogo.statistics;

  if (
    !Array.isArray(lista) ||
    lista.length < 2
  ) {
    return null;
  }

  const casa =
    lista[0];

  const fora =
    lista[1];

  function pegarTime(
    bloco,
    nomes
  ) {

    const stats =
      Array.isArray(bloco.statistics)
        ? bloco.statistics
        : [];

    for (const nome of nomes) {

      const item =
        stats.find(
          s =>
            String(s.type)
              .toLowerCase() ===
            String(nome)
              .toLowerCase()
        );

      if (item) {
        return numero(item.value);
      }
    }

    return 0;
  }

  const home = {
    chutes: pegarTime(
      casa,
      ["Total Shots"]
    ),

    alvo: pegarTime(
      casa,
      ["Shots on Goal"]
    ),

    bloqueados: pegarTime(
      casa,
      ["Blocked Shots"]
    ),

    dentroArea: pegarTime(
      casa,
      ["Shots insidebox"]
    ),

    posse: pegarTime(
      casa,
      ["Ball Possession"]
    ),

    ataquesPerigosos: 0,

    xg: 0,

    grandesChances: 0,

    escanteios: pegarTime(
      casa,
      ["Corner Kicks"]
    )
  };

  const away = {
    chutes: pegarTime(
      fora,
      ["Total Shots"]
    ),

    alvo: pegarTime(
      fora,
      ["Shots on Goal"]
    ),

    bloqueados: pegarTime(
      fora,
      ["Blocked Shots"]
    ),

    dentroArea: pegarTime(
      fora,
      ["Shots insidebox"]
    ),

    posse: pegarTime(
      fora,
      ["Ball Possession"]
    ),

    ataquesPerigosos: 0,

    xg: 0,

    grandesChances: 0,

    escanteios: pegarTime(
      fora,
      ["Corner Kicks"]
    )
  };

  // Algumas competições/API podem não fornecer
  // dangerous attacks, xG ou big chances nas estatísticas.
  //
  // Eles permanecem 0 quando não estão disponíveis.
  //
  // Isso é intencional: NÃO inventamos números.

  return {
    home,
    away
  };
}

// ============================================================
// PRESSÃO
// ============================================================

function analisarPressao(dados) {

  const h = dados.home;
  const a = dados.away;

  let bonus = 0;
  const fatores = [];

  const totalChutes =
    h.chutes + a.chutes;

  const maxChutes =
    Math.max(
      h.chutes,
      a.chutes
    );

  const minChutes =
    Math.min(
      h.chutes,
      a.chutes
    );

  const diffChutes =
    maxChutes -
    minChutes;

  // ----------------------------------------------------------
  // CHUTES TOTAIS
  // ----------------------------------------------------------

  if (totalChutes >= 18) {
    bonus += 12;
    fatores.push("18+ chutes");
  } else if (totalChutes >= 15) {
    bonus += 10;
    fatores.push("15+ chutes");
  } else if (totalChutes >= 12) {
    bonus += 8;
    fatores.push("12+ chutes");
  } else if (totalChutes >= 9) {
    bonus += 5;
    fatores.push("9+ chutes");
  }

  // ----------------------------------------------------------
  // DOMÍNIO DE CHUTES
  // ----------------------------------------------------------

  if (
    maxChutes >= 10 &&
    diffChutes >= 5
  ) {
    bonus += 15;
    fatores.push("forte domínio de chutes");
  } else if (
    maxChutes >= 9 &&
    diffChutes >= 4
  ) {
    bonus += 12;
    fatores.push("domínio de chutes");
  } else if (
    maxChutes >= 7 &&
    diffChutes >= 3
  ) {
    bonus += 8;
    fatores.push("vantagem de chutes");
  }

  // ----------------------------------------------------------
  // CHUTES DOS DOIS LADOS
  // ----------------------------------------------------------

  if (
    h.chutes >= 6 &&
    a.chutes >= 6
  ) {
    bonus += 10;
    fatores.push("pressão dos dois lados");
  } else if (
    h.chutes >= 5 &&
    a.chutes >= 4
  ) {
    bonus += 7;
    fatores.push("volume bilateral");
  }

  // ----------------------------------------------------------
  // CHUTES NO ALVO
  // ----------------------------------------------------------

  const totalAlvo =
    h.alvo + a.alvo;

  if (totalAlvo >= 7) {
    bonus += 10;
    fatores.push("7+ no alvo");
  } else if (totalAlvo >= 5) {
    bonus += 8;
    fatores.push("5+ no alvo");
  } else if (totalAlvo >= 3) {
    bonus += 5;
    fatores.push("3+ no alvo");
  }

  // ----------------------------------------------------------
  // POSSE + CHUTES
  // ----------------------------------------------------------

  const maxPosse =
    Math.max(
      h.posse,
      a.posse
    );

  const diffPosse =
    Math.abs(
      h.posse -
      a.posse
    );

  if (
    maxPosse >= 65 &&
    maxChutes >= 8
  ) {
    bonus += 10;
    fatores.push(
      "posse 65%+ + volume"
    );
  } else if (
    maxPosse >= 60 &&
    maxChutes >= 7
  ) {
    bonus += 7;
    fatores.push(
      "posse 60%+ + volume"
    );
  }

  if (
    diffPosse >= 20 &&
    maxChutes >= 7
  ) {
    bonus += 7;
    fatores.push(
      "forte domínio territorial"
    );
  }

  // ----------------------------------------------------------
  // ATAQUES PERIGOSOS
  // ----------------------------------------------------------

  const totalAtaques =
    h.ataquesPerigosos +
    a.ataquesPerigosos;

  if (totalAtaques >= 80) {
    bonus += 10;
    fatores.push(
      "80+ ataques perigosos"
    );
  } else if (
    totalAtaques >= 60
  ) {
    bonus += 8;
    fatores.push(
      "60+ ataques perigosos"
    );
  } else if (
    totalAtaques >= 40
  ) {
    bonus += 4;
    fatores.push(
      "40+ ataques perigosos"
    );
  }

  const maxAtaques =
    Math.max(
      h.ataquesPerigosos,
      a.ataquesPerigosos
    );

  const minAtaques =
    Math.min(
      h.ataquesPerigosos,
      a.ataquesPerigosos
    );

  if (
    maxAtaques >= 45 &&
    maxAtaques >=
      minAtaques + 20
  ) {
    bonus += 8;
    fatores.push(
      "domínio de ataques perigosos"
    );
  }

  // ----------------------------------------------------------
  // xG
  // ----------------------------------------------------------

  const totalXG =
    h.xg + a.xg;

  if (totalXG >= 1.20) {
    bonus += 10;
    fatores.push("xG 1.20+");
  } else if (
    totalXG >= 0.80
  ) {
    bonus += 8;
    fatores.push("xG 0.80+");
  } else if (
    totalXG >= 0.45
  ) {
    bonus += 5;
    fatores.push("xG 0.45+");
  }

  const maxXG =
    Math.max(
      h.xg,
      a.xg
    );

  const minXG =
    Math.min(
      h.xg,
      a.xg
    );

  if (
    maxXG >= 0.55 &&
    maxXG >=
      minXG + 0.35
  ) {
    bonus += 7;
    fatores.push(
      "domínio de xG"
    );
  }

  // ----------------------------------------------------------
  // DENTRO DA ÁREA
  // ----------------------------------------------------------

  const totalDentro =
    h.dentroArea +
    a.dentroArea;

  if (totalDentro >= 8) {
    bonus += 8;
    fatores.push(
      "8+ chutes dentro da área"
    );
  } else if (
    totalDentro >= 5
  ) {
    bonus += 5;
    fatores.push(
      "5+ dentro da área"
    );
  }

  // ----------------------------------------------------------
  // BLOQUEADOS
  // ----------------------------------------------------------

  const totalBloqueados =
    h.bloqueados +
    a.bloqueados;

  if (
    totalBloqueados >= 6
  ) {
    bonus += 6;
    fatores.push(
      "6+ chutes bloqueados"
    );
  } else if (
    totalBloqueados >= 4
  ) {
    bonus += 4;
    fatores.push(
      "4+ chutes bloqueados"
    );
  }

  // ----------------------------------------------------------
  // GRANDES CHANCES
  // ----------------------------------------------------------

  const totalGrandes =
    h.grandesChances +
    a.grandesChances;

  if (
    totalGrandes >= 3
  ) {
    bonus += 8;
    fatores.push(
      "3+ grandes chances"
    );
  } else if (
    totalGrandes >= 2
  ) {
    bonus += 5;
    fatores.push(
      "2+ grandes chances"
    );
  }

  return {
    bonus,
    fatores
  };
}

// ============================================================
// SCORE
// ============================================================

function calcularScore(dados, jogo) {

  let score = 25;

  const pressao =
    analisarPressao(dados);

  score += pressao.bonus;

  const golsCasa =
    numero(
      jogo.goals?.home
    );

  const golsFora =
    numero(
      jogo.goals?.away
    );

  const totalGols =
    golsCasa +
    golsFora;

  // ----------------------------------------------------------
  // PLACAR
  // ----------------------------------------------------------

  if (
    golsCasa === 0 &&
    golsFora === 0
  ) {

    score += 8;

  } else if (
    golsCasa === golsFora
  ) {

    score += 5;

  } else {

    const perdedor =
      golsCasa < golsFora
        ? dados.home
        : dados.away;

    const vencedor =
      golsCasa > golsFora
        ? dados.home
        : dados.away;

    if (
      perdedor.chutes >=
        vencedor.chutes + 3
    ) {
      score += 8;
    }
  }

  // ----------------------------------------------------------
  // GOLEADA
  // ----------------------------------------------------------

  if (
    Math.abs(
      golsCasa -
      golsFora
    ) >= 3
  ) {
    score -= 8;
  }

  // ----------------------------------------------------------
  // POSSE ALTA + POUCOS CHUTES
  // ----------------------------------------------------------

  const maxPosse =
    Math.max(
      dados.home.posse,
      dados.away.posse
    );

  const maxChutes =
    Math.max(
      dados.home.chutes,
      dados.away.chutes
    );

  if (
    maxPosse >= 65 &&
    maxChutes <= 5
  ) {
    score -= 12;
  }

  // ----------------------------------------------------------
  // JOGO MUITO FRACO
  // ----------------------------------------------------------

  const totalChutes =
    dados.home.chutes +
    dados.away.chutes;

  if (
    totalChutes <= 5
  ) {
    score -= 15;
  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );

  return {
    score,
    fatores: pressao.fatores
  };
}

// ============================================================
// CLASSIFICAÇÃO
// ============================================================

function classificacao(score) {

  if (score >= 90)
    return "🔥 EXCEPCIONAL";

  if (score >= 85)
    return "🚀 MUITO FORTE";

  if (score >= 75)
    return "🟢 FORTE";

  if (score >= 65)
    return "🟡 ATIVADO";

  return "⚪ FRACO";
}

// ============================================================
// FORMATAR JOGO
// ============================================================

function nomeJogo(jogo) {

  const casa =
    jogo.teams?.home?.name ||
    "Casa";

  const fora =
    jogo.teams?.away?.name ||
    "Fora";

  return `${casa} x ${fora}`;
}

// ============================================================
// ANALISAR JOGO
// ============================================================

function analisarJogo(jogo) {

  const dados =
    extrairEstatisticas(jogo);

  if (!dados) {
    return null;
  }

  const totalChutes =
    dados.home.chutes +
    dados.away.chutes;

  // ----------------------------------------------------------
  // FILTRO MÍNIMO
  // ----------------------------------------------------------

  if (totalChutes < 7) {
    return null;
  }

  const resultado =
    calcularScore(
      dados,
      jogo
    );

  if (
    resultado.score <
    SCORE_MINIMO
  ) {
    return null;
  }

  const casa =
    jogo.teams?.home?.name ||
    "Casa";

  const fora =
    jogo.teams?.away?.name ||
    "Fora";

  return {
    id: jogo.fixture.id,

    nome:
      `${casa} x ${fora}`,

    score:
      resultado.score,

    classificacao:
      classificacao(
        resultado.score
      ),

    gols:
      `${jogo.goals?.home ?? 0} x ${jogo.goals?.away ?? 0}`,

    minuto:
      jogo.fixture?.status?.elapsed ||
      "HT",

    home: dados.home,

    away: dados.away,

    fatores:
      resultado.fatores
  };
}

// ============================================================
// TELEGRAM
// ============================================================

async function enviarTelegram(texto) {

  if (
    !TELEGRAM_TOKEN ||
    !CHAT_ID
  ) {
    throw new Error(
      "Telegram não configurado."
    );
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  const response =
    await axios.post(
      url,
      {
        chat_id: CHAT_ID,
        text: texto,
        disable_web_page_preview: true
      },
      {
        timeout: 12000
      }
    );

  if (
    !response.data?.ok
  ) {
    throw new Error(
      "Telegram recusou a mensagem."
    );
  }

  return true;
}

// ============================================================
// MONTAR ALERTA
// ============================================================

function montarAlerta(resultado) {

  const h =
    resultado.home;

  const a =
    resultado.away;

  const fatores =
    resultado.fatores.length
      ? resultado.fatores
          .map(
            f => `• ${f}`
          )
          .join("\n")
      : "• Pressão geral";

  return (
`🚨 ELITE RADAR V24

${resultado.classificacao}

⚽ ${resultado.nome}
📊 Placar: ${resultado.gols}
⏱️ Intervalo

🎯 SCORE: ${resultado.score}/100

📈 PRESSÃO DO 1º TEMPO

Chutes:
🏠 ${h.chutes}
✈️ ${a.chutes}

No alvo:
🏠 ${h.alvo}
✈️ ${a.alvo}

Bloqueados:
🏠 ${h.bloqueados}
✈️ ${a.bloqueados}

Dentro da área:
🏠 ${h.dentroArea}
✈️ ${a.dentroArea}

Posse:
🏠 ${h.posse}%
✈️ ${a.posse}%

🚩 Escanteios HT:
🏠 ${h.escanteios}
✈️ ${a.escanteios}

⚠️ ESCANTEIOS NÃO ENTRAM NO SCORE.

🔥 FATORES DE PRESSÃO

${fatores}

🎯 MERCADO ANALISADO

PRESSÃO → ESCANTEIOS NO 2º TEMPO

💰 Radar procura oportunidade para
corrida de escanteios no 2º tempo.

📡 API: API-FOOTBALL
🔄 Varredura: 20 minutos

⚠️ ALERTA ESTATÍSTICO.
`
  );
}

// ============================================================
// SCAN PRINCIPAL
// ============================================================

async function executarScan() {

  verificarResetDiario();

  ultimoScan =
    new Date();

  log("");
  log(
    "================================================"
  );
  log(
    "🔎 ELITE RADAR V24 - NOVA VARREDURA"
  );
  log(
    `🕐 BRT: ${horaBRT()}`
  );
  log(
    `📊 API: ${requisicoesHoje}/${MAX_REQUESTS_DAY}`
  );
  log(
    "================================================"
  );

  if (
    !podeConsultarAPI()
  ) {
    log(
      "🛑 Scan cancelado por proteção de quota."
    );
    return;
  }

  try {

    // --------------------------------------------------------
    // 1 - UMA CHAMADA PARA TODOS OS JOGOS AO VIVO
    // --------------------------------------------------------

    const aoVivo =
      await buscarJogosAoVivo();

    log(
      `⚽ Jogos ao vivo encontrados: ${aoVivo.length}`
    );

    // --------------------------------------------------------
    // 2 - SOMENTE INTERVALO
    // --------------------------------------------------------

    const intervalo =
      aoVivo.filter(
        estaNoIntervalo
      );

    log(
      `⏸️ Jogos no intervalo: ${intervalo.length}`
    );

    if (!intervalo.length) {
      return;
    }

    // --------------------------------------------------------
    // 3 - PEGAR IDS
    // --------------------------------------------------------

    const ids =
      intervalo
        .map(
          jogo =>
            jogo.fixture?.id
        )
        .filter(Boolean);

    if (!ids.length) {
      return;
    }

    // --------------------------------------------------------
    // 4 - BUSCA EM LOTE
    // --------------------------------------------------------

    const detalhes =
      await buscarDetalhesEmLote(
        ids
      );

    log(
      `📦 Jogos detalhados: ${detalhes.length}`
    );

    // --------------------------------------------------------
    // 5 - ANALISAR
    // --------------------------------------------------------

    for (
      const jogo of detalhes
    ) {

      jogosAnalisados++;

      try {

        const resultado =
          analisarJogo(jogo);

        if (!resultado) {
          continue;
        }

        candidatosEncontrados++;

        log(
          `🎯 CANDIDATO: ${resultado.nome} | ${resultado.score}`
        );

        // ----------------------------------------------------
        // EVITAR DUPLICIDADE
        // ----------------------------------------------------

        if (
          JOGOS_JA_AVISADOS.has(
            resultado.id
          )
        ) {
          log(
            `⏭️ Já avisado: ${resultado.id}`
          );
          continue;
        }

        // ----------------------------------------------------
        // TELEGRAM
        // ----------------------------------------------------

        const alerta =
          montarAlerta(
            resultado
          );

        await enviarTelegram(
          alerta
        );

        JOGOS_JA_AVISADOS.add(
          resultado.id
        );

        alertasEnviados++;

        log(
          `📨 ALERTA ENVIADO: ${resultado.nome}`
        );

      } catch (error) {

        ultimoErro =
          `Análise: ${error.message}`;

        log(
          "❌ Erro analisando jogo:",
          error.message
        );
      }
    }

  } catch (error) {

    ultimoErro =
      error.message;

    log(
      "❌ ERRO NO SCAN:",
      error.message
    );
  }

  log(
    `📊 Consumo: ${requisicoesHoje}/${MAX_REQUESTS_DAY}`
  );

  log(
    "================================================"
  );
}

// ============================================================
// RELATÓRIO DIÁRIO
// ============================================================

async function enviarRelatorioDiario() {

  const texto =
`📊 ELITE RADAR V24
RELATÓRIO DIÁRIO

📅 ${dataBRT()}

🔎 Jogos analisados:
${jogosAnalisados}

🎯 Candidatos:
${candidatosEncontrados}

📨 Alertas enviados:
${alertasEnviados}

📡 Requisições API:
${requisicoesHoje}/${MAX_REQUESTS_DAY}

🟢 Restantes no controle interno:
${Math.max(
  0,
  MAX_REQUESTS_DAY -
  requisicoesHoje
)}

🎯 Score mínimo:
${SCORE_MINIMO}

🚩 Escanteios HT:
IGNORADOS NO SCORE

🔄 Varredura:
20 minutos

🛡️ Proteções:
${protecoes}

🚫 Erros 403:
${erros403}

⚠️ Último erro:
${ultimoErro || "Nenhum"}

📡 Fonte:
API-FOOTBALL
`;

  try {

    await enviarTelegram(
      texto
    );

    log(
      "📊 Relatório diário enviado."
    );

  } catch (error) {

    log(
      "❌ Falha no relatório:",
      error.message
    );
  }
}

// ============================================================
// CONTROLE DO HORÁRIO
// ============================================================

function estaNoHorarioRadar() {

  const agora =
    new Date();

  const hora =
    Number(
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "America/Sao_Paulo",
          hour:
            "2-digit",
          hour12:
            false
        }
      ).format(agora)
    );

  const dia =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/Sao_Paulo",
        weekday:
          "short"
      }
    ).format(agora);

  const fimDeSemana =
    dia === "Sat" ||
    dia === "Sun";

  if (fimDeSemana) {
    return (
      hora >= 8 &&
      hora < 24
    );
  }

  return (
    hora >= 12 &&
    hora < 24
  );
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================

async function loopRadar() {

  try {

    if (
      estaNoHorarioRadar()
    ) {
      await executarScan();
    } else {

      log(
        `⏰ Fora do horário do Radar. BRT ${horaBRT()}`
      );
    }

  } catch (error) {

    ultimoErro =
      error.message;

    log(
      "❌ LOOP:",
      error.message
    );
  }

  proximoScan =
    new Date(
      Date.now() +
      INTERVALO_SCAN_MS
    );

  setTimeout(
    loopRadar,
    INTERVALO_SCAN_MS
  );
}

// ============================================================
// RELATÓRIO AUTOMÁTICO
// ============================================================

let ultimoDiaRelatorio = null;

setInterval(
  async () => {

    const agora =
      new Date();

    const partes =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "America/Sao_Paulo",
          hour:
            "2-digit",
          minute:
            "2-digit",
          hour12:
            false
        }
      ).formatToParts(agora);

    const hora =
      Number(
        partes.find(
          p => p.type === "hour"
        )?.value || 0
      );

    const minuto =
      Number(
        partes.find(
          p => p.type === "minute"
        )?.value || 0
      );

    const hoje =
      dataBRT();

    if (
      hora === 23 &&
      minuto < 2 &&
      ultimoDiaRelatorio !== hoje
    ) {

      ultimoDiaRelatorio =
        hoje;

      await enviarRelatorioDiario();
    }

  },
  30 * 1000
);

// ============================================================
// STATUS
// ============================================================

app.get(
  "/",
  (req, res) => {

    verificarResetDiario();

    res.json({
      projeto:
        "ELITE RADAR V24",

      status:
        "online",

      fonte:
        "API-FOOTBALL",

      efo_ids_configurado:
        !!API_KEY,

      telegram_configurado:
        !!(
          TELEGRAM_TOKEN &&
          CHAT_ID
        ),

      requisicoes_hoje:
        requisicoesHoje,

      limite_interno:
        MAX_REQUESTS_DAY,

      restantes:
        Math.max(
          0,
          MAX_REQUESTS_DAY -
          requisicoesHoje
        ),

      intervalo_scan:
        "20 minutos",

      score_minimo:
        SCORE_MINIMO,

      jogos_analisados:
        jogosAnalisados,

      candidatos:
        candidatosEncontrados,

      alertas_enviados:
        alertasEnviados,

      erros_403:
        erros403,

      ultimo_scan:
        ultimoScan,

      proximo_scan:
        proximoScan,

      ultimo_erro:
        ultimoErro,

      hora_brt:
        horaBRT(),

      data_brt:
        dataBRT()
    });
  }
);

// ============================================================
// API STATUS
// ============================================================

app.get(
  "/api-status",
  (req, res) => {

    verificarResetDiario();

    res.json({

      api:
        "API-FOOTBALL",

      configurada:
        !!API_KEY,

      requisicoes:
        requisicoesHoje,

      limite:
        MAX_REQUESTS_DAY,

      restantes:
        Math.max(
          0,
          MAX_REQUESTS_DAY -
          requisicoesHoje
        ),

      ultima_resposta:
        ultimaRespostaAPI,

      ultimo_erro:
        ultimoErro,

      erros_403:
        erros403
    });
  }
);

// ============================================================
// TESTE TELEGRAM
// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {

    try {

      await enviarTelegram(
`🟢 ELITE RADAR V24

Teste do Telegram realizado com sucesso.

📡 API: API-FOOTBALL
📊 Quota interna: ${requisicoesHoje}/${MAX_REQUESTS_DAY}
🕐 BRT: ${horaBRT()}`
      );

      res.json({
        ok: true
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        erro:
          error.message
      });
    }
  }
);

// ============================================================
// LIMPAR CACHE
// ============================================================

app.get(
  "/limpar-cache",
  (req, res) => {

    CACHE_FIXTURES.clear();

    res.json({
      ok: true,
      mensagem:
        "Cache de jogos limpo."
    });
  }
);

// ============================================================
// LIMPAR JOGOS AVISADOS
// ============================================================

app.get(
  "/limpar-stats-cache",
  (req, res) => {

    JOGOS_JA_AVISADOS.clear();

    res.json({
      ok: true,
      mensagem:
        "Lista de jogos avisados limpa."
    });
  }
);

// ============================================================
// RESET MANUAL DO CONTADOR LOCAL
// NÃO ALTERA A QUOTA REAL DA API.
// ============================================================

app.get(
  "/reset-api",
  (req, res) => {

    requisicoesHoje = 0;

    res.json({
      ok: true,

      aviso:
        "Contador LOCAL resetado. Isso não reseta a quota real da API-Football."
    });
  }
);

// ============================================================
// PORTA
// ============================================================

app.listen(
  PORT,
  () => {

    log(
      "================================================"
    );

    log(
      "🚀 ELITE RADAR V24 INICIADO"
    );

    log(
      `🌐 PORTA: ${PORT}`
    );

    log(
      `📡 API-FOOTBALL: ${API_KEY ? "CONFIGURADA" : "NÃO CONFIGURADA"}`
    );

    log(
      `📨 TELEGRAM: ${
        TELEGRAM_TOKEN && CHAT_ID
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    log(
      `📊 LIMITE: ${MAX_REQUESTS_DAY}/DIA`
    );

    log(
      "🔄 INTERVALO: 20 MINUTOS"
    );

    log(
      `🎯 SCORE MÍNIMO: ${SCORE_MINIMO}`
    );

    log(
      "🚩 ESCANTEIOS HT: IGNORADOS NO SCORE"
    );

    log(
      "================================================"
    );

    // Inicia o Radar após 5 segundos
    setTimeout(
      loopRadar,
      5000
    );
  }
);
