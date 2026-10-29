// Výpis průběhu zápasu 1 člověk (stojí) vs bot, vzorek 1× za s (env EVERY=ticků, PORT). Spuštění: node test/bot-trace.mjs [sekund]
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';

// Testy píšou do dočasné DB (podle portu → paralelní běhy se nepřetahují), ne do flathockey.db
const TEST_DB = join(tmpdir(), `fh-test-${+process.env.PORT || 0}.db`);
const PORT = +process.env.PORT || 3997, BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB }, stdio: 'pipe' });
await new Promise(r => server.stdout.on('data', d => String(d).includes('listening') && r()));
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto(BASE + '/api/season'); await page.addScriptTag({ url: BASE + '/socket.io/socket.io.js' });
await page.evaluate((EVERY) => { window.s = io(); window.log = []; window.EVERY = EVERY; s.on('snap', d => { if (d.n % EVERY) return;
  const b = d.players.find(p => p.id.startsWith('bot:')); const h = d.players.find(p => !p.id.startsWith('bot:')); log.push([d.n, b.x|0, b.y|0, b.hp, b.ch, d.puck.x|0, d.puck.y|0, d.gr.x|0, d.gr.y|0, d.lock, d.score.away, d.gl.x|0, d.gl.y|0, d.gl.h, d.puck.z|0, h.x|0, h.y|0, h.hp]); });
  s.emit('lobby:create', { settings: { minutes: 5, periods: 1 }, profile: { name: 'A' } }); }, +process.env.EVERY || 60);
await new Promise(r => setTimeout(r, 300)); await page.evaluate(() => s.emit('lobby:start'));
await new Promise(r => setTimeout(r, (+process.argv[2] || 40) * 1000));
const log = await page.evaluate(() => log);
console.log('tick botX botY hp charge puckX puckY goalieRx goalieRy lock score glX glY glHold puckZ humX humY humHp');
for (const l of log) console.log(l.join(' '));
await browser.close(); server.kill();
