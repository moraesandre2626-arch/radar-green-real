const http = require('http');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || '';

/*
=========================================================
UPSTASH REDIS
=========================================================
*/

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || '';

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function redisCommand(command) {

  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log('⚠️ Redis não configurado.');
    return null;
  }

  try {

    const r = await fetch(
      REDIS_URL,
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${REDIS_TOKEN}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify(command)
      }
    );

    if (!r.ok) {
      throw new Error(
        `Redis HTTP ${r.status}`
      );
    }

    const data = await r.json();

    return data.result;

  } catch (e) {

    console.log(
      `❌ Redis: ${e.message}`
    );

    return null;
  }
}

async function redisGet(chave) {

  return await redisCommand([
    'GET',
    chave
  ]);
}

async function redisSet(chave, valor) {

  return await redisCommand([
    'SET',
    chave,
    valor
  ]);
}

/*
=========================================================
CHAVE DO HISTÓRICO
=========================================================
*/

function chaveHistorico(data) {

  return `gol2t:v34.6:historico:${data}`;
}

/*
=========================================================
LIGAS
=========================================================
*/

const LIGAS_PERMITIDAS = [
  "bra.1","bra.2","por.1","eng.1","esp.1","ger.1",
  "ita.1","fra.1","ned.1","bel.1","tur.1","sco.1",
  "conmebol.libertadores","conmebol.sudamericana",
  "usa.1","mex.1","arg.1","uefa.champions","uefa.europa"
];

/*
=========================================================
FILTROS
=========================================================
*/

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

/*
=========================================================
CONTROLE DE DUPLICIDADE EM MEMÓRIA
=========================================================
*/

const enviados = new Map();

/*
=========================================================
DATA DE BRASÍLIA
=========================================================
*/

function dataBrasilia() {

  return new Date().toLocaleDateString(
    'pt-BR',
    {
      timeZone:
        'America/Sao_Paulo'
    }
  );
}

/*
=========================================================
HISTÓRICO DIÁRIO
=========================================================
*/

let historicoDia = {

  data:
    dataBrasilia(),

  enviados: [],

  green: 0,

  red: 0,

  pendentes: 0,

  relatorioEnviado: false
};

/*
=========================================================
SALVAR HISTÓRICO NO REDIS
=========================================================
*/

async function salvarHistorico() {

  try {

    const chave =
      chaveHistorico(
        historicoDia.data
      );

    const valor =
      JSON.stringify(
        historicoDia
      );

    await redisSet(
      chave,
      valor
    );

    console.log(
      `💾 Histórico salvo no Redis: ${historicoDia.enviados.length} alertas`
    );

  } catch (e) {

    console.log(
      `❌ Erro salvando histórico: ${e.message}`
    );
  }
}

/*
=========================================================
CARREGAR HISTÓRICO DO REDIS
=========================================================
*/

async function carregarHistorico() {

  const hoje =
    dataBrasilia();

  try {

    const chave =
      chaveHistorico(
        hoje
      );

    const salvo =
      await redisGet(
        chave
      );

    if (salvo) {

      const dados =
        typeof salvo === 'string'
          ? JSON.parse(salvo)
          : salvo;

      if (
        dados &&
        dados.data === hoje
      ) {

        historicoDia = {

          data:
            dados.data,

          enviados:
            Array.isArray(
              dados.enviados
            )
              ? dados.enviados
              : [],

          green:
            Number(
              dados.green || 0
            ),

          red:
            Number(
              dados.red || 0
            ),

          pendentes:
            Number(
              dados.pendentes || 0
            ),

          relatorioEnviado:
            Boolean(
              dados.relatorioEnviado
            )
        };

        console.log(
          `📥 Histórico recuperado do Redis: ${historicoDia.enviados.length} alertas`
        );

      } else {

        console.log(
          '📭 Nenhum histórico válido para hoje.'
        );
      }

    } else {

      console.log(
        '📭 Redis sem histórico de hoje.'
      );
    }

  } catch (e) {

    console.log(
      `❌ Erro carregando histórico: ${e.message}`
    );
  }
}

/*
=========================================================
GARANTIR NOVO DIA
=========================================================
*/

async function garantirNovoDia() {

  const hoje =
    dataBrasilia();

  if (
    hoje !==
    historicoDia.data
  ) {

    historicoDia = {

      data:
        hoje,

      enviados: [],

      green: 0,

      red: 0,

      pendentes: 0,

      relatorioEnviado:
        false
    };

    enviados.clear();

    console.log(
      `📅 Novo dia iniciado em Brasília: ${hoje}`
    );

    await carregarHistorico();
  }
}

const sleep =
  ms =>
    new Promise(
      r => setTimeout(r, ms)
    );

/*
=========================================================
GET JSON
=========================================================
*/

async function getJson(url) {

  const c =
    new AbortController();

  const t =
    setTimeout(
      () => c.abort(),
      8000
    );

  try {

    const r =
      await fetch(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0'
          },

          signal:
            c.signal
        }
      );

    if (!r.ok) {

      throw new Error(
        `HTTP ${r.status}`
      );
    }

    return await r.json();

  } finally {

    clearTimeout(t);
  }
}

/*
=========================================================
NÚMERO
=========================================================
*/

function numero(v) {

  const n =
    parseFloat(
      String(v ?? 0)
        .replace(',', '.')
        .replace('%', '')
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

/*
=========================================================
PEGA STAT
=========================================================
*/

function pegaStat(S, nomes) {

  if (
    !Array.isArray(S)
  ) {

    return null;
  }

  for (
    let nome of nomes
  ) {

    const s =
      S.find(
        x =>
          x.name?.toLowerCase() ===
            nome.toLowerCase() ||

          x.abbreviation?.toLowerCase() ===
            nome.toLowerCase()
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

/*
=========================================================
RAIO-X COMPLETO
=========================================================
*/

async function buscarRaioXCompleto(
  liga,
  eventId
) {

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

    const summary =
      await getJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`
      );

    const teams =
      summary?.boxscore?.teams ||
      [];

    for (
      let i = 0;
      i < teams.length;
      i++
    ) {

      const bloco =
        teams[i];

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
              String(
                c.team?.id
              ) === id
          );

      if (comp) {

        lado =
          comp.homeAway;
      }

      const S =
        bloco?.statistics ||
        [];

      const chutes =
        pegaStat(
          S,
          [
            'totalShots',
            'shots'
          ]
        ) ?? 0;

      const alvo =
        pegaStat(
          S,
          [
            'shotsOnTarget',
            'shotsOnGoal'
          ]
        ) ?? 0;

      const posse =
        pegaStat(
          S,
          [
            'possessionPct',
            'possession'
          ]
        ) ?? 0;

      const esc =
        pegaStat(
          S,
          [
            'wonCorners',
            'cornerKicks'
          ]
        ) ?? 0;

      const amarelos =
        pegaStat(
          S,
          [
            'yellowCards'
          ]
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

      if (
        lado === 'home'
      ) {

        raio.chutesCasa =
          chutes;

        raio.alvoCasa =
          alvo;

        raio.posseCasa =
          posse;

        raio.escCasa =
          esc;

        raio.amarelosCasa =
          amarelos;

        if (
          cruz !== null
        ) {

          raio.cruzCasa =
            cruz;

          raio.temCruz =
            true;
        }

        if (
          ap !== null
        ) {

          raio.apCasa =
            ap;

          raio.temAP =
            true;
        }

      } else {

        raio.chutesFora =
          chutes;

        raio.alvoFora =
          alvo;

        raio.posseFora =
          posse;

        raio.escFora =
          esc;

        raio.amarelosFora =
          amarelos;

        if (
          cruz !== null
        ) {

          raio.cruzFora =
            cruz;

          raio.temCruz =
            true;
        }

        if (
          ap !== null
        ) {

          raio.apFora =
            ap;

          raio.temAP =
            true;
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

function checaJogo(
  jogo,
  raio
) {

  if (
    !LIGAS_PERMITIDAS.includes(
      jogo.liga
    )
  ) {

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
    (
      jogo.chutes_casa +
      jogo.chutes_fora
    ) <
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
          (
            raio.posseCasa /
            totalPosse
          ) * 100
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
      jogo.alvo_casa;

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
      jogo.alvo_fora;

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
      jogo.alvo_casa >=
      jogo.alvo_fora;

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

  let zonaPressao =
    'Meio';

  if (
    cruzTime >= 8 ||
    (
      cruzTime >= 5 &&
      escTime >= 2
    )
  ) {

    zonaPressao =
      `Lateral (${cruzTime} cruz)`;

  } else if (
    escTime >= 3
  ) {

    zonaPressao =
      `Abafa Área (${escTime} esc)`;

  } else if (
    apTime >= 15
  ) {

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

    possePct:
      posseTime,

    scorePressao,

    zonaPressao
  };
}

/*
=========================================================
TELEGRAM — ALERTA
=========================================================
*/

async function enviarTelegram(
  jogo,
  analise,
  raio
) {

  if (
    !TELEGRAM_TOKEN ||
    !CHAT_ID
  ) {

    return false;
  }

  const pCasa =
    (
      raio.posseCasa +
      raio.posseFora
    ) > 0

      ? Math.round(
          (
            raio.posseCasa /
            (
              raio.posseCasa +
              raio.posseFora
            )
          ) * 100
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

    const r =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              chat_id:
                CHAT_ID,

              text:
                msg
            })
        }
      );

    const d =
      await r.json();

    if (!d.ok) {

      throw new Error(
        d.description
      );
    }

    totalEnviados++;

    console.log(
      `📨 Enviado: ${jogo.nome_casa} x ${jogo.nome_fora} | ${analise.zonaPressao} | ${analise.possePct}%`
    );

    /*
    =====================================================
    SALVA ALERTA NO HISTÓRICO
    =====================================================
    */

    await garantirNovoDia();

    historicoDia.enviados.push({

      id:
        String(jogo.id),

      liga:
        jogo.liga,

      casa:
        jogo.nome_casa,

      fora:
        jogo.nome_fora,

      golsCasaAlerta:
        jogo.gols_casa,

      golsForaAlerta:
        jogo.gols_fora,

      minutoAlerta:
        jogo.minuto,

      status:
        'pendente'
    });

    await salvarHistorico();

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

  for (
    const liga
    of LIGAS_PERMITIDAS
  ) {

    try {

      const data =
        await getJson(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`
        );

      if (
        !Array.isArray(
          data.events
        )
      ) {

        continue;
      }

      for (
        const ev
        of data.events
      ) {

        try {

          const comp =
            ev?.competitions?.[0];

          if (!comp) {
            continue;
          }

          const status =
            comp?.status?.type?.name ||
            '';

          if (
            ![
              'STATUS_HALFTIME',
              'STATUS_SECOND_HALF'
            ].includes(
              status
            )
          ) {

            continue;
          }

          let minuto =
            numero(
              comp?.status?.clock
            );

          if (
            status ===
            'STATUS_HALFTIME'
          ) {

            minuto = 45;
          }

          if (
            minuto <
              FILTROS.minuto_minimo ||

            minuto >
              FILTROS.minuto_maximo
          ) {

            continue;
          }

          const casa =
            comp.competitors?.find(
              c =>
                c.homeAway ===
                'home'
            );

          const fora =
            comp.competitors?.find(
              c =>
                c.homeAway ===
                'away'
            );

          if (
            !casa ||
            !fora
          ) {

            continue;
          }

          await sleep(400);

          const raioTemp =
            await buscarRaioXCompleto(
              liga,
              ev.id
            );

          const jogo = {

            id:
              String(ev.id),

            liga,

            nome_casa:
              casa?.team?.displayName ||
              'Casa',

            nome_fora:
              fora?.team?.displayName ||
              'Fora',

            gols_casa:
              numero(
                casa.score
              ),

            gols_fora:
              numero(
                fora.score
              ),

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
              status ===
              'STATUS_HALFTIME'

                ? 'INTERVALO'

                : `${Math.floor(minuto)}'`
          };

          const analise =
            checaJogo(
              jogo,
              raioTemp
            );

          if (
            !analise.aprovado
          ) {

            if (
              analise.motivo?.includes(
                'posse'
              )
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

            raio:
              raioTemp
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

  await garantirNovoDia();

  ultimoScan =
    new Date().toLocaleString(
      'pt-BR',
      {
        timeZone:
          'America/Sao_Paulo'
      }
    );

  console.log(
    `\n🔎 Radar V34.6 varrendo...`
  );

  for (
    const [id, t]
    of enviados.entries()
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

    if (
      !res.length
    ) {

      console.log(
        'Nenhum aprovado (precisa 60% posse).'
      );

      return;
    }

    for (
      const {
        jogo,
        analise,
        raio
      }
      of res
    ) {

      const chave =
        `${jogo.liga}_${jogo.id}_HT`;

      /*
      ===================================================
      EVITA DUPLICAR NA MEMÓRIA
      ===================================================
      */

      if (
        enviados.has(chave)
      ) {

        continue;
      }

      /*
      ===================================================
      EVITA DUPLICAR MESMO APÓS RESTART
      ===================================================
      */

      const jaEnviado =
        historicoDia.enviados.some(
          a =>
            String(a.id) ===
              String(jogo.id) &&
            a.liga ===
              jogo.liga
        );

      if (
        jaEnviado
      ) {

        enviados.set(
          chave,
          Date.now()
        );

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

async function verificarResultado(
  alerta
) {

  try {

    const summary =
      await getJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${alerta.liga}/summary?event=${alerta.id}`
      );

    const comp =
      summary?.header
        ?.competitions?.[0];

    if (!comp) {

      return null;
    }

    const status =
      comp?.status?.type?.name ||
      '';

    const encerrado =
      [
        'STATUS_FINAL',
        'STATUS_FULL_TIME',
        'STATUS_FINAL_PEN'
      ].includes(
        status
      );

    if (!encerrado) {

      return null;
    }

    const casa =
      comp.competitors?.find(
        c =>
          c.homeAway ===
          'home'
      );
