const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

let sinaisDia = [];

async function enviar(msg) {
    try {
        if (!TOKEN || !CHAT_ID) {
            console.log("Sem TOKEN/CHAT_ID");
            return;
        }
        const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: msg
        });
        console.log("Enviado:", msg.substring(0,30));
    } catch (e) {
        console.log("Erro enviar:", e.message);
    }
}

// MOCK PRA TESTE - depois voce troca pela busca real
function buscarJogos() {
    return [{
        liga: "BRA.1",
        jogo: "Bragantino 0x1 Flamengo",
        tempo: "47'",
        chutes: "12x8",
        alvo: "4x2",
        posse: 68,
        posse2: 32,
        esc: "5x1",
        c: 9,
        score: 11.5,
        time_precisa: "Bragantino",
        ht: "0x1",
        ft: "1x1"
    }];
}

async function loopPrincipal() {
    try {
        const jogos = buscarJogos();
        for (const j of jogos) {
            const minuto = parseInt(j.tempo.replace("'", ""));
            if (j.posse >= 60 && minuto >= 45 && minuto <= 75) {
                const msg = `RAIO-X GOL 2T V34.8 PREMIUM

${j.liga}
${j.jogo}
${j.tempo}

Chutes ${j.chutes} Alvo ${j.alvo}
Posse ${j.posse}% x ${j.posse2}% Esc ${j.esc}
Pressao: Lateral ${j.c}c Score ${j.score}
Precisa: ${j.time_precisa}
ENTRADA Over 0.5 GOL`;

                await enviar(msg);
                sinaisDia.push(j);
            }
        }
    } catch (e) {
        console.log("Erro loop:", e.message);
    }
}

// Roda a cada 1 minuto
setInterval(loopPrincipal, 60 * 1000);

// Relatorio 23:59 Brasil
cron.schedule('59 23 * * *', async () => {
    const total = sinaisDia.length;
    const greens = sinaisDia.filter(s => s.ft !== s.ht).length;
    const taxa = total ? Math.round(greens/total*100) : 0;
    const lucro = greens - (total - greens);
    const data = new Date().toLocaleDateString('pt-BR');
    
    let txt = `RELATORIO ${data}\nTotal:${total} GREEN:${greens} RED:${total-greens} Taxa:${taxa}% Lucro:${lucro} un\n\n`;
    if (total === 0) {
        txt += "Nenhum sinal hoje";
    } else {
        sinaisDia.forEach((s, i) => {
            const res = s.ft !== s.ht ? "GREEN" : "RED";
            txt += `[${res}] ${i+1}. ${s.jogo} HT ${s.ht} -> ${s.ft} ${s.time_precisa}\n`;
        });
    }
    await enviar(txt);
    sinaisDia = [];
}, { timezone: "America/Sao_Paulo" });

app.get("/", (req, res) => {
    res.send("V34.8 PREMIUM CURTO SEM LINK - LIVE NODE");
});

app.listen(PORT, () => {
    console.log(`Rodando na porta ${PORT}`);
    enviar("✅ V34.8 PREMIUM NODE SEM LINK INICIADO - Teste");
    loopPrincipal();
});
