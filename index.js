// ROBÔ GOL 2T - V34.3 RIGOROSA - MORAES - FIX RENDER
const http = require('http');

const LIGAS_PERMITIDAS = [
    "bra.1", "bra.2", "libertadores", "sudamericana",
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1",
    "ned.1"
];

const FILTROS_V34_3 = {
    max_diferenca_gols: 2, // 2x0 MANDA, 2x1 MANDA, 3x0 NÃO
    min_ataques_perigosos_total: 45,
    min_ataques_perigosos_time_precisa: 18,
    min_chutes_gol_time_precisa: 3,
    min_total_chutes_jogo: 15
};

function checaJogoV34_3(jogo) {
    if (!LIGAS_PERMITIDAS.includes(jogo.liga)) return false;
    const diferenca = Math.abs(jogo.gols_casa_ht - jogo.gols_fora_ht);
    if (diferenca > FILTROS_V34_3.max_diferenca_gols) return false;
    const totalChutes = jogo.chutes_casa + jogo.chutes_fora;
    if (totalChutes < FILTROS_V34_3.min_total_chutes_jogo) return false;
    const totalAtaquesPerigosos = jogo.ataques_perigosos_casa + jogo.ataques_perigosos_fora;
    if (totalAtaquesPerigosos < FILTROS_V34_3.min_ataques_perigosos_total) return false;
    
    let ataquesPrecisa, chutesGolPrecisa;
    if (jogo.gols_casa_ht < jogo.gols_fora_ht) {
        ataquesPrecisa = jogo.ataques_perigosos_casa;
        chutesGolPrecisa = jogo.chutes_gol_casa;
    } else if (jogo.gols_fora_ht < jogo.gols_casa_ht) {
        ataquesPrecisa = jogo.ataques_perigosos_fora;
        chutesGolPrecisa = jogo.chutes_gol_fora;
    } else {
        ataquesPrecisa = Math.max(jogo.ataques_perigosos_casa, jogo.ataques_perigosos_fora);
        chutesGolPrecisa = jogo.ataques_perigosos_casa >= jogo.ataques_perigosos_fora ? jogo.chutes_gol_casa : jogo.chutes_gol_fora;
    }
    if (ataquesPrecisa < FILTROS_V34_3.min_ataques_perigosos_time_precisa) return false;
    if (chutesGolPrecisa < FILTROS_V34_3.min_chutes_gol_time_precisa) return false;
    return true;
}

// --- MANTEM O RENDER VIVO ---
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`V34.3 RIGOROSA ONLINE - Filtro: Ate 2 de diferenca | HOL OK | 2x0 MANDA SIM - ${new Date().toISOString()}`);
});

server.listen(PORT, () => {
    console.log(`V34.3 RIGOROSA ONLINE na porta ${PORT} - Filtro: Até 2 de diferença + HOL - 2x0 MANDA`);
    
    // SEU LOOP DO ROBÔ COMEÇA AQUI
    setInterval(() => {
        console.log(`[${new Date().toLocaleTimeString()}] Radar varrendo... Ligas: ${LIGAS_PERMITIDAS.join(',')}`);
        // buscarJogosESPN().forEach(jogo => { if(checaJogoV34_3(jogo)) enviarTelegram(jogo) })
    }, 60000); // a cada 1 min
});
