const express=require("express");const axios=require("axios");const app=express();const PORT=process.env.PORT||10000;
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGR||process.env.TELEGRAM_TOKEN||"";const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||"";
let ultimoProxy="nenhum",ultimoErro=null;
async function send(t){if(!TOKEN||!CHAT)return false;try{await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{chat_id:CHAT,text:t,parse_mode:"Markdown"});return true;}catch(e){ultimoErro=e.response?.data?.description||e.message;return false;}}
app.get("/",(req,res)=>res.json({status:"online",v:"V10 ULTRA",proxy:ultimoProxy,token:TOKEN?TOKEN.substring(0,5)+"...":"FALTA",chat:CHAT||"FALTA"}));
app.get("/telegram-test",async(req,res)=>{const ok=await send(`🟢 *RADAR V10 ONLINE* - ${new Date().toLocaleString("pt-BR")}`);res.json({enviado:ok,proxy:ultimoProxy,erro:ultimoErro,token_len:TOKEN.length});});
app.get("/radar",async(req,res)=>{res.json({ok:true});});
app.listen(PORT,()=>console.log("V10"));
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Memória pra não repetir alerta
let ultimosAlertas = {};

async function enviarTelegram(msg){
  if(!TOKEN ||!CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown'})
  });
}

// TESTE QUE VOCÊ JÁ FEZ E DEU TRUE
app.get('/telegram-test', async (req,res)=>{
  try{
    await enviarTelegram('🟢 RADAR V10 ONLINE - Telegram OK token_len:'+(TOKEN?TOKEN.length:0));
    res.json({enviado:true, proxy:"nenhum", erro:null, token_len: TOKEN?TOKEN.length:0});
  }catch(e){
    res.json({enviado:false, erro:e.message, token_len: TOKEN?TOKEN.length:0});
  }
});

// SIMULADOR DE PRESSÃO BASEADO NA SUA PRINT
// No V11 real vamos puxar da API da Sofascore
app.get('/radar-pressao', async (req,res)=>{
  // Exemplo baseado na sua print: Real 2-0 Inter
  // Inter: 11 chutes, 4 escanteios, 3 chutes ao gol, perdendo 2-0 aos 70min
  const jogo = {
    mandante: "Real Madrid",
    visitante: "Inter",
    placar: "2-0",
    minuto: 70,
    stats_1tempo: {
      mandante: { chutes: 6, chutesGol: 4, escanteios: 1 },
      visitante: { chutes: 11, chutesGol: 3, escanteios: 4 }
    }
  };

  let alertas = [];
  // Lógica de pressão: quem tá perdendo tem mais volume
  const visitantePressionando = jogo.stats_1tempo.visitante.chutes >= 8 && jogo.stats_1tempo.visitante.escanteios >= 3 && jogo.stats_1tempo.visitante.chutesGol >= 2;

  if(visitantePressionando){
    const chave = `${jogo.visitante}-${jogo.minuto}`;
    if(!ultimosAlertas[chave]){
      const msg = `🔥 *PRESSÃO DETECTADA - IGUAL SUA PRINT* 🔥\n\n⚽ ${jogo.mandante} ${jogo.placar} ${jogo.visitante} (${jogo.minuto}')\n\n📊 Stats 1º Tempo:\nInter: ${jogo.stats_1tempo.visitante.chutes} chutes | ${jogo.stats_1tempo.visitante.chutesGol} no gol | ${jogo.stats_1tempo.visitante.escanteios} escanteios\n\n💡 Time perdendo mas com volume MAIOR = Tendência de gol\nEntrada: Over 0.5 HT ou Gol da Inter`;
      await enviarTelegram(msg);
      ultimosAlertas[chave] = Date.now();
      alertas.push(msg);
    }
  }

  res.json({jogo, pressao_detectada: visitantePressionando, alertas_enviados: alertas.length});
});

app.get('/', (req,res)=> res.send('RADAR V11 PRESSÃO ONLINE - acesse /telegram-test e /radar-pressao'));

app.listen(PORT, ()=> console.log('Radar online na porta '+PORT));
