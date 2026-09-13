// COLA ESSAS 2 FUNÇÕES ATUALIZADAS NO SEU INDEX.JS

async function buscarRaioXCompleto(liga, eventId){
    const raio = {
        chutesCasa:0,chutesFora:0, alvoCasa:0,alvoFora:0, posseCasa:0,posseFora:0,
        escCasa:0,escFora:0, amarelosCasa:0,amarelosFora:0,
        cruzCasa:0, cruzFora:0, cruzBloqCasa:0, cruzBloqFora:0,
        apCasa:null, apFora:null, temAP:false, temCruz:false
    };
    try{
        const summary = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`);
        const teams = summary?.boxscore?.teams || [];
        for(let i=0;i<teams.length;i++){
            const bloco = teams[i];
            const id = String(bloco?.team?.id||'');
            let lado = i===0?'home':'away';
            const comp = summary?.header?.competitions?.[0]?.competitors?.find(c=>String(c.team?.id)===id);
            if(comp) lado = comp.homeAway;
            const S = bloco?.statistics||[];

            const chutes = pegaStat(S, ['totalShots','shots'])??0;
            const alvo = pegaStat(S, ['shotsOnTarget','shotsOnGoal'])??0;
            const posse = pegaStat(S, ['possessionPct','possession'])??0;
            const esc = pegaStat(S, ['wonCorners','cornerKicks'])??0;
            const amarelos = pegaStat(S, ['yellowCards'])??0;
            const ap = pegaStat(S, ['dangerousAttacks','dangerousAttack','attack']);
            const cruz = pegaStat(S, ['crosses','totalCrosses','totalCross','cross']);
            const cruzBloq = pegaStat(S, ['crossesBlocked','blockedCrosses','crossBlocked']);

            if(lado==='home'){
                raio.chutesCasa=chutes; raio.alvoCasa=alvo; raio.posseCasa=posse; raio.escCasa=esc; raio.amarelosCasa=amarelos;
                if(cruz!==null){ raio.cruzCasa=cruz; raio.temCruz=true; }
                if(cruzBloq!==null) raio.cruzBloqCasa=cruzBloq;
                if(ap!==null){ raio.apCasa=ap; raio.temAP=true; }
            } else {
                raio.chutesFora=chutes; raio.alvoFora=alvo; raio.posseFora=posse; raio.escFora=esc; raio.amarelosFora=amarelos;
                if(cruz!==null){ raio.cruzFora=cruz; raio.temCruz=true; }
                if(cruzBloq!==null) raio.cruzBloqFora=cruzBloq;
                if(ap!==null){ raio.apFora=ap; raio.temAP=true; }
            }
        }
    }catch(e){}
    return raio;
}

async function enviarTelegram(jogo, analise){
    if(!TELEGRAM_TOKEN||!CHAT_ID) return false;
    const raio = await buscarRaioXCompleto(jogo.liga, jogo.id);
    const pCasa = (raio.posseCasa+raio.posseFora)>0? Math.round((raio.posseCasa/(raio.posseCasa+raio.posseFora))*100) : 50;

    // LINHAS SÓ APARECEM COM NOME BONITO SE TIVER DADO
    const linhaAP = raio.temAP? `🔥 Ataques Perigosos: ${raio.apCasa??0}x${raio.apFora??0}\n` : ``;
    const linhaCruz = raio.temCruz? `↗️ Cruzamentos: ${raio.cruzCasa}x${raio.cruzFora}\n` : ``;
    const linhaCruzBloq = (raio.cruzBloqCasa+raio.cruzBloqFora)>0? `🚫 Cruzamentos Bloqueados: ${raio.cruzBloqCasa}x${raio.cruzBloqFora}\n` : ``;

    const msg =
`🚨 RAIO-X GOL 2T — V34.3 FREE

🏆 ${jogo.liga.toUpperCase()}
⚽ ${jogo.nome_casa} ${jogo.gols_casa}x${jogo.gols_fora} ${jogo.nome_fora}
⏱️ ${jogo.minutoTexto}

📊 ESTATÍSTICAS HT:
🥅 Chutes: ${raio.chutesCasa}x${raio.chutesFora}
🎯 No Alvo: ${raio.alvoCasa}x${raio.alvoFora}
${linhaAP}${linhaCruz}${linhaCruzBloq}🚩 Escanteios: ${raio.escCasa}x${raio.escFora}
📊 Posse: ${pCasa}% x ${100-pCasa}%
🟨 Amarelos: ${raio.amarelosCasa}x${raio.amarelosFora}

🎯 Precisa: ${analise.timePrecisa} (${analise.chutesPrecisa} no alvo)
✅ FILTRO: 2x0 MANDA | 3x0 NÃO`;

    try{
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:msg})});
        const d = await r.json(); if(!d.ok) throw new Error(d.description);
        totalEnviados++; return true;
    }catch(e){ console.log(`❌ Telegram: ${e.message}`); return false; }
}
