// ============================================================
// HIGHLIGHTLY TESTE - ELITE RADAR
// ============================================================
// TESTA:
// - partidas
// - jogos ao vivo
// - estatísticas
// - chutes
// - chutes no alvo
// - posse
// - escanteios
// - ataques
// - xG
//
// IMPORTANTE:
// A chave fica no Render:
// HIGHLIGHTLY_API_KEY
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.HIGHLIGHTLY_API_KEY;

const BASE_URL = "https://soccer.highlightly.net";

const TIMEOUT = 15000;
const INTERVALO = 5 * 60 * 1000;

// ============================================================
// CLIENTE
// ============================================================

const api = axios.create({
    baseURL: BASE_URL,
    timeout: TIMEOUT,
    headers: {
        "x-rapidapi-key": API_KEY || ""
    }
});

// ============================================================
// TESTE DA API
// ============================================================

async function requisicao(endpoint, params = {}) {

    try {

        const resposta = await api.get(endpoint, {
            params
        });

        console.log("");
        console.log(
            `📡 ${endpoint} -> HTTP ${resposta.status}`
        );

        return resposta.data;

    } catch (erro) {

        console.error("");
        console.error("❌ ERRO HIGHLIGHTLY");
        console.error("Endpoint:", endpoint);
        console.error(
            "HTTP:",
            erro.response?.status || "sem resposta"
        );

        if (erro.response?.data) {
            console.error(
                "Resposta:",
                JSON.stringify(
                    erro.response.data,
                    null,
                    2
                )
            );
        } else {
            console.error(
                "Mensagem:",
                erro.message
            );
        }

        return null;
    }
}

// ============================================================
// BUSCAR PARTIDAS
// ============================================================

async function buscarPartidas() {

    const agora = new Date();

    const ano = agora.getUTCFullYear();
    const mes = String(
        agora.getUTCMonth() + 1
    ).padStart(2, "0");

    const dia = String(
        agora.getUTCDate()
    ).padStart(2, "0");

    const data = `${ano}-${mes}-${dia}`;

    console.log("");
    console.log("=================================================");
    console.log("🔎 BUSCANDO PARTIDAS");
    console.log("=================================================");
    console.log("📅 Data:", data);

    const resultado = await requisicao(
        "/matches",
        {
            date: data
        }
    );

    if (!resultado) {
        return [];
    }

    // A API pode retornar array diretamente
    // ou dentro de uma propriedade.

    let partidas = [];

    if (Array.isArray(resultado)) {
        partidas = resultado;
    } else if (Array.isArray(resultado.data)) {
        partidas = resultado.data;
    } else if (Array.isArray(resultado.matches)) {
        partidas = resultado.matches;
    }

    console.log(
        `📋 Partidas encontradas: ${partidas.length}`
    );

    return partidas;
}

// ============================================================
// IDENTIFICAR JOGO AO VIVO
// ============================================================

function estaAoVivo(jogo) {

    const texto = JSON.stringify(jogo)
        .toLowerCase();

    const palavras = [
        "live",
        "in progress",
        "first half",
        "second half",
        "half time",
        "halftime",
        "1h",
        "2h"
    ];

    return palavras.some(
        palavra => texto.includes(palavra)
    );
}

// ============================================================
// NOME DOS TIMES
// ============================================================

function nomeTime(jogo, lado) {

    if (lado === "casa") {

        return (
            jogo?.homeTeam?.name ||
            jogo?.home?.name ||
            jogo?.homeTeam?.shortName ||
            "Casa"
        );
    }

    return (
        jogo?.awayTeam?.name ||
        jogo?.away?.name ||
        jogo?.awayTeam?.shortName ||
        "Fora"
    );
}

// ============================================================
// MOSTRAR JOGO
// ============================================================

function mostrarJogo(jogo) {

    console.log("");
    console.log("-------------------------------------------------");

    console.log(
        `⚽ ${nomeTime(jogo, "casa")} x ${nomeTime(jogo, "fora")}`
    );

    console.log(
        "🆔 Match ID:",
        jogo?.id || jogo?.matchId || "NÃO ENCONTRADO"
    );

    console.log(
        "🏆 Liga:",
        jogo?.league?.name ||
        jogo?.competition?.name ||
        "-"
    );

    console.log(
        "⏱️ Estado:",
        jogo?.state?.description ||
        jogo?.status?.description ||
        jogo?.status ||
        "-"
    );

    console.log(
        "-------------------------------------------------");
}

// ============================================================
// BUSCAR ESTATÍSTICAS
// ============================================================

async function buscarEstatisticas(matchId) {

    console.log("");
    console.log("=================================================");
    console.log(
        `📊 ESTATÍSTICAS DO JOGO ${matchId}`
    );
    console.log("=================================================");

    const resultado = await requisicao(
        `/statistics/${matchId}`
    );

    if (!resultado) {

        console.log(
            "⚠️ Nenhuma estatística recebida."
        );

        return;
    }

    // ========================================================
    // MOSTRAR JSON COMPLETO
    // ========================================================

    console.log("");
    console.log("🔍 JSON BRUTO RECEBIDO:");
    console.log(
        JSON.stringify(
            resultado,
            null,
            2
        )
    );

    // ========================================================
    // PROCURAR CAMPOS IMPORTANTES
    // ========================================================

    const texto = JSON.stringify(
        resultado
    ).toLowerCase();

    console.log("");
    console.log("=================================================");
    console.log("🎯 CAMPOS PARA A V24");
    console.log("=================================================");

    const campos = [
        ["chutes", "shots"],
        ["chutes no alvo", "shots on target"],
        ["posse", "possession"],
        ["escanteios", "corner"],
        ["ataques", "attacks"],
        ["ataques perigosos", "dangerous attacks"],
        ["chutes bloqueados", "blocked"],
        ["xG", "xg"],
        ["expected goals", "expected goals"]
    ];

    for (const [nome, busca] of campos) {

        const encontrou =
            texto.includes(busca);

        console.log(
            `${encontrou ? "✅" : "❌"} ${nome}`
        );
    }

    // ========================================================
    // MOSTRAR ESTRUTURA
    // ========================================================

    console.log("");
    console.log("=================================================");
    console.log("📦 ESTRUTURA RECEBIDA");
    console.log("=================================================");

    if (Array.isArray(resultado)) {

        console.log(
            "Tipo: ARRAY"
        );

        console.log(
            "Quantidade:",
            resultado.length
        );

    } else {

        console.log(
            "Tipo: OBJETO"
        );

        console.log(
            "Chaves:",
            Object.keys(resultado)
        );
    }
}

// ============================================================
// EXECUTAR TESTE
// ============================================================

let rodando = false;

async function executarTeste() {

    if (rodando) {

        console.log(
            "⏳ Teste anterior ainda está executando."
        );

        return;
    }

    rodando = true;

    try {

        console.log("");
        console.log("");
        console.log("#################################################");
        console.log("# 🚀 HIGHLIGHTLY TESTE - ELITE RADAR");
        console.log("#################################################");

        console.log(
            "🕒",
            new Date().toLocaleString(
                "pt-BR",
                {
                    timeZone: "America/Sao_Paulo"
                }
            )
        );

        // ====================================================
        // VERIFICAR CHAVE
        // ====================================================

        if (!API_KEY) {

            console.error("");
            console.error(
                "❌ HIGHLIGHTLY_API_KEY NÃO CONFIGURADA"
            );

            console.error(
                "No Render crie a Environment Variable:"
            );

            console.error(
                "HIGHLIGHTLY_API_KEY"
            );

            return;
        }

        console.log(
            "🔑 API Key configurada: SIM"
        );

        // ====================================================
        // BUSCAR JOGOS
        // ====================================================

        const partidas =
            await buscarPartidas();

        if (!partidas.length) {

            console.log("");
            console.log(
                "ℹ️ Nenhuma partida encontrada."
            );

            return;
        }

        // ====================================================
        // FILTRAR AO VIVO
        // ====================================================

        const aoVivo =
            partidas.filter(
                estaAoVivo
            );

        console.log("");
        console.log(
            `🔥 Jogos aparentemente ao vivo: ${aoVivo.length}`
        );

        // ====================================================
        // SE NÃO DETECTAR AO VIVO,
        // MOSTRAR ALGUNS JOGOS PARA ENTENDER A ESTRUTURA
        // ====================================================

        const jogosParaTestar =
            aoVivo.length > 0
                ? aoVivo.slice(0, 3)
                : partidas.slice(0, 3);

        console.log(
            `🧪 Jogos sendo testados: ${jogosParaTestar.length}`
        );

        // ====================================================
        // CONSULTAR ESTATÍSTICAS
        // ====================================================

        for (
            const jogo of jogosParaTestar
        ) {

            mostrarJogo(jogo);

            const matchId =
                jogo?.id ||
                jogo?.matchId;

            if (!matchId) {

                console.log(
                    "❌ Match ID não encontrado."
                );

                continue;
            }

            await buscarEstatisticas(
                matchId
            );
        }

    } catch (erro) {

        console.error("");
        console.error(
            "❌ ERRO GERAL:"
        );

        console.error(
            erro.message
        );

    } finally {

        rodando = false;
    }
}

// ============================================================
// ROTAS
// ============================================================

app.get("/", (req, res) => {

    res.json({
        status: "online",
        api: "Highlightly",
        projeto: "Elite Radar Teste",
        chaveConfigurada: !!API_KEY
    });
});

app.get("/teste", async (req, res) => {

    executarTeste();

    res.json({
        ok: true,
        mensagem:
            "Teste iniciado. Veja os logs do Render."
    });
});

// ============================================================
// SERVIDOR
// ============================================================

app.listen(
    PORT,
    () => {

        console.log("");
        console.log("=================================================");
        console.log("🚀 HIGHLIGHTLY TESTE ONLINE");
        console.log("=================================================");
        console.log(
            `🌐 PORTA: ${PORT}`
        );
        console.log(
            `🔑 API KEY: ${API_KEY ? "CONFIGURADA" : "NÃO CONFIGURADA"}`
        );
        console.log("");
        console.log(
            "🌐 Endpoint: /"
        );
        console.log(
            "🧪 Teste manual: /teste"
        );
        console.log("=================================================");

        // Primeiro teste imediatamente
        executarTeste();

        // Repetir a cada 5 minutos
        setInterval(
            executarTeste,
            INTERVALO
        );
    }
);
