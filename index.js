const http = require('http');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_ATIVO = Boolean(REDIS_URL && REDIS_TOKEN);

const LIGAS_PERMITIDAS = [
  'bra.1','bra.2','por.1','eng.1','esp.1','ger.1',
  'ita.1','fra.1','ned.1','bel.1','tur.1','sco.1',
  'conmebol.libertadores','conmebol.sudamericana',
  'usa.1','mex.1','arg.1','uefa.champions','uefa.europa'
];

const FILTROS = {
  max_diferenca_gols: 2,
  min_chutes_gol_time_precisa: 2,
  min_total_chutes_jogo: 8,
  minuto_minimo: 40,
  minuto_maximo: 55,
  posse_minima_pressao: 60,
  min_pressao_score: 6
};

let ultimoScan = null;
let totalAprovados = 0;
let totalEnviados = 0;
let totalErros = 0;
let relatorioEmExecucao = false;

const enviados = new Map();

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

  const hora = Number(partes.find(p => p.type === 'hour')?.value || 0);
  const minuto = Number(partes.find(p => p.type === 'minute')?.value || 0);

  return { hora, minuto };
}

let dataControle = dataBrasilia();

let historicoDia = {
  data: dataControle,
  enviados: [],
  green: 0,
  red: 0,
  pendentes: 0,
  relatorioEnviado: false
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chaveHistorico(data) {
  return `gol2t:v34.6:historico:${data}`;
}

async function redisGet(chave) {
  if (!REDIS_ATIVO) return null;

  try {
    const r = await fetch(
      `${REDIS_URL}/get/${encodeURIComponent(chave)}`,
      {
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`
        }
      }
    );

    if (!r.ok) {
      throw new Error(`Redis GET HTTP ${r.status}`);
    }

    const d = await r.json();

    return d.result ?? null;

  } catch (e) {
    console.log(`⚠️ Redis GET: ${e.message}`);
    return null;
  }
}

async function redisSet(chave, valor) {
  if (!REDIS_ATIVO) return false;

  try {
    const r = await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(chave)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: valor
      }
    );

    if (!r.ok) {
      throw new Error(`Redis SET HTTP ${r.status}`);
    }

    const d = await r.json();

    if (d.error) {
      throw new Error(d.error);
    }

    return d.result === 'OK';

  } catch (e) {
    console.log(`⚠️ Redis SET: ${e.message}`);
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

function reconstruirMapaEnviados() {
  enviados.clear();

  for (const alerta of historicoDia.enviados) {
    if (!alerta || !alerta.id || !alerta.liga) continue;

    const chave = `${alerta.liga}_${alerta.id}_HT`;

    enviados.set(chave, Date.now());
  }
}

async function garantirNovoDia() {
  const hoje = dataBrasilia();

  if (hoje !== dataControle) {

    dataControle = hoje;

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

    console.log(`📅 Novo dia iniciado em Brasília: ${hoje}`);

    return;
  }

  if (historicoDia.data !== hoje) {
    historicoDia.data = hoje;
  }
}

async function carregarHistorico() {

  if (!REDIS_ATIVO) {
    console.log(
      '⚠️ Redis não configurado. Histórico ficará somente em memória.'
    );

    return;
  }

  const hoje = dataBrasilia();

  const salvo = await redisGet(
    chaveHistorico(hoje)
  );

  if (!salvo) {
    console.log(
      `🟢 Redis conectado. Nenhum histórico salvo para ${hoje}.`
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
        green: Number(dados.green) || 0,
        red: Number(dados.red) || 0,
        pendentes: Number(dados.pendentes) || 0,
        relatorioEnviado: Boolean(
          dados.relatorioEnviado
        )
      };

      reconstruirMapaEnviados();

      console.log(
        `🟢 Histórico recuperado do Redis: ${historicoDia.enviados.length} alerta(s).`
      );
    }

  } catch (e) {

    console.log(
      `⚠️ Erro lendo histórico do Redis: ${e.message}`
    );

  }
}

async function getJson(url) {

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8000
  );

  try {

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      signal: controller.signal
    });

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }

    return await r.json();

  } finally {

    clearTimeout(timeout);

  }
}

function numero(v) {

  const n = parseFloat(
    String(v ?? 0)
      .replace(',', '.')
      .replace('%', '')
  );

  return Number.isFinite(n) ? n : 0;
}

function pegaStat(S, nomes) {

  if (!Array.isArray(S)) return null;

  for (const nome of nomes) {

    const s = S.find(x =>
      x.name?.toLowerCase() === nome.toLowerCase() ||
      x.abbreviation?.toLowerCase() === nome.toLowerCase()
    );

    if (s) {
      return numero(
        s.displayValue ??
        s.value ??
        0
      );
    }
  }

  return null;
}

async function buscarRaioXCompleto(liga, eventId) {

  const raio = {

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

    const summary = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`
    );

    const teams =
      summary?.boxscore?.teams || [];

    for (
      let i = 0;
      i < teams.length;
      i++
    ) {

      const bloco = teams[i];

      const id =
        String(
          bloco?.team?.id || ''
        );

      let lado =
        i === 0
          ? 'home'
          : 'away';

      const comp =
        summary?.header
          ?.competitions?.[0]
          ?.competitors
          ?.find(
            c =>
              String(c.team?.id) === id
          );

      if (comp) {
        lado = comp.homeAway;
      }

      const S =
        bloco?.statistics || [];

      const chutes =
        pegaStat(
          S,
          ['totalShots', 'shots']
        ) ?? 0;

      const alvo =
        pegaStat(
          S,
          ['shotsOnTarget', 'shotsOnGoal']
        ) ?? 0;

      const posse =
        pegaStat(
          S,
          ['possessionPct', 'possession']
        ) ?? 0;

      const esc =
        pegaStat(
          S,
          ['wonCorners', 'cornerKicks']
        ) ?? 0;

      const amarelos =
        pegaStat(
          S,
          ['yellowCards']
        ) ?? 0;

      const ap =
        pegaStat(
          S,
          [
            'dangerousAttacks',
            'dangerousAttack',
            'attack'
          ]
        );

      const cruz =
        pegaStat(
          S,
          [
            'crosses',
            'totalCrosses',
            'totalCross',
            'cross'
          ]
        );

      if (lado === 'home') {

        raio.chutesCasa = chutes;
        raio.alvoCasa = alvo;
        raio.posseCasa = posse;
        raio.escCasa = esc;
        raio.amarelosCasa = amarelos;

        if (cruz !== null) {
          raio.cruzCasa = cruz;
          raio.temCruz = true;
        }

        if (ap !== null) {
          raio.apCasa = ap;
          raio.temAP = true;
        }

      } else {

        raio.chutesFora = chutes;
        raio.alvoFora = alvo;
        raio.posseFora = posse;
        raio.escFora = esc;
        raio.amarelosFora = amarelos;

        if (cruz !== null) {
          raio.cruzFora = cruz;
          raio.temCruz = true;
        }

        if (ap !== null) {
          raio.apFora = ap;
          raio.temAP = true;
        }
      }
    }

  } catch (e) {
    // Mantém os valores padrão quando alguma estatística não estiver disponível.
  }

  return raio;
}

function checaJogo(jogo, raio) {

  if (!LIGAS_PERMITIDAS.includes(jogo.liga)) {

    return {
      aprovado: false,
      motivo: 'liga'
    };
  }

  if (
    Math.abs(
      jogo.gols_casa -
      jogo.gols_fora
    ) >
    FILTROS.max_diferenca_gols
  ) {

    return {
      aprovado: false,
      motivo: 'placar'
    };
  }

  if (
    jogo.chutes_casa +
    jogo.chutes_fora <
    FILTROS.min_total_chutes_jogo
  ) {

    return {
      aprovado: false,
      motivo: 'chutes'
    };
  }

  const totalPosse =
    raio.posseCasa +
    raio.posseFora;

  const posseCasaPct =
    totalPosse > 0
      ? Math.round(
          (raio.posseCasa /
            totalPosse) *
          100
        )
      : 50;

  const posseForaPct =
    100 -
    posseCasaPct;

  let timePrecisa = '';
  let chutesPrecisa = 0;
  let posseTime = 0;
  let cruzTime = 0;
  let escTime = 0;
  let apTime = 0;

  if (
    jogo.gols_casa <
    jogo.gols_fora
  ) {

    timePrecisa =
      jogo.nome_casa;

    chutesPrecisa =
      raio.alvoCasa;

    posseTime =
      posseCasaPct;

    cruzTime =
      raio.cruzCasa;

    escTime =
      raio.escCasa;

    apTime =
      raio.apCasa || 0;

  } else if (
    jogo.gols_fora <
    jogo.gols_casa
  ) {

    timePrecisa =
      jogo.nome_fora;

    chutesPrecisa =
      raio.alvoFora;

    posseTime =
      posseForaPct;

    cruzTime =
      raio.cruzFora;

    escTime =
      raio.escFora;

    apTime =
      raio.apFora || 0;

  } else {

    const casaMelhor =
      raio.alvoCasa >=
      raio.alvoFora;

    timePrecisa =
      casaMelhor
        ? jogo.nome_casa
        : jogo.nome_fora;

    chutesPrecisa =
      Math.max(
        raio.alvoCasa,
        raio.alvoFora
      );

    posseTime =
      casaMelhor
        ? posseCasaPct
        : posseForaPct;

    cruzTime =
      casaMelhor
        ? raio.cruzCasa
        : raio.cruzFora;

    escTime =
      casaMelhor
        ? raio.escCasa
        : raio.escFora;

    apTime =
      casaMel
