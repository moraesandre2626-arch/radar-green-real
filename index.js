const http = require('http');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

const LIGAS_PERMITIDAS = [
  "bra.1","bra.2","por.1","eng.1","esp.1","ger.1",
  "ita.1","fra.1","ned.1","bel.1","tur.1","sco.1",
  "conmebol.libertadores","conmebol.sudamericana",
  "usa.1","mex.1","arg.1","uefa.champions","uefa.europa"
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

const enviados = new Map();

/*
=========================================================
CONTROLE DIÁRIO DOS ALERTAS
=========================================================
*/
let dataControle = new Date().toLocaleDateString('pt-BR');

let historicoDia = {
  data: dataControle,
  enviados: [],
  green: 0,
  red: 0,
  pendentes: 0,
  relatorioEnviado: false
};

function garantirNovoDia() {
  const hoje = new Date().toLocaleDateString('pt-BR');

  if (hoje !== historicoDia.data) {
    historicoDia = {
      data: hoje,
      enviados: [],
      green: 0,
      red: 0,
      pendentes: 0,
      relatorioEnviado: false
    };

    dataControle = hoje;

    console.log(`📅 Novo dia iniciado: ${hoje}`);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      signal: c.signal
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    return await r.json();

  } finally {
    clearTimeout(t);
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

  for (let nome of nomes) {
    const s = S.find(x =>
      x.name?.toLowerCase() === nome.toLowerCase() ||
      x.abbreviation?.toLowerCase() === nome.toLowerCase()
    );

    if (s) {
      return numero(s.displayValue ?? s.value ?? 0);
    }
  }

  return null;
}

/*
=========================================================
RAIO-X COMPLETO
=========================================================
*/
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

    const teams = summary?.boxscore?.teams || [];

    for (let i = 0; i < teams.length; i++) {

      const bloco = teams[i];

      const id = String(bloco?.team?.id || '');

      let lado = i === 0 ? 'home' : 'away';

      const comp =
        summary?.header?.competitions?.[0]?.competitors
          ?.find(c => String(c.team?.id) === id);

      if (comp) lado = comp.homeAway;

      const S = bloco?.statistics || [];

      const chutes =
        pegaStat(S, ['totalShots', 'shots']) ?? 0;

      const alvo =
        pegaStat(S, ['shotsOnTarget', 'shotsOnGoal']) ?? 0;

      const posse =
        pegaStat(S, ['possessionPct', 'possession']) ?? 0;

      const esc =
        pegaStat(S, ['wonCorners', 'cornerKicks']) ?? 0;

      const amarelos =
        pegaStat(S, ['yellowCards']) ?? 0;

      const ap =
        pegaStat(S, [
          'dangerousAttacks',
          'dangerousAttack',
          'attack'
        ]);

      const cruz =
        pegaStat(S, [
          'crosses',
          'totalCrosses',
          'totalCross',
          'cross'
        ]);

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

  } catch (e) {}

  return raio;
}

/*
=========================================================
FILTRO
=========================================================
*/
function checaJogo(jogo, raio) {

  if (!LIGAS_PERMITIDAS.includes(jogo.liga)) {
    return {
      aprovado: false,
      motivo: 'liga'
    };
  }

  if (
    Math.abs(jogo.gols_casa - jogo.gols_fora) >
    FILTROS.max_diferenca_gols
  ) {
    return {
      aprovado: false,
      motivo: 'placar'
    };
  }

  if (
    (jogo.chutes_casa + jogo.chutes_fora) <
    FILTROS.min_total_chutes_jogo
  ) {
    return {
      aprovado: false,
      motivo: 'chutes'
    };
  }

  const totalPosse =
    raio.posseCasa + raio.posseFora;

  const posseCasaPct =
    totalPosse > 0
      ? Math.round((raio.posseCasa / totalPosse) * 100)
      : 50;

  const posseForaPct =
    100 - posseCasaPct;

  let timePrecisa = '';
  let chutesPrecisa = 0;
  let posseTime = 0;
  let cruzTime = 0;
  let escTime = 0;
  let apTime = 0;

  if (jogo.gols_casa < jogo.gols_fora) {

    timePrecisa = jogo.nome_casa;
    chutesPrecisa = jogo.alvo_casa;
    posseTime = posseCasaPct;
    cruzTime = raio.cruzCasa;
    escTime = raio.escCasa;
    apTime = raio.apCasa || 0;

  } else if (jogo.gols_fora < jogo.gols_casa) {

    timePrecisa = jogo.nome_fora;
    chutesPrecisa = jogo.alvo_fora;
    posseTime = posseForaPct;
    cruzTime = raio.cruzFora;
    escTime = raio.escFora;
    apTime = raio.apFora || 0;

  } else {

    const casaMelhor =
      jogo.alvo_casa >= jogo.alvo_fora;

    timePrecisa =
      casaMelhor
        ? jogo.nome_casa
        : jogo.nome_fora;

    chutesPrecisa =
      Math.max(
        jogo.alvo_casa,
        jogo.alvo_fora
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
      casaMelhor
        ? raio.apCasa || 0
        : raio.apFora || 0;
  }

  if (
    chutesPrecisa <
    FILTROS.min_chutes_gol_time_precisa
  ) {
    return {
      aprovado: false,
      motivo: 'alvo'
    };
  }

  const scorePressao =
    cruzTime +
    (escTime * 2) +
    (apTime / 10);

  if (
    scorePressao <
    FILTROS.min_pressao_score
  ) {
    return {
      aprovado: false,
      motivo:
        `score baixo ${scorePressao.toFixed(1)}`
    };
  }

  if (
    posseTime <
    FILTROS.posse_minima_pressao
  ) {
    return {
      aprovado: false,
      motivo:
        `posse pressao ${posseTime}% < ${FILTROS.posse_minima_pressao}%`
    };
  }

  let zonaPressao = 'Meio';

  if (
    cruzTime >= 8 ||
    (cruzTime >= 5 && escTime >= 2)
  ) {
    zonaPressao =
      `Lateral (${cruzTime} cruz)`;

  } else if (escTime >= 3) {

    zonaPressao =
      `Abafa Área (${escTime} esc)`;

  } else if (apTime >= 15) {

    zonaPressao =
      `Meio-Perigoso (${apTime} AP)`;
  }

  return {
    aprovado: true,
    timePrecisa,
    chutesPrecisa,
    totalChutes:
      jogo.chutes_casa +
      jogo.chutes_fora,
    possePct: posseTime,
    scorePressao,
    zonaPressao
  };
}

/*
=========================================================
TELEGRAM — ALERTA
=========================================================
*/
async function enviarTelegram(jogo, analise, raio) {

  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    return false;
  }

  const pCasa =
    (raio.posseCasa + raio.posseFora) > 0
      ? Math.round(
          (raio.posseCasa /
          (raio.posseCasa + raio.posseFora)) * 100
        )
      : 50;

  const linhaAP =
    raio.temAP
      ? `🔥 Ataques Perigosos: ${raio.apCasa ?? 0}x${raio.apFora ?? 0}\n`
      : '';

  const linhaCruz =
    raio.temCruz
      ? `↗️ Cruzamentos: ${raio.cruzCasa}x${raio.cruzFora}\n`
      : '';

  const msg =
`🚨 RAIO-X GOL 2T — V34.6 60% POSSE

🏆 ${jogo.liga.toUpperCase()}
⚽ ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}
⏱️ ${jogo.minutoTexto}

📊 ESTATÍSTICAS HT:
🥅 Chutes: ${raio.chutesCasa}x${raio.chutesFora} (Total: ${analise.totalChutes})
🎯 No Alvo: ${raio.alvoCasa}x${raio.alvoFora}
${linhaAP}${linhaCruz}🚩 Escanteios: ${raio.escCasa}x${raio.escFora}
📊 Posse: ${pCasa}% x ${100-pCasa}%
🟨 Amarelos: ${raio.amarelosCasa}x${raio.amarelosFora}

📍 PRESSÃO: ${analise.zonaPressao}
📈 Score Pressão: ${analise.scorePressao.toFixed(1)} | Posse time: ${analise.possePct}% ✅ 60%+

🎯 Precisa: ${analise.timePrecisa} (${analise.chutesPrecisa} no alvo)
✅ FILTRO: 60% POSSE + PRESSAO LATERAL`;

  try {

    const r = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: msg
        })
      }
    );

    const d = await r.json();

    if (!d.ok) {
      throw new Error(d.description);
    }

    totalEnviados++;

    console.log(
      `📨 Enviado: ${jogo.nome_casa} x ${jogo.nome_fora} | ${analise.zonaPressao} | ${analise.possePct}%`
    );

    /*
    =====================================================
    SALVA O ALERTA PARA O RELATÓRIO
    =====================================================
    */

    garantirNovoDia();

    historicoDia.enviados.push({
      id: String(jogo.id),
      liga: jogo.liga,
      casa: jogo.nome_casa,
      fora: jogo.nome_fora,
      golsCasaAlerta: jogo.gols_casa,
      golsForaAlerta: jogo.gols_fora,
      minutoAlerta: jogo.minuto,
      status: 'pendente'
    });

    return true;

  } catch (e) {

    totalErros++;

    console.log(
      `❌ Telegram: ${e.message}`
    );

    return false;
  }
}

/*
=========================================================
BUSCAR JOGOS ESPN
=========================================================
*/
async function buscarJogosESPN() {

  const aprovados = [];

  for (const liga of LIGAS_PERMITIDAS) {

    try {

      const data = await getJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`
      );

      if (!Array.isArray(data.events)) continue;

      for (const ev of data.events) {

        try {

          const comp =
            ev?.competitions?.[0];

          if (!comp) continue;

          const status =
            comp?.status?.type?.name || '';

          if (
            ![
              'STATUS_HALFTIME',
              'STATUS_SECOND_HALF'
            ].includes(status)
          ) {
            continue;
          }

          let minuto =
            numero(comp?.status?.clock);

          if (status === 'STATUS_HALFTIME') {
            minuto = 45;
          }

          if (
            minuto < FILTROS.minuto_minimo ||
            minuto > FILTROS.minuto_maximo
          ) {
            continue;
          }

          const casa =
            comp.competitors?.find(
              c => c.homeAway === 'home'
            );

          const fora =
            comp.competitors?.find(
              c => c.homeAway === 'away'
            );

          if (!casa || !fora) continue;

          await sleep(400);

          const raioTemp =
            await buscarRaioXCompleto(
              liga,
              ev.id
            );

          const jogo = {
            id: String(ev.id),
            liga,
            nome_casa:
              casa?.team?.displayName || 'Casa',
            nome_fora:
              fora?.team?.displayName || 'Fora',
            gols_casa:
              numero(casa.score),
            gols_fora:
              numero(fora.score),
            chutes_casa:
              raioTemp.chutesCasa,
            chutes_fora:
              raioTemp.chutesFora,
            alvo_casa:
              raioTemp.alvoCasa,
            alvo_fora:
              raioTemp.alvoFora,
            minuto,
            minutoTexto:
              status === 'STATUS_HALFTIME'
                ? 'INTERVALO'
                : `${Math.floor(minuto)}'`
          };

          const analise =
            checaJogo(
              jogo,
              raioTemp
            );

          if (!analise.aprovado) {

            if (
              analise.motivo?.includes('posse')
            ) {
              console.log(
                `🚫 Posse <60%: ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora} - ${analise.motivo}`
              );
            }

            continue;
          }

          totalAprovados++;

          aprovados.push({
            jogo,
            analise,
            raio: raioTemp
          });

        } catch (e) {}
      }

    } catch (e) {

      totalErros++;
    }
  }

  return aprovados;
}

/*
=========================================================
EXECUTAR RADAR
=========================================================
*/
async function executarRadar() {

  garantirNovoDia();

  ultimoScan =
    new Date().toISOString();

  console.log(
    `\n🔎 Radar V34.6 varrendo...`
  );

  for (
    const [id, t] of enviados.entries()
  ) {

    if (
      Date.now() - t >
      3 * 60 * 60 * 1000
    ) {
      enviados.delete(id);
    }
  }

  try {

    const res =
      await buscarJogosESPN();

    if (!res.length) {

      console.log(
        'Nenhum aprovado (precisa 60% posse).'
      );

      return;
    }

    for (
      const { jogo, analise, raio }
      of res
    ) {

      const chave =
        `${jogo.liga}_${jogo.id}_HT`;

      if (enviados.has(chave)) {
        continue;
      }

      if (
        await enviarTelegram(
          jogo,
          analise,
          raio
        )
      ) {

        enviados.set(
          chave,
          Date.now()
        );
      }
    }

  } catch (e) {

    console.log(
      `❌ Radar: ${e.message}`
    );
  }
}

/*
=========================================================
VERIFICAR GREEN / RED
=========================================================
*/
async function verificarResultado(alerta) {

  try {

    const summary =
      await getJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${alerta.liga}/summary?event=${alerta.id}`
      );

    const comp =
      summary?.header?.competitions?.[0];

    if (!comp) {
      return null;
    }

    const status =
      comp?.status?.type?.name || '';

    const encerrado =
      [
        'STATUS_FINAL',
        'STATUS_FULL_TIME',
        'STATUS_FINAL_PEN'
      ].includes(status);

    if (!encerrado) {
      return null;
    }

    const casa =
      comp.competitors?.find(
        c => c.homeAway === 'home'
      );

    const fora =
      comp.competitors?.find(
        c => c.homeAway === 'away'
      );

    if (!casa || !fora) {
      return null;
    }

    const golsCasaFinal =
      numero(casa.score);

    const golsForaFinal =
      numero(fora.score);

    const golsAlerta =
      alerta.golsCasaAlerta +
      alerta.golsForaAlerta;

    const golsFinal =
      golsCasaFinal +
      golsForaFinal;

    /*
    GREEN:
    houve pelo menos 1 gol depois do momento
    em que o alerta foi enviado.
    */

    const green =
      golsFinal > golsAlerta;

    return {
      green,
      golsCasaFinal,
      golsForaFinal
    };

  } catch (e) {

    console.log(
      `❌ Erro verificando ${alerta.casa} x ${alerta.fora}: ${e.message}`
    );

    return null;
  }
}

/*
=========================================================
RELATÓRIO DAS 23:50
=========================================================
*/
async function enviarRelatorio2350() {

  garantirNovoDia();

  if (historicoDia.relatorioEnviado) {
    return;
  }

  console.log(
    '\n📊 INICIANDO RELATÓRIO 23:50...'
  );

  let green = 0;
  let red = 0;
  let pendentes = 0;

  for (
    const alerta of historicoDia.enviados
  ) {

    if (alerta.status !== 'pendente') {

      if (alerta.status === 'green') green++;
      if (alerta.status === 'red') red++;

      continue;
    }

    const resultado =
      await verificarResultado(alerta);

    if (!resultado) {

      pendentes++;

      continue;
    }

    if (resultado.green) {

      alerta.status = 'green';

      alerta.golsCasaFinal =
        resultado.golsCasaFinal;

      alerta.golsForaFinal =
        resultado.golsForaFinal;

      green++;

    } else {

      alerta.status = 'red';

      alerta.golsCasaFinal =
        resultado.golsCasaFinal;

      alerta.golsForaFinal =
        resultado.golsForaFinal;

      red++;
    }

    await sleep(300);
  }

  historicoDia.green = green;
  historicoDia.red = red;
  historicoDia.pendentes = pendentes;

  const totalFinalizados =
    green + red;

  const percentual =
    totalFinalizados > 0
      ? ((green / totalFinalizados) * 100).toFixed(1)
      : '0.0';

  const totalAlertas =
    historicoDia.enviados.length;

  const msg =
`📊 RELATÓRIO GOL 2T — V34.6

📅 ${historicoDia.data}
⏰ Fechamento: 23:50

📨 Alertas enviados: ${totalAlertas}

🟢 GREEN: ${green}
🔴 RED: ${red}
⏳ Pendentes: ${pendentes}

📈 Aproveitamento:
${percentual}% de GREEN

🎯 Critério:
GREEN = pelo menos 1 gol após o alerta.

🤖 ROBÔ V34.6
60% POSSE + PRESSÃO`;

  if (!TELEGRAM_TOKEN || !CHAT_ID) {

    console.log(
      '\n' + msg
    );

    historicoDia.relatorioEnviado = true;

    return;
  }

  try {

    const r =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text: msg
          })
        }
      );

    const d =
      await r.json();

    if (!d.ok) {
      throw new Error(d.description);
    }

    historicoDia.relatorioEnviado = true;

    console.log(
      '📊 Relatório 23:50 enviado com sucesso!'
    );

  } catch (e) {

    totalErros++;

    console.log(
      `❌ Erro relatório 23:50: ${e.message}`
    );
  }
}

/*
=========================================================
CONTROLE DO HORÁRIO 23:50
=========================================================
*/
function verificarHorarioRelatorio() {

  garantirNovoDia();

  const agora = new Date();

  const hora = agora.getHours();
  const minuto = agora.getMinutes();

  if (
    hora === 23 &&
    minuto === 50 &&
    !historicoDia.relatorioEnviado
  ) {

    enviarRelatorio2350();
  }
}

/*
=========================================================
SERVIDOR
=========================================================
*/
const server = http.createServer((req, res) => {

  garantirNovoDia();

  res.writeHead(200, {
    'Content-Type': 'application/json'
  });

  res.end(JSON.stringify({
    status: 'online',
    robo: 'V34.6 60% POSSE PRESSAO',
    ultimoScan,
    aprovados: totalAprovados,
    enviados: totalEnviados,
    erros: totalErros,
    relatorio2350: {
      data: historicoDia.data,
      alertas: historicoDia.enviados.length,
      green: historicoDia.green,
      red: historicoDia.red,
      pendentes: historicoDia.pendentes,
      enviado: historicoDia.relatorioEnviado
    },
    filtros: FILTROS
  }, null, 2));
});

server.listen(PORT, () => {

  console.log(`🚀 V34.6 ONLINE — porta ${PORT}`);

  executarRadar();

  setInterval(() => {
    executarRadar();
  }, 60000);

  setInterval(() => {
    verificarHorarioRelatorio();
  }, 30000);

});
