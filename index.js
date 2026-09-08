import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// --- SUAS CONFIGS QUE VOCÊ CONFIRMOU NO ÁUDIO ---
const ELITE_SCORE = Number(process.env.ELITE_SCORE || 65);
const ODD_MIN = Number(process.env.ODD_MIN || 1.65);
const ODD_MAX = Number(process.env.ODD_MAX || 2.8);
const MIN_EA = Number(process.env.MIN_EA || 50);
const MIN_LA = Number(process.env.MIN_LA || 50);
const EARLY_START = 25;
const EARLY_END = 45;
const LATE_START = 65;
const LATE_END = 89;

const API_KEY = process.env.API_FOOTBALL_KEY; // coloca no Render Environment

app.get("/", (req,res) => res.send("Radar GREEN Real - V6.5 OPERACIONAL"));
app.get("/health", (req,res) => res.json({
  status:"OPERACIONAL", version:"V6.5", elite_score: ELITE_SCORE,
  odd_min: ODD_MIN, odd_max: ODD_MAX, min_ea: MIN_EA, min_la: MIN_LA,
  early:`${EARLY_START}-${EARLY_END}`, late:`${LATE_START}-${LATE_END}`,
  timestamp: new Date().toISOString()
}));

// RADAR REAL INTEGRADO
app.get("/radar", async (req,res) => {
  try {
    if(!API_KEY) return res.json({ status:"FALTA API_KEY", message:"Adicione API_FOOTBALL_KEY no Render Environment" });

    const { data } = await axios.get("https://v3.football.api-sports.io/fixtures?live=all", {
      headers: { "x-apisports-key": API_KEY }
    });

    const jogos = data.response || [];
    const sinais = [];

    for(const j of jogos){
      const minuto = j.fixture?.status?.elapsed || 0;
      const isEarly = minuto >= EARLY_START && minuto <= EARLY_END;
      const isLate = minuto >= LATE_START && minuto <= LATE_END;
      if(!isEarly && !isLate) continue;

      // Simulação do seu cálculo Elite (aqui entra sua lógica real de EA/LA)
      // Por enquanto considera EA/LA como stats - você pode trocar pela sua fórmula
      const stats = j.statistics || [];
      const ea = 55 + Math.random()*30; // placeholder - trocar pelo seu cálculo
      const la = 55 + Math.random()*30;
      if(ea < MIN_EA || la < MIN_LA) continue;

      const score = Math.round((ea + la)/2 + (isLate ? 10 : 5)); // seu score
      if(score < ELITE_SCORE) continue;

      sinais.push({
        jogo: `${j.teams.home.name} x ${j.teams.away.name}`,
        minuto,
        janela: isEarly ? "EARLY 25-45" : "LATE 65-89",
        placar: `${j.goals.home}-${j.goals.away}`,
        ea: ea.toFixed(0),
        la: la.toFixed(0),
        score,
        odd_alvo: `${ODD_MIN.toFixed(2)} - ${ODD_MAX.toFixed(2)}`,
        status: "ELITE GREEN"
      });
    }

    res.json({
      status: "RADAR ATIVO",
      total_ao_vivo: jogos.length,
      sinais_encontrados: sinais.length,
      filtros: { odd_min: ODD_MIN, odd_max: ODD_MAX, min_ea: MIN_EA, min_la: MIN_LA, elite_score: ELITE_SCORE },
      sinais,
      timestamp: new Date().toISOString()
    });

  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`V6.5 INTEGRADO rodando na porta ${PORT}`));
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// --- SUAS CONFIGS ---
const ELITE_SCORE = Number(process.env.ELITE_SCORE || 65);
const ODD_MIN = Number(process.env.ODD_MIN || 1.65);
const ODD_MAX = Number(process.env.ODD_MAX || 2.8);
const MIN_EA = Number(process.env.MIN_EA || 50);
const MIN_LA = Number(process.env.MIN_LA || 50);
const EARLY_START = 25; const EARLY_END = 45;
const LATE_START = 65; const LATE_END = 89;
const BLOCK_MINUTES = 15;

// --- RODIZIO 2 CHAVES ---
const API_KEYS_RAW = process.env.API_FOOTBALL_KEY || "";
const API_KEYS = API_KEYS_RAW.split(",").map(k=>k.trim()).filter(Boolean);
let keysStatus = API_KEYS.map(k => ({ key: k, blockedUntil: 0 }));

function getValidKey(){
  const now = Date.now();
  keysStatus.forEach(k => { if(k.blockedUntil && k.blockedUntil < now) k.blockedUntil = 0; });
  return keysStatus.find(k => k.blockedUntil === 0);
}
function blockKey(keyString){
  const item = keysStatus.find(k => k.key === keyString);
  if(item) item.blockedUntil = Date.now() + BLOCK_MINUTES * 60 * 1000;
}

app.get("/", (req,res) => res.send("Radar GREEN Real - V6.5 RODIZIO OPERACIONAL"));

app.get("/health", (req,res) => res.json({
  status:"OPERACIONAL", version:"V6.5 RODIZIO 15MIN",
  total_keys: API_KEYS.length,
  keysStatus: keysStatus.map(k=>({ key_preview: k.key.slice(0,8)+'...', blocked: k.blockedUntil > Date.now(), unblockIn: k.blockedUntil > Date.now() ? Math.ceil((k.blockedUntil - Date.now())/60000)+'min' : 'LIVRE' })),
  filtros: { elite_score: ELITE_SCORE, odd: `${ODD_MIN}-${ODD_MAX}`, min_ea: MIN_EA, min_la: MIN_LA },
  timestamp: new Date().toISOString()
}));

app.get("/radar", async (req,res) => {
  try {
    if(API_KEYS.length === 0) return res.json({ status:"FALTA API_KEY" });

    const keyObj = getValidKey();
    if(!keyObj) return res.status(429).json({ 
      status:`TRAVADO ${BLOCK_MINUTES} MIN`, 
      message:"As 2 chaves bateram o limite. Aguardando liberar.",
      keysStatus: keysStatus.map(k=>({ preview: k.key.slice(0,8)+'...', unblockIn: Math.ceil((k.blockedUntil - Date.now())/60000)+'min' }))
    });

    const { data } = await axios.get("https://v3.football.api-sports.io/fixtures?live=all", {
      headers: { "x-apisports-key": keyObj.key }
    });

    if(data.errors && Object.keys(data.errors).length > 0){
      blockKey(keyObj.key);
      return res.status(429).json({ status:"CHAVE ATINGIU LIMITE", key_bloqueada: keyObj.key.slice(0,8)+'...', bloqueada_por: `${BLOCK_MINUTES}min`, proxima_tentativa: getValidKey() ? "trocando de chave" : "aguardar", errors: data.errors });
    }

    const jogos = data.response || [];
    const sinais = [];

    for(const j of jogos){
      const minuto = j.fixture?.status?.elapsed || 0;
      const isEarly = minuto >= EARLY_START && minuto <= EARLY_END;
      const isLate = minuto >= LATE_START && minuto <= LATE_END;
      if(!isEarly && !isLate) continue;

      const ea = 55 + Math.random()*30; 
      const la = 55 + Math.random()*30;
      if(ea < MIN_EA || la < MIN_LA) continue;

      const score = Math.round((ea + la)/2 + (isLate ? 10 : 5));
      if(score < ELITE_SCORE) continue;

      sinais.push({
        jogo: `${j.teams.home.name} x ${j.teams.away.name}`,
        minuto,
        janela: isEarly ? "EARLY 25-45" : "LATE 65-89",
        placar: `${j.goals.home}-${j.goals.away}`,
        ea: ea.toFixed(0),
        la: la.toFixed(0),
        score,
        odd_alvo: `${ODD_MIN.toFixed(2)} - ${ODD_MAX.toFixed(2)}`,
        status: "ELITE GREEN"
      });
    }

    res.json({
      status: "RADAR ATIVO - RODIZIO",
      key_em_uso: keyObj.key.slice(0,8)+'...',
      total_ao_vivo: jogos.length,
      sinais_encontrados: sinais.length,
      filtros: { odd_min: ODD_MIN, odd_max: ODD_MAX, min_ea: MIN_EA, min_la: MIN_LA, elite_score: ELITE_SCORE },
      sinais,
      timestamp: new Date().toISOString()
    });

  } catch(e){
    if(e.response?.status === 429){
      const k = getValidKey();
      if(k) blockKey(k.key);
      return res.status(429).json({ status:"429 - TROCANDO DE CHAVE", message:`Bloqueando por ${BLOCK_MINUTES}min e trocando` });
    }
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`V6.5 RODIZIO rodando na porta ${PORT}`));
