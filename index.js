import express from "express";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 10000;

const ELITE_SCORE = Number(process.env.ELITE_SCORE || 65);
const ODD_MIN = Number(process.env.ODD_MIN || 1.50);
const ODD_MAX = Number(process.env.ODD_MAX || 2.80);
const MIN_EA = Number(process.env.MIN_EA || 50);
const MIN_LA = Number(process.env.MIN_LA || 50);

app.get("/", (req,res) => {
  res.send("Radar GREEN Real - V6.5 OPERACIONAL");
});

app.get("/health", (req,res) => {
  res.json({
    status: "OPERACIONAL",
    version: "V6.5",
    elite_score: ELITE_SCORE,
    odd_min: ODD_MIN,
    odd_max: ODD_MAX,
    min_ea: MIN_EA,
    min_la: MIN_LA,
    early: "25-45",
    late: "65-89",
    timestamp: new Date().toISOString()
  });
});

app.get("/radar", async (req,res) => {
  try {
    res.json({
      status: "RADAR ATIVO",
      elite_score: ELITE_SCORE,
      filtros: { odd_min: ODD_MIN, odd_max: ODD_MAX, min_ea: MIN_EA, min_la: MIN_LA },
      message: "V6.5 pronto para escanear - jogos das 15h",
      timestamp: new Date().toISOString()
    });
  } catch(e){
    res.status(500).json({error: e.message});
  }
});

app.listen(PORT, () => console.log(`V6.5 rodando na porta ${PORT}`));
