// Vlastnosti k účtu (2026-11-18): velikost, hůl, kosmetika karty, barvy dresu a vlastní sady se ukládají do DB s validací;
// host nese všechny informace jako účet (2026-11-18); žebříček vrací data karty a nevrací interní id.
// Spuštění: npm run test:profile   (DB jen v tmpdir)
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const PORT = +process.env.PORT || 4235, BASE = `http://localhost:${PORT}`, SECRET = 'test-secret';
const DB = join(tmpdir(), `fh-prof-${PORT}.db`);
for (const x of ['', '-wal', '-shm']) rmSync(DB + x, { force: true });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB, JWT_SECRET: SECRET }, stdio: 'pipe' });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 250)); }
try {
  check(up, 'server běží');
  const db = new Database(DB);
  const mk = (name, prov, pid) => {
    const id = db.prepare('INSERT INTO users (display_name) VALUES (?)').run(name).lastInsertRowid;
    db.prepare('INSERT INTO identities (user_id, provider, provider_id) VALUES (?, ?, ?)').run(id, prov, pid);
    db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(id);
    db.prepare('INSERT OR IGNORE INTO stats (user_id) VALUES (?)').run(id);
    return id;
  };
  const acc = mk('Karta', 'discord', 'd1'), guest = mk('Host', 'device', 'g1');
  db.prepare('UPDATE stats SET games_played = 12, wins = 7, goals = 30, assists = 4, rank_points = 1234 WHERE user_id = ?').run(acc);
  const tok = id => jwt.sign({ sub: id }, SECRET, { expiresIn: 600 });
  const post = (id, body) => fetch(BASE + '/auth/profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok(id) }, body: JSON.stringify(body) });
  const get = async id => (await fetch(BASE + '/auth/profile', { headers: { authorization: 'Bearer ' + tok(id) } })).json();

  const slots = [{ jersey: '#112233', stripe: '#ffffff', helmet: '#ffffff', gloves: '#000000' }, null, null];
  const r1 = await post(acc, { size: 2, stick_len: 0, banner: 'red', card_title: 'scorer', avatar: 'num', jersey: '#1B4FD1', stripe: '#FFFFFF', shorts: '#0B1220', kit_slots: slots, number: 16 });
  check(r1.status === 200, 'účet: uložení 200');
  let p = await get(acc);
  check(p.size === 2 && p.stick_len === 0, `účet: velikost a hůl uložené (${p.size}, ${p.stick_len})`);
  check(p.banner === 'red' && p.card_title === 'scorer' && p.avatar === 'num', 'účet: banner, titul, profilovka uložené');
  check(p.jersey === '#1B4FD1' && p.stripe === '#FFFFFF' && p.shorts === '#0B1220', 'účet: barvy dresu uložené');
  check(JSON.stringify(JSON.parse(p.kit_slots)) === JSON.stringify(slots), 'účet: vlastní sady uložené');

  await post(acc, { size: 7, stick_len: '1', banner: '<b>x', avatar: 'evil', jersey: 'red;x', kit_slots: 'x'.repeat(10) });
  p = await get(acc);
  check(p.size === 2 && p.stick_len === 0 && p.banner === 'red' && p.avatar === 'num' && p.jersey === '#1B4FD1' && p.kit_slots.startsWith('['), 'neplatné hodnoty odmítnuté (beze změny)');
  await post(acc, { kit_slots: new Array(4).fill(slots[0]) });
  check(JSON.parse((await get(acc)).kit_slots).length === 3, 'víc než 3 sady odmítnuto');

  await post(guest, { size: 0, stick_len: 2, banner: 'ice', jersey: '#ff0000', number: 5 });
  const g = await get(guest);
  check(g.size === 0 && g.stick_len === 2 && g.banner === 'ice', 'host: herní volby a kosmetika karty uložené');
  check(g.jersey === '#ff0000' && g.number === 5, 'host: vzhled dresu i číslo uložené (nese vše jako účet)');

  const lb = await (await fetch(BASE + '/api/leaderboard')).json();
  const row = lb.find(r => r.display_name === 'Karta');
  check(!!row && row.size === 2 && row.stick_len === 0 && row.banner === 'red' && row.jersey === '#1B4FD1' && row.number === 16, 'žebříček: řádek nese data karty');
  check(!!row && !('uid' in row) && !('user_id' in row) && !('kit_slots' in row), 'žebříček: bez interního id a vlastních sad');
  check(!lb.some(r => r.display_name === 'Host'), 'žebříček: host není');
  db.close();
} finally { const ex = new Promise(r => server.once('exit', r)); server.kill(); await ex; }
console.log(fails.length ? `NEPROŠLO ${fails.length}` : 'VŠE OK');
process.exitCode = fails.length ? 1 : 0;   // bez process.exit (Windows: assert v libuv při tvrdém ukončení)
