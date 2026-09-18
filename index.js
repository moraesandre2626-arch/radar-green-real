const http = require('http');

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  '';

const CHAT_ID =
  process.env.CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID ||
  '';

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  '';

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  '';

const REDIS_ATIVO = !!(REDIS_URL && REDIS_TOKEN);


// ============================================================
// LIGAS
// ============================================================

const LIGAS_PERMITIDAS = [
  'bra.1',
  'bra.2',
  'por.1',
  'eng.1',
  'esp.1',
  'ger.1',
  'ita.1',
  'fra.1',
  'ned.1',
  'bel.1',
  'tur.1',
  'sco.1',
  'conmebol.libertadores',
  'conmebol.sudamericana',
  'usa.1',
  'mex.1',
  'arg.1',
  'uefa.champions',
  'uefa.europa'
];


// ============================================================
// FILTROS V35
// ============================================================

const FILTROS = {

  // Diferença máxima do placar
  max_diferenca_gols: 2,

  // Time que precisa do gol
  min_chutes_gol_time_precisa: 2,

  // Chutes totais da partida
  min_total_chutes_jogo: 8,

  // Janela de análise
  minuto_minimo: 40,
  minuto_maximo: 65,

  // POSSE MÍNIMA DO TIME QUE ESTÁ PRESSIONANDO
  posse_minima_pressao: 60,

  // Score mínimo de pressão
  min_pressao_score: 6
};


// ============================================================
// CONTROLES
// ============================================================

let ultimoScan = null;
let totalAprovados = 0;
let totalEnviados = 0;
let totalErros = 0;
let relatorioEmExecucao = false;

const enviados = new Map();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));


// ============================================================
// HORÁRIO DE BRASÍLIA
// ============================================================

function dataBrasilia() {

  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).format(new Date());
}


function horaBrasilia() {

  const partes = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  ).formatToParts(new Date());

  return {
    hora: Number(
      partes.find(x => x.type === 'hour')?.value || 0
    ),
    minuto: Number(
      partes.find(x => x.type === 'minute')?.value || 0
    )
  };
}


// ============================================================
// HISTÓRICO DO DIA
// ============================================================

let historicoDia = {
  data: dataBrasilia(),
  enviados: [],
  green: 0,
  red: 0,
  pendentes: 0,
  relatorioEnviado: false
};


function chaveHistorico(data) {

  return `gol2t:v35:historico:${data}`;
}


// ============================================================
// REDIS
// ============================================================

async function redisGet(chave) {

  if (!REDIS_ATIVO) return null;

  try {

    const resposta = await fetch(
      `${REDIS_URL}/get/${encodeURIComponent(chave)}`,
      {
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`
        }
      }
    );

    if (!resposta.ok) {
      throw new Error(`HTTP ${resposta.status}`);
    }

    const dados = await resposta.json();

    return dados.result ?? null;

  } catch (erro) {

    console.log(
      '⚠️ Redis GET:',
      erro.message
    );

    return null;
  }
}


async function redisSet(chave, valor) {

  if (!REDIS_ATIVO) return false;

  try {

    const resposta = await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(chave)}`,
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          'Content-Type': 'text/plain'
        },

        body: valor
      }
    );

    if (!resposta.ok) {
      throw new Error(`HTTP ${resposta.status}`);
    }

    const dados = await resposta.json();

    return dados.result === 'OK';

  } catch (erro) {

    console.log(
      '⚠️ Redis SET:',
      erro.message
    );

    return false;
  }
}


async function salvarHistorico() {

  if (!REDIS_ATIVO) return;

  await redisSet(
    chaveHistorico(historicoDia.data),
    JSON.stringify(historicoDia)
  );
}


function reconstruirMapa() {

  enviados.clear();

  for (const aposta of historicoDia.enviados) {

    if (
      aposta?.id &&
      aposta?.liga
    ) {

      enviados.set(
        `${aposta.liga}_${aposta.id}_HT`,
        Date.now()
      );
    }
  }
}


async function carregarHistorico() {

  const hoje = dataBrasilia();

  historicoDia.data = hoje;

  if (!REDIS_ATIVO) {

    console.log(
      '⚠️ Redis não configurado.'
    );

    return;
  }

  const salvo = await redisGet(
    chaveHistorico(hoje)
  );

  if (!salvo) {

    console.log(
      '🟢 Redis conectado; sem histórico de hoje.'
    );

    return;
  }

  try {

    const dados =
      typeof salvo === 'string'
        ? JSON.parse(salvo)
        : salvo;

    if (
      dados &&
      dados.data === hoje &&
      Array.isArray(dados.enviados)
    ) {

      historicoDia = {

        data: hoje,

        enviados: dados.enviados,

        green:
          Number(dados.green) || 0,

        red:
          Number(dados.red) || 0,

        pendentes:
          Number(dados.pendentes) || 0,

        relatorioEnviado:
          !!dados.relatorioEnviado
      };

      reconstruirMapa();

      console.log(
        `🟢 Histórico recuperado: ${historicoDia.enviados.length} entradas`
      );
    }

  } catch (erro) {

    console.log(
      '⚠️ Erro ao ler histórico Redis:',
      erro.message
    );
  }
}


async function garantirNovoDia() {

  const hoje = dataBrasilia();

  if (historicoDia.data !== hoje) {

    historicoDia = {

      data: hoje,
      enviados: [],
      green: 0,
      red: 0,
      pendentes: 0,
      relatorioEnviado: false

    };

    enviados.clear();

    await salvarHistorico();

    console.log(
      '📅 Novo dia:',
      hoje
    );
  }
}


// ============================================================
// HTTP / JSON
// ============================================================

async function getJson(url) {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8000
    );

  try {

    const resposta = await fetch(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        signal: controller.signal
      }
    );

    if (!resposta.ok) {

      throw new Error(
        `HTTP ${resposta.status}`
      );
    }

    return await resposta.json();

  } finally {

    clearTimeout(timeout);
  }
}


// ============================================================
// UTILITÁRIOS
// ============================================================

function numero(valor) {

  const n =
    parseFloat(
      String(valor ?? 0)
        .replace(',', '.')
        .replace('%', '')
    );

  return Number.isFinite(n)
    ? n
    : 0;
}


function pegaStat(estatisticas, nomes) {

  if (!Array.isArray(estatisticas)) {
    return null;
  }

  for (const nome of nomes) {

    const encontrado =
      estatisticas.find(
        x =>
          x.name?.toLowerCase() ===
            nome.toLowerCase() ||

          x.abbreviation?.toLowerCase() ===
            nome.toLowerCase()
      );

    if (encontrado) {

      return numero(
        encontrado.displayValue ??
        encontrado.value ??
        0
      );
    }
  }

  return null;
}


// ============================================================
// RAIO-X COMPLETO
// ============================================================

async function buscarRaioXCompleto(
  liga,
  eventId
) {

  const resultado = {

    chutesCasa: 0,
    chutesFora: 0,

    alvoCasa: 0,
    alvoFora: 0,

    posseCasa: 0,
    posseFora: 0,

    escCasa: 0,
    escFora: 0,

    amarelosCasa: 0,
    amarelosFora: 0,

    cruzCasa: 0,
    cruzFora: 0,

    apCasa: null,
    apFora: null,

    temAP: false,
    temCruz: false
  };


  try {

    const resumo = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports
