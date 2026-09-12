// V25.1 FIX - CommonJS
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
let ultimoScan = null;
let jogosAnalisados = 0;
let candidatosEncontrados = 0;
let ultimoErro = null;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};
async function enviarTelegram(msg) {
  if (!TELEGRAM_TOKEN ||!TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
    });
  } catch (e) {}
}
async function getLiveEvents() {
  try {
    const res = await fetch('https://api.sofascore.com/api/v1/sport/football/events/live', { headers: HEADERS });
    const data = await res.json();
    return data.events || [];
  } catch (e) { ultimoErro = e.message; return []; }
}
async function getStats(eventId) {
  try {
    const res = await fetch(`https://api.sofascore.com/api/v1/event/${eventId}/statistics`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    return data.statistics || [];
  } catch { return null; }
}
function extrairDados(stats) {
  if (!stats ||!stats.length) return null;
  const all = stats.find(s => s.period === 'ALL') || stats[0];
  if (!all ||!all.groups) return null;
  let corners = 0, dangerous = 0;
  for (const g of all.groups) {
    for (const item of g.statisticsItems || []) {
      if (item.name === 'Corner kicks') corners = (parseInt(item.home)||0)+(parseInt(item.away)||0);
      if (item.name === 'Dangerous attacks') dangerous = (parseInt(item.home)||0)+(parseInt(item.away)||0);
    }
  }
  return { corners, dangerous };
}
async function scan() {
  const events = await getLiveEvents();
  jogosAnalisados = events.length;
  let candidatos = 0;
  for (const ev of events) {
    let minuto = 0;
    if (ev.statusDescription) {
      const m = ev.statusDescription.match(/(\d+)'/);
      if (m) minuto = parseInt(m[1]);
    }
    if (minuto < 60 || minuto > 88) continue;
    const gols = (ev.homeScore?.current||0)+(ev.awayScore?.current||0);
    if (gols > 2) continue;
    const stats = await getStats(ev.id);
    await new Promise(r=>setTimeout(r,600));
    const dados = extrairDados(stats);
    if (!dados) continue;
    if (dados.corners >= 6 && minuto >= 65) {
      candidatos++;
      const msg = `🟢 *GREEN V25.1*\n\n⚽ ${ev.homeTeam?.name} x ${ev.awayTeam?.name}\n🏆 ${ev.tournament?.name}\n⏱️ ${minuto}' - ${ev.homeScore?.current}x${ev.awayScore?.current}\n🚩 Esc
