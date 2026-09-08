const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.7
// SOFASCORE LIVE
// PRESSÃO + MOMENTUM + EVOLUÇÃO ENTRE CICLOS
// OVER LIVE + ESCANTEIOS LIVE
// ============================================================

const SOFA_BASE = "https://api.sofascore.com/api/v1";

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.TOKEN ||
  "";

const CHAT_ID =
  process.env.TELEGRAM_CHAT_ID ||
  process.env.CHAT_ID ||
  "";

const POLL_MINUTES =
  Number(process.env.POLL_MINUTES || 5);

const SCORE_MIN =
  Number(process.env.SCORE_MIN || 82);

const SCORE_FORTE =
  Number(process.env.SCORE_FORTE || 90);

const MAX_ALERTAS =
  Number(process.env.MAX_ALERTAS || 3);

const MAX_STATS =
  Number(process.env.MAX_STATS || 6);

const HORARIO_INICIO =
  Number(process.env.HORARIO_INICIO || 9);

const HORARIO_FIM =
  Number(process.env.HORARIO_FIM || 23);

// ============================================================
// MEMÓRIA
// ============================================================

// Histórico curto de cada jogo
const historico = new Map();

// Alertas já enviados
const enviados = new Map();

// Cache de estatísticas
const cacheStats = new Map();

// Cache de momentum
const cacheMomentum = new Map();

// Cache de incidentes
const cacheIncidentes = new Map();

let radarRodando = false;
let ultimoRadar = null;
let ultimoErro = null;

// ============================================================
// HTTP
// ============================================================

const http = axios.create({
  baseURL: SOFA_BASE,
  timeout: 12000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    "Accept": "application/json"
  }
});

// ============================================================
// HORA
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

// ============================================================
// UTILITÁRIOS
// ============================================================

function num(valor) {
  if (valor === null || valor === undefined) {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  const n = parseFloat(
    String(valor)
      .replace("%", "")
      .replace(",", ".")
      .trim()
  );

  return Number.isFinite(n) ? n : 0;
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// TELEGRAM
// ============================================================

async function enviarTelegram(texto) {

  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.log("[TELEGRAM] Não configurado.");
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
      "[TELEGRAM] Erro:",
      e.response?.data || e.message
    );

    return false;
  }
}

// ============================================================
// MINUTO DO JOGO
// ============================================================

function obterMinuto(jogo) {

  const status =
    jogo.status?.type;

  if (
    status === "finished" ||
    status === "canceled" ||
    status === "postponed"
  ) {
    return 0;
  }

  const minuto =
    num(jogo.time?.minute);

  if (minuto > 0) {
    return Math.floor(minuto);
  }

  const inicio =
    jogo.time?.currentPeriodStartTimestamp ||
    jogo.time?.period1StartTimestamp;

  if (inicio) {

    const agora =
      Math.floor(Date.now() / 1000);

    const diferenca =
      agora - Number(inicio);

    if (
      diferenca >= 0 &&
      diferenca < 120 * 60
    ) {
      return Math.floor(
        diferenca / 60
      );
    }
  }

  return 0;
}

// ============================================================
// ESTATÍSTICAS
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

  const lista =
    data?.statistics || [];

  // Primeiro tenta ALL
  let grupos = [];

  const all =
    lista.find(
      x =>
        String(x.period).toUpperCase() === "ALL"
    );

  if (all) {
    grupos = all.groups || [];
  } else {
    grupos = lista.flatMap(
      x => x.groups || []
    );
  }

  for (const grupo of grupos) {

    for (
      const item
      of grupo.statisticsItems || []
    ) {

      const nome =
        String(
          item.name ||
          item.statisticsType ||
          ""
        ).toLowerCase();

      const home =
        num(item.home);

      const away =
        num(item.away);

      if (
        nome.includes("total shots") ||
        nome.includes("shots total")
      ) {
        stats.shots =
          home + away;
      }

      if (
        nome.includes("shots on target") ||
        nome.includes("shots on goal")
      ) {
        stats.shotsOnTarget =
          home + away;
      }

      if (
        nome.includes("corner")
      ) {
        stats.corners =
          home + away;
      }

      if (
        nome.includes("dangerous attack")
      ) {
        stats.dangerousAttacks =
          home + away;
      }

      if (
        nome === "attacks" ||
        nome.includes("total attacks")
      ) {
        stats.attacks =
          home + away;
      }

      if (
        nome.includes("ball possession") ||
        nome.includes("possession")
      ) {

        stats.possessionHome =
          home;

        stats.possessionAway =
          away;
      }
    }
  }

  return stats;
}

// ============================================================
// BUSCAR STATS
// ============================================================

async function buscarStats(eventId) {

  const agora =
    Date.now();

  const cache =
    cacheStats.get(eventId);

  if (
    cache &&
    agora - cache.timestamp <
      3 * 60 * 1000
  ) {
    return cache.stats;
  }

  try {

    const res =
      await http.get(
        `/event/${eventId}/statistics`
      );

    const stats =
      extrairStats(res.data);

    cacheStats.set(
      eventId,
      {
        timestamp: agora,
        stats
      }
    );

    return stats;

  } catch (e) {

    console.log(
      `[STATS ${eventId}]`,
      e.response?.status ||
      e.message
    );

    return null;
  }
}

// ============================================================
// MOMENTUM
// ============================================================

async function buscarMomentum(eventId) {

  const agora =
    Date.now();

  const cache =
    cacheMomentum.get(eventId);

  if (
    cache &&
    agora - cache.timestamp <
      3 * 60 * 1000
  ) {
    return cache.momentum;
  }

  try {

    const res =
      await http.get(
        `/event/${eventId}/graph`
      );

    const pontos =
      res.data?.graphPoints || [];

    if (!pontos.length) {
      return null;
    }

    const ultimos =
      pontos.slice(-10);

    const anteriores =
      pontos.slice(-20, -10);

    const mediaAtual =
      ultimos.length
        ? ultimos.reduce(
            (s, p) =>
              s + num(p.value),
            0
          ) / ultimos.length
        : 0;

    const mediaAnterior =
      anteriores.length
        ? anteriores.reduce(
            (s, p) =>
              s + num(p.value),
            0
          ) / anteriores.length
        : 0;

    const diferenca =
      mediaAtual - mediaAnterior;

    let tendencia =
      "ESTÁVEL";

    if (diferenca >= 8) {
      tendencia = "SUBINDO";
    } else if (diferenca <= -8) {
      tendencia = "CAINDO";
    }

    const momentum = {
      mediaAtual,
      mediaAnterior,
      diferenca,
      tendencia,
      ultimoValor:
        num(
          ultimos[
            ultimos.length - 1
          ]?.value
        )
    };

    cacheMomentum.set(
      eventId,
      {
        timestamp: agora,
        momentum
      }
    );

    return momentum;

  } catch (e) {

    console.log(
      `[MOMENTUM ${eventId}]`,
      e.response?.status ||
      e.message
    );

    return null;
  }
}

// ============================================================
// INCIDENTES
// ============================================================

async function buscarIncidentes(eventId) {

  const agora =
    Date.now();

  const cache =
    cacheIncidentes.get(eventId);

  if (
    cache &&
    agora - cache.timestamp <
      3 * 60 * 1000
  ) {
    return cache.incidentes;
  }

  try {

    const res =
      await http.get(
        `/event/${eventId}/incidents`
      );

    const incidentes =
      res.data?.incidents || [];

    cacheIncidentes.set(
      eventId,
      {
        timestamp: agora,
        incidentes
      }
    );

    return incidentes;

  } catch (e) {

    console.log(
      `[INCIDENTES ${eventId}]`,
      e.response?.status ||
      e.message
    );

    return [];
  }
}

// ============================================================
// ANÁLISE DE EVOLUÇÃO
// ============================================================

function analisarEvolucao(
  eventId,
  stats,
  momentum,
  minuto
) {

  const atual = {
    minuto,
    shots: stats?.shots || 0,
    shotsOnTarget:
      stats?.shotsOnTarget || 0,
    corners:
      stats?.corners || 0,
    dangerousAttacks:
      stats?.dangerousAttacks || 0,
    timestamp: Date.now()
  };

  let anterior = null;

  const lista =
    historico.get(eventId);

  if (lista && lista.length) {
    anterior =
      lista[lista.length - 1];
  }

  const evolucao = {
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    dangerousAttacks: 0,
    minutos: 0
  };

  if (anterior) {

    evolucao.shots =
      atual.shots -
      anterior.shots;

    evolucao.shotsOnTarget =
      atual.shotsOnTarget -
      anterior.shotsOnTarget;

    evolucao.corners =
      atual.corners -
      anterior.corners;

    evolucao.dangerousAttacks =
      atual.dangerousAttacks -
      anterior.dangerousAttacks;

    evolucao.minutos =
      atual.minuto -
      anterior.minuto;
  }

  // Guarda somente os últimos 6 ciclos
  if (!historico.has(eventId)) {
    historico.set(eventId, []);
  }

  const array =
    historico.get(eventId);

  array.push(atual);

  if (array.length > 6) {
    array.shift();
  }

  return evolucao;
}

// ============================================================
// SCORE OVER
// ============================================================

function calcularScoreOver(
  jogo,
  stats,
  momentum,
  evolucao
) {

  const minuto =
    obterMinuto(jogo);

  const home =
    num(
      jogo.homeScore?.current
    );

  const away =
    num(
      jogo.awayScore?.current
    );

  const gols =
    home + away;

  let score = 45;

  const motivos = [];

  // ----------------------------------------------------------
  // JANELA
  // ----------------------------------------------------------

  if (
    minuto >= 25 &&
    minuto <= 38
  ) {

    score += 10;

    motivos.push(
      "janela 25-38'"
    );
  }

  if (
    minuto >= 70 &&
    minuto <= 84
  ) {

    score += 12;

    motivos.push(
      "pressão 70-84'"
    );
  }

  if (
    minuto >= 85 &&
    minuto <= 90
  ) {

    score += 15;

    motivos.push(
      "reta final"
    );
  }

  // ----------------------------------------------------------
  // PRODUÇÃO
  // ----------------------------------------------------------

  if (stats) {

    if (stats.shots >= 8) {
      score += 8;
      motivos.push(
        `${stats.shots} chutes`
      );
    }

    if (stats.shots >= 12) {
      score += 5;
      motivos.push(
        "volume alto de chutes"
      );
    }

    if (
      stats.shotsOnTarget >= 4
    ) {

      score += 12;

      motivos.push(
        `${stats.shotsOnTarget} no alvo`
      );
    }

    if (
      stats.shotsOnTarget >= 6
    ) {

      score += 5;

      motivos.push(
        "muita finalização no alvo"
      );
    }

    if (
      stats.corners >= 5
    ) {

      score += 8;

      motivos.push(
        `${stats.corners} escanteios`
      );
    }

    if (
      stats.dangerousAttacks >= 35
    ) {

      score += 8;

      motivos.push(
        `${stats.dangerousAttacks} ataques perigosos`
      );
    }

    if (
      stats.dangerousAttacks >= 55
    ) {

      score += 5;

      motivos.push(
        "pressão ofensiva alta"
      );
    }

    const maiorPosse =
      Math.max(
        stats.possessionHome,
        stats.possessionAway
      );

    if (maiorPosse >= 58) {

      score += 4;

      motivos.push(
        `posse ${maiorPosse}%`
      );
    }
  }

  // ----------------------------------------------------------
  // ACELERAÇÃO
  // ----------------------------------------------------------

  if (evolucao) {

    if (
      evolucao.shots >= 2
    ) {

      score += 7;

      motivos.push(
        `+${evolucao.shots} chutes no ciclo`
      );
    }

    if (
      evolucao.shotsOnTarget >= 1
    ) {

      score += 8;

      motivos.push(
        `+${evolucao.shotsOnTarget} no alvo`
      );
    }

    if (
      evolucao.corners >= 1
    ) {

      score += 6;

      motivos.push(
        `+${evolucao.corners} escanteio`
      );
    }

    if (
      evolucao.dangerousAttacks >= 8
    ) {

      score += 7;

      motivos.push(
        `+${evolucao.dangerousAttacks} ataques perigosos`
      );
    }

    if (
      evolucao.shots >= 2 &&
      evolucao.shotsOnTarget >= 1 &&
      evolucao.dangerousAttacks >= 8
    ) {

      score += 10;

      motivos.push(
        "🔥 ACELERAÇÃO CONFIRMADA"
      );
    }
  }

  // ----------------------------------------------------------
  // MOMENTUM
  // ----------------------------------------------------------

  if (momentum) {

    if (
      momentum.tendencia ===
      "SUBINDO"
    ) {

      score += 10;

      motivos.push(
        "📈 momentum subindo"
      );
    }

    if (
      momentum.tendencia ===
      "CAINDO"
    ) {

      score -= 8;

      motivos.push(
        "momentum caindo"
      );
    }

    if (
      momentum.diferenca >= 15
    ) {

      score += 5;

      motivos.push(
        "forte aceleração do momentum"
      );
    }
  }

  // ----------------------------------------------------------
  // PLACAR
  // ----------------------------------------------------------

  if (gols >= 4) {

    score -= 15;

    motivos.push(
      "placar já muito aberto"
    );
  }

  if (gols <= 2) {
    score += 3;
  }

  // ----------------------------------------------------------
  // JOGO MORTO
  // ----------------------------------------------------------

  if (
    stats &&
    stats.shots <= 3 &&
    stats.shotsOnTarget <= 1 &&
    stats.corners <= 2
  ) {

    score -= 18;

    motivos.push(
      "⚠️ baixa produção"
    );
  }

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
// SCORE ESCANTEIOS
// ============================================================

function calcularScoreCorners(
  jogo,
  stats,
  momentum,
  evolucao
) {

  const minuto =
    obterMinuto(jogo);

  if (!stats) {
    return {
      score: 0,
      motivos: []
    };
  }

  let score = 42;

  const motivos = [];

  if (
    minuto >= 65 &&
    minuto <= 84
  ) {

    score += 15;

    motivos.push(
      `janela ${minuto}'`
    );
  }

  if (
    minuto >= 85 &&
    minuto <= 90
  ) {

    score += 20;

    motivos.push(
      "reta final"
    );
  }

  if (stats.corners >= 5) {

    score += 15;

    motivos.push(
      `${stats.corners} escanteios`
    );
  }

  if (stats.corners >= 7) {

    score += 10;

    motivos.push(
      "volume alto de escanteios"
    );
  }

  if (
    stats.dangerousAttacks >= 40
  ) {

    score += 10;

    motivos.push(
      "ataques perigosos altos"
    );
  }

  if (stats.shots >= 8) {

    score += 5;

    motivos.push(
      "volume de chutes"
    );
  }

  if (
    stats.shotsOnTarget >= 4
  ) {

    score += 5;

    motivos.push(
      "finalizações no alvo"
    );
  }

  // ----------------------------------------------------------
  // EVOLUÇÃO
  // ----------------------------------------------------------

  if (
    evolucao.corners >= 1
  ) {

    score += 10;

    motivos.push(
      `+${evolucao.corners} escanteio no ciclo`
    );
  }

  if (
    evolucao.dangerousAttacks >= 8
  ) {

    score += 7;

    motivos.push(
      "ataques perigosos acelerando"
    );
  }

  // ----------------------------------------------------------
  // MOMENTUM
  // ----------------------------------------------------------

  if (
    momentum &&
    momentum.tendencia ===
    "SUBINDO"
  ) {

    score += 10;

    motivos.push(
      "📈 momentum subindo"
    );
  }

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
// ALERTAS
// ============================================================

function chaveAlerta(
  eventId,
  mercado
) {

  return `${eventId}-${mercado}`;
}

function podeEnviar(
  eventId,
  mercado,
  score
) {

  const chave =
    chaveAlerta(
      eventId,
      mercado
    );

  const anterior =
    enviados.get(chave);

  if (!anterior) {
    return true;
  }

  // Upgrade para sinal muito forte
  if (
    score >= SCORE_FORTE &&
    anterior.score < SCORE_FORTE
  ) {
    return true;
  }

  // Depois de 30 minutos
  if (
    Date.now() -
    anterior.timestamp >
    30 * 60 * 1000
  ) {
    return true;
  }

  return false;
}

function marcarEnviado(
  eventId,
  mercado,
  score
) {

  enviados.set(
    chaveAlerta(
      eventId,
      mercado
    ),
    {
      score,
      timestamp: Date.now()
    }
  );
}

// ============================================================
// MENSAGEM
// ============================================================

function criarMensagem(
  jogo,
  mercado,
  analise,
  stats,
  momentum,
  evolucao
) {

  const home =
    jogo.homeScore?.current ?? 0;

  const away =
    jogo.awayScore?.current ?? 0;

  const minuto =
    obterMinuto(jogo);

  const emoji =
    analise.score >= SCORE_FORTE
      ? "🔥🔥🔥"
      : "🟢";

  const nivel =
    analise.score >= SCORE_FORTE
      ? "MUITO FORTE"
      : "FORTE";

  let texto =
`${emoji} *ELITE RADAR V7.7*

*${nivel} — ${analise.score}/100*

⚽ *${jogo.homeTeam?.name || "Casa"}* ${home} x ${away} *${jogo.awayTeam?.name || "Fora"}*

⏱️ ${minuto}'
🏆 ${jogo.tournament?.name || "Competição"}

🎯 *MERCADO:* ${mercado}

📊 *MOTIVOS:*`;

  for (
    const motivo
    of analise.motivos
  ) {

    texto +=
      `\n• ${motivo}`;
  }

  if (stats) {

    texto +=
`

📈 *LIVE STATS*
• Chutes: ${stats.shots}
• No alvo: ${stats.shotsOnTarget}
• Escanteios: ${stats.corners}
• Ataques: ${stats.attacks}
• Perigosos: ${stats.dangerousAttacks}
• Posse: ${stats.possessionHome}% x ${stats.possessionAway}%`;
  }

  if (evolucao) {

    texto +=
`

⚡ *ÚLTIMO CICLO*
• Chutes: +${evolucao.shots}
• No alvo: +${evolucao.shotsOnTarget}
• Escanteios: +${evolucao.corners}
• Perigosos: +${evolucao.dangerousAttacks}`;
  }

  if (momentum) {

    texto +=
`

📈 *MOMENTUM*
• Tendência: ${momentum.tendencia}
• Variação: ${momentum.diferenca > 0 ? "+" : ""}${momentum.diferenca.toFixed(1)}`;
  }

  texto +=
`

⚠️ *SINAL ESTATÍSTICO — NÃO GARANTE RESULTADO*

🆔 ${jogo.id}`;

  return texto;
}

// ============================================================
// LIMPEZA
// ============================================================

function limparMemoria() {

  const agora =
    Date.now();

  // Alertas
  for (
    const [chave, dados]
    of enviados.entries()
  ) {

    if (
      agora - dados.timestamp >
      24 * 60 * 60 * 1000
    ) {

      enviados.delete(chave);
    }
  }

  // Histórico
  for (
    const [id, lista]
    of historico.entries()
  ) {

    if (!lista.length) {
      historico.delete(id);
      continue;
    }

    const ultimo =
      lista[lista.length - 1];

    if (
      agora - ultimo.timestamp >
      2 * 60 * 60 * 1000
    ) {

      historico.delete(id);
    }
  }

  // Cache
  for (
    const [id, dados]
    of cacheStats.entries()
  ) {

    if (
      agora - dados.timestamp >
      10 * 60 * 1000
    ) {

      cacheStats.delete(id);
    }
  }

  for (
    const [id, dados]
    of cacheMomentum.entries()
  ) {

    if (
      agora - dados.timestamp >
      10 * 60 * 1000
    ) {

      cacheMomentum.delete(id);
    }
  }

  for (
    const [id, dados]
    of cacheIncidentes.entries()
  ) {

    if (
      agora - dados.timestamp >
      10 * 60 * 1000
    ) {

      cacheIncidentes.delete(id);
    }
  }
}

// ============================================================
// RADAR
// ============================================================

async function radar() {

  if (radarRodando) {

    console.log(
      "[RADAR] Ciclo anterior ainda rodando."
    );

    return {
      jogos: 0,
      candidatos: 0,
      sinais: 0,
      ignorado: true
    };
  }

  if (!isHorarioAtivo()) {

    console.log(
      `[RADAR] Fora do horário: ${horaBrasil()}h`
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
  let statsConsultadas = 0;
  let sinais = 0;

  try {

    // --------------------------------------------------------
    // LIVE
    // --------------------------------------------------------

    const res =
      await http.get(
        "/sport/football/events/live"
      );

    const eventos =
      res.data?.events || [];

    jogos =
      eventos.length;

    console.log(
      `[V7.7] ${jogos} jogos ao vivo`
    );

    // --------------------------------------------------------
    // FILTRO
    // --------------------------------------------------------

    const lista =
      eventos
        .map(jogo => {

          const minuto =
            obterMinuto(jogo);

          const home =
            num(
              jogo.homeScore?.current
            );

          const away =
            num(
              jogo.awayScore?.current
            );

          const gols =
            home + away;

          let prioridade = 0;

          if (
            minuto >= 25 &&
            minuto <= 38
          ) {
            prioridade += 20;
          }

          if (
            minuto >= 70 &&
            minuto <= 90
          ) {
            prioridade += 30;
          }

          if (gols <= 2) {
            prioridade += 10;
          }

          if (gols >= 4) {
            prioridade -= 15;
          }

          return {
            jogo,
            minuto,
            prioridade
          };

        })
        .filter(item => {

          const m =
            item.minuto;

          const gols =
            num(
              item.jogo.homeScore?.current
            ) +
            num(
              item.jogo.awayScore?.current
            );

          if (
            m < 25 ||
            m > 90
          ) {
            return false;
          }

          if (gols >= 5) {
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

    candidatos =
      lista.length;

    // --------------------------------------------------------
    // ANÁLISE
    // --------------------------------------------------------

    for (
      const item
      of lista.slice(
        0,
        MAX_STATS
      )
    ) {

      if (
        sinais >= MAX_ALERTAS
      ) {
        break;
      }

      const jogo =
        item.jogo;

      const stats =
        await buscarStats(
          jogo.id
        );

      statsConsultadas++;

      await esperar(300);

      const momentum =
        await buscarMomentum(
          jogo.id
        );

      await esperar(250);

      const incidentes =
        await buscarIncidentes(
          jogo.id
        );

      // Não usamos incidentes para
      // inflar artificialmente a pontuação,
      // mas detectamos cartão vermelho.
      const vermelho =
        incidentes.some(
          x =>
            x.incidentType === "card" &&
            (
              x.incidentClass === "red" ||
              x.incidentClass === "secondYellow"
            )
        );

      // ------------------------------------------------------
      // EVOLUÇÃO
      // ------------------------------------------------------

      const evolucao =
        analisarEvolucao(
          jogo.id,
          stats,
          momentum,
          item.minuto
        );

      // ------------------------------------------------------
      // SCORE OVER
      // ------------------------------------------------------

      const over =
        calcularScoreOver(
          jogo,
          stats,
          momentum,
          evolucao
        );

      // Cartão vermelho torna o contexto
      // muito diferente; não bloqueamos,
      // apenas informamos.
      if (vermelho) {

        over.score =
          Math.min(
            100,
            over.score + 3
          );

        over.motivos.push(
          "🚨 cartão vermelho detectado"
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

        const mensagem =
          criarMensagem(
            jogo,
            "OVER LIVE",
            over,
            stats,
            momentum,
            evolucao
          );

        const enviado =
          await enviarTelegram(
            mensagem
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

      // ------------------------------------------------------
      // SCORE ESCANTEIOS
      // ------------------------------------------------------

      const corners =
        calcularScoreCorners(
          jogo,
          stats,
          momentum,
          evolucao
        );

      if (
        corners.score >= SCORE_MIN &&
        podeEnviar(
          jogo.id,
          "ESCANTEIOS",
          corners.score
        )
      ) {

        const mensagem =
          criarMensagem(
            jogo,
            "ESCANTEIOS LIVE",
            corners,
            stats,
            momentum,
            evolucao
          );

        const enviado =
          await enviarTelegram(
            mensagem
          );

        if (enviado) {

          marcarEnviado(
            jogo.id,
            "ESCANTEIOS",
            corners.score
          );

          sinais++;

          console.log(
            `[CANTOS] ${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} = ${corners.score}`
          );
        }
      }
    }

    limparMemoria();

    ultimoRadar =
      new Date().toISOString();

    ultimoErro = null;

    console.log(
      `[V7.7] ${jogos} jogos | ${candidatos} candidatos | ${statsConsultadas} stats | ${sinais} sinais`
    );

    return {
      jogos,
      candidatos,
      statsConsultadas,
      sinais
    };

  } catch (e) {

    ultimoErro =
      e.response?.data ||
      e.message;

    console.log(
      "[V7.7] ERRO:",
      e.response?.status ||
      "",
      e.message
    );

    return {
      jogos,
      candidatos,
      statsConsultadas,
      sinais,
      erro:
        e.response?.status ||
        e.message
    };

  } finally {

    radarRodando = false;
  }
}

// ============================================================
// ROTAS
// ============================================================

app.get("/", (req, res) => {

  res.send(`
    <h1>ELITE RADAR V7.7</h1>
    <h2>PRESSÃO + MOMENTUM + EVOLUÇÃO</h2>
    <p>Status: ${
      isHorarioAtivo()
        ? "ATIVO"
        : "FORA DO HORÁRIO"
    }</p>
    <p>Fonte: SofaScore</p>
    <p>Mercados: OVER + ESCANTEIOS</p>
  `);

});

// ============================================================

app.get("/health", (req, res) => {

  res.json({

    versao: "V7.7",

    status:
      isHorarioAtivo()
        ? "ATIVO"
        : "FORA DO HORÁRIO",

    fonte:
      "SofaScore",

    analise: [
      "placar",
      "tempo",
      "estatísticas",
      "momentum",
      "evolução entre ciclos",
      "incidentes"
    ],

    mercados: [
      "OVER LIVE",
      "ESCANTEIOS LIVE"
    ],

    scoreMin:
      SCORE_MIN,

    scoreForte:
      SCORE_FORTE,

    polling:
      `${POLL_MINUTES} minutos`,

    maxStats:
      MAX_STATS,

    maxAlertas:
      MAX_ALERTAS,

    radarRodando,

    ultimoRadar,

    ultimoErro,

    jogosHistorico:
      historico.size,

    alertas:
      enviados.size,

    cacheStats:
      cacheStats.size,

    cacheMomentum:
      cacheMomentum.size,

    telegram:
      !!(
        TELEGRAM_TOKEN &&
        CHAT_ID
      )

  });

});

// ============================================================

app.get("/radar", async (req, res) => {

  const resultado =
    await radar();

  res.json({

    versao:
      "V7.7",

    ...resultado,

    timestamp:
      new Date().toISOString()

  });

});

// ============================================================

app.get("/config", (req, res) => {

  res.json({

    versao:
      "V7.7",

    scoreMin:
      SCORE_MIN,

    scoreForte:
      SCORE_FORTE,

    pollMinutes:
      POLL_MINUTES,

    maxStats:
      MAX_STATS,

    maxAlertas:
      MAX_ALERTAS,

    horario: {
      inicio:
        HORARIO_INICIO,

      fim:
        HORARIO_FIM
    },

    telegram:
      !!(
        TELEGRAM_TOKEN &&
        CHAT_ID
      )

  });

});

// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {

    const ok =
      await enviarTelegram(
`🟢 *ELITE RADAR V7.7*

Teste do Telegram realizado.

📊 Sistema:
PRESSÃO + MOMENTUM + EVOLUÇÃO`
      );

    res.json({
      enviado: ok
    });
  }
);

// ============================================================
// RADAR AUTOMÁTICO
// ============================================================

const INTERVALO =
  Math.max(
    3,
    POLL_MINUTES
  ) * 60 * 1000;

setInterval(
  () => {

    radar().catch(
      e =>
        console.log(
          "[AUTO]",
          e.message
        )
    );

  },
  INTERVALO
);

// Primeira execução
setTimeout(
  () => {

    radar().catch(
      e =>
        console.log(
          "[BOOT]",
          e.message
        )
    );

  },
  5000
);

// ============================================================
// SERVIDOR
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      "===================================================="
    );

    console.log(
      " ELITE RADAR V7.7"
    );

    console.log(
      " PRESSÃO + MOMENTUM + EVOLUÇÃO"
    );

    console.log(
      ` PORTA: ${PORT}`
    );

    console.log(
      ` HORÁRIO: ${HORARIO_INICIO}h-${HORARIO_FIM}h`
    );

    console.log(
      ` INTERVALO: ${POLL_MINUTES} minutos`
    );

    console.log(
      ` SCORE MÍNIMO: ${SCORE_MIN}`
    );

    console.log(
      ` SCORE FORTE: ${SCORE_FORTE}`
    );

    console.log(
      ` STATS POR CICLO: ${MAX_STATS}`
    );

    console.log(
      ` TELEGRAM: ${
        TELEGRAM_TOKEN && CHAT_ID
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      "===================================================="
    );
  }
);
