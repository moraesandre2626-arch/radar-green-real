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

const REDIS_ATIVO =
  !!(REDIS_URL && REDIS_TOKEN);


// ======================================================
// CONFIGURAÇÃO
// ======================================================

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

const FILTROS = {
  diferencaMaxima: 2,
  chutesAlvoMinimo: 2,
  chutesTotaisMinimo: 8,
  minutoMinimo: 40,
  minutoMaximo: 65,

  // REGRA PRINCIPAL:
  posseMinima: 60,

  scoreMinimo: 6
};


// ======================================================
// CONTROLES
// ======================================================

let ultimoScan = null;
let executando = false;
let relatorioExecutando = false;

const enviados = new Set();

let historicoDia = {
  data: '',
  enviados: [],
  green: 0,
  red: 0,
  pendentes: 0,
  relatorioEnviado: false
};


// ======================================================
// DATA / HORA BRASÍLIA
// ======================================================

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

  return {
    hora: Number(partes.find(x => x.type === 'hour')?.value || 0),
    minuto: Number(partes.find(x => x.type === 'minute')?.value || 0)
  };
}


// ======================================================
// REDIS
// ======================================================

function chaveRedis() {
  return `gol2t:v35:historico:${historicoDia.data}`;
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
      throw new Error(`HTTP ${r.status}`);
    }

    const d = await r.json();
    return d.result ?? null;

  } catch (e) {
    console.log('Redis GET:', e.message);
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
          'Content-Type': 'text/plain'
        },
        body: valor
      }
    );

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }

    const d = await r.json();
    return d.result === 'OK';

  } catch (e) {
    console.log('Redis SET:', e.message);
    return false;
  }
}

async function salvarHistorico() {
  if (!REDIS_ATIVO) return;

  await redisSet(
    chaveRedis(),
    JSON.stringify(historicoDia)
  );
}

async function carregarHistorico() {
  const hoje = dataBrasilia();

  historicoDia.data = hoje;

  if (!REDIS_ATIVO) {
    console.log('Redis não configurado.');
    return;
  }

  const salvo = await redisGet(
    `gol2t:v35:historico:${hoje}`
  );

  if (!salvo) {
    console.log('Redis conectado. Nenhum histórico hoje.');
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
        relatorioEnviado: !!dados.relatorioEnviado
      };

      reconstruirEnviados();

      console.log(
        `Histórico recuperado: ${historicoDia.enviados.length}`
      );
    }

  } catch (e) {
    console.log(
      'Erro lendo histórico:',
      e.message
    );
  }
}

function reconstruirEnviados() {
  enviados.clear();

  for (const aposta of historicoDia.enviados) {
    if (aposta?.id && aposta?.liga) {
      enviados.add(
        `${aposta.liga}_${aposta.id}`
      );
    }
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
      'Novo dia:',
      hoje
    );
  }
}


// ======================================================
// BUSCAR JSON
// ======================================================

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ======================================================
// ESTATÍSTICAS ESPN
// ======================================================

function pegaStat(stats, nomes) {
  if (!Array.isArray(stats)) return null;

  for (const nome of nomes) {
    const item = stats.find(x =>
      String(x.name || '').toLowerCase() ===
        nome.toLowerCase() ||
      String(x.abbreviation || '').toLowerCase() ===
        nome.toLowerCase()
    );

    if (item) {
      return numero(
        item.displayValue ??
        item.value ??
        0
      );
    }
  }

  return null;
}


// ======================================================
// RAIO-X
// ======================================================

async function buscarRaioX(liga, eventId) {
  const r = {
    chutesCasa: 0,
    chutesFora: 0,

    alvoCasa: 0,
    alvoFora: 0,

    posseCasa: 0,
    posseFora: 0,

    escCasa: 0,
    escFora: 0,

    cruzCasa: 0,
    cruzFora: 0,

    ataquesCasa: null,
    ataquesFora: null,

    temAP: false,
    temCruz: false
  };

  try {
    const s = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`
    );

    const teams =
      s?.boxscore?.teams || [];

    for (let i = 0; i < teams.length; i++) {
      const bloco = teams[i];

      const id =
        String(bloco?.team?.id || '');

      let lado =
        i === 0 ? 'home' : 'away';

      const comp =
        s?.header?.competitions?.[0]
          ?.competitors
          ?.find(
            x =>
              String(x.team?.id) === id
          );

      if (comp) {
        lado = comp.homeAway;
      }

      const stats =
        bloco?.statistics || [];

      const chutes =
        pegaStat(stats, [
          'totalShots',
          'shots'
        ]) ?? 0;

      const alvo =
        pegaStat(stats, [
          'shotsOnTarget',
          'shotsOnGoal'
        ]) ?? 0;

      const posse =
        pegaStat(stats, [
          'possessionPct',
          'possession'
        ]) ?? 0;

      const escanteios =
        pegaStat(stats, [
          'wonCorners',
          'cornerKicks'
        ]) ?? 0;

      const cruzamentos =
        pegaStat(stats, [
          'crosses',
          'totalCrosses',
          'totalCross',
          'cross'
        ]);

      const ataques =
        pegaStat(stats, [
          'dangerousAttacks',
          'dangerousAttack',
          'attack'
        ]);

      if (lado === 'home') {

        r.chutesCasa = chutes;
        r.alvoCasa = alvo;
        r.posseCasa = posse;
        r.escCasa = escanteios;

        if (cruzamentos !== null) {
          r.cruzCasa = cruzamentos;
          r.temCruz = true;
        }

        if (ataques !== null) {
          r.ataquesCasa = ataques;
          r.temAP = true;
        }

      } else {

        r.chutesFora = chutes;
        r.alvoFora = alvo;
        r.posseFora = posse;

        // CORRIGIDO
        r.escFora = escanteios;

        if (cruzamentos !== null) {
          r.cruzFora = cruzamentos;
          r.temCruz = true;
        }

        if (ataques !== null) {
          r.ataquesFora = ataques;
          r.temAP = true;
        }
      }
    }

  } catch (e) {
    console.log(
      `Raio-X ${liga}/${eventId}:`,
      e.message
    );
  }

  return r;
}


// ======================================================
// DEFINIR TIME DE PRESSÃO
// ======================================================

function definirTimePrecisa(jogo, r) {

  if (
    jogo.golsCasa >
    jogo.golsFora
  ) {
    return {
      lado: 'away',
      nome: jogo.fora,
      chutes: r.chutesFora,
      alvo: r.alvoFora,
      posse: r.posseFora,
      escanteios: r.escFora,
      cruzamentos: r.cruzFora,
      ataques: r.ataquesFora
    };
  }

  if (
    jogo.golsCasa <
    jogo.golsFora
  ) {
    return {
      lado: 'home',
      nome: jogo.casa,
      chutes: r.chutesCasa,
      alvo: r.alvoCasa,
      posse: r.posseCasa,
      escanteios: r.escCasa,
      cruzamentos: r.cruzCasa,
      ataques: r.ataquesCasa
    };
  }

  // Empate: escolhe quem apresenta
  // maior pressão estatística.

  const pressaoCasa =
    r.alvoCasa * 3 +
    r.chutesCasa +
    r.escCasa * 2 +
    r.posseCasa / 10;

  const pressaoFora =
    r.alvoFora * 3 +
    r.chutesFora +
    r.escFora * 2 +
    r.posseFora / 10;

  if (pressaoCasa >= pressaoFora) {
    return {
      lado: 'home',
      nome: jogo.casa,
      chutes: r.chutesCasa,
      alvo: r.alvoCasa,
      posse: r.posseCasa,
      escanteios: r.escCasa,
      cruzamentos: r.cruzCasa,
      ataques: r.ataquesCasa
    };
  }

  return {
    lado: 'away',
    nome: jogo.fora,
    chutes: r.chutesFora,
    alvo: r.alvoFora,
    posse: r.posseFora,
    escanteios: r.escFora,
    cruzamentos: r.cruzFora,
    ataques: r.ataquesFora
  };
}


// ======================================================
// FILTROS
// ======================================================

function analisarJogo(jogo, r) {

  const diferenca =
    Math.abs(
      jogo.golsCasa -
      jogo.golsFora
    );

  if (
    diferenca >
    FILTROS.diferencaMaxima
  ) {
    return null;
  }

  const time =
    definirTimePrecisa(
      jogo,
      r
    );

  if (!time) return null;

  const totalChutes =
    r.chutesCasa +
    r
