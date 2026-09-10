// ============================================================
// ELITE RADAR V22 - PRESSÃO INTELIGENTE + RELATÓRIO 23H
// ============================================================
// - Pressão bilateral
// - Pressão forte de um único lado
// - Domínio + finalizações
// - Placar inteligente
// - 12+ chutes
// - Até 5 escanteios
// - Score mínimo 65
// - Relatório diário às 23h BRT
// - Anti-spam por jogo
// - Proxy anti-403
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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

const SCORE_MINIMO = 65;
const INTERVALO_MINUTOS = 20;
const DELAY_SOFASCORE = 4000;

let ULTIMO_CHECK = "Nunca";
let TOTAL_ENVIADOS = 0;
let TOTAL_ANALISADOS = 0;
let TOTAL_CANDIDATOS = 0;
let ULTIMO_ERRO = "Nenhum";

let JOGOS_JA_AVISADOS = new Set();

let RELATORIO_ENVIADO_HOJE = false;
let DIA_RELATORIO = "";

function dormir(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function numero(v) {
  if (v == null) return 0;

  if (typeof v === "number") {
    return isFinite(v) ? v : 0;
  }

  const n = parseFloat(
    String(v)
      .replace("%", "")
      .replace(",", ".")
  );

  return isFinite(n) ? n : 0;
}

function textoSeguro(v) {
  return String(v || "").replace(/[*_`\[\]]/g, "");
}

// ============================================================
// HORÁRIO BRASIL
// ============================================================

function agoraBrasil() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo"
    })
  );
}

function podeRodarAgora() {
  const agora = agoraBrasil();
  const h = agora.getHours();
  const d = agora.getDay();

  const fimDeSemana = d === 0 || d === 6;

  return fimDeSemana
    ? h >= 8 && h < 24
    : h >= 12 && h < 24;
}

function horarioTexto() {
  const brasil = agoraBrasil();
  const d = brasil.getDay();

  return (d === 0 || d === 6)
    ? "Sab-Dom 08h-00h BRT"
    : "Seg-Sex 12h-00h BRT";
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(texto) {

  if (!TOKEN || !CHAT_ID) {
    console.log("Telegram não configurado.");
    return false;
  }

  try {

    await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: texto,
        parse_mode: "Markdown"
      },
      {
        timeout: 10000
      }
    );

    TOTAL_ENVIADOS++;

    return true;

  } catch (e) {

    console.log(
      "ERRO TELEGRAM:",
      e.response?.data || e.message
    );

    return false;
  }
}

// ============================================================
// SOFASCORE + PROXY
// ============================================================

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",

  "Accept": "application/json",

  "Referer":
    "https://www.sofascore.com/",

  "Origin":
    "https://www.sofascore.com"
};

async function getSofascore(url) {

  try {

    const resposta = await axios.get(
      url,
      {
        headers: HEADERS,
        timeout: 12000
      }
    );

    return resposta.data;

  } catch (e) {

    if (e.response?.status !== 403) {
      throw e;
    }

    console.log("403 direto. Tentando proxy 1...");
  }

  try {

    const proxyUrl =
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

    const resposta = await axios.get(
      proxyUrl,
      {
        timeout: 15000
      }
    );

    console.log("Proxy 1 funcionou!");

    return typeof resposta.data === "string"
      ? JSON.parse(resposta.data)
      : resposta.data;

  } catch (e2) {

    console.log(
      "Proxy 1 falhou. Tentando proxy 2..."
    );
  }

  const proxyUrl2 =
    `https://corsproxy.io/?${encodeURIComponent(url)}`;

  const resposta3 = await axios.get(
    proxyUrl2,
    {
      headers: HEADERS,
      timeout: 15000
    }
  );

  console.log("Proxy 2 funcionou!");

  return typeof resposta3.data === "string"
    ? JSON.parse(resposta3.data)
    : resposta3.data;
}

// ============================================================
// ESTATÍSTICAS
// ============================================================

function extrairEstatisticas(periodo) {

  let escanteios = 0;

  let chutes = 0;
  let chutesNoAlvo = 0;

  let chutesCasa = 0;
  let chutesFora = 0;

  let alvoCasa = 0;
  let alvoFora = 0;

  let cantosCasa = 0;
  let cantosFora = 0;

  let ataquesPerigososCasa = 0;
  let ataquesPerigososFora = 0;

  let posseCasa = 0;
  let posseFora = 0;

  for (const grupo of periodo?.groups || []) {

    for (const item of grupo.statisticsItems || []) {

      const nome =
        String(item.name || "").toLowerCase();

      const home = numero(item.home);
      const away = numero(item.away);

      if (
        nome.includes("corner") ||
        nome.includes("escanteio")
      ) {

        escanteios += home + away;

        cantosCasa += home;
        cantosFora += away;

        continue;
      }

      if (
        nome === "total shots" ||
        nome === "shots" ||
        nome.includes("total shots")
      ) {

        chutes += home + away;

        chutesCasa += home;
        chutesFora += away;

        continue;
      }

      if (
        nome.includes("shots on target") ||
        nome.includes("shots on goal") ||
        nome.includes("on target")
      ) {

        chutesNoAlvo += home + away;

        alvoCasa += home;
        alvoFora += away;

        continue;
      }

      if (nome.includes("dangerous attacks")) {

        ataquesPerigososCasa += home;
        ataquesPerigososFora += away;

        continue;
      }

      if (
        nome.includes("ball possession") ||
        nome.includes("possession")
      ) {

        posseCasa = home;
        posseFora = away;

        continue;
      }
    }
  }

  return {
    escanteios,
    chutes,
    chutesNoAlvo,
    chutesCasa,
    chutesFora,
    alvoCasa,
    alvoFora,
    cantosCasa,
    cantosFora,
    ataquesPerigososCasa,
    ataquesPerigososFora,
    posseCasa,
    posseFora
  };
}

// ============================================================
// PRESSÃO INTELIGENTE V22
// ============================================================

function analisarPressao(dados, jogo) {

  const motivos = [];
  let bonus = 0;

  const {
    chutesCasa,
    chutesFora,
    alvoCasa,
    alvoFora,
    posseCasa,
    posseFora,
    chutes
  } = dados;

  const golsCasa =
    numero(jogo.homeScore?.current);

  const golsFora =
    numero(jogo.awayScore?.current);

  // ----------------------------------------------------------
  // 1. PRESSÃO BILATERAL
  // ----------------------------------------------------------

  if (
    chutesCasa >= 6 &&
    chutesFora >= 6 &&
    alvoCasa >= 2 &&
    alvoFora >= 2
  ) {

    bonus += 12;

    motivos.push(
      "🔥 pressão bilateral forte"
    );
  }

  // ----------------------------------------------------------
  // 2. PRESSÃO MUITO FORTE DO MANDANTE
  // ----------------------------------------------------------

  if (
    chutesCasa >= 9 &&
    chutesCasa >= chutesFora + 4 &&
    alvoCasa >= alvoFora + 1
  ) {

    bonus += 12;

    motivos.push(
      "🏠 mandante pressionando forte"
    );
  }

  // ----------------------------------------------------------
  // 3. PRESSÃO MUITO FORTE DO VISITANTE
  // ----------------------------------------------------------

  if (
    chutesFora >= 9 &&
    chutesFora >= chutesCasa + 4 &&
    alvoFora >= alvoCasa + 1
  ) {

    bonus += 12;

    motivos.push(
      "✈️ visitante pressionando forte"
    );
  }

  // ----------------------------------------------------------
  // 4. VOLUME ABSOLUTO MUITO ALTO
  // ----------------------------------------------------------

  if (
    chutes >= 18 &&
    (alvoCasa >= 3 || alvoFora >= 3)
  ) {

    bonus += 7;

    motivos.push(
      "💥 volume ofensivo elevado"
    );
  }

  // ----------------------------------------------------------
  // 5. POSSE COM FINALIZAÇÃO
  // ----------------------------------------------------------

  if (
    Math.max(posseCasa, posseFora) >= 62 &&
    Math.max(chutesCasa, chutesFora) >= 8
  ) {

    bonus += 5;

    motivos.push(
      "📈 domínio convertido em finalizações"
    );
  }

  // ----------------------------------------------------------
  // 6. DOMÍNIO SEM FINALIZAÇÃO
  // ----------------------------------------------------------

  const posseDominante =
    Math.max(posseCasa, posseFora) >= 65;

  const poucaFinalizacao =
    chutes <= 15 || dados.chutesNoAlvo <= 3;

  if (
    posseDominante &&
    poucaFinalizacao
  ) {

    bonus -= 10;

    motivos.push(
      "⚠️ domínio sem finalizações"
    );
  }

  // ----------------------------------------------------------
  // 7. PLACAR
  // ----------------------------------------------------------

  const diferenca =
    Math.abs(golsCasa - golsFora);

  if (diferenca >= 3) {

    bonus -= 12;

    motivos.push(
      "🧊 placar de 3+ gols reduz pressão"
    );

  } else if (diferenca === 2) {

    const perdedorCasaPressiona =
      golsCasa < golsFora &&
      chutesCasa >= chutesFora + 4 &&
      alvoCasa >= alvoFora;

    const perdedorForaPressiona =
      golsFora < golsCasa &&
      chutesFora >= chutesCasa + 4 &&
      alvoFora >= alvoCasa;

    if (
      perdedorCasaPressiona ||
      perdedorForaPressiona
    ) {

      bonus += 4;

      motivos.push(
        "🔥 perdedor reagindo com pressão"
      );

    } else {

      bonus -= 6;

      motivos.push(
        "🧊 placar reduz pressão"
      );
    }
  }

  return {
    bonus,
    motivos
  };
}

// ============================================================
// SCORE
// ============================================================

function calcularScore(dados, jogo) {

  let score = 0;
  const motivos = [];

  const {
    escanteios,
    chutes,
    chutesNoAlvo
  } = dados;

  // ----------------------------------------------------------
  // ESCANTEIOS
  // ----------------------------------------------------------

  if (escanteios <= 2) {

    score += 20;

    motivos.push("🚩 poucos cantos");

  } else if (escanteios <= 3) {

    score += 16;

    motivos.push("🚩 cantos baixos");

  } else if (escanteios <= 5) {

    score += 10;

    motivos.push("🚩 até 5 cantos");

  } else {

    return {
      score: 0,
      motivos: ["muitos cantos"]
    };
  }

  // ----------------------------------------------------------
  // CHUTES
  // ----------------------------------------------------------

  if (chutes >= 20) {

    score += 25;

    motivos.push("🎯 20+ chutes");

  } else if (chutes >= 17) {

    score += 21;

    motivos.push("🎯 17+ chutes");

  } else if (chutes >= 14) {

    score += 16;

    motivos.push("🎯 14+ chutes");

  } else if (chutes >= 12) {

    score += 12;

    motivos.push("🎯 12+ chutes");

  } else {

    return {
      score: 0,
      motivos: ["poucos chutes"]
    };
  }

  // ----------------------------------------------------------
  // CHUTES NO ALVO
  // ----------------------------------------------------------

  if (chutesNoAlvo >= 8) {

    score += 20;

    motivos.push("🥅 8+ no alvo");

  } else if (chutesNoAlvo >= 6) {

    score += 16;

    motivos.push("🥅 6+ no alvo");

  } else if (chutesNoAlvo >= 4) {

    score += 10;

    motivos.push("🥅 4+ no alvo");

  } else {

    score -= 5;

    motivos.push("⚠️ poucos no alvo");
  }

  // ----------------------------------------------------------
  // VOLUME INDIVIDUAL
  // ----------------------------------------------------------

  if (
    Math.max(
      dados.chutesCasa,
      dados.chutesFora
    ) >= 10
  ) {

    score += 10;

    motivos.push("💥 forte volume");
  }

  // ----------------------------------------------------------
  // ATAQUES PERIGOSOS
  // ----------------------------------------------------------

  const ataquesTotal =
    dados.ataquesPerigososCasa +
    dados.ataquesPerigososFora;

  if (ataquesTotal >= 60) {

    score += 8;

    motivos.push(
      "⚔️ ataques perigosos"
    );
  }

  // ----------------------------------------------------------
  // POSSE
  // ----------------------------------------------------------

  if (
    Math.max(
      dados.posseCasa,
      dados.posseFora
    ) >= 65
  ) {

    score += 5;

    motivos.push(
      "📊 posse dominante"
    );
  }

  // ----------------------------------------------------------
  // EMPATE
  // ----------------------------------------------------------

  const golsCasa =
    numero(jogo.homeScore?.current);

  const golsFora =
    numero(jogo.awayScore?.current);

  const diferenca =
    Math.abs(golsCasa - golsFora);

  if (diferenca === 0) {

    score += 5;

    motivos.push(
      "⚖️ jogo empatado"
    );
  }

  // ----------------------------------------------------------
  // PRESSÃO
  // ----------------------------------------------------------

  const pressao =
    analisarPressao(dados, jogo);

  score += pressao.bonus;

  motivos.push(...pressao.motivos);

  score =
    Math.max(
      0,
      Math.min(100, score)
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
    return "🟡 OBSERVAÇÃO";

  return "⚪ FRACO";
}

// ============================================================
// ANALISAR JOGO
// ============================================================

async function analisarJogo(jogo) {

  if (!jogo?.id) return;

  if (
    JOGOS_JA_AVISADOS.has(jogo.id)
  ) return;

  TOTAL_ANALISADOS++;

  await dormir(
    DELAY_SOFASCORE
  );

  try {

    const data =
      await getSofascore(
        `https://api.sofascore.com/api/v1/event/${jogo.id}/statistics`
      );

    const periodo =
      (data?.statistics || [])
        .find(
          p =>
            p.period === "1ST" ||
            p.period === "ALL"
        );

    if (!periodo) return;

    const dados =
      extrairEstatisticas(periodo);

    // --------------------------------------------------------
    // FILTRO PRINCIPAL
    // --------------------------------------------------------

    if (dados.escanteios > 5)
      return;

    if (dados.chutes < 12)
      return;

    TOTAL_CANDIDATOS++;

    const resultado =
      calcularScore(
        dados,
        jogo
      );

    console.log(
      `${jogo.homeTeam?.name} x ${jogo.awayTeam?.name} | ` +
      `C:${dados.escanteios} ` +
      `CH:${dados.chutes} ` +
      `ALVO:${dados.chutesNoAlvo} ` +
      `SCORE:${resultado.score}`
    );

    console.log(
      "MOTIVOS:",
      resultado.motivos.join(" | ")
    );

    if (
      resultado.score <
      SCORE_MINIMO
    ) return;

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

    const motivosTexto =
      resultado.motivos.join("\n");

    const mensagem =
`🚨 *ELITE RADAR V22 — SINAL AO VIVO* 🚨

⚽ *${casa} ${golsCasa} x ${golsFora} ${fora}*

⏱️ *INTERVALO*

📊 *1º TEMPO*

🚩 Escanteios: *${dados.escanteios}*
🎯 Chutes: *${dados.chutes}*
🥅 No alvo: *${dados.chutesNoAlvo}*

🏠 ${casa}: ${dados.chutesCasa} chutes | ${dados.alvoCasa} no alvo
✈️ ${fora}: ${dados.chutesFora} chutes | ${dados.alvoFora} no alvo

📈 *ANÁLISE DE PRESSÃO*

${motivosTexto}

⭐ *SCORE: ${resultado.score}/100*
${classificacao(resultado.score)}

🎯 *OVER 4.5 ESCANTEIOS — 2º TEMPO*

⚠️ *Sinal estatístico. Não é garantia de entrada.*

🕐 ${ULTIMO_CHECK}`;

    if (
      await sendTelegram(
        mensagem
      )
    ) {

      JOGOS_JA_AVISADOS.add(
        jogo.id
      );

      console.log(
        "✅ SINAL ENVIADO"
      );
    }

    if (
      JOGOS_JA_AVISADOS.size > 300
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
// BUSCAR JOGOS
// ============================================================

async function verificarJogosAoVivo() {

  if (!podeRodarAgora()) {

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
    `\n[${ULTIMO_CHECK}] V22 buscando jogos...`
  );

  try {

    const data =
      await getSofascore(
        "https://api.sofascore.com/api/v1/sport/football/events/live"
      );

    const jogos =
      data?.events || [];

    console.log(
      `Ao vivo: ${jogos.length}`
    );

    const intervalo =
      jogos.filter(
        j =>
          j.status?.code === 31 ||
          j.status?.type === "halftime"
      );

    console.log(
      `Intervalo: ${intervalo.length}`
    );

    for (
      const jogo of intervalo
    ) {

      await analisarJogo(
        jogo
      );
    }

    ULTIMO_ERRO =
      "Nenhum - Proxy OK";

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
// RELATÓRIO DIÁRIO 23H
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

  // Reset automático no novo dia
  if (
    DIA_RELATORIO !== diaAtual
  ) {

    RELATORIO_ENVIADO_HOJE =
      false;

    DIA_RELATORIO =
      diaAtual;
  }

  // Envia entre 23:00 e 23:04
  if (
    hora === 23 &&
    minutos >= 0 &&
    minutos <= 4 &&
    !RELATORIO_ENVIADO_HOJE
  ) {

    const mensagem =
`📊 *ELITE RADAR V22 — RELATÓRIO DIÁRIO*

📅 ${agora.toLocaleDateString("pt-BR")}

🔎 Jogos analisados: *${TOTAL_ANALISADOS}*

🎯 Candidatos encontrados: *${TOTAL_CANDIDATOS}*

🚨 Sinais enviados: *${TOTAL_ENVIADOS}*

📌 Score mínimo: *${SCORE_MINIMO}*

🚩 Estratégia:
*Over 4.5 escanteios — 2º tempo*

🔥 Filtro:
*Pressão inteligente + volume de chutes + poucos cantos*

🛡️ Proteções:
*Placar + domínio sem finalizações + anti-spam*

⚠️ Último erro:
${textoSeguro(ULTIMO_ERRO)}

🕚 Relatório automático das 23h BRT.`;

    const ok =
      await sendTelegram(
        mensagem
      );

    if (ok) {

      RELATORIO_ENVIADO_HOJE =
        true;

      console.log(
        "📊 RELATÓRIO DAS 23H ENVIADO"
      );
    }
  }
}

// ============================================================
// ROTINAS
// ============================================================

// Radar a cada 20 minutos
setInterval(
  verificarJogosAoVivo,
  INTERVALO_MINUTOS * 60 * 1000
);

// Verifica o relógio a cada 30 segundos
setInterval(
  verificarRelatorioDiario,
  30 * 1000
);

verificarJogosAoVivo();

verificarRelatorioDiario();

// ============================================================
// ROTAS
// ============================================================

app.get("/", (req, res) => {

  res.json({

    status:
      "ELITE RADAR V22 ONLINE",

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

    intervalo:
      "20 minutos",

    relatorio:
      "Todos os dias às 23h BRT",

    horario:
      "Seg-Sex 12h-00h / Sab-Dom 08h-00h BRT",

    pode_rodar:
      podeRodarAgora()
  });
});

// ============================================================
// TESTE TELEGRAM
// ============================================================

app.get(
  "/telegram-test",
  async (req, res) => {

    const ok =
      await sendTelegram(
`✅ *V22 TESTE OK*

🔥 Pressão bilateral
🏠 Pressão mandante
✈️ Pressão visitante
💥 Volume ofensivo
⚠️ Domínio sem finalizações
🧊 Placar inteligente

⭐ Score mínimo: ${SCORE_MINIMO}

📊 Relatório diário: 23h BRT

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
// LIMPAR CACHE
// ============================================================

app.get(
  "/limpar-cache",
  (req, res) => {

    const antes =
      JOGOS_JA_AVISADOS.size;

    JOGOS_JA_AVISADOS.clear();

    res.json({
      ok: true,
      antes,
      depois: 0
    });
  }
);

// ============================================================
// SERVIDOR
// ============================================================

app.listen(
  PORT,
  () =>
    console.log(
      `🚀 ELITE RADAR V22 RODANDO NA PORTA ${PORT}`
    )
);
