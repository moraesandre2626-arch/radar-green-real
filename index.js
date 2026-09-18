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

const LIGAS = [
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

const FILTROS = {
  max_diferenca_gols: 2,
  min_chutes_gol_time_precisa: 2,
  min_total_chutes_jogo: 8,
  minuto_minimo: 40,
  minuto_maximo: 65,
  posse_minima_pressao: 60,
  min_pressao_score: 6
};

let ultimoScan = null;
let totalErros = 0;
let relatorioEmExecucao = false;

const enviados = new Map();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function dataBrasilia() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function horaBrasilia() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  let hora = Number(
    partes.find(x => x.type === 'hour')?.value || 0
  );

  const minuto = Number(
    partes.find(x => x.type === 'minute')?.value || 0
  );

  if (hora === 24) hora = 0;

  return {
    hora,
    minuto
  };
}

let historico = {
  data: dataBrasilia(),
  enviados: [],
  green: 0,
  red: 0,
  pendentes: 0,
  relatorioEnviado: false
};

function chave(d) {
  return `gol2t:v35:historico:${d}`;
}

async function redisGet(chaveRedis) {
  if (!REDIS_ATIVO) return null;

  try {
    const r = await fetch(
      `${REDIS_URL}/get/${encodeURIComponent(chaveRedis)}`,
      {
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`
        }
      }
    );

    const j = await
