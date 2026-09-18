const http=require('http');

const PORT=process.env.PORT||3000;

const TELEGRAM_TOKEN=
process.env.TELEGRAM_TOKEN||
process.env.TOKEN||
'';

const CHAT_ID=
process.env.CHAT_ID||
process.env.TELEGRAM_CHAT_ID||
'';

const REDIS_URL=
process.env.UPSTASH_REDIS_REST_URL||
'';

const REDIS_TOKEN=
process.env.UPSTASH_REDIS_REST_TOKEN||
'';

const REDIS_ATIVO=!!(
REDIS_URL&&
REDIS_TOKEN
);

const LIGAS_PERMITIDAS=[
'bra.1',
'bra.2',
'por.1',
'eng.1',
'esp.1',
'ger.1',
'ita.1',
'fra.1',
'ned.1',
'bel.1',
'tur.1',
'sco.1',
'conmebol.libertadores',
'conmebol.sudamericana',
'usa.1',
'mex.1',
'arg.1',
'uefa.champions',
'uefa.europa'
];

const FILTROS={
max_diferenca_gols:2,
min_chutes_gol_time_precisa:2,
min_total_chutes_jogo:8,
minuto_minimo:40,
minuto_maximo:65,
posse_minima_pressao:75,
min_pressao_score:6
};

let ultimoScan=null;
let totalAprovados=0;
let totalEnviados=0;
let totalErros=0;
let relatorioEmExecucao=false;

const enviados=new Map();

const sleep=ms=>
new Promise(r=>setTimeout(r,ms));

function dataBrasilia(){

return new Intl.DateTimeFormat(
'pt-BR',
{
timeZone:'America/Sao_Paulo',
year:'numeric',
month:'2-digit',
day:'2-digit'
}
).format(new Date());

}

function horaBrasilia(){

const p=
new Intl.DateTimeFormat(
'en-US',
{
timeZone:'America/Sao_Paulo',
hour:'2-digit',
minute:'2-digit',
hour12:false
}
).formatToParts(new Date());

return{
hora:Number(
p.find(x=>x.type==='hour')?.value||0
),
minuto:Number(
p.find(x=>x.type==='minute')?.value||0
)
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

return `gol2t:v35:historico:${data}`;

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

if(!r.ok){
throw new Error(`HTTP ${r.status}`);
}

const d=await r.json();

return d.result??null;

}catch(e){

console.log(
'⚠️ Redis GET:',
e.message
);

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

if(!r.ok){
throw new Error(`HTTP ${r.status}`);
}

const d=await r.json();

return d.result==='OK';

}catch(e){

console.log(
'⚠️ Redis SET:',
e.message
);

return false;

}

}

async function salvarHistorico(){

if(!REDIS_ATIVO)return;

await redisSet(
chaveHistorico(historicoDia.data),
JSON.stringify(historicoDia)
);

}

function reconstruirMapa(){

enviados.clear();

for(
const a of historicoDia.enviados
){

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

console.log(
'⚠️ Redis não configurado'
);

return;

}

const salvo=
await redisGet(
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
relatorioEnviado:
!!d.relatorioEnviado
};

reconstruirMapa();

console.log(
`🟢 Histórico recuperado: ${d.enviados.length} entradas`
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

if(
historicoDia.data!==hoje
){

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
()=>{
c.abort();
},
8000
);

try{

const r=await fetch(
url,
{
headers:{
'User-Agent':
'Mozilla/5.0'
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

const n=
parseFloat(
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

for(
const nome of nomes
){

const s=S.find(
x=>
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

const id=String(
b?.team?.id||''
);

let lado=
i===0
?'home'
:'away';

const comp=
s?.header?.competitions?.[0]
?.competitors
?.find(
x=>String(x.team?.id)===id
);

if(comp){
lado=comp.homeAway;
}

const S=
b?.statistics||[];

const ch=
pegaStat(
S,
[
'totalShots',
'shots'
]
)??0;

const al=
pegaStat(
S,
[
'shotsOnTarget',
'shotsOnGoal'
]
)??0;

const po=
pegaStat(
S,
[
'possessionPct',
'possession'
]
)??0;

const es=
pegaStat(
S,
[
'wonCorners',
'cornerKicks'
]
)??0;

const am=
pegaStat(
S,
[
'yellowCards'
]
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
r.tem
  async function enviarTelegramTexto(msg){

if(
!TELEGRAM_TOKEN||
!CHAT_ID
)return false;

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

if(!d.ok){

throw new Error(
d.description||
'Telegram recusou'
);

}

return true;

}

async function enviarTelegram(j,a,r){

const totalPosse=
r.posseCasa+
r.posseFora;

const pc=
totalPosse>0
?Math.round(
r.posseCasa/
totalPosse*
100
)
:50;

const pf=100-pc;

const linhaAP=
r.temAP
?
`⚠️ Ataques perigosos: ${r.apCasa??0} x ${r.apFora??0}`
:'';

const linhaCruz=
r.temCruz
?
`↗️ Cruzamentos: ${r.cruzCasa} x ${r.cruzFora}`
:'';

const msg=
`🚨 RAIO-X GOL 2T — V35

🏆 ${j.ligaNome||j.liga}

⚽ ${j.nome_casa} ${j.gols_casa} x ${j.gols_fora} ${j.nome_fora}

⏱️ Minuto: ${j.minuto}'
🎯 Entrada: GOL NO 2º TEMPO

🔥 Time que precisa do gol:
${a.timePrecisa}

🎯 Chutes no alvo: ${a.chutesPrecisa}
📊 Chutes totais: ${a.totalChutes}

📈 Posse:
${j.nome_casa}: ${pc}%
${j.nome_fora}: ${pf}%

${linhaAP}
${linhaCruz}

🚩 Escanteios:
${r.escCasa} x ${r.escFora}

🟨 Amarelos:
${r.amarelosCasa} x ${r.amarelosFora}

🔥 Score pressão:
${a.scorePressao.toFixed(1)}

📍 Zona:
${a.zonaPressao}

⏰ Entrada entre 40' e 65'

⚠️ Sinal estatístico — não é garantia de gol.`;

return enviarTelegramTexto(msg);

}

function obterEventoBase(ev,liga){

const comp=
ev?.competitions?.[0];

const competitors=
comp?.competitors||[];

const casa=
competitors.find(
x=>x.homeAway==='home'
)||
competitors[0];

const fora=
competitors.find(
x=>x.homeAway==='away'
)||
competitors[1];

if(!casa||!fora)
return null;

const golsCasa=
numero(
casa?.score?.displayValue??
casa?.score?.value??
0
);

const golsFora=
numero(
fora?.score?.displayValue??
fora?.score?.value??
0
);

let minuto=0;

if(
ev?.status?.type?.shortDetail
){

const texto=
ev.status.type.shortDetail;

const m=
texto.match(
/(\d+)(?:\+(\d+))?'/
);

if(m){

minuto=
Number(m[1]);

}

}

if(
!minuto&&
ev?.status?.displayClock
){

const partes=
String(
ev.status.displayClock
).split(':');

if(
partes.length>=2
){

minuto=
Math.floor(
Number(partes[0])+
Number(partes[1])/60
);

}

}

const status=
ev?.status?.type;

if(
status?.state==='post'||
status?.completed===true||
status?.name==='STATUS_FINAL'
){

return null;

}

return{

id:String(ev.id),

liga,

ligaNome:
ev?.league?.name||
ev?.competitions?.[0]
?.league?.name||
liga,

nome_casa:
casa?.team?.displayName||
casa?.team?.name||
'Casa',

nome_fora:
fora?.team?.displayName||
fora?.team?.name||
'Fora',

gols_casa:golsCasa,
gols_fora:golsFora,

chutes_casa:0,
chutes_fora:0,

minuto

};

}

async function buscarJogosLiga(liga){

try{

const url=
`https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard`;

const s=
await getJson(url);

return Array.isArray(s?.events)
?s.events
:[];

}catch(e){

console.log(
`⚠️ Scoreboard ${liga}:`,
e.message
);

return[];

}

}

function eventoJaEnviado(
liga,
id
){

return enviados.has(
`${liga}_${id}_HT`
);

}

async function registrarEntrada(
j,
a,
r
){

await garantirNovoDia();

const chave=
`${j.liga}_${j.id}_HT`;

if(
enviados.has(chave)
)return false;

const entrada={

id:String(j.id),

liga:j.liga,

ligaNome:j.ligaNome,

nome_casa:j.nome_casa,

nome_fora:j.nome_fora,

gols_casa:j.gols_casa,

gols_fora:j.gols_fora,

minuto:j.minuto,

timePrecisa:a.timePrecisa,

chutesPrecisa:a.chutesPrecisa,

totalChutes:a.totalChutes,

possePct:a.possePct,

scorePressao:a.scorePressao,

zonaPressao:a.zonaPressao,

data:historicoDia.data,

hora:
new Intl.DateTimeFormat(
'pt-BR',
{
timeZone:'America/Sao_Paulo',
hour:'2-digit',
minute:'2-digit',
hour12:false
}
).format(new Date()),

status:'PENDENTE',

placar_final:null

};

historicoDia.enviados.push(
entrada
);

enviados.set(
chave,
Date.now()
);

totalEnviados++;

await salvarHistorico();

console.log(
`📌 Entrada registrada: ${j.nome_casa} x ${j.nome_fora}`
);

return true;

}

async function atualizarResultados(){

await garantirNovoDia();

const pendentes=
historicoDia.enviados.filter(
a=>
a&&
a.status==='PENDENTE'
);

if(!pendentes.length)
return;

for(
const a of pendentes
){

try{

const eventos=
await buscarJogosLiga(
a.liga
);

const ev=
eventos.find(
x=>
String(x.id)===
String(a.id)
);

if(!ev)
continue;

const comp=
ev?.competitions?.[0];

const competitors=
comp?.competitors||[];

const casa=
competitors.find(
x=>x.homeAway==='home'
)||
competitors[0];

const fora=
competitors.find(
x=>x.homeAway==='away'
)||
competitors[1];

if(!casa||!fora)
continue;

const status=
ev?.status?.type;

const finalizado=
status?.state==='post'||
status?.completed===true||
status?.name==='STATUS_FINAL';

if(!finalizado)
continue;

const gc=
numero(
casa?.score?.displayValue??
casa?.score?.value??
0
);

const gf=
numero(
fora?.score?.displayValue??
fora?.score?.value??
0
);

a.placar_final=
`${gc} x ${gf}`;

const totalAtual=
Number(a.gols_casa)+
Number(a.gols_fora);

if(
gc+gf>
totalAtual
){

a.status='GREEN';

historicoDia.green++;

}else{

a.status='RED';

historicoDia.red++;

}

await salvarHistorico();

console.log(
`📊 Resultado ${a.nome_casa} x ${a.nome_fora}: ${a.status}`
);

await sleep(300);

}catch(e){

console.log(
`⚠️ Resultado ${a.id}:`,
e.message
);

}

}

}

function contarPendentes(){

return historicoDia.enviados.filter(
a=>
a?.status==='PENDENTE'
).length;

}

async function enviarRelatorio2350(){

if(relatorioEmExecucao)
return;

await garantirNovoDia();

const h=horaBrasilia();

if(
h.hora!==23||
h.minuto!==50
)return;

if(
historicoDia.relatorioEnviado
)return;

relatorioEmExecucao=true;

try{

console.log(
'📊 Preparando relatório das 23:50...'
);

await atualizarResultados();

const lista=
Array.isArray(
historicoDia.enviados
)
?historicoDia.enviados
:[];

const total=lista.length;

const greens=
lista.filter(
a=>a?.status==='GREEN'
).length;

const reds=
lista.filter(
a=>a?.status==='RED'
).length;

const pendentes=
lista.filter(
a=>a?.status==='PENDENTE'
).length;

historicoDia.green=greens;
historicoDia.red=reds;
historicoDia.pendentes=
pendentes;

const taxa=
greens+reds>0
?
(
greens/
(greens+reds)*
100
).toFixed(1)
:'0.0';

let detalhes='';

if(total>0){

detalhes=
lista.map(
(a,i)=>
`${i+1}. ${a.nome_casa} ${a.gols_casa} x ${a.gols_fora} ${a.nome_fora} — ${a.status}${a.placar_final?` (${a.placar_final})`:''}`
).join('\n');

}else{

detalhes=
'Nenhuma entrada enviada hoje.';

}

const msg=
`📊 RELATÓRIO GOL 2T — V35

📅 ${historicoDia.data}

📨 Quantas mandou: ${total}

🟢 Green: ${greens}
🔴 Red: ${reds}
🟡 Pendentes: ${pendentes}

📈 Aproveitamento:
${taxa}% de Green entre as entradas com resultado

━━━━━━━━━━━━━━

📋 ENTRADAS DO DIA

${detalhes}

━━━━━━━━━━━━━━

⏰ Fechamento: 23:50
🇧🇷 Horário de Brasília`;

await enviarTelegramTexto(msg);

historicoDia.relatorioEnviado=true;

await salvarHistorico();

console.log(
`✅ Relatório enviado: ${total} entradas`
);

}catch(e){

totalErros++;

console.log(
'❌ Erro relatório:',
e.message
);

}finally{

relatorioEmExecucao=false;

}

}
  async function analisarJogos(){

try{

await garantirNovoDia();

const agora=
horaBrasilia();

if(
agora.hora<8||
(
agora.hora===8&&
agora.minuto<0
)
){

return;

}

if(
agora.hora>23||
(
agora.hora===23&&
agora.minuto>=50
)
){

return;

}

for(
const liga of LIGAS_PERMITIDAS
){

let eventos=[];

try{

eventos=
await buscarJogosLiga(liga);

}catch(e){

continue;

}

for(
const ev of eventos
){

try{

const j=
obterEventoBase(
ev,
liga
);

if(!j)
continue;

if(
j.minuto<
FILTROS.minuto_minimo||
j.minuto>
FILTROS.minuto_maximo
){

continue;

}

if(
eventoJaEnviado(
liga,
j.id
)
){

continue;

}

const r=
await buscarRaioXCompleto(
liga,
j.id
);

j.chutes_casa=
r.chutesCasa;

j.chutes_fora=
r.chutesFora;

const analise=
checaJogo(
j,
r
);

if(!analise.aprovado)
continue;

totalAprovados++;

const enviado=
await enviarTelegram(
j,
analise,
r
);

if(enviado){

await registrarEntrada(
j,
analise,
r
);

console.log(
`🚨 ENVIADO: ${j.nome_casa} x ${j.nome_fora}`
);

await sleep(500);

}

}catch(e){

totalErros++;

console.log(
'⚠️ Erro analisando jogo:',
e.message
);

}

}

await sleep(150);

}

ultimoScan=
new Date().toISOString();

}catch(e){

totalErros++;

console.log(
'❌ Erro no scan:',
e.message
);

}

}

async function cicloPrincipal(){

try{

await garantirNovoDia();

const agora=
horaBrasilia();

console.log(
`🔎 Ciclo ${dataBrasilia()} ${String(agora.hora).padStart(2,'0')}:${String(agora.minuto).padStart(2,'0')} — entradas hoje: ${historicoDia.enviados.length}`
);

await atualizarResultados();

await enviarRelatorio2350();

await analisarJogos();

}catch(e){

totalErros++;

console.log(
'❌ Erro ciclo principal:',
e.message
);

}

}

const servidor=
http.createServer(
async(req,res)=>{

try{

if(req.url==='/'){

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

bot:'Gol 2T V35',

dataBrasilia:
dataBrasilia(),

horaBrasilia:
horaBrasilia(),

redis:
REDIS_ATIVO,

entradasHoje:
historicoDia.enviados.length,

green:
historicoDia.green,

red:
historicoDia.red,

pendentes:
contarPendentes(),

relatorio2350:
historicoDia.relatorioEnviado,

ultimoScan

},
null,
2
)
);

return;

}

if(req.url==='/teste'){

try{

const h=
horaBrasilia();

await enviarTelegramTexto(
`🟢 TESTE GOL 2T V35

Bot online.
Horário de Brasília: ${dataBrasilia()} ${String(h.hora).padStart(2,'0')}:${String(h.minuto).padStart(2,'0')}`
);

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
status:'ok',
mensagem:
'Teste enviado para o Telegram'
}
)
);

}catch(e){

res.writeHead(
500,
{
'Content-Type':
'application/json; charset=utf-8'
}
);

res.end(
JSON.stringify(
{
status:'erro',
mensagem:e.message
}
)
);

}

return;

}

res.writeHead(404);

res.end(
'Not found'
);

}catch(e){

res.writeHead(500);

res.end(
'Erro interno'
);

}

}
);

servidor.listen(
PORT,
()=>{

console.log(
'===================================='
);

console.log(
'🚀 ROBÔ GOL 2T — V35'
);

console.log(
'===================================='
);

console.log(
`🌐 Porta: ${PORT}`
);

console.log(
`🇧🇷 Data: ${dataBrasilia()}`
);

const h=
horaBrasilia();

console.log(
`⏰ Brasília: ${String(h.hora).padStart(2,'0')}:${String(h.minuto).padStart(2,'0')}`
);

console.log(
`📡 Redis: ${REDIS_ATIVO?'ATIVO':'DESATIVADO'}`
);

console.log(
`📨 Telegram: ${TELEGRAM_TOKEN&&CHAT_ID?'CONFIGURADO':'NÃO CONFIGURADO'}`
);

console.log(
`📊 Entradas de hoje: ${historicoDia.enviados.length}`
);

console.log(
'===================================='
);

}
);

let iniciando=false;

async function iniciar(){

if(iniciando)
return;

iniciando=true;

try{

await carregarHistorico();

console.log(
`📚 Histórico carregado: ${historicoDia.enviados.length} entradas`
);

}catch(e){

console.log(
'⚠️ Falha ao carregar histórico:',
e.message
);

}finally{

iniciando=false;

}

}

iniciar();

setInterval(
()=>{
cicloPrincipal().catch(
e=>
console.log(
'❌ Erro intervalo:',
e.message
)
);
},
30000
);

setInterval(
async()=>{
try{

await garantirNovoDia();

const h=
horaBrasilia();

if(
h.hora===23&&
h.minuto===50&&
!historicoDia.relatorioEnviado
){

await enviarRelatorio2350();

}

}catch(e){

console.log(
'❌ Erro relógio 23:50:',
e.message
);

}
},
5000
);

setInterval(
async()=>{
try{

await garantirNovoDia();

}catch(e){

console.log(
'⚠️ Erro virada do dia:',
e.message
);

}
},
60000
);
