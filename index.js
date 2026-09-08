const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.8
// LIVE FOOTBALL + OVER + ESCANTEIOS + MOMENTUM + EVOLUÇÃO
// SOFASCORE + TELEGRAM
// ============================================================

// =========================
// CONFIGURAÇÕES
// =========================

const SOFA_BASE = "https://www.sofascore.com/api/v1";

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  "";

const CHAT_ID =
  process.env.TELEGRAM_CHAT_ID ||
  process.env.CHAT_ID ||
  "";

const POLL_MINUTES = Number(process.env.POLL_MINUTES || 5);

const SCORE_MIN = Number(process.env.SCORE_MIN || 82);
const SCORE_FORTE = Number(process.env.SCORE_FORTE || 90);

const MAX_ALERTAS = Number(process.env.MAX_ALERTAS || 3);
const MAX_STATS = Number(process.env.MAX_STATS || 4);

const HORARIO_INICIO = Number(process.env.HORARIO_INICIO || 9);
const HORARIO_FIM = Number(process.env.HORARIO_FIM || 23);

// =========================
// MEMÓRIA
// =========================

const historico = new Map();
const enviados = new Map();

const cacheStats = new Map();
const cacheMomentum = new Map();
const cacheIncidentes = new Map();

let radarRodando = false;
let ultimoRadar = null;
let ultimoErro = null;

// =========================
// HTTP SOFASCORE
// =========================

const http = axios.create({
  baseURL: SOFA_BASE,
  timeout: 12000,

  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",

    Accept: "application/json, text/plain, */*",

    "Accept-Language":
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

    Referer: "https://www.sofascore.com/",
    Origin: "https://www.sofascore.com",
    "X-Requested-With": "XMLHttpRequest",
    Connection: "keep-alive"
  }
});

// ============================================================
// FUNÇÕES BÁSICAS
// ============================================================

function horaBrasil() {
  try {
    return parseInt(
      new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hour12: false
      }),
      10
    );
  } catch {
    return new Date().getHours();
  }
}

function isHorarioAtivo() {
  const h = horaBrasil();

  if (HORARIO_INICIO <= HORARIO_FIM) {
    return h >= HORARIO_INICIO && h <= HORARIO_FIM;
  }

  return h >= HORARIO_INICIO || h <= HORARIO_FIM;
}

function num(v) {
  if (v == null) return 0;

  if (typeof v === "number") {
    return isFinite(v) ? v : 0;
  }

  const n = parseFloat(
    String(v)
      .replace("%", "")
      .replace(",", ".")
      .trim()
  );

  return isFinite(n) ? n : 0;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// TELEGRAM
// ============================================================

async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.log("[TELEGRAM] TOKEN ou CHAT_ID não configurado.");
    return false;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: texto,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      },
      {
        timeout: 10000
      }
    );

    return true;
  } catch (e) {
    console.log(
      "[TELEGRAM]",
      e.response?.data || e.message
    );

    return false;
  }
}

// ============================================================
// MINUTO DO JOGO
// ============================================================

function obterMinuto(jogo) {
  const status = jogo.status?.type;

  if (
    status === "finished" ||
    status === "canceled" ||
    status === "postponed"
  ) {
    return 0;
  }

  const m = num(jogo.time?.minute);

  if (m > 0) {
    return Math.floor(m);
  }

  const inicio =
    jogo.time?.currentPeriodStartTimestamp ||
    jogo.time?.period1StartTimestamp;

  if (inicio) {
    const agora = Math.floor(Date.now() / 1000);

    const dif = agora - Number(inicio);

    if (dif >= 0 && dif < 7200) {
      return Math.floor(dif / 60);
    }
  }

  return 0;
}

// ============================================================
// EXTRAIR ESTATÍSTICAS
// ============================================================

function extrairStats(data) {
  const stats = {
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    dangerousAttacks: 0,
    attacks: 0,
    possessionHome: 0,
    possessionAway: 0
  };

  const lista = data?.statistics || [];

  let grupos = [];

  const all = lista.find(
    (x) => String(x.period).toUpperCase() === "ALL"
  );

  if (all) {
    grupos = all.groups || [];
  } else {
    grupos = lista.flatMap((x) => x.groups || []);
  }

  for (const g of grupos) {
    for (const it of g.statisticsItems || []) {
      const nome = String(
        it.name || it.statisticsType || ""
      ).toLowerCase();

      const h = num(it.home);
      const a = num(it.away);

      if (nome.includes("total shots")) {
        stats.shots = h + a;
      }

      if (
        nome.includes("shots on target") ||
        nome.includes("shots on goal")
      ) {
        stats.shotsOnTarget = h + a;
      }

      if (nome.includes("corner")) {
        stats.corners = h + a;
      }

      if (nome.includes("dangerous attack")) {
        stats.dangerousAttacks = h + a;
      }

      if (
        nome === "attacks" ||
        nome.includes("total attacks")
      ) {
        stats.attacks = h + a;
      }

      if (
        nome.includes("ball possession") ||
        nome.includes("possession")
      ) {
        stats.possessionHome = h;
        stats.possessionAway = a;
      }
    }
  }

  return stats;
}

// ============================================================
// BUSCAR ESTATÍSTICAS
// ============================================================

async function buscarStats(id) {
  const agora = Date.now();

  const c = cacheStats.get(id);

  if (c && agora - c.timestamp < 180000) {
    return c.stats;
  }

  try {
    const r = await http.get(
      `/event/${id}/statistics`
    );

    const s = extrairStats(r.data);

    cacheStats.set(id, {
      timestamp: agora,
      stats: s
    });

    return s;
  } catch (e) {
    console.log(
      `[STATS ${id}]`,
      e.response?.status || e.message
    );

    return null;
  }
}

// ============================================================
// MOMENTUM
// ============================================================

async function buscarMomentum(id) {
  const agora = Date.now();

  const c = cacheMomentum.get(id);

  if (c && agora - c.timestamp < 180000) {
    return c.momentum;
  }

  try {
    const r = await http.get(
      `/event/${id}/graph`
    );

    const pts = r.data?.graphPoints || [];

    if (!pts.length) {
      return null;
    }

    const ult = pts.slice(-10);
    const ant = pts.slice(-20, -10);

    const medA = ult.length
      ? ult.reduce(
          (s, p) => s + num(p.value),
          0
        ) / ult.length
      : 0;

    const medB = ant.length
      ? ant.reduce(
          (s, p) => s + num(p.value),
          0
        ) / ant.length
      : 0;

    const dif = medA - medB;

    let tend = "ESTÁVEL";

    if (dif >= 8) {
      tend = "SUBINDO";
    } else if (dif <= -8) {
      tend = "CAINDO";
    }

    const momentum = {
      mediaAtual: medA,
      mediaAnterior: medB,
      diferenca: dif,
      tendencia: tend,
      ultimoValor: num(
        ult[ult.length - 1]?.value
      )
    };

    cacheMomentum.set(id, {
      timestamp: agora,
      momentum
    });

    return momentum;
  } catch (e) {
    console.log(
      `[MOMENTUM ${id}]`,
      e.response?.status || e.message
    );

    return null;
  }
}

// ============================================================
// INCIDENTES
// ============================================================

async function buscarIncidentes(id) {
  const agora = Date.now();

  const c = cacheIncidentes.get(id);

  if (c && agora - c.timestamp < 180000) {
    return c.incidentes;
  }

  try {
    const r = await http.get(
      `/event/${id}/incidents`
    );

    const inc = r.data?.incidents || [];

    cacheIncidentes.set(id, {
      timestamp: agora,
      incidentes: inc
    });

    return inc;
  } catch (e) {
    console.log(
      `[INCIDENTES ${id}]`,
      e.response?.status || e.message
    );

    return [];
  }
}

// ============================================================
// EVOLUÇÃO ENTRE CICLOS
// ============================================================

function analisarEvolucao(
  id,
  stats,
  momento,
  min
) {
  const atual = {
    minuto: min,

    shots: stats?.shots || 0,

    shotsOnTarget:
      stats?.shotsOnTarget || 0,

    corners:
      stats?.corners || 0,

    dangerousAttacks:
      stats?.dangerousAttacks || 0,

    timestamp: Date.now()
  };

  let ant = null;

  const lista = historico.get(id);

  if (lista && lista.length) {
    ant = lista[lista.length - 1];
  }

  const evo = {
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    dangerousAttacks: 0,
    minutos: 0
  };

  if (ant) {
    evo.shots =
      atual.shots - ant.shots;

    evo.shotsOnTarget =
      atual.shotsOnTarget -
      ant.shotsOnTarget;

    evo.corners =
      atual.corners - ant.corners;

    evo.dangerousAttacks =
      atual.dangerousAttacks -
      ant.dangerousAttacks;

    evo.minutos =
      atual.minuto - ant.minuto;
  }

  if (!historico.has(id)) {
    historico.set(id, []);
  }

  const arr = historico.get(id);

  arr.push(atual);

  if (arr.length > 6) {
    arr.shift();
  }

  return evo;
}

// ============================================================
// SCORE OVER
// ============================================================

function calcularScoreOver(
  jogo,
  stats,
  mom,
  ev
) {
  const min = obterMinuto(jogo);

  const gols =
    num(jogo.homeScore?.current) +
    num(jogo.awayScore?.current);

  let s = 45;

  const m = [];

  // JANELAS

  if (min >= 25 && min <= 38) {
    s += 10;
    m.push("janela 25-38'");
  }

  if (min >= 70 && min <= 84) {
    s += 12;
    m.push("pressão 70-84'");
  }

  if (min >= 85 && min <= 90) {
    s += 15;
    m.push("reta final");
  }

  // ESTATÍSTICAS

  if (stats) {
    if (stats.shots >= 8) {
      s += 8;
      m.push(`${stats.shots} chutes`);
    }

    if (stats.shots >= 12) {
      s += 5;
      m.push("volume alto de chutes");
    }

    if (stats.shotsOnTarget >= 4) {
      s += 12;
      m.push(
        `${stats.shotsOnTarget} no alvo`
      );
    }

    if (stats.shotsOnTarget >= 6) {
      s += 5;
      m.push("muita finalização no alvo");
    }

    if (stats.corners >= 5) {
      s += 8;
      m.push(`${stats.corners} escanteios`);
    }

    if (stats.dangerousAttacks >= 35) {
      s += 8;
      m.push(
        `${stats.dangerousAttacks} ataques perigosos`
      );
    }

    if (stats.dangerousAttacks >= 55) {
      s += 5;
      m.push("pressão ofensiva alta");
    }

    const mp = Math.max(
      stats.possessionHome,
      stats.possessionAway
    );

    if (mp >= 58) {
      s += 4;
      m.push(`posse ${mp}%`);
    }
  }

  // EVOLUÇÃO

  if (ev) {
    if (ev.shots >= 2) {
      s += 7;
      m.push(
        `+${ev.shots} chutes no ciclo`
      );
    }

    if (ev.shotsOnTarget >= 1) {
      s += 8;
      m.push(
        `+${ev.shotsOnTarget} no alvo`
      );
    }

    if (ev.corners >= 1) {
      s += 6;
      m.push(
        `+${ev.corners} escanteio`
      );
    }

    if (ev.dangerousAttacks >= 8) {
      s += 7;
      m.push(
        `+${ev.dangerousAttacks} ataques perigosos`
      );
    }

    if (
      ev.shots >= 2 &&
      ev.shotsOnTarget >= 1 &&
      ev.dangerousAttacks >= 8
    ) {
      s += 10;
      m.push(
        "🔥 ACELERAÇÃO CONFIRMADA"
      );
    }
  }

  // MOMENTUM

  if (mom) {
    if (mom.tendencia === "SUBINDO") {
      s += 10;
      m.push("📈 momentum subindo");
    }

    if (mom.tendencia === "CAINDO") {
      s -= 8;
      m.push("momentum caindo");
    }

    if (mom.diferenca >= 15) {
      s += 5;
      m.push(
        "forte aceleração do momentum"
      );
    }
  }

  // PLACAR

  if (gols >= 4) {
    s -= 15;
    m.push("placar já muito aberto");
  }

  if (gols <= 2) {
    s += 3;
  }

  // BAIXA PRODUÇÃO

  if (
    stats &&
    stats.shots <= 3 &&
    stats.shotsOnTarget <= 1 &&
    stats.corners <= 2
  ) {
    s -= 18;
    m.push("⚠️ baixa produção");
  }

  s = Math.max(
    0,
    Math.min(100, Math.round(s))
  );

  return {
    score: s,
    motivos: m
  };
}

// ============================================================
// SCORE ESCANTEIOS
// ============================================================

function calcularScoreCorners(
  jogo,
  stats,
  mom,
  ev
) {
  const min = obterMinuto(jogo);

  if (!stats) {
    return {
      score: 0,
      motivos: []
    };
  }

  let s = 42;

  const m = [];

  if (min >= 65 && min <= 84) {
    s += 15;
    m.push(`janela ${min}'`);
  }

  if (min >= 85 && min <= 90) {
    s += 20;
    m.push("reta final");
  }

  if (stats.corners >= 5) {
    s += 15;
    m.push(
      `${stats.corners} escanteios`
    );
  }

  if (stats.corners >= 7) {
    s += 10;
    m.push(
      "volume alto de escanteios"
    );
  }

  if (stats.dangerousAttacks >= 40) {
    s += 10;
    m.push(
      "ataques perigosos altos"
    );
  }

  if (stats.shots >= 8) {
    s += 5;
    m.push("volume de chutes");
  }

  if (stats.shotsOnTarget >= 4) {
    s += 5;
    m.push(
      "finalizações no alvo"
    );
  }

  if (ev && ev.corners >= 1) {
    s += 10;
    m.push(
      `+${ev.corners} escanteio no ciclo`
    );
  }

  if (ev && ev.dangerousAttacks >= 8) {
    s += 7;
    m.push(
      "ataques perigosos acelerando"
    );
  }

  if (
    mom &&
    mom.tendencia === "SUBINDO"
  ) {
    s += 10;
    m.push(
      "📈 momentum subindo"
    );
  }

  s = Math.max(
    0,
    Math.min(100, Math.round(s))
  );

  return {
    score: s,
    motivos: m
  };
}

// ============================================================
// CONTROLE DE ALERTAS
// ============================================================

function chaveAlerta(id, mercado) {
  return `${id}-${mercado}`;
}

function podeEnviar(
  id,
  mercado,
  score
) {
  const ch =
    chaveAlerta(id, mercado);

  const ant = enviados.get(ch);

  if (!ant) {
    return true;
  }

  // Permite atualização para MUITO FORTE
  if (
    score >= SCORE_FORTE &&
    ant.score < SCORE_FORTE
  ) {
    return true;
  }

  // Reavalia depois de 30 minutos
  if (
    Date.now() - ant.timestamp >
    1800000
  ) {
    return true;
  }

  return false;
}

function marcarEnviado(
  id,
  mercado,
  score
) {
  enviados.set(
    chaveAlerta(id, mercado),
    {
      score,
      timestamp: Date.now()
    }
  );
}

// ============================================================
// MENSAGEM TELEGRAM
// ============================================================

function criarMensagem(
  jogo,
  mercado,
  analise,
  stats,
  mom,
  ev
) {
  const home =
    jogo.homeScore?.current ?? 0;

  const away =
    jogo.awayScore?.current ?? 0;

  const min =
    obterMinuto(jogo);

  const emoji =
    analise.score >= SCORE_FORTE
      ? "🔥🔥🔥"
      : "🟢";

  const nivel =
    analise.score >= SCORE_FORTE
      ? "MUITO FORTE"
      : "FORTE";

  let t =
`${emoji} *ELITE RADAR V7.8*

*${nivel} — ${analise.score}/100*

⚽ *${jogo.homeTeam?.name || "Casa"}* ${home} x ${away} *${jogo.awayTeam?.name || "Fora"}*

⏱️ ${min}'
🏆 ${jogo.tournament?.name || "Competição"}

🎯 *MERCADO:* ${mercado}

📊 *MOTIVOS:*`;

  for (const mo of analise.motivos) {
    t += `\n• ${mo}`;
  }

  if (stats) {
    t +=
`

📈 *LIVE STATS*
• Chutes: ${stats.shots}
• No alvo: ${stats.shotsOnTarget}
• Escanteios: ${stats.corners}
• Ataques: ${stats.attacks}
• Perigosos: ${stats.dangerousAttacks}
• Posse: ${stats.possessionHome}% x ${stats.possessionAway}%`;
  }

  if (ev) {
    t +=
`

⚡ *ÚLTIMO CICLO*
• Chutes: +${ev.shots}
• No alvo: +${ev.shotsOnTarget}
• Escanteios: +${ev.corners}
• Perigosos: +${ev.dangerousAttacks}`;
  }

  if (mom) {
    t +=
`

📈 *MOMENTUM*
• Tendência: ${mom.tendencia}
• Variação: ${
      mom.diferenca > 0 ? "+" : ""
    }${mom.diferenca.toFixed(1)}`;
  }

  t +=
`

⚠️ *SINAL ESTATÍSTICO — NÃO GARANTE RESULTADO*

🆔 ${jogo.id}`;

  return t;
}

// ============================================================
// LIMPEZA DE MEMÓRIA
// ============================================================

function limparMemoria() {
  const agora = Date.now();

  // ALERTAS
  for (
    const [k, d] of enviados.entries()
  ) {
    if (
      agora - d.timestamp >
      86400000
    ) {
      enviados.delete(k);
    }
  }

  // HISTÓRICO
  for (
    const [id, lista] of historico.entries()
  ) {
    if (!lista.length) {
      historico.delete(id);
      continue;
    }

    const ult =
      lista[lista.length - 1];

    if (
      agora - ult.timestamp >
      7200000
    ) {
      historico.delete(id);
    }
  }

  // CACHE STATS
  for (
    const [id, d] of cacheStats.entries()
  ) {
    if (
      agora - d.timestamp >
      600000
    ) {
      cacheStats.delete(id);
    }
  }

  // CACHE MOMENTUM
  for (
    const [id, d] of cacheMomentum.entries()
  ) {
    if (
      agora - d.timestamp >
      600000
    ) {
      cacheMomentum.delete(id);
    }
  }

  // CACHE INCIDENTES
  for (
    const [id, d] of cacheIncidentes.entries()
  ) {
    if (
      agora - d.timestamp >
      600000
    ) {
      cacheIncidentes.delete(id);
    }
  }
}

// ============================================================
// RADAR PRINCIPAL
// ============================================================

async function radar() {
  if (radarRodando) {
    return {
      jogos: 0,
      candidatos: 0,
      sinais: 0,
      ignorado: true
    };
  }

  if (!isHorarioAtivo()) {
    console.log(
      `[RADAR] Fora horário ${horaBrasil()}h`
    );

    return {
      jogos: 0,
      candidatos: 0,
      sinais: 0,
      dormindo: true
    };
  }

  radarRodando = true;

  let jogos = 0;
  let candidatos = 0;
  let statsQ = 0;
  let sinais = 0;

  try {
    // ========================================================
    // BUSCA JOGOS AO VIVO
    // ========================================================

    const res = await http.get(
      "/sport/football/events/live"
    );

    const eventos =
      res.data?.events || [];

    jogos = eventos.length;

    console.log(
      `[V7.8] ${jogos} jogos ao vivo`
    );

    // ========================================================
    // PRIORIZAÇÃO
    // ========================================================

    const lista = eventos
      .map((jogo) => {
        const min =
          obterMinuto(jogo);

        const gols =
          num(jogo.homeScore?.current) +
          num(jogo.awayScore?.current);

        let pri = 0;

        if (
          min >= 25 &&
          min <= 38
        ) {
          pri += 20;
        }

        if (
          min >= 70 &&
          min <= 90
        ) {
          pri += 30;
        }

        if (gols <= 2) {
          pri += 10;
        }

        if (gols >= 4) {
          pri -= 15;
        }

        return {
          jogo,
          minuto: min,
          prioridade: pri
        };
      })

      .filter((i) => {
        const m = i.minuto;

        const g =
          num(
            i.jogo.homeScore?.current
          ) +
          num(
            i.jogo.awayScore?.current
          );

        if (m < 25 || m > 90) {
          return false;
        }

        if (g >= 5) {
          return false;
        }

        return (
          (m >= 25 && m <= 38) ||
          (m >= 70 && m <= 90)
        );
      })

      .sort(
        (a, b) =>
          b.prioridade -
          a.prioridade
      );

    candidatos = lista.length;

    console.log(
      `[RADAR] Candidatos: ${candidatos}`
    );

    // ========================================================
    // ANÁLISE DOS MELHORES JOGOS
    // ========================================================

    for (
      const item of lista.slice(
        0,
        MAX_STATS
      )
    ) {
      if (
        sinais >= MAX_ALERTAS
      ) {
        break;
      }

      const jogo = item.jogo;

      // ------------------------------------------------------
      // STATS
      // ------------------------------------------------------

      const stats =
        await buscarStats(
          jogo.id
        );

      statsQ++;

      await esperar(400);

      // ------------------------------------------------------
      // MOMENTUM
      // ------------------------------------------------------

      const mom =
        await buscarMomentum(
          jogo.id
        );

      await esperar(350);

      // ------------------------------------------------------
      // INCIDENTES
      // ------------------------------------------------------

      const inc =
        await buscarIncidentes(
          jogo.id
        );

      const vermelho =
        inc.some(
          (x) =>
            x.incidentType === "card" &&
            (
              x.incidentClass === "red" ||
              x.incidentClass === "secondYellow"
            )
        );

      // ------------------------------------------------------
      // EVOLUÇÃO
      // ------------------------------------------------------

      const ev =
        analisarEvolucao(
          jogo.id,
          stats,
          mom,
          item.minuto
        );

      // ======================================================
      // OVER
      // ======================================================

      const over =
        calcularScoreOver(
          jogo,
          stats,
          mom,
          ev
        );

      if (vermelho) {
        over.score =
          Math.min(
            100,
            over.score + 3
          );

        over.motivos.push(
          "🚨 cartão vermelho"
        );
      }

      if (
        over.score >= SCORE_MIN &&
        podeEnviar(
          jogo.id,
          "OVER",
          over.score
        )
      ) {
        const msg =
          criarMensagem(
            jogo,
            "OVER LIVE",
            over,
            stats,
            mom,
            ev
          );

        const enviado =
          await enviarTelegram(
            msg
          );

        if (enviado) {
          marcarEnviado(
            jogo.id,
            "OVER",
            over.score
          );

          sinais++;

          console.log(
            `[OVER] ${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} = ${over.score}`
          );
        }
      }

      if (
        sinais >= MAX_ALERTAS
      ) {
        break;
      }

      // ======================================================
      // ESCANTEIOS
      // ======================================================

      const corn =
        calcularScoreCorners(
          jogo,
          stats,
          mom,
          ev
        );

      if (
        corn.score >= SCORE_MIN &&
        podeEnviar(
          jogo.id,
          "ESCANTEIOS",
          corn.score
        )
      ) {
        const msg =
          criarMensagem(
            jogo,
            "ESCANTEIOS LIVE",
            corn,
            stats,
            mom,
            ev
          );

        const enviado =
          await enviarTelegram(
            msg
          );

        if (enviado) {
          marcarEnviado(
            jogo.id,
            "ESCANTEIOS",
            corn.score
          );

          sinais++;

          console.log(
            `[CANTOS] ${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} = ${corn.score}`
          );
        }
      }
    }

    // ========================================================
    // LIMPEZA
    // ========================================================

    limparMemoria();

    ultimoRadar =
      new Date().toISOString();

    ultimoErro = null;

    console.log(
      `[RADAR OK] jogos=${jogos} candidatos=${candidatos} stats=${statsQ} sinais=${sinais}`
    );

    return {
      jogos,
      candidatos,
      statsQ,
      sinais,
      horario: horaBrasil(),
      timestamp: ultimoRadar
    };
  } catch (e) {
    ultimoErro =
      e.response?.data ||
      e.message ||
      String(e);

    console.log(
      "[RADAR ERRO]",
      ultimoErro
    );

    return {
      jogos,
      candidatos,
      statsQ,
      sinais,
      erro: ultimoErro
    };
  } finally {
    radarRodando = false;
  }
}

// ============================================================
// ROTAS DO SERVIDOR
// ============================================================

app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    sistema: "ELITE RADAR V7.8",
    horaBrasil: horaBrasil(),
    horarioAtivo: isHorarioAtivo(),
    radarRodando,
    ultimoRadar,
    ultimoErro
  });
});

// ============================================================
// STATUS
// ============================================================

app.get("/status", (req, res) => {
  res.status(200).json({
    sistema: "ELITE RADAR V7.8",
    status: "online",

    horaBrasil:
      `${String(horaBrasil()).padStart(2, "0")}:00`,

    horarioAtivo:
      isHorarioAtivo(),

    radarRodando,

    ultimoRadar,

    ultimoErro,

    memoria: {
      historico: historico.size,
      enviados: enviados.size,
      cacheStats: cacheStats.size,
      cacheMomentum: cacheMomentum.size,
      cacheIncidentes: cacheIncidentes.size
    },

    configuracao: {
      pollMinutes: POLL_MINUTES,
      scoreMin: SCORE_MIN,
      scoreForte: SCORE_FORTE,
      maxAlertas: MAX_ALERTAS,
      maxStats: MAX_STATS,
      horarioInicio: HORARIO_INICIO,
      horarioFim: HORARIO_FIM
    }
  });
});

// ============================================================
// EXECUTAR RADAR MANUALMENTE
// ============================================================

app.get("/radar", async (req, res) => {
  try {
    const resultado =
      await radar();

    res.status(200).json(
      resultado
    );
  } catch (e) {
    res.status(500).json({
      erro:
        e.message || String(e)
    });
  }
});

// ============================================================
// TESTE TELEGRAM
// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {
    const ok =
      await enviarTelegram(
        "🟢 *ELITE RADAR V7.8*\n\nTeste do Telegram realizado com sucesso."
      );

    res.status(
      ok ? 200 : 500
    ).json({
      telegram: ok
        ? "OK"
        : "FALHA"
    });
  }
);

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log(
    "============================================================"
  );

  console.log(
    "🚀 ELITE RADAR V7.8 ONLINE"
  );

  console.log(
    `🌐 Porta: ${PORT}`
  );

  console.log(
    `⏱️ Intervalo: ${POLL_MINUTES} minutos`
  );

  console.log(
    `🎯 Score mínimo: ${SCORE_MIN}`
  );

  console.log(
    `🔥 Score forte: ${SCORE_FORTE}`
  );

  console.log(
    `📊 Máximo de análises: ${MAX_STATS}`
  );

  console.log(
    `🚨 Máximo de alertas/ciclo: ${MAX_ALERTAS}`
  );

  console.log(
    `🕘 Horário: ${HORARIO_INICIO}h às ${HORARIO_FIM}h`
  );

  console.log(
    `🇧🇷 Hora Brasil: ${horaBrasil()}h`
  );

  console.log(
    `📱 Telegram: ${
      TELEGRAM_TOKEN && CHAT_ID
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    }`
  );

  console.log(
    "============================================================"
  );
});

// ============================================================
// CICLO AUTOMÁTICO
// ============================================================

// Primeira execução após 10 segundos
setTimeout(() => {
  radar().catch((e) => {
    console.log(
      "[RADAR INICIAL]",
      e.message
    );
  });
}, 10000);

// Execução periódica
setInterval(() => {
  radar().catch((e) => {
    console.log(
      "[RADAR INTERVALO]",
      e.message
    );
  });
}, Math.max(
  1,
  POLL_MINUTES
) * 60 * 1000);

// Limpeza periódica
setInterval(() => {
  limparMemoria();
}, 10 * 60 * 1000);
