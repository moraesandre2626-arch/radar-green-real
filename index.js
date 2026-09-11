// ============================================================
// HIGHLIGHTLY TESTE - ESTATÍSTICAS AO VIVO
// ============================================================
// OBJETIVO:
// 1. Buscar partidas em andamento
// 2. Pegar o matchId
// 3. Consultar /statistics/{matchId}
// 4. Mostrar TODAS as estatísticas recebidas no log do Render
//
// NÃO É A V24 AINDA.
// É SOMENTE UM TESTE DA API.
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const API_KEY = process.env.HIGHLIGHTLY_API_KEY;

const BASE_URL = "https://soccer.highlightly.net";

const INTERVALO = 5 * 60 * 1000; // 5 minutos
const TIMEOUT = 15000;

// ============================================================
// VERIFICAÇÃO DA CHAVE
// ============================================================

if (!API_KEY) {
    console.error("");
    console.error("=================================================");
    console.error("ERRO: HIGHLIGHTLY_API_KEY NÃO CONFIGURADA");
    console.error("=================================================");
    console.error("No Render, crie:");
    console.error("HIGHLIGHTLY_API_KEY = SUA_CHAVE");
    console.error("=================================================");
}

// ============================================================
// CLIENTE HTTP
// ============================================================

const api = axios.create({
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
        "x-rapidapi-key": API_KEY || ""
    }
});

// ============================================================
// FUNÇÃO GENÉRICA PARA API
// ============================================================

async function requestHighlightly(url, params = {}) {

    try {

        const response = await api.get(url, {
            params
        });

        console.log(
            `📡 API ${url} -> HTTP ${response.status}`
        );

        console.log(
            "📊 Requests restantes:",
            response.headers["x-ratelimit-requests-remaining"] ?? "não informado"
        );

        return response.data;

    } catch (error) {

        const status = error.response?.status;

        console.error("");
        console.error("❌ ERRO HIGHLIGHTLY");
        console.error("Endpoint:", url);
        console.error("HTTP:", status || "sem resposta");

        if (error.response?.data) {
            console.error(
                "Resposta:",
                JSON.stringify(error.response.data, null, 2)
            );
        } else {
            console.error(
                "Mensagem:",
                error.message
            );
        }

        if (status === 401) {
            console.error("🔴 API KEY inválida ou não autorizada.");
        }

        if (status === 403) {
            console.error("🔴 Acesso proibido / plano / chave.");
        }

        if (status === 429) {
            console.error("🟠 Limite de requisições atingido.");
        }

        return null;
    }
}

// ============================================================
// BUSCAR PARTIDAS DE HOJE
// ============================================================

async function buscarJogosAoVivo() {

    const agora = new Date();

    const ano = agora.getUTCFullYear();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(agora.getUTCDate()).padStart(2, "0");

    const data = `${ano}-${mes}-${dia}`;

    console.log("");
    console.log("=================================================");
    console.log("🔎 BUSCANDO PARTIDAS");
    console.log("Data UTC:", data);
    console.log("=================================================");

    const resultado = await requestHighlightly(
        "/matches",
        {
            date: data,
            timezone: "America/Sao_Paulo",
            limit: 100
        }
    );

    if (!resultado) {
        return [];
    }

    const jogos = Array.isArray(resultado)
        ? resultado
        : resultado.data || [];

    console.log(
        `📋 Total de partidas retornadas: ${jogos.length}`
    );

    return jogos;
}

// ============================================================
// VERIFICAR SE ESTÁ AO VIVO
// ============================================================

function jogoEstaAoVivo(jogo) {

    const estado =
        jogo?.state?.description ||
        jogo?.status?.description ||
        "";

    const estadosAoVivo = [
        "First half",
        "Second half",
        "Half time",
        "Extra time",
        "Break time",
        "In progress"
    ];

    return estadosAoVivo.includes(estado);
}

// ============================================================
// EXIBIR PARTIDA
// ============================================================

function mostrarPartida(jogo) {

    const casa =
        jogo?.homeTeam?.name ||
        "Casa";

    const fora =
        jogo?.awayTeam?.name ||
        "Fora";

    const estado =
        jogo?.state?.description ||
        "Desconhecido";

    const minuto =
        jogo?.state?.clock ??
        "-";

    const placar =
        jogo?.state?.score?.current ||
        "0 - 0";

    console.log("");
    console.log("-------------------------------------------------");
    console.log(`⚽ ${casa} x ${fora}`);
    console.log(`🆔 Match ID: ${jogo.id}`);
    console.log(`⏱️ Estado: ${estado}`);
    console.log(`⏱️ Minuto: ${minuto}`);
    console.log(`📊 Placar: ${placar}`);
    console.log(`🏆 Liga: ${jogo?.league?.name || "-"}`);
    console.log("-------------------------------------------------");
}

// ============================================================
// BUSCAR ESTATÍSTICAS
// ============================================================

async function buscarEstatisticas(matchId, jogo) {

    console.log("");
    console.log("=================================================");
    console.log(`📊 ESTATÍSTICAS - MATCH ${matchId}`);
    console.log("=================================================");

    const resultado = await requestHighlightly(
        `/statistics/${matchId}`
    );

    if (!resultado) {
        console.log("⚠️ Nenhuma estatística retornada.");
        return;
    }

    console.log("");
    console.log("🔍 JSON BRUTO DAS ESTATÍSTICAS:");
    console.log(
        JSON.stringify(resultado, null, 2)
    );

    console.log("");
    console.log("=================================================");
    console.log("📈 RESUMO DAS ESTATÍSTICAS");
    console.log("=================================================");

    const lista = Array.isArray(resultado)
        ? resultado
        : resultado.data || [];

    if (!Array.isArray(lista) || lista.length === 0) {

        console.log(
            "⚠️ A API respondeu, mas não encontramos a lista esperada."
        );

        return;
    }

    for (const equipe of lista) {

        const nome =
            equipe?.team?.name ||
            "Equipe";

        console.log("");
        console.log(`🏳️ ${nome}`);
        console.log("-----------------------------------------");

        const stats =
            equipe?.statistics || [];

        if (!Array.isArray(stats) || stats.length === 0) {

            console.log(
                "Sem estatísticas para esta equipe."
            );

            continue;
        }

        for (const stat of stats) {

            const nomeStat =
                stat?.displayName ||
                stat?.name ||
                "Estatística";

            const valor =
                stat?.value ??
                "-";

            console.log(
                `   ${nomeStat}: ${valor}`
            );
        }
    }

    console.log("");
    console.log("=================================================");
    console.log("🎯 CAMPOS IMPORTANTES PARA A V24");
    console.log("=================================================");

    const texto =
        JSON.stringify(resultado).toLowerCase();

    const procurar = [
        "shots",
        "shot",
        "shots on target",
        "possession",
        "corners",
        "corner",
        "dangerous attacks",
        "attacks",
        "blocked",
        "xg",
        "expected goals"
    ];

    for (const campo of procurar) {

        const encontrado =
            texto.includes(campo.toLowerCase());

        console.log(
            `${encontrado ? "✅" : "❌"} ${campo}`
        );
    }
}

// ============================================================
// EXECUÇÃO PRINCIPAL
// ============================================================

let executando = false;

async function analisarJogos() {

    if (executando) {

        console.log(
            "⏳ Análise anterior ainda está rodando."
        );

        return;
    }

    executando = true;

    try {

        console.log("");
        console.log("");
        console.log("#################################################");
        console.log("# HIGHLIGHTLY TESTE - ELITE RADAR");
        console.log("#################################################");
        console.log(
            "🕒",
            new Date().toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo"
            })
        );

        if (!API_KEY) {

            console.error(
                "❌ Configure HIGHLIGHTLY_API_KEY no Render."
            );

            return;
        }

        const jogos =
            await buscarJogosAoVivo();

        const aoVivo =
            jogos.filter(jogoEstaAoVivo);

        console.log("");
        console.log(
            `🔥 Jogos ao vivo encontrados: ${aoVivo.length}`
        );

        if (aoVivo.length === 0) {

            console.log(
                "ℹ️ Nenhuma partida ao vivo encontrada agora."
            );

            return;
        }

        // ====================================================
        // TESTAR NO MÁXIMO 3 JOGOS
        // PARA NÃO GASTAR A COTA DESNECESSARIAMENTE
        // ====================================================

        const jogosTeste =
            aoVivo.slice(0, 3);

        console.log(
            `🧪 Testando ${jogosTeste.length} partida(s).`
        );

        for (const jogo of jogosTeste) {

            mostrarPartida(jogo);

            if (!jogo.id) {

                console.log(
                    "⚠️ Partida sem matchId."
                );

                continue;
            }

            await buscarEstatisticas(
                jogo.id,
                jogo
            );
        }

    } catch (error) {

        console.error(
            "❌ ERRO GERAL:",
            error.message
        );

    } finally {

        executando = false;
    }
}

// ============================================================
// ROTAS DO SERVIDOR
// ============================================================

app.get("/", (req, res) => {

    res.json({
        status: "online",
        projeto: "Highlightly Teste",
        api: "Highlightly Football",
        objetivo: "Testar estatísticas ao vivo para Elite Radar V24",
        chaveConfigurada: !!API_KEY
    });
});

app.get("/teste", async (req, res) => {

    await analisarJogos();

    res.json({
        ok: true,
        mensagem: "Teste executado. Veja os logs do Render."
    });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {

    console.log("");
    console.log("=================================================");
    console.log("🚀 HIGHLIGHTLY TESTE ONLINE");
    console.log("=================================================");
    console.log(`🌐 Porta: ${PORT}`);
    console.log(
        `🔑 API Key configurada: ${API_KEY ? "SIM" : "NÃO"}`
    );
    console.log("");
    console.log("Endpoints:");
    console.log("GET /");
    console.log("GET /teste");
    console.log("");
    console.log("O teste automático começa agora.");
    console.log("=================================================");

    analisarJogos();

    setInterval(
        analisarJogos,
        INTERVALO
    );
});
