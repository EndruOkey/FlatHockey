// Test zabezpečení serveru: rate limit (429), CSRF (403), 401 bez cookie, validace reconnect tokenu.
// Spuštění: npm run test:server
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

const PORT = +process.env.PORT || 4230;
const BASE = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `fh-hardening-${PORT}.db`);
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB, JWT_SECRET: 'test-secret' }, stdio: 'pipe' });
let log = ''; server.stderr.on('data', d => log += d); server.stdout.on('data', d => log += d);
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('listening') && res());
  server.on('exit', c => rej(new Error('server exit ' + c + '\n' + log)));
});

const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };
const T = { signal: AbortSignal.timeout(5000) };
const post = (headers) => fetch(BASE + '/api/store/buy', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"item_id":1}', signal: AbortSignal.timeout(5000) });

try {
  // CSRF: cizí origin / bez originu → 403
  check((await post({ origin: 'https://evil.example' })).status === 403, 'cross-origin buy -> 403');
  check((await post({})).status === 403, 'buy bez Origin/Referer -> 403');
  // Správný origin, bez cookie → 401 (ne hang)
  check((await post({ origin: BASE })).status === 401, 'same-origin unauth buy -> 401');
  // Rate limit buy: 10/min. Zatím padly 1 (same-origin) + 0 (403 jdou před limiterem) → pošli dalších 12
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await post({ origin: BASE })).status);
  check(codes.includes(429) && codes[0] === 401, `buy -> 429 po limitu (${codes.join(',')})`);
  // Rate limit čtení: /api/leaderboard 120/min
  let last = 0, first429 = -1;
  for (let i = 0; i < 125; i++) { last = (await fetch(BASE + '/api/leaderboard', T)).status; if (last === 429 && first429 < 0) first429 = i; }
  check(first429 === 120, `leaderboard 429 od 121. požadavku (první 429 na indexu ${first429})`);
  // Auth router limit 20/min
  let a429 = -1;
  for (let i = 0; i < 25; i++) { const r = await fetch(BASE + '/auth/me', T); if (r.status === 429 && a429 < 0) a429 = i; }
  check(a429 === 20, `/auth/me 429 od 21. požadavku (index ${a429})`);
  // /auth POST bez originu → 403
  check((await fetch(BASE + '/auth/profile', { method: 'POST', signal: AbortSignal.timeout(5000) })).status === 403, 'POST /auth/profile bez originu -> 403');

  // Reconnect token: handshake přes engine.io polling (bez klienta), pak zkontroluj metric_events (pid = rt)
  const connect = async (rt) => {
    const o = await (await fetch(`${BASE}/socket.io/?EIO=4&transport=polling`, T)).text();
    const sid = JSON.parse(o.slice(1)).sid;
    await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', body: '40' + JSON.stringify({ rt }), signal: AbortSignal.timeout(5000) });
    await new Promise(r => setTimeout(r, 300));
  };
  await connect('short');            // 5 znaků -> zahodit
  await connect('bad token!!!!');    // nepovolené znaky -> zahodit
  await connect('x'.repeat(65));     // příliš dlouhý -> zahodit (dřív by se useknul na 64)
  await connect('goodToken_123-abc');
  const { default: Database } = await import('better-sqlite3');
  const pids = new Database(DB, { readonly: true }).prepare("SELECT DISTINCT pid FROM metric_events WHERE type='visit'").all().map(r => r.pid);
  check(pids.length === 1 && pids[0] === 'goodToken_123-abc', 'bad rt zahozen, platný přijat: ' + JSON.stringify(pids));
} catch (e) { check(false, 'výjimka: ' + e.message); }

server.kill();
try { rmSync(DB, { force: true }); } catch {}
if (fails.length) { console.log(`\n${fails.length} selhalo\n` + log.slice(-500)); process.exit(1); }
console.log('\nvše OK');
