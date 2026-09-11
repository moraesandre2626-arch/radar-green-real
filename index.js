import os, time, threading, requests
from datetime import datetime, timedelta
from flask import Flask, jsonify
import pytz

app = Flask(__name__)

# --- CONFIG ---
API_KEY = os.getenv("API_FOOTBALL_KEY")
EFO_IDS_RAW = os.getenv("EFO_IDS", "") # ex: 1,2,3,39,140
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT = os.getenv("TELEGRAM_CHAT_ID")

BR_TZ = pytz.timezone("America/Sao_Paulo")
BASE_URL = "https://v3.football.api-sports.io"

HEADERS = {"x-apisports-key": API_KEY} if API_KEY else {}

# Controle de cota
REQUISICOES_HOJE = 0
DATA_RESET = datetime.now(BR_TZ).date()
ULTIMO_ERRO = None
ULTIMO_SCAN = None

EFO_IDS = [int(x.strip()) for x in EFO_IDS_RAW.split(",") if x.strip().isdigit()] if EFO_IDS_RAW else []

def contar_req(n=1):
    global REQUISICOES_HOJE, DATA_RESET
    hoje = datetime.now(BR_TZ).date()
    if hoje!= DATA_RESET:
        REQUISICOES_HOJE = 0
        DATA_RESET = hoje
    REQUISICOES_HOJE += n

def enviar_telegram(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT:
        return False
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        r = requests.post(url, json={"chat_id": TELEGRAM_CHAT, "text": msg, "parse_mode": "HTML"}, timeout=10)
        return r.status_code == 200
    except Exception as e:
        print(f"Erro Telegram: {e}")
        return False

def calcular_score(stats_home, stats_away, posse_home=50):
    try:
        # pega chutes, escanteios, ataques perigosos
        def get_val(stats, nome):
            for s in stats:
                if s['type'].lower() == nome.lower():
                    return s['value'] if s['value'] is not None else 0
            return 0

        chutes_home = int(get_val(stats_home, 'Total Shots') or 0)
        chutes_away = int(get_val(stats_away, 'Total Shots') or 0)
        esc_home = int(get_val(stats_home, 'Corner Kicks') or 0)
        esc_away = int(get_val(stats_away, 'Corner Kicks') or 0)
        ataques_home = int(get_val(stats_home, 'Dangerous Attacks') or 0)

        score = 0
        # Posse
        if posse_home >= 65: score += 25
        elif posse_home >= 60: score += 15

        # Chutes
        if chutes_home >= 10: score += 25
        elif chutes_home >= 7: score += 15

        # Escanteios (o mais importante igual da sua print Besiktas 8x0)
        if esc_home >= 6: score += 30
        elif esc_home >= 4: score += 20
        elif esc_home >= 3: score += 10

        # Dominio escanteios
        if esc_home >= 3 and esc_away == 0: score += 15

        # Ataques perigosos
        if ataques_home >= 30: score += 10

        return min(score, 100), chutes_home, esc_home, esc_away
    except:
        return 0,0,0,0

def scan():
    global ULTIMO_ERRO, ULTIMO_SCAN
    if not API_KEY:
        ULTIMO_ERRO = "Sem API_FOOTBALL_KEY"
        return

    try:
        print(f"[{datetime.now(BR_TZ)}] SCAN V24.1 iniciado...")
        # 1 req: jogos ao vivo
        r = requests.get(f"{BASE_URL}/fixtures?live=all", headers=HEADERS, timeout=15)
        contar_req(1)

        if r.status_code!= 200:
            ULTIMO_ERRO = f"API {r.status_code}: {r.text[:100]}"
            print(ULTIMO_ERRO)
            return

        jogos = r.json().get('response', [])
        # Filtra por ligas se tiver EFO_IDS
        if EFO_IDS:
            jogos = [j for j in jogos if j['league']['id'] in EFO_IDS]

        # Filtra só HT ou até 65'
        candidatos = []
        for j in jogos:
            status_short = j['fixture']['status']['short']
            elapsed = j['fixture']['status']['elapsed'] or 0

            if status_short == 'HT':
                candidatos.append(j)
            elif status_short == '2H' and 46 <= elapsed <= 65:
                candidatos.append(j)

        candidatos = candidatos[:2] # MAX 2 jogos pra não gastar cota
        print(f"Candidatos: {len(candidatos)}")

        for jogo in candidatos:
            fid = jogo['fixture']['id']
            elapsed = jogo['fixture']['status']['elapsed'] or 0
            status_short = jogo['fixture']['status']['short']
            home = jogo['teams']['home']['name']
            away = jogo['teams']['away']['name']
            gols_home = jogo['goals']['home'] or 0
            gols_away = jogo['goals']['away'] or 0

            # 1 req por jogo pra estatísticas
            time.sleep(1)
            rs = requests.get(f"{BASE_URL}/fixtures/statistics?fixture={fid}", headers=HEADERS, timeout=15)
            contar_req(1)
            if rs.status_code!= 200:
                continue

            stats_resp = rs.json().get('response', [])
            if len(stats_resp) < 2:
                continue

            stats_home = stats_resp[0]['statistics']
            stats_away = stats_resp[1]['statistics']

            # posse
            posse_home = 50
            for s in stats_home:
                if s['type'] == 'Ball Possession':
                    try: posse_home = int(str(s['value']).replace('%',''))
                    except: pass

            score, chutes, esc_h, esc_a = calcular_score(stats_home, stats_away, posse_home)

            # Regra V24.1
            minimo = 65 if status_short == 'HT' else 70
            if score >= minimo:
                tipo = "🟢 INTERVALO" if status_short == 'HT' else f"⚠️ ENTRADA TARDIA {elapsed}'"
                msg = f"""{tipo} - ELITE RADAR V24.1

<b>{home} {gols_home} x {gols_away} {away}</b>
Score: <b>{score}/100</b> | Status: {status_short} {elapsed}'
Posse: {posse_home}% | Chutes: {chutes} | Esc: {esc_h}x{esc_a}

<b>ENTRADA:</b> Over Escanteios FT / Over {esc_h+2}.5 casa
Liga ID: {jogo['league']['id']}

Hora: {datetime.now(BR_TZ).strftime('%H:%M:%S')} BRT"""
                enviar_telegram(msg)
                print(f"ALERTA ENVIADO: {home} Score {score}")

        ULTIMO_SCAN = datetime.now(BR_TZ)
        ULTIMO_ERRO = None

    except Exception as e:
        ULTIMO_ERRO = str(e)
        print(f"Erro scan: {e}")

def loop_scan():
    while True:
        scan()
        time.sleep(1800) # 30 min

# --- ROTAS ---
@app.route("/")
def home():
    agora = datetime.now(BR_TZ)
    proximo = (ULTIMO_SCAN + timedelta(minutes=30)) if ULTIMO_SCAN else (agora + timedelta(minutes=2))
    return jsonify({
        "projeto": "ELITE RADAR V24.1 - ATE 65'",
        "status": "online",
        "fonte": "API-FOOTBALL",
        "efo_ids_configurado": bool(EFO_IDS),
        "qtd_ligas_filtradas": len(EFO_IDS),
        "telegram_configurado": bool(TELEGRAM_TOKEN and TELE
