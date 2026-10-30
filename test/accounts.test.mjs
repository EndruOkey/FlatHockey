// Test účtů: hostující účet (device token), identity, merge s Discordem, link kód, Bearer vs cookie CSRF.
// Spuštění: npm run test:accounts   (PORT=419x, DB jen v tmpdir, nikdy flathockey.db)
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const PORT = +process.env.PORT || 4195;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'test-secret';
const DB_A = join(tmpdir(), `fh-acc-a-${PORT}.db`);   // přímé testy db.js (+ starý schéma = migrace)
const DB_S = join(tmpdir(), `fh-acc-s-${PORT}.db`);   // DB serveru
for (const f of [DB_A, DB_S]) for (const x of ['', '-wal', '-shm']) rmSync(f + x, { force: true });

const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };
const T = () => ({ signal: AbortSignal.timeout(5000) });

// ── A) Migrace ze starého schématu (bez identities) ─────────────────────────
{
  const old = new Database(DB_A);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT UNIQUE, email TEXT UNIQUE,
      display_name TEXT NOT NULL, avatar_url TEXT, is_sponsor INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    INSERT INTO users (discord_id, display_name) VALUES ('111', 'Stary Hrac');
    INSERT INTO users (email, display_name) VALUES ('a@b.cz', 'Mailer');
  `);
  old.close();
}
process.env.DB_PATH = DB_A;
process.env.JWT_SECRET = SECRET;
const D = await import('../db.js');
const A = await import('../auth.js');
const db = D.default;

check(D.getUserIdByIdentity('discord', '111') === 1, 'migrace: stará discord_id -> identities');
check(D.getUserIdByIdentity('email', 'a@b.cz') === 2, 'migrace: email -> identities');
const idCount = () => db.prepare('SELECT COUNT(*) n FROM identities').get().n;
const n0 = idCount();
const r2 = spawnSync(process.execPath, ['-e', "import('./db.js').then(()=>process.exit(0))"], { env: { ...process.env, DB_PATH: DB_A }, cwd: process.cwd() });
check(r2.status === 0 && idCount() === n0, `migrace idempotentní (druhý start, identit ${n0} -> ${idCount()})`);

// ── B) Hosté + merge ────────────────────────────────────────────────────────
db.prepare('INSERT OR IGNORE INTO stats (user_id) VALUES (1)').run();
db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (1)').run();
const setStats = (uid, s) => db.prepare(`UPDATE stats SET goals=?, assists=?, saves=?, games_played=?, wins=?, losses=?, rank_points=?, puck_credits=?, plus_minus=? WHERE user_id=?`)
  .run(s.goals, s.assists, s.saves, s.gp, s.wins, s.losses, s.rank, s.credits, s.pm, uid);
const st = (uid) => db.prepare('SELECT * FROM stats WHERE user_id=?').get(uid);

const g1 = D.createGuestUser('did-1');
check(db.prepare('SELECT discord_id FROM users WHERE id=?').get(g1).discord_id === null, 'host má discord_id NULL');
D.updateStats(g1, { goals: 3, assists: 1, saves: 2, games_played: 2, wins: 1, losses: 1 });
D.updateRankAndCredits(g1, { rankDelta: 50, creditsDelta: 40, plusMinusDelta: 2 });
setStats(1, { goals: 10, assists: 5, saves: 7, gp: 9, wins: 6, losses: 3, rank: 1020, credits: 100, pm: -1 });
db.prepare('INSERT INTO user_unlocks (user_id,item_id) VALUES (?,1),(?,2)').run(g1, g1);
db.prepare('INSERT INTO user_unlocks (user_id,item_id) VALUES (1,2),(1,3)').run();
db.prepare("UPDATE profiles SET helmet='#111111' WHERE user_id=1").run();
db.prepare("UPDATE profiles SET helmet='#222222', number=7 WHERE user_id=?").run(g1);
const bad = D.mergeUsers(g1, 999999);
check(!bad.ok && D.getUserById(g1) && st(g1).goals === 3, 'merge s neexistujícím cílem: nic se nezměnilo');
check(!D.mergeUsers(1, g1).ok && !D.mergeUsers(g1, g1).ok, 'merge odmítne discord zdroj i src===dst');
const mr = D.mergeUsers(g1, 1);
const s1 = st(1);
check(mr.ok && s1.goals === 13 && s1.assists === 6 && s1.saves === 9 && s1.games_played === 11 && s1.wins === 7 && s1.losses === 4 && s1.plus_minus === 1,
  'merge: goals/assists/saves/gp/wins/losses/plus_minus sečteny ' + JSON.stringify(s1));
check(s1.rank_points === 1050, `merge: rank_points = max (${s1.rank_points})`);
check(s1.puck_credits === 140, `merge: kredity sečteny (${s1.puck_credits})`);
check(JSON.stringify(D.getUserUnlocks(1)) === '[1,2,3]', 'merge: unlocks sjednocení ' + JSON.stringify(D.getUserUnlocks(1)));
check(D.getProfile(1).helmet === '#111111' && D.getProfile(1).number === 99, 'merge: profil Discord účtu zachován');
check(!D.getUserById(g1) && !db.prepare('SELECT 1 FROM stats WHERE user_id=?').get(g1), 'merge: řádek hosta smazán (vč. stats)');
check(D.getUserIdByIdentity('device', 'did-1') === 1, 'merge: device identita přepojena na Discord účet');

// loginDiscordUser: nový Discord + host -> identita přidána hostovi (bez merge)
const g2 = D.createGuestUser('did-2');
D.updateStats(g2, { goals: 4, games_played: 1 });
const uNew = D.loginDiscordUser({ discord_id: '222', display_name: 'Novy', avatar_url: null, is_sponsor: false }, g2);
check(uNew === g2 && D.getUserIdByIdentity('discord', '222') === g2 && st(g2).goals === 4 && !D.isGuestUser(g2), 'nový Discord + host: identita připojena, statistiky zůstaly');
// existující Discord + host -> merge
const g3 = D.createGuestUser('did-3');
D.updateStats(g3, { goals: 2, games_played: 1 });
const uEx = D.loginDiscordUser({ discord_id: '111', display_name: 'Stary Hrac', avatar_url: null, is_sponsor: false }, g3);
check(uEx === 1 && st(1).goals === 15 && !D.getUserById(g3) && D.getUserIdByIdentity('device', 'did-3') === 1, 'existující Discord + host: sloučeno');
// bez hosta / s neplatným hostem
check(D.loginDiscordUser({ discord_id: '111', display_name: 'X', avatar_url: null, is_sponsor: false }, null) === 1, 'Discord login bez hosta beze změny');
check(D.loginDiscordUser({ discord_id: '333', display_name: 'Z', avatar_url: null, is_sponsor: false }, 424242) > 0, 'neexistující host se ignoruje');

// ── C) OAuth state podpis ───────────────────────────────────────────────────
{
  const s = A.signOAuthState('nonce1', 42);
  const v = A.verifyOAuthState(s);
  check(v?.nonce === 'nonce1' && v.guestId === 42, 'state: platný podpis projde');
  const [d, m] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ n: 'nonce1', g: 99, x: Date.now() + 1e6 })).toString('base64url') + '.' + m;
  check(A.verifyOAuthState(forged) === null, 'state: změněný payload (cizí host) zamítnut');
  check(A.verifyOAuthState(d + '.' + m.slice(0, -2) + 'AA') === null, 'state: změněný podpis zamítnut');
  check(A.verifyOAuthState(A.signOAuthState('n', 1, Date.now() - 1)) === null, 'state: prošlý zamítnut');
  check(A.verifyOAuthState('junk') === null && A.verifyOAuthState(undefined) === null && A.verifyOAuthState(s + '.x') === null, 'state: nesmysly zamítnuty');
}

// ── D) Link kódy (db) ───────────────────────────────────────────────────────
{
  const g = D.createGuestUser('did-L');
  D.updateStats(g, { goals: 1, games_played: 1 });
  const now = 1_000_000;
  const { code, expires_at } = D.createLinkCode(g, now);
  check(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/.test(code) && expires_at === now + 600, 'kód: formát XXX-XXX bez nejednoznačných znaků, TTL 600 s ' + code);
  check(D.redeemLinkCode(code, 1, now + 601).error === 'invalid_code', 'kód: po 10 min vyprší');
  const c2 = D.createLinkCode(g, now).code;
  check(D.redeemLinkCode(c2, g, now + 1).error === 'discord_required', 'kód: cíl bez Discordu zamítnut');
  const ok = D.redeemLinkCode(c2.toLowerCase().replace('-', ' '), 1, now + 5);
  check(ok.ok && !D.getUserById(g), 'kód: redeem sloučí (normalizace malá písmena/mezera)');
  check(D.redeemLinkCode(c2, 1, now + 6).error === 'invalid_code', 'kód: jednorázový');
  const c3 = D.createLinkCode(1, now).code;
  check(D.redeemLinkCode(c3, 1, now + 1).error === 'same_account', 'kód: vlastní účet zamítnut');
}

// ── E) Server (HTTP + socket handshake) ─────────────────────────────────────
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB_S, JWT_SECRET: SECRET }, stdio: 'pipe' });
let log = ''; server.stderr.on('data', d => log += d); server.stdout.on('data', d => log += d);
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('listening') && res());
  server.on('exit', c => rej(new Error('server exit ' + c + '\n' + log)));
});
const S = new Database(DB_S);
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const api = (path, { token, cookie, origin, method = 'GET', body } = {}) => fetch(BASE + path, {
  method, signal: AbortSignal.timeout(5000),
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(cookie ? { cookie: 'fh_session=' + cookie } : {}),
    ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
// Socket.io handshake bez klienta (engine.io polling); vrací token z události device_token (nebo null)
async function connect(auth, origin) {
  const h = origin ? { origin } : {};
  const o = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling`, { headers: h, ...T() });
  const sid = JSON.parse((await o.text()).slice(1)).sid;
  await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', headers: h, body: '40' + JSON.stringify(auth), ...T() });
  let got = '';
  for (let i = 0; i < 3 && !got.includes('device_token'); i++) {
    const r = await fetch(`${BASE}/socket.io/?EIO=4&transport=polling&sid=${sid}&t=${i}`, { headers: h, signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (!r) break;
    got += await r.text();
    if (got.includes('device_token')) break;
    if (i === 0 && got.includes('"data"')) break;
  }
  const m = /"device_token",\{"token":"([^"]+)"/.exec(got);
  return { token: m ? m[1] : null, acao: o.headers.get('access-control-allow-origin') };
}
const usersCount = () => S.prepare('SELECT COUNT(*) n FROM users').get().n;

try {
  const c1 = await connect({ rt: 'recon-token-aaaa1' });
  check(!!c1.token, 'host: první connect bez tokenu vydá device_token');
  const me1 = await j(await api('/auth/me', { token: c1.token }));
  check(me1.status === 200 && me1.body.kind === 'guest', 'host: /auth/me přes Bearer -> kind guest (' + JSON.stringify(me1.body) + ')');
  const u0 = usersCount();
  const c2 = await connect({ rt: 'recon-token-aaaa1', token: c1.token });
  check(c2.token === null && usersCount() === u0, 'host: reconnect s tokenem nevytváří nového hosta');
  const c3 = await connect({ rt: 'recon-token-bbbb2', token: 'nesmysl' });
  check(!!c3.token && usersCount() === u0 + 1, 'host: neplatný token -> nový host');
  const guestId = me1.body.id;
  S.prepare('UPDATE stats SET goals=5, games_played=2, wins=1, rank_points=1100, puck_credits=30 WHERE user_id=?').run(guestId);
  const stats = await j(await api('/auth/stats', { token: c1.token }));
  const rank = await j(await api('/api/me/rank', { token: c1.token }));
  const cred = await j(await api('/api/me/credits', { token: c1.token }));
  check(stats.body?.goals === 5 && rank.body?.rank_points === 1100 && cred.body?.puck_credits === 30, 'host: stats/rank/credits čitelné přes Bearer');
  check((await api('/auth/me', { token: 'x.y.z' })).status === 401, 'neplatný Bearer -> 401');

  // CSRF: Bearer z cizího originu projde, cookie z cizího originu ne
  const prof = await j(await api('/auth/profile', { token: c1.token, origin: 'https://evil.example', method: 'POST', body: { number: 12, display_name: 'Ondra' } }));
  check(prof.status === 200, 'Bearer POST z cizího originu -> 200');
  check((await j(await api('/auth/me', { token: c1.token }))).body.display_name === 'Ondra', 'host: přezdívka z profilu uložena');
  // Discord účet v serverové DB + cookie
  const dId = Number(S.prepare("INSERT INTO users (discord_id, display_name) VALUES ('777','Disc')").run().lastInsertRowid);
  S.prepare('INSERT INTO identities (provider, provider_id, user_id) VALUES (?,?,?)').run('discord', '777', dId);
  S.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(dId);
  S.prepare('INSERT OR IGNORE INTO stats (user_id) VALUES (?)').run(dId);
  S.prepare('UPDATE stats SET goals=1, rank_points=1000, puck_credits=10 WHERE user_id=?').run(dId);
  const cookie = jwt.sign({ sub: dId }, SECRET, { expiresIn: 3600 });
  check((await api('/auth/profile', { cookie, origin: 'https://evil.example', method: 'POST', body: { number: 1 } })).status === 403, 'cookie POST z cizího originu -> 403');
  check((await api('/auth/profile', { cookie, method: 'POST', body: { number: 1 } })).status === 403, 'cookie POST bez originu -> 403');
  check((await api('/auth/profile', { cookie, origin: BASE, method: 'POST', body: { number: 1 } })).status === 200, 'cookie POST ze stejného originu -> 200');
  check((await j(await api('/auth/me', { cookie }))).body.kind === 'account', 'Discord účet: kind account');

  // OAuth start: dt ověřen a zapečen do state
  const loc = async (dt) => (await fetch(`${BASE}/auth/discord${dt ? '?dt=' + encodeURIComponent(dt) : ''}`, { redirect: 'manual', ...T() })).headers.get('location');
  const stateOf = (l) => new URL(l).searchParams.get('state');
  const withGuest = A.verifyOAuthState(stateOf(await loc(c1.token)));
  check(withGuest?.guestId === guestId, 'OAuth start: platný device token -> host v podepsaném state');
  const forgedTok = jwt.sign({ sub: guestId, kind: 'device', did: 'x' }, 'jiny-secret');
  check(A.verifyOAuthState(stateOf(await loc(forgedTok)))?.guestId === null, 'OAuth start: token cizím klíčem -> bez hosta');
  check(A.verifyOAuthState(stateOf(await loc(null)))?.guestId === null, 'OAuth start: bez tokenu -> bez hosta');
  const dcookieAsDt = jwt.sign({ sub: guestId }, SECRET);   // cookie-typ JWT jako dt nesmí propůjčit hosta
  check(A.verifyOAuthState(stateOf(await loc(dcookieAsDt)))?.guestId === null, 'OAuth start: ne-device JWT jako dt -> bez hosta');

  // CORS (itch/crazygames)
  const pre = await fetch(`${BASE}/api/link/code`, { method: 'OPTIONS', headers: { origin: 'https://abc.itch.zone', 'access-control-request-method': 'POST' }, ...T() });
  check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://abc.itch.zone', 'CORS preflight itch.zone povolen');
  const preBad = await fetch(`${BASE}/api/link/code`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' }, ...T() });
  check(!preBad.headers.get('access-control-allow-origin'), 'CORS cizí origin bez hlavičky');
  const sc = await connect({ rt: 'recon-token-cccc3', token: c1.token }, 'https://game.crazygames.com');
  check(sc.acao === 'https://game.crazygames.com', 'socket.io CORS crazygames.com povolen');

  // Link kód přes HTTP
  const codeRes = await j(await api('/api/link/code', { token: c1.token, origin: 'https://evil.example', method: 'POST' }));
  check(codeRes.status === 200 && /^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(codeRes.body.code), 'link/code přes Bearer z cizího originu -> kód ' + codeRes.body?.code);
  check((await api('/api/link/redeem', { token: c1.token, method: 'POST', origin: BASE, body: { code: codeRes.body.code } })).status === 403, 'redeem hostem (bez Discordu) -> 403');
  check((await api('/api/link/redeem', { cookie, method: 'POST', origin: 'https://evil.example', body: { code: codeRes.body.code } })).status === 403, 'redeem cookie z cizího originu -> 403 (CSRF)');
  check((await api('/api/link/redeem', { cookie, method: 'POST', origin: BASE, body: { code: 'ZZZ-ZZZ' } })).status === 400, 'redeem špatný kód -> 400');
  const red = await j(await api('/api/link/redeem', { cookie, method: 'POST', origin: BASE, body: { code: codeRes.body.code } }));
  check(red.status === 200 && red.body.ok, 'redeem Discord účtem -> 200');
  const after = await j(await api('/auth/me', { token: c1.token }));
  check(after.body.id === dId && after.body.kind === 'account', 'po redeem token zařízení ukazuje na Discord účet');
  const dst = S.prepare('SELECT * FROM stats WHERE user_id=?').get(dId);
  check(dst.goals === 6 && dst.puck_credits === 40 && dst.rank_points === 1100 && dst.games_played === 2, 'po redeem: statistiky sloučeny ' + JSON.stringify(dst));
  check(!S.prepare('SELECT 1 FROM users WHERE id=?').get(guestId), 'po redeem: host smazán');
  check((await api('/api/link/redeem', { cookie, method: 'POST', origin: BASE, body: { code: codeRes.body.code } })).status === 400, 'redeem podruhé -> 400 (jednorázový)');
  // Expirace přes HTTP
  const g9 = (await connect({ rt: 'recon-token-dddd4' })).token;
  const c9 = await j(await api('/api/link/code', { token: g9, method: 'POST' }));
  S.prepare('UPDATE link_codes SET expires_at = ? WHERE code = ?').run(Math.floor(Date.now() / 1000) - 1, c9.body.code);
  check((await api('/api/link/redeem', { cookie, method: 'POST', origin: BASE, body: { code: c9.body.code } })).status === 400, 'redeem prošlého kódu -> 400');
  // Rate limit /api/link/code: 5/min na IP; dosud 3 (c1, g9, OPTIONS z cizího originu)
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await api('/api/link/code', { token: g9, method: 'POST' })).status);
  check(codes.join() === '200,200,429,429', 'link/code rate limit 5/min (' + codes.join() + ')');
} catch (e) { check(false, 'výjimka: ' + e.stack); }

server.kill();
S.close();
for (const f of [DB_A, DB_S]) for (const x of ['', '-wal', '-shm']) { try { rmSync(f + x, { force: true }); } catch {} }
if (fails.length) { console.log(`\n${fails.length} selhalo\n` + log.slice(-600)); process.exit(1); }
console.log('\nvše OK');
process.exit(0);
