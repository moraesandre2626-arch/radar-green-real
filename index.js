# ROBÔ GOL 2T - V34.3 RIGOROSA - MORAES
# Filtro: Até 2 gols HT + Pressão Alta + Liga BR/EU/HOL

import time
from datetime import datetime

# CONFIG V34.3
LIGAS_PERMITIDAS = [
    "bra.1", "bra.2", "libertadores", "sudamericana", # BR
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", # Top 5 Europa
    "ned.1"  # HOLANDESA ADICIONADA
]

FILTROS_V34_3 = {
    "max_gols_ht": 2,  # Até 2 gols: 0-0, 1-0, 0-1, 1-1, 2-0, 0-2
    "min_ataques_perigosos_total": 45,
    "min_ataques_perigosos_time_precisa": 18,
    "min_chutes_gol_time_precisa": 3,
    "min_total_chutes_jogo": 15,
    "minuto_alerta": (44, 52) # HT
}

def checa_jogo_v34_3(jogo):
    """
    jogo = dict com: liga, placar_ht, ataques_perigosos, chutes, chutes_gol
    """
    # 1. Filtro de Liga
    if jogo['liga'] not in LIGAS_PERMITIDAS:
        return False

    # 2. Filtro de Placar - ATÉ 2 GOLS
    gols_ht = jogo['gols_casa_ht'] + jogo['gols_fora_ht']
    if gols_ht > FILTROS_V34_3['max_gols_ht']:
        return False
    
    # 3. Filtro de Jogo Morto
    total_chutes = jogo['chutes_casa'] + jogo['chutes_fora']
    if total_chutes < FILTROS_V34_3['min_total_chutes_jogo']:
        return False

    # 4. Filtro de Pressão RIGOROSO
    total_ataques_perigosos = jogo['ataques_perigosos_casa'] + jogo['ataques_perigosos_fora']
    if total_ataques_perigosos < FILTROS_V34_3['min_ataques_perigosos_total']:
        return False

    # Identifica quem precisa do gol
    if jogo['gols_casa_ht'] < jogo['gols_fora_ht']:
        time_precisa = 'casa'
        ataques_precisa = jogo['ataques_perigosos_casa']
        chutes_gol_precisa = jogo['chutes_gol_casa']
    elif jogo['gols_fora_ht'] < jogo['gols_casa_ht']:
        time_precisa = 'fora'
        ataques_precisa = jogo['ataques_perigosos_fora']
        chutes_gol_precisa = jogo['chutes_gol_fora']
    else: # 0x0 ou 1x1
        # No empate, pega quem tem mais ataque
        if jogo['ataques_perigosos_casa'] >= jogo['ataques_perigosos_fora']:
            ataques_precisa = jogo['ataques_perigosos_casa']
            chutes_gol_precisa = jogo['chutes_gol_casa']
        else:
            ataques_precisa = jogo['ataques_perigosos_fora']
            chutes_gol_precisa = jogo['chutes_gol_fora']

    if ataques_precisa < FILTROS_V34_3['min_ataques_perigosos_time_precisa']:
        return False
        
    if chutes_gol_precisa < FILTROS_V34_3['min_chutes_gol_time_precisa']:
        return False

    # PASSOU EM TUDO = ALERTA OURO
    return True

def enviar_alerta_telegram(jogo):
    placar = f"{jogo['gols_casa_ht']}x{jogo['gols_fora_ht']} HT"
    msg = f"🚨 V34.3 OURO - ATÉ 2 GOLS\n\n{jogo['casa']} {placar} {jogo['fora']}\nLiga: {jogo['liga']}\nPressão: {jogo['ataques_perigosos_casa']+jogo['ataques_perigosos_fora']} ataques perigosos\nChutes: {jogo['chutes_casa']+jogo['chutes_fora']} (No gol: {jogo['chutes_gol_casa']+jogo['chutes_gol_fora']})\n\n👉 Over 0.5 HT | Mais 1 gol no 2T"
    # sua funcao de envio aqui
    print(f"[{datetime.now()}] ALERTA ENVIADO: {msg}")

# LOOP PRINCIPAL
# while True:
#   jogos_ht = buscar_jogos_espn()
#   for jogo in jogos_ht:
#       if checa_jogo_v34_3(jogo):
#           enviar_alerta_telegram(jogo)
#   time.sleep(60)
