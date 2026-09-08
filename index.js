import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

// CONFIGS - JÁ COM SUA LÓGICA
const ELITE_SCORE = Number(process.env.ELITE_SCORE || 65);
const ODD_MIN = Number(process.env.ODD_MIN || 1.50);
const ODD_MAX = Number(process.env.ODD_MAX || 2.80);
const MIN_EA = Number(process.env.MIN_EA || 50);
const MIN_LA = Number(process.env.MIN_LA || 50);
const EARLY_START = 25;
const EARLY_END = 45;
const LATE_START = 65;
const LATE_END = 89;

app.get("/", (req,res)=> res.send("Radar GREEN Real - V6.5 OPERACIONAL"));
app.get("/health", (req,res)=> res.json({
  status: "OPERACIONAL",
  elite_score: ELITE_SCORE,
  odd_min: ODD_MIN,
  odd_max: ODD_MAX,
  min_ea: MIN_EA,
  min_la: MIN_LA,
  early: `${EARLY_START}-${EARLY_END}`,
  late: `${LATE_START}-${LATE_END}`,
  timestamp: new Date().toISOString()
}));

// ... mantém o resto do seu código de radar aqui embaixo ...

app.listen(PORT, ()=> console.log(`Rodando na porta ${PORT}`));
