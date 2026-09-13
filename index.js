// ADICIONA ISSO NO TOPO
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000); // timeout 8s
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally { clearTimeout(t); }
}

// DENTRO DO buscarJogosESPN, troca o for por isso:
for (const ev of data.events) {
    // ... seu código
    await sleep(400); // 400ms entre cada summary = não toma block
    const stats = await buscarEstatisticas(liga, ev.id);
}

// ANTI-DUPLICAÇÃO CORRIGIDO:
const chave = `${jogo.liga}_${jogo.id}_HT`; // trava o jogo inteiro no HT, não só o placar
