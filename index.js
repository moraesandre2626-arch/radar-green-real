from flask import Flask
import requests, os, time
from threading import Thread
from datetime import datetime
import pytz

app = Flask(__name__)

TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT_ID = os.getenv("CHAT_ID")
BR_TZ = pytz.timezone("America/Sao_Paulo")

sinais_dia = []

def enviar(msg):
    try:
        url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
        requests.post(url, data={"chat_id": CHAT_ID, "text": msg}, timeout=10)
    except: pass

def buscar_jogos():
    # SEU CODIGO DE BUSCA AQUI
    # Exemplo retorno:
    return [{
        "liga": "BRA.1",
        "jogo": "Bragantino 0x1 Flamengo",
        "tempo": "47'",
        "chutes": "12x8",
        "alvo": "4x2",
        "posse": 68,
        "posse2": 32,
        "esc": "5x1",
        "c": 9,
        "score": 11.5,
        "time_precisa": "Bragantino",
        "ht": "0x1",
        "ft": "1x1"
    }]def loop():
    while True:
        try:
            agora = datetime.now(BR_TZ)
            jogos = buscar_jogos()
            
            for j in jogos:
                if j["posse"] >= 60 and 45 <= int(j["tempo"].replace("'","")) <= 75:
                    msg = f"""RAIO-X GOL 2T V34.8 PREMIUM

{j['liga']}
{j['jogo']}
{j['tempo']}

Chutes {j['chutes']} Alvo {j['alvo']}
Posse {j['posse']}% x {j['posse2']}% Esc {j['esc']}
Pressao: Lateral {j['c']}c Score {j['score']}
Precisa: {j['time_precisa']}
ENTRADA Over 0.5 GOL"""
                    enviar(msg)
                    sinais_dia.append(j)

            if agora.hour == 23 and agora.minute == 59:
                total = len(sinais_dia)
                greens = sum(1 for s in sinais_dia if s["ft"] != s["ht"])
                taxa = int(greens/total*100) if total else 0
                lucro = greens - (total-greens)
                txt = f"RELATORIO {agora.strftime('%d/%m/%Y')}\nTotal:{total} GREEN:{greens} RED:{total-greens} Taxa:{taxa}% Lucro:{lucro} un\n\n"
                if total == 0:
                    txt += "Nenhum sinal hoje"
                else:
                    for i,s in enumerate(sinais_dia,1):
                        res = "GREEN" if s["ft"] != s["ht"] else "RED"
                        txt += f"[{res}] {i}. {s['jogo']} HT {s['ht']} -> {s['ft']} {s['time_precisa']}\n"
                enviar(txt)
                sinais_dia.clear()
                time.sleep(70)
                
        except: pass
        time.sleep(900)

@app.route("/")
def home():
    return "V34.8 PREMIUM CURTO SEM LINK - LIVE"

Thread(target=loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT",10000)))
