// ROBÔ GOL 2T - V34.3 RIGOROSA - MORAES - JS
// Filtro: Até 2 de diferença + Holandesa

const LIGAS_PERMITIDAS = [
    "bra.1", "bra.2", "libertadores", "sudamericana",
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1",
    "ned.1" // HOLANDESA
];

const FILTROS_V34_3 = {
    max_diferenca_gols: 2, // ATÉ 2 DE DIFERENÇA - Manda 2x0 e 2x1
    min_ataques_perigosos_total: 45,
    min_ataques_perigosos_time_precisa: 18,
    min_chutes_gol_time_precisa: 3,
    min_total_chutes_jogo: 15
};

function checaJogoV34_3(jogo) {
    // 1. Liga
    if (!LIGAS_PERMITIDAS.includes(jogo.liga)) return false;

    // 2. Placar - ATÉ 2 DE DIFERENÇA
    const diferenca = Math.abs(jogo.gols_casa_ht - jogo.gols_fora_ht);
    if (diferenca > FILTROS_V34_3.max_diferenca_gols) return false;

    // 3. Jogo morto
    const totalChutes = jogo.chutes_casa + jogo.chutes_fora;
    if (totalChutes < FILTROS_V34_3.min_total_chutes_jogo) return false;

    // 4. Pressão
    const totalAtaquesPerigosos = jogo.ataques_perigosos_casa + jogo.ataques_perigosos_fora;
    if (totalAtaquesPerigosos < FILTROS_V34_3.min_ataques_perigosos_total) return false;

    // Quem precisa
    let ataquesPrecisa, chutesGolPrecisa;
    if (jogo.gols_casa_ht < jogo.gols_fora_ht) {
        ataquesPrecisa = jogo.ataques_perigosos_casa;
        chutesGolPrecisa = jogo.chutes_gol_casa;
    } else if (jogo.gols_fora_ht < jogo.gols_casa_ht) {
        ataquesPrecisa = jogo.ataques_perigosos_fora;
        chutesGolPrecisa = jogo.chutes_gol_fora;
    } else {
        // Empate 0x0, 1x1, 2x2
        if (jogo.ataques_perigosos_casa >= jogo.ataques_perigosos_fora) {
            ataquesPrecisa = jogo.ataques_perigosos_casa;
            chutesGolPrecisa = jogo.chutes_gol_casa;
        } else {
            ataquesPrecisa = jogo.ataques_perigosos_fora;
            chutesGolPrecisa = jogo.chutes_gol_fora;
        }
    }

    if (ataquesPrecisa < FILTROS_V34_3.min_ataques_perigosos_time_precisa) return false;
    if (chutesGolPrecisa < FILTROS_V34_3.min_chutes_gol_time_precisa) return false;

    return true; // ALERTA OURO
}

console.log("V34.3 RIGOROSA ONLINE - Filtro: Até 2 de diferença + HOL");
// seu loop de buscar jogos ESPN aqui...
