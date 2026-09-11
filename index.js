// ============================================================
// ELITE RADAR V24 - API-FOOTBALL - CORRIGIDO FINAL
// PRESSÃO INTELIGENTE -> ESCANTEIOS NO 2º TEMPO
// ============================================================
// FONTE: API-FOOTBALL / API-SPORTS
// REGRAS:
// - API key somente no Render: EFO_IDS
// - Máximo: 99 req/dia (proteção interna)
// - Varredura: 20 minutos
// - 1 chamada live + 1 chamada por jogo HT para stats
// - Escanteios NÃO entram no score
// ============================================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const API_KEY = (process.env.EFO_IDS || "").trim();
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.TOKEN || "";
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

const API_BASE = "https://v3.football.api-sports.io";
const MAX_REQUESTS_DAY = 99;
const INTERVALO_SCAN_MS = 20 * 60 * 1000;
const SCORE_MINIMO = 65;
const TIMEOUT_API = 15000;
const MAX_JOGOS_POR_SCAN = 6; // máximo pra não estourar a quota

let requisicoesHoje = 0;
let ultimoErro = null;
let ultimoScan = null;
let proximoScan = null;
let jogosAnalisados = 0;
let candidatosEncontrados = 0;
let alertasEnviados = 0;
let protecoes = 0;
let erros403 = 0;
let ultimoResetUTC = null;
const JOGOS_JA_AVISADOS = new Set();
const CACHE_FIXTURES = new Map();
const CACHE_TTL = 60 * 1000;

function log(...args) { console.log(new Date().toISOString(),...args); }
function horaBRT() { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()); }
function dataBRT() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function dataUTC() { return new Date().toISOString().slice(0, 10); }

function verificarResetDiario() {
  const hoje = dataUTC();
  if (ultimoResetUTC!== hoje) {
    ultimoResetUTC = hoje;
    requisicoesHoje = 0; jogosAnalisados = 0; candidatosEncontrados = 0; alertasEnviados = 0; protecoes = 0; erros403 = 0;
    JOGOS_JA_AVISADOS.clear();
    log("🔄 RESET DIÁRIO:", hoje);
  }
}
function podeConsultarAPI() {
  verificarResetDiario();
  if (!API_KEY) { ultimoErro = "EFO_IDS não configurado"; return false; }
  if (requisicoesHoje >= MAX_REQUESTS_DAY) { protecoes++; ultimoErro = `Limite ${MAX_REQUESTS_DAY}/dia atingido`; return false; }
  return true;
}
function registrarRequisicao(response) { requisicoesHoje++; log(`📡 REQ ${requisicoesHoje}/${MAX_REQUESTS_DAY}`); }

async function apiGet(endpoint, params = {}) {
  if (!podeConsultarAPI()) throw new Error("LIMITE_API_INTERNO");
  try {
    const response = await axios.get(`${API_BASE}${endpoint}`, {
      params, timeout: TIMEOUT_API,
      headers: { "x-apisports-key": API_KEY, "Accept": "application/json" },
      validateStatus: () => true
    });
    registrarRequisicao(response);
    if (response.status === 403) { erros403++; throw new Error("API_403"); }
    if (response.status === 429) throw new Error("API_429");
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
    if (response.data.errors && Object.keys(response.data.errors).length > 0) throw new Error(JSON.stringify(response.data.errors));
    return response.data;
  } catch (error) { if(!ultimoErro || error.message.includes("API")) ultimoErro = error.message; throw error; }
}

async function buscarJogosAoVivo() {
  const cacheKey = "live"; const cache = CACHE_FIXTURES.get(cacheKey);
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) return cache.data;
  const data = await apiGet("/fixtures", { live: "all" });
  const jogos = Array.isArray(data.response)? data.response : [];
  CACHE_FIXTURES.set(cacheKey, { timestamp: Date.now(), data: jogos });
  return jogos;
}
function estaNoIntervalo(jogo) { return jogo?.fixture?.status?.short === "HT"; }
function numero(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace("%","").replace(",",".").trim());
  return isFinite(n)? n : 0;
}function extrairEstatisticas(statisticsArray) {
  if (!Array.isArray(statisticsArray) || statisticsArray.length < 2) return null;
  const casa = statisticsArray[0]; const fora = statisticsArray[1];
  function pegar(bloco, nomes) {
    const stats = Array.isArray(bloco.statistics)? bloco.statistics : [];
    for (const nome of nomes) {
      const item = stats.find(s => String(s.type).toLowerCase() === String(nome).toLowerCase());
      if (item) return numero(item.value);
    } return 0;
  }
  return {
    home: { chutes: pegar(casa, ["Total Shots"]), alvo: pegar(casa, ["Shots on Goal"]), bloqueados: pegar(casa, ["Blocked Shots"]), dentroArea: pegar(casa, ["Shots insidebox"]), posse: pegar(casa, ["Ball Possession"]), escanteios: pegar(casa, ["Corner Kicks"]), ataquesPerigosos: 0, xg: 0, grandesChances: 0 },
    away: { chutes: pegar(fora, ["Total Shots"]), alvo: pegar(fora, ["Shots on Goal"]), bloqueados: pegar(fora, ["Blocked Shots"]), dentroArea: pegar(fora, ["Shots insidebox"]), posse: pegar(fora, ["Ball Possession"]), escanteios: pegar(fora, ["Corner Kicks"]), ataquesPerigosos: 0, xg: 0, grandesChances: 0 }
  };
}

function analisarPressao(dados) {
  const h = dados.home; const a = dados.away; let bonus = 0; const fatores = [];
  const totalChutes = h.chutes + a.chutes; const maxChutes = Math.max(h.chutes, a.chutes); const diffChutes = maxChutes - Math.min(h.chutes, a.chutes);
  if (totalChutes >= 18) { bonus += 12; fatores.push("18+ chutes"); } else if (totalChutes >= 15) { bonus += 10; fatores.push("15+ chutes"); } else if (totalChutes >= 12) { bonus += 8; fatores.push("12+ chutes"); } else if (totalChutes >= 9) { bonus += 5; fatores.push("9+ chutes"); }
  if (maxChutes >= 10 && diffChutes >= 5) { bonus += 15; fatores.push("forte domínio de chutes"); } else if (maxChutes >= 9 && diffChutes >= 4) { bonus += 12; fatores.push("domínio de chutes"); } else if (maxChutes >= 7 && diffChutes >= 3) { bonus += 8; fatores.push("vantagem de chutes"); }
  if (h.chutes >= 6 && a.chutes >= 6) { bonus += 10; fatores.push("pressão dos dois lados"); } else if (h.chutes >= 5 && a.chutes >= 4) { bonus += 7; fatores.push("volume bilateral"); }
  const totalAlvo = h.alvo + a.alvo;
  if (totalAlvo >= 7) { bonus += 10; fatores.push("7+ no alvo"); } else if (totalAlvo >= 5) { bonus += 8; fatores.push("5+ no alvo"); } else if (totalAlvo >= 3) { bonus += 5; fatores.push("3+ no alvo"); }
  const maxPosse = Math.max(h.posse, a.posse); const diffPosse = Math.abs(h.posse - a.posse);
  if (maxPosse >= 65 && maxChutes >= 8) { bonus += 10; fatores.push("posse 65%+ + volume"); } else if (maxPosse >= 60 && maxChutes >= 7) { bonus += 7; fatores.push("posse 60%+ + volume"); }
  if (diffPosse >= 20 && maxChutes >= 7) { bonus += 7; fatores.push("forte domínio territorial"); }
  const totalDentro = h.dentroArea + a.dentroArea; if (totalDentro >= 8) { bonus += 8; fatores.push("8+ dentro da área"); } else if (totalDentro >= 5) { bonus += 5; fatores.push("5+ dentro da área"); }
  const totalBloq = h.bloqueados + a.bloqueados; if (totalBloq >= 6) { bonus += 6; fatores.push("6+ bloqueados"); } else if (totalBloq >= 4) { bonus += 4; fatores.push("4+ bloqueados"); }
  return { bonus, fatores };
}

function calcularScore(dados, jogo) {
  let score = 25; const pressao = analisarPressao(dados); score += pressao.bonus;
  const golsCasa = numero(jogo.goals?.home); const golsFora = numero(jogo.goals?.away);
  if (golsCasa === 0 && golsFora === 0) score += 8; else if (golsCasa === golsFora) score += 5;
  else { const perdedor = golsCasa < golsFora? dados.home : dados.away; const vencedor = golsCasa > golsFora? dados.home : dados.away; if (perdedor.chutes >= vencedor.chutes + 3) score += 8; }
  if (Math.abs(golsCasa - golsFora) >= 3) score -= 8;
  const maxPosse = Math.max(dados.home.posse, dados.away.posse); const maxChutes = Math.max(dados.home.chutes, dados.away.chutes);
  if (maxPosse >= 65 && maxChutes <= 5) score -= 12;
  if ((dados.home.chutes + dados.away.chutes) <= 5) score -= 15;
  score = Math.max(0, Math.min(100, score));
  return { score, fatores: pressao.fatores };
}
function classificacao(score) { if (score >= 90) return "🔥 EXCEPCIONAL"; if (score >= 85) return "🚀 MUITO FORTE"; if (score >= 75) return "🟢 FORTE"; if (score >= 65) return "🟡 ATIVADO"; return "⚪ FRACO"; }

function montarAlerta(resultado) {
  const h = resultado.home; const a = resultado.away;
  const fatores = resultado.fatores.length? resultado.fatores.map(f=>`• ${f}`).join("\n") : "• Pressão geral";
  return `🚨 ELITE RADAR V24\n\n${resultado.classificacao}\n\n⚽ ${resultado.nome}\n📊 Placar: ${resultado.gols}\n⏱️ Intervalo\n\n🎯 SCORE: ${resultado.score}/100\n\n📈 PRESSÃO 1º TEMPO\nChutes: 🏠 ${h.chutes} x ✈️ ${a.chutes}\nNo alvo: 🏠 ${h.alvo} x ✈️ ${a.alvo}\nBloqueados: 🏠 ${h.bloqueados} x ✈️ ${a.bloqueados}\nDentro área: 🏠 ${h.dentroArea} x ✈️ ${a.dentroArea}\nPosse: 🏠 ${h.posse}% x ✈️ ${a.posse}%\n🚩 Escanteios HT: 🏠 ${h.escanteios} x ✈️ ${a.escanteios}\n\n⚠️ ESCANTEIOS NÃO ENTRAM NO SCORE.\n\n🔥 FATORES\n${fatores}\n\n🎯 MERCADO: PRESSÃO → ESCANTEIOS 2º TEMPO\n📡 API: API-FOOTBALL\n🔄 Varredura: 20 min`;
}
async function enviarTelegram(texto) {
  if (!TELEGRAM_TOKEN ||!CHAT_ID) throw new Error("Telegram não configurado");
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await axios.post(url, { chat_id: CHAT_ID, text: texto, disable_web_page_preview: true }, { timeout: 12000 });
  if (!res.data?.ok) throw new Error("Telegram recusou");
  return true;
    }async function executarScan() {
  verificarResetDiario(); ultimoScan = new Date();
  log("================================================"); log(`🔎 V24 SCAN - BRT ${horaBRT()} - API ${requisicoesHoje}/${MAX_REQUESTS_DAY}`);
  if (!podeConsultarAPI()) { log("🛑 Quota protegida"); return; }
  try {
    const aoVivo = await buscarJogosAoVivo();
    log(`⚽ Ao vivo: ${aoVivo.length}`);
    let intervalo = aoVivo.filter(estaNoIntervalo);
    log(`⏸️ Intervalo: ${intervalo.length}`);
    if (!intervalo.length) return;
    intervalo = intervalo.slice(0, MAX_JOGOS_POR_SCAN); // limita pra não estourar quota

    for (const jogo of intervalo) {
      if (!podeConsultarAPI()) break;
      jogosAnalisados++;
      const fixtureId = jogo.fixture?.id;
      if (!fixtureId || JOGOS_JA_AVISADOS.has(fixtureId)) continue;

      try {
        // BUSCA CORRETA DE ESTATÍSTICAS
        const statsData = await apiGet("/fixtures/statistics", { fixture: fixtureId });
        const statsArray = statsData.response;
        const dados = extrairEstatisticas(statsArray);
        if (!dados) { log(`Sem stats ${fixtureId}`); continue; }

        const totalChutes = dados.home.chutes + dados.away.chutes;
        if (totalChutes < 7) { log(`Descartado ${fixtureId} - ${totalChutes} chutes`); continue; }

        const resultadoScore = calcularScore(dados, jogo);
        if (resultadoScore.score < SCORE_MINIMO) { log(`Abaixo score ${fixtureId}: ${resultadoScore.score}`); continue; }

        candidatosEncontrados++;
        const casa = jogo.teams?.home?.name || "Casa"; const fora = jogo.teams?.away?.name || "Fora";
        const resultado = {
          id: fixtureId, nome: `${casa} x ${fora}`, score: resultadoScore.score,
          classificacao: classificacao(resultadoScore.score),
          gols: `${jogo.goals?.home?? 0} x ${jogo.goals?.away?? 0}`,
          home: dados.home, away: dados.away, fatores: resultadoScore.fatores
        };

        log(`🎯 CANDIDATO: ${resultado.nome} | ${resultado.score}`);
        await enviarTelegram(montarAlerta(resultado));
        JOGOS_JA_AVISADOS.add(fixtureId); alertasEnviados++;
        log(`📨 ENVIADO: ${resultado.nome}`);

      } catch (err) { ultimoErro = err.message; log(`❌ Erro jogo ${jogo.fixture?.id}: ${err.message}`); }
      await new Promise(r => setTimeout(r, 800)); // delay entre jogos
    }
  } catch (error) { ultimoErro = error.message; log("❌ ERRO SCAN:", error.message); }
  log(`📊 Consumo: ${requisicoesHoje}/${MAX_REQUESTS_DAY}`);
}

async function enviarRelatorioDiario() {
  const texto = `📊 ELITE RADAR V24 - RELATÓRIO\n📅 ${dataBRT()}\n🔎 Analisados: ${jogosAnalisados}\n🎯 Candidatos: ${candidatosEncontrados}\n📨 Alertas: ${alertasEnviados}\n📡 Req: ${requisicoesHoje}/${MAX_REQUESTS_DAY}\nRestantes: ${Math.max(0, MAX_REQUESTS_DAY - requisicoesHoje)}\nScore min: ${SCORE_MINIMO}\nProteções: ${protecoes}\nErros 403: ${erros403}\nÚltimo erro: ${ultimoErro || "Nenhum"}\nFonte: API-FOOTBALL`;
  try { await enviarTelegram(texto); log("📊 Relatório enviado"); } catch(e) { log("❌ Falha relatório", e.message); }
}
function estaNoHorarioRadar() {
  const agora = new Date();
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora));
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(agora);
  const fds = dia === "Sat" || dia === "Sun"; return fds? (hora >= 8 && hora < 24) : (hora >= 12 && hora < 24);
}
async function loopRadar() {
  try { if (estaNoHorarioRadar()) await executarScan(); else log(`⏰ Fora do horário BRT ${horaBRT()}`); } catch(e) { ultimoErro = e.message; log("❌ LOOP", e.message); }
  proximoScan = new Date(Date.now() + INTERVALO_SCAN_MS); setTimeout(loopRadar, INTERVALO_SCAN_MS);
}
let ultimoDiaRelatorio = null;
setInterval(async () => {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(agora);
  const hora = Number(partes.find(p=>p.type==="hour")?.value||0); const minuto = Number(partes.find(p=>p.type==="minute")?.value||0); const hoje = dataBRT();
  if (hora === 23 && minuto < 2 && ultimoDiaRelatorio!== hoje) { ultimoDiaRelatorio = hoje; await enviarRelatorioDiario(); }
}, 30*1000);

app.get("/", (req,res)=>{ verificarResetDiario(); res.json({ projeto:"ELITE RADAR V24", status:"online", fonte:"API-FOOTBALL", efo_ids_configurado:!!API_KEY, telegram_configurado:!!(TELEGRAM_TOKEN&&CHAT_ID), requisicoes_hoje:requisicoesHoje, limite:MAX_REQUESTS_DAY, restantes:Math.max(0,MAX_REQUESTS_DAY-requisicoesHoje), intervalo_scan:"20 min", score_minimo:SCORE_MINIMO, jogos_analisados: jogosAnalisados, candidatos: candidatosEncontrados, alertas: alertasEnviados, ultimo_scan: ultimoScan, proximo_scan: proximoScan, ultimo_erro: ultimoErro, hora_brt: horaBRT() }); });
app.get("/api-status", (req,res)=>{ verificarResetDiario(); res.json({ api:"API-FOOTBALL", configurada:!!API_KEY, requisicoes:requisicoesHoje, limite:MAX_REQUESTS_DAY, restantes:Math.max(0,MAX_REQUESTS_DAY-requisicoesHoje), ultimo_erro: ultimoErro, erros_403: erros403 }); });
app.get("/telegram-test", async (req,res)=>{ try{ await enviarTelegram(`🟢 V24 TESTE OK\n📡 API: ${requisicoesHoje}/${MAX_REQUESTS_DAY}\n🕐 BRT: ${horaBRT()}`); res.json({ok:true}); }catch(e){ res.status(500).json({ok:false, erro:e.message}); } });
app.get("/limpar-cache", (req,res)=>{ CACHE_FIXTURES.clear(); res.json({ok:true}); });
app.get("/limpar-stats-cache", (req,res)=>{ JOGOS_JA_AVISADOS.clear(); res.json({ok:true}); });
app.get("/reset-api", (req,res)=>{ requisicoesHoje=0; res.json({ok:true, aviso:"Contador LOCAL resetado"}); });

app.listen(PORT, ()=>{ log("================================================"); log(`🚀 V24 API-FOOTBALL RODANDO PORTA ${PORT}`); log(`📡 API: ${API_KEY?"CONFIGURADA":"NÃO CONFIGURADA"}`); log(`📨 TELEGRAM: ${TELEGRAM_TOKEN&&CHAT_ID?"CONFIGURADO":"NÃO"}`); log(`📊 LIMITE: ${MAX_REQUESTS_DAY}/DIA - MAX ${MAX_JOGOS_POR_SCAN} jogos/scan`); setTimeout(loopRadar, 5000); });
