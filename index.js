const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const BLOCK_MINUTES = 15;
const API_KEYS_RAW = process.env.API_FOOTBALL_KEY || "";
const API_KEYS = API_KEYS_RAW.split(",").map(k=>k.trim()).filter(Boolean);
let keysStatus = API_KEYS.map(k => ({ key: k, blockedUntil: 0 }));

function getValidKey(){
  const now = Date.now();
  keysStatus = keysStatus.map(k => k.blockedUntil && k.blockedUntil < now ? { ...k, blockedUntil: 0 } : k);
  return keysStatus.find(k => k.blockedUntil === 0);
}
function blockKey(keyStr){
  keysStatus = keysStatus.map(k => k.key === keyStr ? { ...k, blockedUntil: Date.now() + BLOCK_MINUTES*60000 } : k);
}

app.get("/", (req,res)=> res.send("Radar GREEN Real - V6.7 RODIZIO FIX FINAL"));

app.get("/health", (req,res)=>{
  res.json({
    status: "OPERACIONAL",
    version: "V6.7 RODIZIO 15MIN FINAL",
    total_keys: API_KEYS.length,
    keysStatus: keysStatus.map(k=>({
      preview: k.key.slice(0,8),
      livre: k.blockedUntil === 0,
      desbloqueia_em: k.blockedUntil > Date.now() ? Math.ceil((k.blockedUntil-Date.now())/60000)+"min" : "AGORA"
    })),
    timestamp: new Date().toISOString()
  });
});

app.get("/radar", async (req,res)=>{
  try{
    const keyObj = getValidKey();
    if(!keyObj) return res.status(429).json({ status: "TRAVADO "+BLOCK_MINUTES+" MIN - 2 chaves no limite" });
    const { data } = await axios.get("https://v3.football.api-sports.io/fixtures?live=all", {
      headers: { "x-apisports-key": keyObj.key }
    });
    if(data.errors && Object.keys(data.errors).length > 0){
      blockKey(keyObj.key);
      return res.status(429).json({ status:"LIMITE", key: keyObj.key.slice(0,8), erro: data.errors });
    }
    res.json({
      status: "RADAR ATIVO RODIZIO",
      key_em_uso: keyObj.key.slice(0,8),
      jogos_ao_vivo: data.response.length,
      timestamp: new Date().toISOString()
    });
  }catch(e){
    if(e.response && e.response.status === 429){
      const k = getValidKey();
      if(k) blockKey(k.key);
      return res.status(429).json({ status:"429 - Trocando de chave" });
    }
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, ()=> console.log("V6.7 FIX FINAL rodando"));
