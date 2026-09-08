const express=require("express");const axios=require("axios");const app=express();app.use(express.json());const PORT=process.env.PORT||10000;
const PROXY_LIST=["https://corsproxy.io/?","https://api.allorigins.win/raw?url=","https://proxy.cors.sh/","https://thingproxy.freeboard.io/fetch/","https://api.codetabs.com/v1/proxy?quest=","https://cors-anywhere.herokuapp.com/","https://yacdn.org/proxy/","https://api.cors.lol/?url="];
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||process.env.TELEGR||"";const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||"";
let ultimoProxy="nenhum",ultimoErro=null,ultimoRadar=null;
const http=axios.create({timeout:30000,headers:{"User-Agent":"Mozilla/5.0 Chrome/122","Referer":"https://www.sofascore.com/","Origin":"https://www.sofascore.com/"}});
async function sofaGet(p){
 try{const r=await http.get(`https://www.sofascore.com/api/v1${p}`);if(r.data&&(r.data.events||r.data.statistics||r.data.graphPoints)){ultimoProxy="direto";return r;}}catch(e){}
 for(const pr of PROXY_LIST){try{const t=`https://www.sofascore.com/api/v1${p}`;const u=`${pr}${encodeURIComponent(t)}`;const r=await http.get(u,{timeout:30000});if(r.data&&JSON.stringify(r.data).length>100){ultimoProxy=pr.split("/")[2];return r;}}catch(e){continue;}}
 throw new Error("Proxy falhou");
}
async function send(t){if(!TOKEN||!CHAT)return false;try{await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{chat_id:CHAT,text:t,parse_mode:"Markdown"});return true;}catch(e){ultimoErro=e.response?.data?.description||e.message;return false;}}
async function radar(){try{const r=await sofaGet("/sport/football/events/live");ultimoRadar=new Date().toISOString();ultimoErro=null;return{jogos:r.data.events?.length||0,proxy:ultimoProxy,ok:true};}catch(e){ultimoErro=e.message;return{erro:e.message,proxy:ultimoProxy};}}
app.get("/",async(req,res)=>{if(ultimoProxy==="nenhum")await radar().catch(()=>{});res.json({status:"online",v:"V10 ULTRA FIX",hora:new Date().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}),proxy:ultimoProxy,ultimoRadar,ultimoErro,token:TOKEN?"ok":"falta",chat:CHAT?"ok":"falta"});});
app.get("/radar",async(req,res)=>res.json(await radar()));
app.get("/telegram-test",async(req,res)=>{const ok=await send(`🟢 *V10 ULTRA OK* - Proxy: ${ultimoProxy} - ${new Date().toLocaleString("pt-BR")}`);res.json({enviado:ok,proxy:ultimoProxy,erro:ultimoErro});});
app.listen(PORT,()=>console.log("V10 na porta "+PORT));
setInterval(()=>radar().catch(()=>{}),5*60*1000);
