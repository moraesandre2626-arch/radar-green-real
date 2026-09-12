const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

let ultimoScan = new Date().toLocaleString('pt-BR');
let jogosAoVivo = 0;
let ultimoErro = 'Nenhum';
let enviados = new Set();

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

function getHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://www.sofascore.com/',
    'Origin': 'https://www.sofascore.com',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
}

async function enviarTelegram(msg) {
  try {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await axios.get(`https://api.telegram.org/bot${token}/sendMessage`, {
      params: { chat_id: chatId, text: msg, parse_mode: 'HTML' }
    });
  } catch (e) { console.log('Erro telegram:', e.message); }
}

async function getLiveEvents() {
  try {
    // Tenta endpoint 1 - API principal
    const url = 'https://api.sofascore.com/api/v1/sport/football/events/live';
    const res = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
    ultimoErro = 'OK - ' + new Date().toLocaleTimeString('pt-BR');
    return res.data.events || [];
  } catch (e) {
    ultimoErro = `Erro: ${e.message} - ${e
