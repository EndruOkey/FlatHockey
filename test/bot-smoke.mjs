// Smoke test botů: spustí server, 1 člověk (stojí) vs bot → bot musí sebrat puk a dát gól,
// připojený druhý člověk nahradí bota, po jeho odchodu se bot vrátí.
// Spuštění: npm run test:bot
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';

// Testy píšou do dočasné DB (podle portu → paralelní běhy se nepřetahují), ne do flathockey.db
const TEST_DB = join(tmpdir(), `fh-test-${+process.env.PORT || 0}.db`);

const PORT = +process.env.PORT || 3998;
const BASE = `http://localhost:${PORT}`;
const GOAL_TIMEOUT_S = 60;   // wall-clock; reálná smyčka se pod zátěží CI občas time-dilatuje → retry níž.
                             // Že bot spolehlivě skóruje je deterministicky ověřeno v test:bot-quality (1v1 10/10).

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB }, stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('listening') && res());
  server.on('exit', c => rej(new Error('server exit ' + c)));
});

const browser = await chromium.launch();
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// Klient = stránka se socket.io klientem ze serveru (bez UI hry)
async function client() {
  const page = await browser.newPage();
  await page.goto(BASE + '/api/season');                       // stejný origin jako server
  await page.addScriptTag({ url: BASE + '/socket.io/socket.io.js' });
  await page.evaluate(() => {
    window.s = io();
    window.last = null; window.botTouch = 0;
    window.s.on('snap', d => {
      window.last = d;
      if (d.players.some(p => p.id.startsWith('bot:') && p.hp)) window.botTouch++;
    });
  });
  return page;
}
const snap = (pg) => pg.evaluate(() => window.last && {
  bots: window.last.players.filter(p => p.id.startsWith('bot:')).map(p => p.team),
  n: window.last.players.length, score: window.last.score, botTouch: window.botTouch,
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const a = await client();
  await a.evaluate(() => { s.emit('lobby:create', { settings: { minutes: 5, periods: 1 }, profile: { name: 'A' } }); });
  await wait(300);
  await a.evaluate(() => s.emit('lobby:start'));
  await wait(1500);
  let st = await snap(a);
  check(st && st.n === 2 && st.bots.join() === 'away', `1 člověk → 1 bot v týmu away (${JSON.stringify(st?.bots)})`);

  // Čekej na gól; při nule retry 1× novým zápasem (reálná smyčka se pod zátěží CI občas time-dilatuje,
  // takže se za 60 s wall-clock odehraje málo herních ticků — není to regrese, viz deterministický bot-quality).
  let scored = false, attempts = 0, t0 = Date.now();
  while (!scored && attempts < 2) {
    attempts++;
    if (attempts > 1) {
      await a.evaluate(() => s.emit('lobby:leave')); await wait(400);
      await a.evaluate(() => { s.emit('lobby:create', { settings: { minutes: 5, periods: 1 }, profile: { name: 'A' } }); }); await wait(300);
      await a.evaluate(() => s.emit('lobby:start')); await wait(1500);
    }
    t0 = Date.now();
    while (Date.now() - t0 < GOAL_TIMEOUT_S * 1000) {
      st = await snap(a);
      if (st.score.away > 0) { scored = true; break; }
      await wait(500);
    }
  }
  check(st.botTouch > 0, `bot sebral puk (${st.botTouch} snapshotů s pukem)`);
  check(scored, `bot dal gól do ${GOAL_TIMEOUT_S} s (pokusů ${attempts}, skóre ${st.score.home}:${st.score.away})`);

  const lobbyId = await a.evaluate(() => new Promise(r => { s.once('lobby:list', l => r(l[0]?.id)); s.emit('lobby:list'); }));
  const b = await client();
  await b.evaluate((id) => s.emit('lobby:join', { id, profile: { name: 'B' } }), lobbyId);
  await wait(800);
  st = await snap(a);
  check(st.n === 2 && st.bots.length === 0, `druhý člověk → bot zmizí (${st.n} hráčů, botů ${st.bots.length})`);

  await b.evaluate(() => s.emit('lobby:leave'));
  await wait(800);
  st = await snap(a);
  check(st.n === 2 && st.bots.length === 1, `člověk odešel → bot se vrátí (${st.n} hráčů, botů ${st.bots.length})`);
} finally {
  await browser.close();
  server.kill();
}
console.log(fails.length ? `\n${fails.length} FAIL` : '\nVŠE OK');
process.exit(fails.length ? 1 : 0);
