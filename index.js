const express=require("express");const axios=require("axios");const app=express();const PORT=process.env.PORT||10000;
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGR||process.env.TELEGRAM_TOKEN||"";const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||"";
let ultimoProxy="nenhum",ultimoErro=null;
async function send(t){if(!TOKEN||!CHAT)return false;try{await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{chat_id:CHAT,text:t,parse_mode:"Markdown"});return true;}catch(e){ultimoErro=e.response?.data?.description||e.message;return false;}}
app.get("/",(req,res)=>res.json({status:"online",v:"V10 ULTRA",proxy:ultimoProxy,token:TOKEN?TOKEN.substring(0,5)+"...":"FALTA",chat:CHAT||"FALTA"}));
app.get("/telegram-test",async(req,res)=>{const ok=await send(`🟢 *RADAR V10 ONLINE* - ${new Date().toLocaleString("pt-BR")}`);res.json({enviado:ok,proxy:ultimoProxy,erro:ultimoErro,token_len:TOKEN.length});});
app.get("/radar",async(req,res)=>{res.json({ok:true});});
app.listen(PORT,()=>console.log("V10"));
