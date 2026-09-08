const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.CHAT_ID || "").trim();
const EFO_IDS_RAW = process.env.EFO_IDS || "d74b999bbee306c89c611ef43fd4854f,d0ea94777078ab9401d9b31f1f1d2a30";
const EFO_IDS = EFO_IDS_RAW.split(",").map(s=>s.trim()).filter(Boolean);

async function sendTelegram(texto) {
  try {
    const r = await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: texto
    });
    return { ok: true, data: r.data };
  } catch (e) {
    return { ok: false, erro: e.response?.data?.description || e.message, token_len: TOKEN.length };
  }
}

app.get("/", (req,res)=>{
  res.json({
    status:"online",
    v:"V12.2 ANTI-TRAVA FIX",
    proxy:"nenhum",
    token: TOKEN ? TOKEN.slice(0,5)+"..." : "VAZIO",
    chat: CHAT_ID,
    ids: EFO_IDS,
    rotas: ["/telegram-test","/radar","/tabela"]
  });
});

app.get("/telegram-test", async (req,res)=>{
  const msg = `RADAR V12.2 ONLINE\nIDs: ${EFO_IDS.length}\n${EFO_IDS.join("\n")}`;
  const result = await sendTelegram(msg);
  res.json({ enviado: result.ok, ...result });
});

app.get("/radar", (req,res)=> res.json({ ok:true, ids:EFO_IDS }));
app.get("/tabela", (req,res)=> res.json({ ok:true, total:EFO_IDS.length, ids:EFO_IDS }));

app.listen(PORT, ()=>console.log("V12.2 RODANDO"));
