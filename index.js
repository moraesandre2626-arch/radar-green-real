const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// ELITE RADAR V7.0
// PROTEÇÃO AVANÇADA + RODÍZIO INTELIGENTE
// API-FOOTBALL
// ============================================================

// ------------------------------------------------------------
// CONFIGURAÇÕES
// ------------------------------------------------------------

const API_URL =
  "https://v3.football.api-sports.io/fixtures?live=all";

const API_KEYS_RAW =
  process.env.API_FOOTBALL_KEY || "";

const API_KEYS =
  API_KEYS_RAW
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);

// Cache dos jogos ao vivo
const CACHE_TTL_MS = 15000;

// Intervalo mínimo recomendado entre chamadas
// da mesma chave
const MIN_KEY_INTERVAL_MS = 12000;

// Cooldown inicial após 429
const INITIAL_COOLDOWN_MS = 30000;

// Cooldown máximo
const MAX_COOLDOWN_MS =
  15 * 60 * 1000;

// Timeout
const REQUEST_TIMEOUT_MS = 12000;

// ------------------------------------------------------------
// ESTADO DAS CHAVES
// ------------------------------------------------------------

let keysStatus =
  API_KEYS.map((key, index) => ({
    id: index + 1,
    key,

    blockedUntil: 0,

    lastUsed: 0,

    uses: 0,

    consecutive429: 0,

    cooldownMs:
      INITIAL_COOLDOWN_MS,

    minuteRemaining: null,

    minuteLimit: null,

    dailyRemaining: null,

    dailyLimit: null,

    lastStatus: null,

    lastError: null,

    lastResponse: 0
  }));

// ------------------------------------------------------------
// CACHE
// ------------------------------------------------------------

let liveCache = {
  data: null,
  timestamp: 0
};

// ------------------------------------------------------------
// CONTROLE DE REQUISIÇÃO
// ------------------------------------------------------------

let requestInProgress = false;

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function now() {
  return Date.now();
}

// ------------------------------------------------------------
// VERIFICA SE A CHAVE ESTÁ BLOQUEADA
// ------------------------------------------------------------

function isBlocked(keyObj) {
  return keyObj.blockedUntil > now();
}

// ------------------------------------------------------------
// LIBERA CHAVES COM COOLDOWN EXPIRADO
// ------------------------------------------------------------

function releaseExpiredKeys() {
  const current = now();

  keysStatus =
    keysStatus.map(keyObj => {

      if (
        keyObj.blockedUntil > 0 &&
        keyObj.blockedUntil <= current
      ) {
        return {
          ...keyObj,
          blockedUntil: 0,
          lastError: null
        };
      }

      return keyObj;
    });
}

// ------------------------------------------------------------
// PREVIEW SEGURO DA CHAVE
// ------------------------------------------------------------

function keyPreview(key) {

  if (!key) {
    return "N/A";
  }

  if (key.length <= 8) {
    return "********";
  }

  return (
    key.slice(0, 8) +
    "..." +
    key.slice(-4)
  );
}

// ============================================================
// ESCOLHA DAS CHAVES
// ============================================================

function getValidKeys() {

  releaseExpiredKeys();

  const current = now();

  return keysStatus
    .filter(keyObj => {

      // Chave em cooldown
      if (
        keyObj.blockedUntil >
        current
      ) {
        return false;
      }

      // Evita chamadas muito próximas
      if (
        keyObj.lastUsed > 0 &&
        current -
          keyObj.lastUsed <
          MIN_KEY_INTERVAL_MS
      ) {
        return false;
      }

      // Se sabemos que está praticamente
      // no limite, evitamos usar
      if (
        keyObj.minuteRemaining !== null &&
        keyObj.minuteRemaining <= 1
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {

      // Prefere maior limite restante
      if (
        a.minuteRemaining !== null &&
        b.minuteRemaining !== null &&
        a.minuteRemaining !==
          b.minuteRemaining
      ) {
        return (
          b.minuteRemaining -
          a.minuteRemaining
        );
      }

      // Depois prefere a menos utilizada
      return (
        a.lastUsed -
        b.lastUsed
      );
    });
}

// ------------------------------------------------------------
// PEGA A MELHOR CHAVE
// ------------------------------------------------------------

function getValidKey() {

  const validKeys =
    getValidKeys();

  if (
    validKeys.length === 0
  ) {
    return null;
  }

  return validKeys[0];
}

// ============================================================
// REGISTRA USO
// ============================================================

function registerUse(keyObj) {

  keyObj.lastUsed =
    now();

  keyObj.uses += 1;
}

// ============================================================
// RATE LIMIT
// ============================================================

function updateRateHeaders(
  keyObj,
  headers
) {

  if (!headers) {
    return;
  }

  const minuteRemaining =
    headers[
      "x-ratelimit-remaining"
    ];

  const minuteLimit =
    headers[
      "x-ratelimit-limit"
    ];

  const dailyRemaining =
    headers[
      "x-ratelimit-requests-remaining"
    ];

  const dailyLimit =
    headers[
      "x-ratelimit-requests-limit"
    ];

  if (
    minuteRemaining !==
    undefined
  ) {
    keyObj.minuteRemaining =
      Number(
        minuteRemaining
      );
  }

  if (
    minuteLimit !==
    undefined
  ) {
    keyObj.minuteLimit =
      Number(
        minuteLimit
      );
  }

  if (
    dailyRemaining !==
    undefined
  ) {
    keyObj.dailyRemaining =
      Number(
        dailyRemaining
      );
  }

  if (
    dailyLimit !==
    undefined
  ) {
    keyObj.dailyLimit =
      Number(
        dailyLimit
      );
  }
}

// ============================================================
// RETRY-AFTER
// ============================================================

function getRetryAfter(
  headers
) {

  if (!headers) {
    return null;
  }

  const retryAfter =
    headers[
      "retry-after"
    ];

  if (
    retryAfter ===
    undefined
  ) {
    return null;
  }

  const seconds =
    Number(
      retryAfter
    );

  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return null;
  }

  return (
    seconds * 1000
  );
}

// ============================================================
// COOLDOWN PROGRESSIVO
// ============================================================

function cooldownKey(
  keyObj,
  customCooldown = null
) {

  keyObj.consecutive429 += 1;

  const multiplier =
    Math.pow(
      2,
      Math.min(
        keyObj.consecutive429 -
          1,
        4
      )
    );

  let cooldown =
    Math.min(
      INITIAL_COOLDOWN_MS *
        multiplier,
      MAX_COOLDOWN_MS
    );

  if (
    customCooldown !==
    null
  ) {
    cooldown =
      Math.min(
        Math.max(
          customCooldown,
          cooldown
        ),
        MAX_COOLDOWN_MS
      );
  }

  keyObj.cooldownMs =
    cooldown;

  keyObj.blockedUntil =
    now() + cooldown;
}

// ============================================================
// CHAVE SAUDÁVEL
// ============================================================

function markKeyHealthy(
  keyObj
) {

  keyObj.consecutive429 =
    0;

  keyObj.cooldownMs =
    INITIAL_COOLDOWN_MS;

  keyObj.lastError =
    null;

  keyObj.lastStatus =
    200;
}

// ============================================================
// CACHE
// ============================================================

function getCachedData() {

  if (
    !liveCache.data
  ) {
    return null;
  }

  if (
    now() -
      liveCache.timestamp >
    CACHE_TTL_MS
  ) {
    return null;
  }

  return liveCache.data;
}

function saveCache(
  data
) {

  liveCache = {
    data,
    timestamp: now()
  };
}

// ============================================================
// CHAMADA PROTEGIDA
// ============================================================

async function callFootballAPI() {

  const attemptedKeys =
    new Set();

  const maxAttempts =
    Math.min(
      API_KEYS.length,
      2
    );

  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {

    const availableKeys =
      getValidKeys()
        .filter(
          keyObj =>
            !attemptedKeys.has(
              keyObj.id
            )
        );

    if (
      availableKeys.length ===
      0
    ) {
      break;
    }

    const keyObj =
      availableKeys[0];

    attemptedKeys.add(
      keyObj.id
    );

    registerUse(
      keyObj
    );

    try {

      const response =
        await axios.get(
          API_URL,
          {
            headers: {
              "x-apisports-key":
                keyObj.key
            },

            timeout:
              REQUEST_TIMEOUT_MS,

            validateStatus:
              () => true
          }
        );

      keyObj.lastResponse =
        now();

      keyObj.lastStatus =
        response.status;

      updateRateHeaders(
        keyObj,
        response.headers
      );

      // ======================================================
      // SUCESSO
      // ======================================================

      if (
        response.status ===
        200
      ) {

        const body =
          response.data ||
          {};

        // -----------------------------------------------
        // ERROS DENTRO DO HTTP 200
        // -----------------------------------------------

        if (
          body.errors &&
          Object.keys(
            body.errors
          ).length > 0
        ) {

          const errorText =
            JSON.stringify(
              body.errors
            ).toLowerCase();

          if (
            errorText.includes(
              "rate"
            ) ||
            errorText.includes(
              "limit"
            ) ||
            errorText.includes(
              "too many"
            )
          ) {

            keyObj.lastError =
              body.errors;

            cooldownKey(
              keyObj
            );

            continue;
          }

          keyObj.lastError =
            body.errors;

          return {
            success: false,

            status: 400,

            error:
              body.errors
          };
        }

        markKeyHealthy(
          keyObj
        );

        return {
          success: true,

          data: body,

          keyObj
        };
      }

      // ======================================================
      // 429
      // ======================================================

      if (
        response.status ===
        429
      ) {

        keyObj.lastError =
          response.data &&
          response.data.errors
            ? response.data.errors
            : "429 Too Many Requests";

        const retryAfter =
          getRetryAfter(
            response.headers
          );

        cooldownKey(
          keyObj,
          retryAfter
        );

        // Não insiste nessa mesma chave
        continue;
      }

      // ======================================================
      // 401 / 403
      // ======================================================

      if (
        response.status ===
          401 ||
        response.status ===
          403
      ) {

        keyObj.lastError =
          response.data &&
          response.data.errors
            ? response.data.errors
            : "Erro de autenticação/acesso";

        // Retira temporariamente do rodízio
        keyObj.blockedUntil =
          now() +
          MAX_COOLDOWN_MS;

        continue;
      }

      // ======================================================
      // ERROS 5XX
      // ======================================================

      if (
        response.status >=
        500
      ) {

        keyObj.lastError =
          response.data &&
          response.data.errors
            ? response.data.errors
            : "Erro temporário da API";

        keyObj.blockedUntil =
          now() + 5000;

        continue;
      }

      // ======================================================
      // OUTROS STATUS
      // ======================================================

      keyObj.lastError =
        response.data &&
        response.data.errors
          ? response.data.errors
          : "HTTP " +
            response.status;

      return {
        success: false,

        status:
          response.status,

        error:
          keyObj.lastError
      };

    } catch (error) {

      keyObj.lastStatus =
        "NETWORK_ERROR";

      keyObj.lastError =
        error.message;

      // Erro de conexão:
      // pequeno cooldown para impedir loop
      keyObj.blockedUntil =
        now() + 5000;

      continue;
    }
  }

  return {
    success: false,

    status: 429,

    error:
      "Nenhuma chave disponível no momento."
  };
}

// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.send(
      "Radar GREEN Real - V7.0 PROTECTED ELITE"
    );
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (req, res) => {

    releaseExpiredKeys();

    const current =
      now();

    const livres =
      keysStatus.filter(
        keyObj =>
          keyObj.blockedUntil <=
          current
      ).length;

    const bloqueadas =
      keysStatus.filter(
        keyObj =>
          keyObj.blockedUntil >
          current
      ).length;

    res.json({

      status:
        "OPERACIONAL",

      version:
        "V7.0 PROTECTED ELITE",

      total_keys:
        API_KEYS.length,

      chaves_livres:
        livres,

      chaves_bloqueadas:
        bloqueadas,

      requisicao_em_andamento:
        requestInProgress,

      cache_disponivel:
        !!getCachedData(),

      cache_ttl:
        CACHE_TTL_MS / 1000 +
        "s",

      keysStatus:
        keysStatus.map(
          getKeyStatus
        ),

      timestamp:
        new Date().toISOString()
    });
  }
);

// ============================================================
// STATUS DAS CHAVES
// ============================================================

function getKeyStatus(
  keyObj
) {

  const current =
    now();

  return {

    id:
      keyObj.id,

    preview:
      keyPreview(
        keyObj.key
      ),

    livre:
      keyObj.blockedUntil <=
      current,

    bloqueada:
      keyObj.blockedUntil >
      current,

    desbloqueia_em:
      keyObj.blockedUntil >
      current
        ? Math.ceil(
            (
              keyObj.blockedUntil -
              current
            ) / 1000
          ) + "s"
        : "AGORA",

    usos:
      keyObj.uses,

    limite_minuto:
      keyObj.minuteLimit,

    restante_minuto:
      keyObj.minuteRemaining,

    limite_diario:
      keyObj.dailyLimit,

    restante_diario:
      keyObj.dailyRemaining,

    ultimos_429:
      keyObj.consecutive429,

    ultimo_status:
      keyObj.lastStatus,

    ultimo_erro:
      keyObj.lastError,

    ultima_utilizacao:
      keyObj.lastUsed > 0
        ? new Date(
            keyObj.lastUsed
          ).toISOString()
        : "NUNCA"
  };
}

// ============================================================
// KEYS
// ============================================================

app.get(
  "/keys",
  (req, res) => {

    releaseExpiredKeys();

    res.json({

      total:
        API_KEYS.length,

      keys:
        keysStatus.map(
          getKeyStatus
        ),

      timestamp:
        new Date().toISOString()
    });
  }
);

// ============================================================
// RADAR
// ============================================================

app.get(
  "/radar",
  async (req, res) => {

    try {

      // ------------------------------------------------------
      // CACHE
      // ------------------------------------------------------

      const cached =
        getCachedData();

      if (cached) {

        return res.json({

          ...cached,

          origem:
            "CACHE",

          timestamp:
            new Date().toISOString()
        });
      }

      // ------------------------------------------------------
      // PROTEÇÃO CONTRA REQUISIÇÕES SIMULTÂNEAS
      // ------------------------------------------------------

      if (
        requestInProgress
      ) {

        return res.status(
          202
        ).json({

          status:
            "REQUISICAO JA EM ANDAMENTO",

          mensagem:
            "O radar está processando uma consulta. Aguarde a próxima atualização.",

          timestamp:
            new Date().toISOString()
        });
      }

      requestInProgress =
        true;

      // ------------------------------------------------------
      // CHAMADA PROTEGIDA
      // ------------------------------------------------------

      const result =
        await callFootballAPI();

      // ------------------------------------------------------
      // SUCESSO
      // ------------------------------------------------------

      if (
        result.success
      ) {

        const responseData = {

          status:
            "RADAR ATIVO - V7.0",

          key_em_uso:
            keyPreview(
              result.keyObj.key
            ),

          jogos_ao_vivo:
            result.data &&
            result.data.response
              ? result.data.response.length
              : 0,

          resultados:
            result.data
              ? result.data.results
              : 0,

          origem:
            "API",

          timestamp:
            new Date().toISOString()
        };

        saveCache(
          responseData
        );

        requestInProgress =
          false;

        return res.json(
          responseData
        );
      }

      // ------------------------------------------------------
      // FALHA
      // ------------------------------------------------------

      requestInProgress =
        false;

      return res.status(
        result.status === 429
          ? 429
          : 500
      ).json({

        status:
          "RADAR SEM CHAVE DISPONIVEL",

        erro:
          result.error,

        mensagem:
          "O sistema evitou novas tentativas agressivas para proteger as chaves.",

        timestamp:
          new Date().toISOString()
      });

    } catch (error) {

      requestInProgress =
        false;

      console.error(
        "ERRO GERAL RADAR:",
        error.message
      );

      return res.status(
        500
      ).json({

        status:
          "ERRO INTERNO",

        error:
          error.message,

        timestamp:
          new Date().toISOString()
      });
    }
  }
);

// ============================================================
// STATUS SIMPLES
// ============================================================

app.get(
  "/status",
  (req, res) => {

    releaseExpiredKeys();

    res.json({

      status:
        "ONLINE",

      versao:
        "V7.0",

      api_keys:
        API_KEYS.length,

      cache:
        !!getCachedData(),

      requisicao:
        requestInProgress
          ? "EM ANDAMENTO"
          : "LIVRE",

      timestamp:
        new Date().toISOString()
    });
  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      "============================================"
    );

    console.log(
      "ELITE RADAR V7.0"
    );

    console.log(
      "PROTECTED ROTATION"
    );

    console.log(
      "SMART RATE LIMIT"
    );

    console.log(
      "CACHE:",
      CACHE_TTL_MS /
        1000 +
        "s"
    );

    console.log(
      "INTERVALO POR CHAVE:",
      MIN_KEY_INTERVAL_MS /
        1000 +
        "s"
    );

    console.log(
      "COOLDOWN MAXIMO:",
      MAX_COOLDOWN_MS /
        60000 +
        "min"
    );

    console.log(
      "TOTAL DE CHAVES:",
      API_KEYS.length
    );

    console.log(
      "PORTA:",
      PORT
    );

    console.log(
      "============================================"
    );
  }
);
