const express=require("express");
const axios=require("axios");
const app=express();
const PORT=process.env.PORT||10000;

const TOKEN=process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGR||process.env.TELEGRAM_TOKEN||"";
const CHAT=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||"";

let ultimoProxy="nenhum",ultimoErro=null;
let ultimosAlertas={};

async function send(t){
  if(!TOKEN||!CHAT)return false;
  try{
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
      chat_id:CHAT,
      text:t,
      parse_mode:"Markdown"
    });
    return true;
  }catch(e){
    ultimoErro=e.response?.data?.description||e.message;
    return false;
  }
}

app.get("/",(req,res)=>res.json({
  status:"online",
  v:"V11 PRESSÃO",
  proxy:ultimoProxy,
  token:TOKEN?TOKEN.substring(0,5)+"...":"FALTA",
  chat:CHAT||"FALTA",
  rotas:["/telegram-test","/radar-pressao","/radar"]
}));

app.get("/telegram-test",async(req,res)=>{
  const ok=await send(`🟢 *RADAR V11 ONLINE* - ${new Date().toLocaleString("pt-BR")}\ntoken_len:${TOKEN.length}`);
  res.json({enviado:ok,proxy:ultimoProxy,erro:ultimoErro,token_len:TOKEN.length});
});

app.get("/radar-pressao",async(req,res)=>{
  const jogo={
    mandante:"Real Madrid",
    visitante:"Inter",
    placar:"2-0",
    minuto:70,
    stats_1tempo:{
      mandante:{chutes:6,chutesGol:4,escanteios:1},
      visitante:{chutes:11,chutesGol:3,escanteios:4}
    }
  };

  const visitantePressionando = jogo.stats_1tempo.visitante.chutes>=8 && jogo.stats_1tempo.visitante.escanteios>=3 && jogo.stats_1tempo.visitante.chutesGol>=2;
  let alertas=0;

  if(visitantePressionando){
    const chave=`${jogo.visitante}-${jogo.minuto}`;
    if(!ultimosAlertas[chave]){
      const msg=`🔥 *PRESSÃO DETECTADA - IGUAL SUA PRINT* 🔥\n\n⚽ ${jogo.mandante} ${jogo.placar} ${jogo.visitante} (${jogo.minuto}')\n\n📊 Stats 1º Tempo:\nInter: ${jogo.stats_1tempo.visitante.chutes} chutes | ${jogo.stats_1tempo.visitante.chutesGol} no gol | ${jogo.stats_1tempo.visitante.escanteios} escanteios\n\n💡 Time perdendo mas com volume MAIOR = Tendência de gol\nEntrada: Over 0.5`;
      const ok=await send(msg);
      if(ok) alertas=1;
      ultimosAlertas[chave]=Date.now();
    }
  }

  res.json({jogo,pressao_detectada:visitantePressionando,alertas_enviados:alertas});
});

app.get("/radar",async(req,res)=>{res.json({ok:true,v:"V11"});});

app.listen(PORT,()=>console.log("V11 PRESSÃO ONLINE"));
