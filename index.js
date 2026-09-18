const http=require('http');

const PORT=process.env.PORT||3000;
const TELEGRAM_TOKEN=process.env.TELEGRAM_TOKEN||process.env.TOKEN||'';
const CHAT_ID=process.env.CHAT_ID||process.env.TELEGRAM_CHAT_ID||'';

const REDIS_URL=process.env.UPSTASH_REDIS_REST_URL||'';
const REDIS_TOKEN=process.env.UPSTASH_REDIS_REST_TOKEN||'';
const REDIS_ATIVO=!!(REDIS_URL&&REDIS_TOKEN);

const LIGAS_PERMITIDAS=[
'bra.1','bra.2','por.1','eng.1','esp.1','ger.1',
'ita.1','fra.1','ned.1','bel.1','tur.1','sco.1',
'conmebol.libertadores','conmebol.sudamericana',
'usa.1','mex.1','arg.1','uefa.champions','uefa.europa'
];

const FILTROS={
max_diferenca_gols:2,
min_chutes_gol_time_precisa:2,
min_total_chutes_jogo:8,
minuto_minimo:40,
minuto_maximo:55,
posse_minima_pressao:60,
min_pressao_score:6
};

let ultimoScan=null;
let totalAprovados=0;
let totalEnviados=0;
let totalErros=0;
let relatorioEmExecucao=false;

const enviados=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function dataBrasilia(){
return new Intl.DateTimeFormat('pt-BR',{
timeZone:'America/Sao_Paulo',
year:'numeric',
month:'2-digit',
day:'2-digit'
}).format(new Date());
}

function horaBrasilia(){
const p=new Intl.DateTimeFormat('en-US',{
timeZone:'America/Sao_Paulo',
hour:'2-digit',
minute:'2-digit',
hour12:false
}).formatToParts(new Date());

return{
hora:Number(p.find(x=>x.type==='hour')?.value||0),
minuto:Number(p.find(x=>x.type==='minute')?.value||0)
};
}

let historicoDia={
data:dataBrasilia(),
enviados:[],
green:0,
red:0,
pendentes:0,
relatorioEnviado:false
};

function chaveHistorico(data){
return `gol2t:v34.6:historico:${data}`;
}

async function redisGet(chave){
if(!REDIS_ATIVO)return null;

try{
const r=await fetch(
`${REDIS_URL}/get/${encodeURIComponent(chave)}`,
{
headers:{
Authorization:`Bearer ${REDIS_TOKEN}`
}
}
);

if(!r.ok)throw new Error(`HTTP ${r.status}`);

const d=await r.json();
return d.result??null;

}catch(e){
console.log('⚠️ Redis GET:',e.message);
return null;
}
}

async function redisSet(chave,valor){
if(!REDIS_ATIVO)return false;

try{
const r=await fetch(
`${REDIS_URL}/set/${encodeURIComponent(chave)}`,
{
method:'POST',
headers:{
Authorization:`Bearer ${REDIS_TOKEN}`,
'Content-Type':'text/plain'
},
body:valor
}
);

if(!r.ok)throw new Error(`HTTP ${r.status}`);

const d=await r.json();
return d.result==='OK';

}catch(e){
console.log('⚠️ Redis SET:',e.message);
return false;
}
}

async function salvarHistorico(){
if(REDIS_ATIVO){
await redisSet(
chaveHistorico(historicoDia.data),
JSON.stringify(historicoDia)
);
}
}

function reconstruirMapa(){
enviados.clear();

for(const a of historicoDia.enviados){
if(a?.id&&a?.liga){
enviados.set(
`${a.liga}_${a.id}_HT`,
Date.now()
);
}
}
}

async function carregarHistorico(){

const hoje=dataBrasilia();

historicoDia.data=hoje;

if(!REDIS_ATIVO){
console.log('⚠️ Redis não configurado');
return;
}

const salvo=await redisGet(
chaveHistorico(hoje)
);

if(!salvo){
console.log(
'🟢 Redis conectado; sem histórico de hoje'
);
return;
}

try{

const d=
typeof salvo==='string'
?JSON.parse(salvo)
:salvo;

if(
d&&
d.data===hoje&&
Array.isArray(d.enviados)
){

historicoDia={
data:hoje,
enviados:d.enviados,
green:Number(d.green)||0,
red:Number(d.red)||0,
pendentes:Number(d.pendentes)||0,
relatorioEnviado:!!d.relatorioEnviado
};

reconstruirMapa();

console.log(
`🟢 Histórico recuperado: ${d.enviados.length}`
);
}

}catch(e){
console.log(
'⚠️ Histórico Redis:',
e.message
);
}
}

async function garantirNovoDia(){

const hoje=dataBrasilia();

if(historicoDia.data!==hoje){

historicoDia={
data:hoje,
enviados:[],
green:0,
red:0,
pendentes:0,
relatorioEnviado:false
};

enviados.clear();

await salvarHistorico();

console.log(
'📅 Novo dia:',
hoje
);
}
}

async function getJson(url){

const c=new AbortController();

const t=setTimeout(
()=>c.abort(),
8000
);

try{

const r=await fetch(
url,
{
headers:{
'User-Agent':'Mozilla/5.0'
},
signal:c.signal
}
);

if(!r.ok){
throw new Error(
`HTTP ${r.status}`
);
}

return await r.json();

}finally{

clearTimeout(t);

}
}

function numero(v){

const n=parseFloat(
String(v??0)
.replace(',','.')
.replace('%','')
);

return Number.isFinite(n)
?n
:0;
}

function pegaStat(S,nomes){

if(!Array.isArray(S))
return null;

for(const nome of nomes){

const s=S.find(x=>
x.name?.toLowerCase()===
nome.toLowerCase()||
x.abbreviation?.toLowerCase()===
nome.toLowerCase()
);

if(s){

return numero(
s.displayValue??
s.value??
0
);

}
}

return null;
}

async function buscarRaioXCompleto(
liga,
eventId
){

const r={
chutesCasa:0,
chutesFora:0,
alvoCasa:0,
alvoFora:0,
posseCasa:0,
posseFora:0,
escCasa:0,
escFora:0,
amarelosCasa:0,
amarelosFora:0,
cruzCasa:0,
cruzFora:0,
apCasa:null,
apFora:null,
temAP:false,
temCruz:false
};

try{

const s=await getJson(
`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/summary?event=${eventId}`
);

const teams=
s?.boxscore?.teams||[];

for(
let i=0;
i<teams.length;
i++
){

const b=teams[i];

const id=
String(
b?.team?.id||''
);

let lado=
i===0
?'home'
:'away';

const comp=
s?.header
?.competitions?.[0]
?.competitors
?.find(
x=>String(x.team?.id)===id
);

if(comp)
lado=comp.homeAway;

const S=
b?.statistics||[];

const ch=
pegaStat(
S,
['totalShots','shots']
)??0;

const al=
pegaStat(
S,
['shotsOnTarget','shotsOnGoal']
)??0;

const po=
pegaStat(
S,
['possessionPct','possession']
)??0;

const es=
pegaStat(
S,
['wonCorners','cornerKicks']
)??0;

const am=
pegaStat(
S,
['yellowCards']
)??0;

const ap=
pegaStat(
S,
[
'dangerousAttacks',
'dangerousAttack',
'attack'
]
);

const cr=
pegaStat(
S,
[
'crosses',
'totalCrosses',
'totalCross',
'cross'
]
);

if(lado==='home'){

r.chutesCasa=ch;
r.alvoCasa=al;
r.posseCasa=po;
r.escCasa=es;
r.amarelosCasa=am;

if(cr!==null){
r.cruzCasa=cr;
r.temCruz=true;
}

if(ap!==null){
r.apCasa=ap;
r.temAP=true;
}

}else{

r.chutesFora=ch;
r.alvoFora=al;
r.posseFora=po;
r.escFora=es;
r.amarelosFora=am;

if(cr!==null){
r.cruzFora=cr;
r.temCruz=true;
}

if(ap!==null){
r.apFora=ap;
r.temAP=true;
}

}

}

}catch(e){}

return r;
}

function checaJogo(j,r){

if(!LIGAS_PERMITIDAS.includes(j.liga))
return{
aprovado:false,
motivo:'liga'
};

if(
Math.abs(
j.gols_casa-j.gols_fora
)>FILTROS.max_diferenca_gols
)
return{
aprovado:false,
motivo:'placar'
};

if(
j.chutes_casa+j.chutes_fora
<FILTROS.min_total_chutes_jogo
)
return{
aprovado:false,
motivo:'chutes'
};

const totalPosse=
r.posseCasa+r.posseFora;

const posseCasa=
totalPosse>0
?Math.round(
r.posseCasa/totalPosse*100
)
:50;

const posseFora=
100-posseCasa;

let nome='';
let alvo=0;
let posse=0;
let cruz=0;
let esc=0;
let ap=0;

if(
j.gols_casa<
j.gols_fora
){

nome=j.nome_casa;
alvo=r.alvoCasa;
posse=posseCasa;
cruz=r.cruzCasa;
esc=r.escCasa;
ap=r.apCasa||0;

}else if(
j.gols_fora<
j.gols_casa
){

nome=j.nome_fora;
alvo=r.alvoFora;
posse=posseFora;
cruz=r.cruzFora;
esc=r.escFora;
ap=r.apFora||0;

}else{

const casaMelhor=
r.alvoCasa>=r.alvoFora;

nome=
casaMelhor
?j.nome_casa
:j.nome_fora;

alvo=Math.max(
r.alvoCasa,
r.alvoFora
);

posse=
casaMelhor
?posseCasa
:posseFora;

cruz=
casaMelhor
?r.cruzCasa
:r.cruzFora;

esc=
casaMelhor
?r.escCasa
:r.escFora;

ap=
casaMelhor
?(r.apCasa||0)
:(r.apFora||0);
}

if(
alvo<
FILTROS.min_chutes_gol_time_precisa
)
return{
aprovado:false,
motivo:'alvo'
};

const score=
cruz+
esc*2+
ap/10;

if(
score<
FILTROS.min_pressao_score
)
return{
aprovado:false,
motivo:
`score baixo ${score.toFixed(1)}`
};

if(
posse<
FILTROS.posse_minima_pressao
)
return{
aprovado:false,
motivo:
`posse pressao ${posse}% < ${FILTROS.posse_minima_pressao}%`
};

let zona='Meio';

if(
cruz>=8||
(
cruz>=5&&
esc>=2
)
){

zona=
`Lateral (${cruz} cruz)`;

}else if(esc>=3){

zona=
`Abafa Área (${esc} esc)`;

}else if(ap>=15){

zona=
`Meio-Perigoso (${ap} AP)`;
}

return{
aprovado:true,
timePrecisa:nome,
chutesPrecisa:alvo,
totalChutes:
j.chutes_casa+
j.chutes_fora,
possePct:posse,
scorePressao:score,
zonaPressao:zona
};
}

async function enviarTelegramTexto(msg){

if(!TELEGRAM_TOKEN||!CHAT_ID)
return false;

const r=await fetch(
`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
{
method:'POST',
headers:{
'Content-Type':
'application/json'
},
body:JSON.stringify({
chat_id:CHAT_ID,
text:msg
})
}
);

const d=await r.json();

if(!d.ok)
throw new Error(
d.description||
'Telegram recusou'
);

return true;
}

async function enviarTelegram(
j,
a,
r
){

const totalPosse=
r.posseCasa+r.posseFora;

const pc=
totalPosse>0
?Math.round(
r.posseCasa/
totalPosse*
100
)
:50;

const linhaAP=
r.temAP
?`🔥 Ataques Perigosos: ${r.apCasa??0}x${r.apFora??0}\n`
:'';

const linhaCruz=
r.temCruz
?`↗️ Cruzamentos: ${r.cruzCasa}x${r.cruzFora}\n`
:'';

const msg=
`🚨 RAIO-X GOL 2T — V34.6 60% POSSE

🏆 ${j.liga.toUpperCase()}
⚽ ${j.nome_casa} ${j.gols_casa}x${j.gols_fora} ${j.nome_fora}
⏱️ ${j.minutoTexto}

📊 ESTATÍSTICAS HT:
🥅 Chutes: ${r.chutesCasa}x${r.chutesFora} (Total: ${a.totalChutes})
🎯 No Alvo: ${r.alvoCasa}x${r.alvoFora}
${linhaAP}${linhaCruz}🚩 Escanteios: ${r.escCasa}x${r.escFora}
📊 Posse: ${pc}% x ${100-pc}%
🟨 Amarelos: ${r.amarelosCasa}x${r.amarelosFora}

📍 PRESSÃO: ${a.zonaPressao}
📈 Score Pressão: ${a.scorePressao.toFixed(1)} | Posse time: ${a.possePct}% ✅ 60%+

🎯 Precisa: ${a.timePrecisa} (${a.chutesPrecisa} no alvo)
✅ FILTRO: 60% POSSE + PRESSAO LATERAL`;

try{

await enviarTelegramTexto(msg);

totalEnviados++;

await garantirNovoDia();

const existe=
historicoDia.enviados.some(
x=>
String(x.id)===
String(j.id)&&
x.liga===j.liga
);

if(!existe){

historicoDia.enviados.push({

id:String(j.id),
liga:j.liga,
casa:j.nome_casa,
fora:j.nome_fora,

golsCasaAlerta:
j.gols_casa,

golsForaAlerta:
j.gols_fora,

minutoAlerta:
j.minuto,

status:'pendente'

});

await salvarHistorico();
}

console.log(
`📨 Enviado: ${j.nome_casa} x ${j.nome_fora}`
);

return true;

}catch(e){

totalErros++;

console.log(
'❌ Telegram:',
e.message
);

return false;
}
}

async function buscarJogosESPN(){

const aprovados=[];

for(
const liga of
LIGAS_PERMITIDAS
){

try{

const data=
await getJson(
`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`
);

if(!Array.isArray(data.events))
continue;

for(
const ev of data.events
){

try{

const comp=
ev?.competitions?.[0];

if(!comp)
continue;

const status=
comp?.status?.type?.name||'';

if(
![
'STATUS_HALFTIME',
'STATUS_SECOND_HALF'
].includes(status)
)
continue;

let minuto=
numero(
comp?.status?.clock
);

if(
status===
'STATUS_HALFTIME'
)
minuto=45;

if(
minuto<
FILTROS.minuto_minimo||
minuto>
FILTROS.minuto_maximo
)
continue;

const casa=
comp.competitors?.find(
c=>c.homeAway==='home'
);

const fora=
comp.competitors?.find(
c=>c.homeAway==='away'
);

if(!casa||!fora)
continue;

await sleep(400);

const raio=
await buscarRaioXCompleto(
liga,
ev.id
);

const jogo={

id:String(ev.id),
liga,

nome_casa:
casa.team?.displayName||
'Casa',

nome_fora:
fora.team?.displayName||
'Fora',

gols_casa:
numero(casa.score),

gols_fora:
numero(fora.score),

chutes_casa:
raio.chutesCasa,

chutes_fora:
raio.chutesFora,

alvo_casa:
raio.alvoCasa,

alvo_fora:
raio.alvoFora,

minuto,

minutoTexto:
status==='STATUS_HALFTIME'
?'INTERVALO'
:`${Math.floor(minuto)}'`
};

const analise=
checaJogo(
jogo,
raio
);

if(!analise.aprovado)
continue;

totalAprovados++;

aprovados.push({
jogo,
analise,
raio
});

}catch(e){}
}

}catch(e){

totalErros++;

}
}

return aprovados;
}

async function executarRadar(){

await garantirNovoDia();

ultimoScan=
new Date().toLocaleString(
'pt-BR',
{
timeZone:
'America/Sao_Paulo'
}
);

console.log(
'🔎 Radar V34.6 varrendo...'
);

try{

const res=
await buscarJogosESPN();

if(!res.length){

console.log(
'Nenhum aprovado.'
);

return;
}

for(
const item of res
){

const chave=
`${item.jogo.liga}_${item.jogo.id}_HT`;

const existe=
historicoDia.enviados.some(
a=>
String(a.id)===
String(item.jogo.id)&&
a.liga===
item.jogo.liga
);

if(
enviados.has(chave)||
existe
)
continue;

if(
await enviarTelegram(
item.jogo,
item.analise,
item.raio
)
){

enviados.set(
chave,
Date.now()
);

}
}

}catch(e){

console.log(
'❌ Radar:',
e.message
);
}
}

async function verificarResultado(
alerta
){

try{

const summary=
await getJson(
`https://site.api.espn.com/apis/site/v2/sports/soccer/${alerta.liga}/summary?event=${alerta.id}`
);

const comp=
summary?.header
?.competitions?.[0];

if(!comp)
return null;

const status=
comp?.status?.type?.name||
'';

const encerrado=[
'STATUS_FINAL',
'STATUS_FULL_TIME',
'STATUS_FINAL_PEN'
].includes(status);

if(!encerrado)
return null;

const casa=
comp.competitors?.find(
c=>c.homeAway==='home'
);

const fora=
comp.competitors?.find(
c=>c.homeAway==='away'
);

if(!casa||!fora)
return null;

const golsCasaFinal=
numero(casa.score);

const golsForaFinal=
numero(fora.score);

const golsAlerta=
alerta.golsCasaAlerta+
alerta.golsForaAlerta;

const golsFinal=
golsCasaFinal+
golsForaFinal;

return{

green:
golsFinal>golsAlerta,

golsCasaFinal,
golsForaFinal
};

}catch(e){

console.log(
`❌ Erro verificando ${alerta.casa} x ${alerta.fora}: ${e.message}`
);

return null;
}
}

async function enviarRelatorio2350(){

if(relatorioEmExecucao)
return;

relatorioEmExecucao=true;

try{

await garantirNovoDia();

if(
historicoDia.relatorioEnviado
)
return;

console.log(
'📊 INICIANDO RELATÓRIO 23:50...'
);

let green=0;
let red=0;
let pendentes=0;

for(
const alerta of
historicoDia.enviados
){

if(
alerta.status!=='pendente'
){

if(alerta.status==='green')
green++;

if(alerta.status==='red')
red++;

continue;
}

const resultado=
await verificarResultado(
alerta
);

if(!resultado){

pendentes++;

continue;
}

if(resultado.green){

alerta.status='green';

alerta.golsCasaFinal=
resultado.golsCasaFinal;

alerta.golsForaFinal=
resultado.golsForaFinal;

green++;

}else{

alerta.status='red';

alerta.golsCasaFinal=
resultado.golsCasaFinal;

alerta.golsForaFinal=
resultado.golsForaFinal;

red++;
}

await sleep(300);
}

historicoDia.green=green;
historicoDia.red=red;
historicoDia.pendentes=pendentes;

const totalFinalizados=
green+red;

const percentual=
totalFinalizados>0
?(
green/
totalFinalizados*
100
).toFixed(1)
:'0.0';

const totalAlertas=
historicoDia.enviados.length;

const msg=
`📊 RELATÓRIO GOL 2T — V34.6

📅 ${historicoDia.data}
⏰ Fechamento: 23:50

📨 Alertas enviados: ${totalAlertas}

🟢 GREEN: ${green}
🔴 RED: ${red}
⏳ Pendentes: ${pendentes}

📈 Aproveitamento:
${percentual}% de GREEN

🎯 Critério:
GREEN = pelo menos 1 gol após o alerta.

🤖 ROBÔ V34.6
60% POSSE + PRESSÃO`;

if(
TELEGRAM_TOKEN&&
CHAT_ID
){

await enviarTelegramTexto(msg);

historicoDia.relatorioEnviado=true;

await salvarHistorico();

console.log(
'📊 Relatório 23:50 enviado!'
);

}else{

console.log(msg);

historicoDia.relatorioEnviado=true;

await salvarHistorico();

}

}catch(e){

totalErros++;

console.log(
'❌ Relatório:',
e.message
);

}finally{

relatorioEmExecucao=false;

}
}

function verificarHorarioRelatorio(){

const{
hora,
minuto
}=horaBrasilia();

if(
hora===23&&
minuto===50&&
!historicoDia.relatorioEnviado
){

enviarRelatorio2350()
.catch(e=>{
console.log(
'❌ Relatório:',
e.message
);
});

}
}

const server=
http.createServer(
async(req,res)=>{

await garantirNovoDia();

res.writeHead(
200,
{
'Content-Type':
'application/json; charset=utf-8'
}
);

res.end(
JSON.stringify(
{

status:'online',

robo:
'V34.6 60% POSSE PRESSAO',

ultimoScan,

aprovados:
totalAprovados,

enviados:
totalEnviados,

erros:
totalErros,

redis:
REDIS_ATIVO,

relatorio2350:{

data:
historicoDia.data,

alertas:
historicoDia.enviados.length,

green:
historicoDia.green,

red:
historicoDia.red,

pendentes:
historicoDia.pendentes,

enviado:
historicoDia.relatorioEnviado

},

filtros:FILTROS

},
null,
2
)
);

}
);

server.listen(
PORT,
async()=>{

console.log(
`🚀 V34.6 ONLINE — porta ${PORT}`
);

if(REDIS_ATIVO){

console.log(
'🟢 UPSTASH REDIS CONFIGURADO'
);

}else{

console.log(
'⚠️ UPSTASH REDIS NÃO CONFIGURADO'
);

}

await carregarHistorico();

executarRadar();

setInterval(
executarRadar,
60000
);

setInterval(
verificarHorarioRelatorio,
30000
);

}
);
