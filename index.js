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

    const j = await r.json();

    return j.result ?? null;
  } catch (e) {
    return null;
  }
}

async function redisSet(chaveRedis, valor) {
  if (!REDIS_ATIVO) return false;

  try {
    await fetch(
      `${REDIS_URL}/set/${encodeURIComponent(chaveRedis)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          'Content-Type': 'text/plain'
        },
        body: valor
      }
    );

    return true;
  } catch (e) {
    return false;
  }
}

async function salvar() {
  await redisSet(
    chave(historico.data),
    JSON.stringify(historico)
  );
}

async function carregar() {
  const hoje = dataBrasilia();

  historico.data = hoje;

  const salvo = await redisGet(chave(hoje));

  if (!salvo) return;

  try {
    const d =
      typeof salvo === 'string'
        ? JSON.parse(salvo)
        : salvo;

    if (
      d &&
      d.data === hoje &&
      Array.isArray(d.enviados)
    ) {
      historico = d;

      if (!Array.isArray(historico.enviados)) {
        historico.enviados = [];
      }

      if (typeof historico.green !== 'number') {
        historico.green = 0;
      }

      if (typeof historico.red !== 'number') {
        historico.red = 0;
      }

      if (typeof historico.pendentes !== 'number') {
        historico.pendentes = 0;
      }

      if (typeof historico.relatorioEnviado !== 'boolean') {
        historico.relatorioEnviado = false;
      }

      for (const a of historico.enviados) {
        enviados.set(
          `${a.liga}_${a.id}_HT`,
          Date.now()
        );
      }

      console.log(
        `🟢 Histórico carregado: ${historico.enviados.length} alertas`
      );
    }
  } catch (e) {
    console.log('⚠️ Erro ao carregar histórico');
  }
}

async function getJson(url) {
  const controller = new AbortController();

  const timer = setTimeout(
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
    clearTimeout(timer);
  }
}

function num(valor) {
  const n = parseFloat(
    String(valor ?? 0)
      .replace(',', '.')
      .replace('%', '')
  );

  return Number.isFinite(n) ? n : 0;
}

function pegaStat(S, nomes) {
  if (!Array.isArray(S)) return null;

  for (const nome of nomes) {
    const s = S.find(
      x =>
        x.name?.toLowerCase() === nome.toLowerCase() ||
        x.abbreviation?.toLowerCase() === nome.toLowerCase()
    );

    if (s) {
      return num(
        s.displayValue ??
        s.value ??
        0
      );
    }
  }

  return null;
}

async function raioX(liga, eventId) {
  const r = {
    chCasa: 0,
    chFora: 0,

    alvoCasa: 0,
    alvoFora: 0,

    posseCasa: 0,
    posseFora: 0,

    escCasa: 0,
    escFora: 0,

    cruzCasa: 0,
    cruzFora: 0,

    apCasa: null,
    apFora: null,

    temAP: false,
    temCruz: false
  };

  try {
    const s = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`
    );

    for (const b of s?.boxscore?.teams || []) {
      const id = String(
        b?.team?.id || ''
      );

      let lado =
        b.team?.id ==
        s?.header?.competitions?.[0]?.competitors?.[0]?.team?.id
          ? 'home'
          : 'away';

      const comp =
        s?.header?.competitions?.[0]?.competitors?.find(
          x =>
            String(x.team?.id) === id
        );

      if (comp) {
        lado = comp.homeAway;
      }

      const S = b?.statistics || [];

      const ch =
        pegaStat(
          S,
          ['totalShots', 'shots']
        ) ?? 0;

      const al =
        pegaStat(
          S,
          ['shotsOnTarget', 'shotsOnGoal']
        ) ?? 0;

      const po =
        pegaStat(
          S,
          ['possessionPct', 'possession']
        ) ?? 0;

      const es =
        pegaStat(
          S,
          ['wonCorners', 'cornerKicks']
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

      const cr =
        pegaStat(
          S,
          [
            'crosses',
            'totalCrosses'
          ]
        );

      if (lado === 'home') {
        r.chCasa = ch;
        r.alvoCasa = al;
        r.posseCasa = po;
        r.escCasa = es;

        if (cr !== null) {
          r.cruzCasa = cr;
          r.temCruz = true;
        }

        if (ap !== null) {
          r.apCasa = ap;
          r.temAP = true;
        }
      } else {
        r.chFora = ch;
        r.alvoFora = al;
        r.posseFora = po;
        r.escFora = es;

        if (cr !== null) {
          r.cruzFora = cr;
          r.temCruz = true;
        }

        if (ap !== null) {
          r.apFora = ap;
          r.temAP = true;
        }
      }
    }
  } catch (e) {
  }

  return r;
}

function timePrecisa(j, r) {
  if (j.gols_casa > j.gols_fora) {
    return {
      nome: j.nome_fora,
      alvo: r.alvoFora,
      posse: r.posseFora,
      esc: r.escFora,
      cruz: r.cruzFora,
      ap: r.apFora
    };
  }

  if (j.gols_casa < j.gols_fora) {
    return {
      nome: j.nome_casa,
      alvo: r.alvoCasa,
      posse: r.posseCasa,
      esc: r.escCasa,
      cruz: r.cruzCasa,
      ap: r.apCasa
    };
  }

  const pC =
    r.alvoCasa * 3 +
    r.chCasa +
    r.escCasa * 2;

  const pF =
    r.alvoFora * 3 +
    r.chFora +
    r.escFora * 2;

  if (pC >= pF) {
    return {
      nome: j.nome_casa,
      alvo: r.alvoCasa,
      posse: r.posseCasa,
      esc: r.escCasa,
      cruz: r.cruzCasa,
      ap: r.apCasa
    };
  }

  return {
    nome: j.nome_fora,
    alvo: r.alvoFora,
    posse: r.posseFora,
    esc: r.escFora,
    cruz: r.cruzFora,
    ap: r.apFora
  };
}

function checa(j, r) {
  if (
    Math.abs(
      j.gols_casa -
      j.gols_fora
    ) > FILTROS.max_diferenca_gols
  ) {
    return {
      ok: false
    };
  }

  const t = timePrecisa(j, r);

  if (!t) {
    return {
      ok: false
    };
  }

  if (
    r.chCasa +
    r.chFora <
    FILTROS.min_total_chutes_jogo
  ) {
    return {
      ok: false
    };
  }

  if (
    t.alvo <
    FILTROS.min_chutes_gol_time_precisa
  ) {
    return {
      ok: false
    };
  }

  if (
    t.posse <
    FILTROS.posse_minima_pressao
  ) {
    return {
      ok: false
    };
  }

  const score =
    t.cruz +
    t.esc * 2 +
    (t.ap || 0) / 10;

  if (
    score <
    FILTROS.min_pressao_score
  ) {
    return {
      ok: false
    };
  }

  let zona = 'Central';

  if (
    t.cruz >= 8 ||
    (
      t.cruz >= 5 &&
      t.esc >= 2
    )
  ) {
    zona =
      `Lateral (${t.cruz} cruz)`;
  } else if (
    t.esc >= 3
  ) {
    zona =
      `Abafa (${t.esc} esc)`;
  } else if (
    (t.ap || 0) >= 15
  ) {
    zona =
      `Meio-Perigoso (${t.ap} AP)`;
  }

  return {
    ok: true,
    time: t.nome,
    alvo: t.alvo,
    total:
      r.chCasa +
      r.chFora,
    posse: t.posse,
    score,
    zona
  };
}

async function sendTelegram(msg) {
  if (
    !TELEGRAM_TOKEN ||
    !CHAT_ID
  ) {
    return false;
  }

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
    throw new Error(
      d.description ||
      'Erro Telegram'
    );
  }

  return true;
}

async function enviar(j, a, r) {
  const somaPosse =
    r.posseCasa +
    r.posseFora;

  const pc =
    somaPosse > 0
      ? Math.round(
          r.posseCasa /
          somaPosse *
          100
        )
      : 50;

  const msg =
`🚨 RAIO-X GOL 2T — V35 ${FILTROS.posse_minima_pressao}% POSSE
🏆 ${j.liga.toUpperCase()}
⚽ ${j.nome_casa} ${j.gols_casa}x${j.gols_fora} ${j.nome_fora}
⏱️ ${j.minutoTexto}
📊 Chutes: ${r.chCasa}x${r.chFora} (Total: ${a.total})
🎯 Alvo: ${r.alvoCasa}x${r.alvoFora}
🚩 Esc: ${r.escCasa}x${r.escFora} | Posse: ${pc}% x ${100 - pc}%
📍 ${a.zona} | Score ${a.score.toFixed(1)}
🎯 Precisa: ${a.time} (${a.alvo} alvo)
📊 Total hoje: ${historico.enviados.length + 1}`;

  try {
    await sendTelegram(msg);

    const existe =
      historico.enviados.some(
        x =>
          String(x.id) ===
            String(j.id) &&
          x.liga === j.liga
      );

    if (!existe) {
      historico.enviados.push({
        id: String(j.id),
        liga: j.liga,
        casa: j.nome_casa,
        fora: j.nome_fora,
        golsCasa: j.gols_casa,
        golsFora: j.gols_fora,
        status: 'pendente'
      });

      historico.pendentes =
        historico.enviados.filter(
          x =>
            x.status ===
            'pendente'
        ).length;

      await salvar();
    }

    console.log(
      `📨 ${j.nome_casa} x ${j.nome_fora} | Total: ${historico.enviados.length}`
    );

    return true;
  } catch (e) {
    totalErros++;

    console.log(
      `❌ Telegram: ${e.message}`
    );

    return false;
  }
}

async function buscar() {
  const lista = [];

  for (const liga of LIGAS) {
    try {
      const data =
        await getJson(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`
        );

      for (
        const ev of data.events || []
      ) {
        const comp =
          ev?.competitions?.[0];

        if (!comp) continue;

        const status =
          comp?.status?.type?.name ||
          '';

        if (
          ![
            'STATUS_HALFTIME',
            'STATUS_SECOND_HALF'
          ].includes(status)
        ) {
          continue;
        }

        let minuto =
          num(
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

        if (!casa || !fora) {
          continue;
        }

        const jogo = {
          id: String(ev.id),
          liga,

          nome_casa:
            casa.team?.displayName ||
            'Casa',

          nome_fora:
            fora.team?.displayName ||
            'Fora',

          gols_casa:
            num(casa.score),

          gols_fora:
            num(fora.score),

          minuto,
          minutoTexto:
            status ===
            'STATUS_HALFTIME'
              ? 'INTERVALO'
              : `${Math.floor(minuto)}'`
        };

        const chaveJogo =
          `${liga}_${jogo.id}_HT`;

        const ultimo =
          enviados.get(
            chaveJogo
          );

        if (ultimo) {
          const passou =
            Date.now() -
            ultimo;

          if (
            passou <
            3 * 60 * 60 * 1000
          ) {
            continue;
          }
        }

        await sleep(350);

        const r =
          await raioX(
            liga,
            ev.id
          );

        const analise =
          checa(
            jogo,
            r
          );

        if (!analise.ok) {
          continue;
        }

        lista.push({
          jogo,
          raioX: r,
          analise
        });

        const sucesso =
          await enviar(
            jogo,
            analise,
            r
          );

        if (sucesso) {
          enviados.set(
            chaveJogo,
            Date.now()
          );
        }

        await sleep(350);
      }
    } catch (e) {
      totalErros++;

      console.log(
        `⚠️ Erro ${liga}: ${e.message}`
      );
    }
  }

  ultimoScan =
    new Date().toISOString();

  return lista;
}

async function verificarResultado(alerta) {
  try {
    const data =
      await getJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${alerta.liga}/summary?event=${alerta.id}`
      );

    const comp =
      data?.header?.competitions?.[0];

    const tipo =
      comp?.status?.type || {};

    const finalizado =
      tipo.completed === true ||
      tipo.state === 'post' ||
      tipo.state === 'final' ||
      String(
        tipo.name || ''
      ).toUpperCase()
        .includes('FINAL');

    if (!finalizado) {
      return 'pendente';
    }

    const competidores =
      comp?.competitors || [];

    const casa =
      competidores.find(
        x =>
          x.homeAway ===
          'home'
      );

    const fora =
      competidores.find(
        x =>
          x.homeAway ===
          'away'
      );

    if (!casa || !fora) {
      return 'pendente';
    }

    const golsCasa =
      num(casa.score);

    const golsFora =
      num(fora.score);

    const golsIniciais =
      Number(alerta.golsCasa) +
      Number(alerta.golsFora);

    const golsFinais =
      golsCasa +
      golsFora;

    if (
      golsFinais >
      golsIniciais
    ) {
      return 'green';
    }

    return 'red';

  } catch (e) {
    return 'pendente';
  }
}

async function atualizarResultados() {
  if (
    !historico.enviados ||
    historico.enviados.length === 0
  ) {
    return;
  }

  let alterou = false;

  for (
    const alerta of historico.enviados
  ) {
    if (
      alerta.status !==
      'pendente'
    ) {
      continue;
    }

    const resultado =
      await verificarResultado(
        alerta
      );

    if (
      resultado ===
      'green'
    ) {
      alerta.status =
        'green';

      alterou = true;

      console.log(
        `🟢 GREEN: ${alerta.casa} x ${alerta.fora}`
      );
    }

    if (
      resultado ===
      'red'
    ) {
      alerta.status =
        'red';

      alterou = true;

      console.log(
        `🔴 RED: ${alerta.casa} x ${alerta.fora}`
      );
    }

    await sleep(350);
  }

  historico.green =
    historico.enviados.filter(
      x =>
        x.status ===
        'green'
    ).length;

  historico.red =
    historico.enviados.filter(
      x =>
        x.status ===
        'red'
    ).length;

  historico.pendentes =
    historico.enviados.filter(
      x =>
        x.status ===
        'pendente'
    ).length;

  if (alterou) {
    await salvar();
  }
}

function textoRelatorio() {
  const total =
    historico.enviados.length;

  const green =
    historico.enviados.filter(
      x =>
        x.status ===
        'green'
    ).length;

  const red =
    historico.enviados.filter(
      x =>
        x.status ===
        'red'
    ).length;

  const pendentes =
    historico.enviados.filter(
      x =>
        x.status ===
        'pendente'
    ).length;

  const decididos =
    green + red;

  const percentual =
    decididos > 0
      ? (
          green /
          decididos *
          100
        ).toFixed(1)
      : '0.0';

  return (
`📊 RELATÓRIO GOL 2T — V35

📅 ${historico.data}

📨 Quantos mandou: ${total}
🟢 Quantas bateram: ${green}
🔴 Não bateram: ${red}
⏳ Pendentes: ${pendentes}

🎯 Greens: ${green}/${decididos}
📈 Aproveitamento: ${percentual}%

🕚 Fechamento: 23:50
🇧🇷 Horário de Brasília`
  );
}

async function enviarRelatorio2350() {
  if (relatorioEmExecucao) {
    return;
  }

  if (
    historico.relatorioEnviado
  ) {
    return;
  }

  relatorioEmExecucao = true;

  try {
    await atualizarResultados();

    const msg =
      textoRelatorio();

    await sendTelegram(msg);

    historico.relatorioEnviado =
      true;

    await salvar();

    console.log(
      '📊 Relatório 23:50 enviado com sucesso.'
    );
  } catch (e) {
    totalErros++;

    console.log(
      `❌ Erro no relatório: ${e.message}`
    );
  } finally {
    relatorioEmExecucao = false;
  }
}

async function verificarHorario() {
  const agora =
    horaBrasilia();

  /*
   * Janela de segurança:
   * o relatório é programado para 23:50
   * e pode ser enviado até 23:55 caso
   * o ciclo do Render atrase alguns segundos.
   */
  if (
    agora.hora === 23 &&
    agora.minuto >= 50 &&
    agora.minuto <= 55
  ) {
    await enviarRelatorio2350();
  }
}

function resetarSeMudouDia() {
  const hoje =
    dataBrasilia();

  if (
    historico.data !== hoje
  ) {
    console.log(
      `📅 Novo dia: ${hoje}`
    );

    historico = {
      data: hoje,
      enviados: [],
      green: 0,
      red: 0,
      pendentes: 0,
      relatorioEnviado: false
    };

    enviados.clear();

    salvar();
  }
}

async function ciclo() {
  try {
    resetarSeMudouDia();

    const agora =
      horaBrasilia();

    /*
     * Durante o dia procura novos jogos.
     * Evita continuar procurando depois
     * do fechamento diário.
     */
    if (
      agora.hora >= 8 &&
      agora.hora < 23
    ) {
      await buscar();
    }

    /*
     * Atualiza os resultados dos alertas
     * já enviados.
     */
    await atualizarResultados();

    /*
     * Relatório somente às 23:50 BRT.
     */
    await verificarHorario();

  } catch (e) {
    totalErros++;

    console.log(
      `❌ Erro no ciclo: ${e.message}`
    );
  }
}

const server =
  http.createServer(
    async (req, res) => {

      if (
        req.url ===
        '/teste'
      ) {
        try {
          await sendTelegram(
            '✅ TESTE ROBÔ GOL 2T V35 — Telegram funcionando.'
          );

          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          );

          res.end(
            JSON.stringify({
              status: 'ok',
              mensagem:
                'Teste enviado para o Telegram'
            })
          );

        } catch (e) {
          res.writeHead(
            500,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          );

          res.end(
            JSON.stringify({
              status: 'erro',
              mensagem:
                e.message
            })
          );
        }

        return;
      }

      if (
        req.url ===
        '/status'
      ) {
        res.writeHead(
          200,
          {
            'Content-Type':
              'application/json; charset=utf-8'
          }
        );

        res.end(
          JSON.stringify({
            status: 'online',
            versao: 'V35',
            brasilia:
              horaBrasilia(),
            data:
              dataBrasilia(),
            alertasHoje:
              historico.enviados.length,
            green:
              historico.green,
            red:
              historico.red,
            pendentes:
              historico.pendentes,
            relatorio2350:
              historico.relatorioEnviado,
            redis:
              REDIS_ATIVO,
            ultimoScan,
            erros:
              totalErros
          })
        );

        return;
      }

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );

      res.end(
        'ROBÔ GOL 2T V35 ONLINE'
      );
    }
  );

server.listen(
  PORT,
  async () => {
    console.log(
      `🚀 ROBÔ GOL 2T V35 online na porta ${PORT}`
    );

    console.log(
      `🇧🇷 Brasília: ${JSON.stringify(horaBrasilia())}`
    );

    console.log(
      `💾 Redis: ${REDIS_ATIVO ? 'ATIVO' : 'DESATIVADO'}`
    );

    await carregar();

    /*
     * Primeira execução após iniciar.
     */
    await ciclo();

    /*
     * Novo ciclo a cada 20 minutos.
     */
    setInterval(
      ciclo,
      20 * 60 * 1000
    );

    /*
     * Verificação do horário do relatório
     * a cada 20 segundos.
     */
    setInterval(
      verificarHorario,
      20 * 1000
    );
  }
);

process.on(
  'unhandledRejection',
  err => {
    console.log(
      '❌ Unhandled:',
      err?.message || err
    );
  }
);

process.on(
  'uncaughtException',
  err => {
    console.log(
      '❌ Uncaught:',
      err?.message || err
    );
  }
);
