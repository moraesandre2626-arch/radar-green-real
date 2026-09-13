// ROBÔ GOL 2T - V34.3 RIGOROSA ADAPTADA PARA API ESPN GRÁTIS - MORAES
const http = require('http');

const LIGAS_PERMITIDAS = [
    "bra.1", "bra.2", "conmebol.libertadores", "conmebol.sudamericana",
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "ned.1"
];

// FILTRO ADAPTADO - SEM ATAQUES PERIGOSOS (ESPN grátis não tem)
const FILTROS_V34_3_FREE = {
    max_diferenca_gols: 2, // 2x0 MANDA, 2x1 MANDA, 3x0 NÃO
    min_chutes_gol_time_precisa: 2, // ESPN só tem isso de confiável
    min_total_chutes_jogo: 8
};

async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function checaJogoV34_3_FREE(jogo) {
    const diferenca = Math.abs(jogo.gols_casa - jogo.gols_fora);
    if (diferenca > FILTROS_V34_3_FREE.max_diferenca_gols) return false;

    // Regra HOL - time que precisa estar perdendo tem que estar chutando
    if (jogo.chutes_gol_precisa < FILTROS_V34_3_FREE.min_chutes_gol_time_precisa) return false;

    console.log(`✅ APROVADO V34.3 FREE: ${jogo.liga} | ${jogo.placar} | Precisa: ${jogo.time_precisa} com ${jogo.chutes_gol_precisa} no alvo`);
    return true;
}

async function buscarJogosESPN() {
    const jogosAprovaveis = [];
    for (const liga of LIGAS_PERMITIDAS) {
        try {
            const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`);
            if (!data.events) continue;

            for (const ev of data.events) {
                const comp = ev.competitions[0];
                const status = comp.status.type.name;
                // Só pega INTERVALO ou INICIO 2T
                if (!['STATUS_HALFTIME', 'STATUS_SECOND_HALF'].includes(status)) continue;

                const minuto = comp.status.clock || 0;
                if (minuto < 40 || minuto > 55) continue; // Janela HT

                const casa = comp.competitors.find(c => c.homeAway === 'home');
                const fora = comp.competitors.find(c => c.homeAway === 'away');
                const golsCasa = parseInt(casa.score);
                const golsFora = parseInt(fora.score);

                // Busca detalhes do summary pra pegar chutes no gol
                let chutesGolCasa = 0, chutesGolFora = 0;
                try {
                    const summary = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${ev.id}`);
                    const stats = summary.boxscore?.teams || [];
                    // stats vem agregado, pega onTarget
                    chutesGolCasa = parseInt(stats[0]?.statistics?.find(s => s.name === 'shotsOnTarget')?.displayValue || 0);
                    chutesGolFora = parseInt(stats[1]?.statistics?.find(s => s.name === 'shotsOnTarget')?.displayValue || 0);
                } catch(e) {}

                let timePrecisa, chutesPrecisa;
                if (golsCasa < golsFora) {
                    timePrecisa = casa.team.displayName;
                    chutesPrecisa = chutesGolCasa;
                } else if (golsFora < golsCasa) {
                    timePrecisa = fora.team.displayName;
                    chutesPrecisa = chutesGolFora;
                } else {
                    // Empate 0x0, 1x1, 2x2 - pega quem chutou mais
                    timePrecisa = chutesGolCasa >= chutesGolFora? casa.team.displayName : fora.team.displayName;
                    chutesPrecisa = Math.max(chutesGolCasa, chutesGolFora);
                }

                const jogo = {
                    liga, placar: `${golsCasa}x${golsFora}`, gols_casa: golsCasa, gols_fora: golsFora,
                    time_precisa: timePrecisa, chutes_gol_precisa: chutesPrecisa
                };

                if (checaJogoV34_3_FREE(jogo)) jogosAprovaveis.push(jogo);
            }
        } catch (err) {
            console.log(`Erro ${liga}: ${err.message}`);
        }
    }
    return jogosAprovaveis;
}

// --- RENDER FIX ---
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`V34.3 FREE ONLINE - ${new Date().toISOString()}`);
}).listen(PORT, () => {
    console.log(`V34.3 FREE ONLINE na porta ${PORT}`);

    setInterval(async () => {
        console.log(`[${new Date().toLocaleTimeString()}] Radar ESPN GRÁTIS varrendo...`);
        const jogos = await buscarJogosESPN();
        if (jogos.length === 0) console.log("Nenhum jogo no filtro HT agora.");
        // aqui você chama seu enviarTelegram(jogos)
    }, 60000);
});
