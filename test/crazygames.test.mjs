// Test CrazyGames účtů: ověření JWT přes (lokální) JWKS, pravidla propojení, most wrapper<->hra v Playwrightu.
// Spuštění: npm run test:cg   (porty PORT..PORT+3: server, server pro Playwright, JWKS, wrapper; DB jen v tmpdir)
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync, readFileSync } from 'fs';
import http from 'http';
import Database from 'better-sqlite3';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 4306;
const P_SRV = PORT, P_PW = PORT + 1, P_JWKS = PORT + 2, P_WRAP = PORT + 3;
const SECRET = 'test-secret', GAME_ID = 'game-1';
const DB_S = join(tmpdir(), `fh-cg-s-${PORT}.db`), DB_P = join(tmpdir(), `fh-cg-p-${PORT}.db`);
for (const f of [DB_S, DB_P]) for (const x of ['', '-wal', '-shm']) rmSync(f + x, { force: true });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// ── lokální JWKS + podepisování ──
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'ingame-auth', alg: 'RS256', use: 'sig' };
const jwksSrv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); }).listen(P_JWKS);
const sign = (claims, { key = privateKey, alg = 'RS256', exp = '1h', kid = 'ingame-auth' } = {}) =>
  new SignJWT({ gameId: GAME_ID, username: 'Karel', ...claims }).setProtectedHeader({ alg, kid }).setIssuedAt().setExpirationTime(exp).sign(key);

const spawnServer = (port, db) => new Promise((res, rej) => {
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PORT: String(port), DB_PATH: db, JWT_SECRET: SECRET,
    CG_JWKS_URL: `http://localhost:${P_JWKS}/jwks.json`, CG_GAME_ID: GAME_ID, ALLOW_LOCAL_EMBED: '1' } });
  let log = ''; p.stderr.on('data', d => log += d); p.stdout.on('data', d => { log += d; if (String(d).includes('listening')) res(p); });
  p.on('exit', c => rej(new Error('server exit ' + c + '\n' + log)));
});

// in-process přístup ke stejné DB (hosté + hry)
process.env.DB_PATH = DB_S; process.env.JWT_SECRET = SECRET;
const D = await import('../db.js');
const A = await import('../auth.js');
const sdb = new Database(DB_S);
const procs = [];
let browser, wrap;
try {
  const srv = await spawnServer(P_SRV, DB_S); procs.push(srv);
  const BASE = `http://localhost:${P_SRV}`;
  const cg = (token, bearer) => fetch(BASE + '/auth/crazygames', { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', origin: BASE, ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify({ token }) });
  const uidOf = (deviceTok) => A.verifySession(deviceTok);
  const identities = (uid) => sdb.prepare('SELECT provider FROM identities WHERE user_id=? ORDER BY provider').all(uid).map(r => r.provider);

  // A) platný token, bez hosta -> nový účet
  let r = await cg(await sign({ userId: 'cg-1' }));
  let j = await r.json();
  const u1 = uidOf(j.token);
  check(r.status === 200 && u1 && D.getUserIdByIdentity('crazygames', 'cg-1') === u1 && j.created === true, 'platný token -> účet + crazygames identita');
  check(sdb.prepare('SELECT display_name FROM users WHERE id=?').get(u1).display_name === 'Karel', 'jméno z CG username');
  // B) stejné userId znovu -> stejný účet
  r = await cg(await sign({ userId: 'cg-1', username: 'Karel2' })); j = await r.json();
  check(r.status === 200 && uidOf(j.token) === u1 && sdb.prepare("SELECT COUNT(*) n FROM identities WHERE provider='crazygames'").get().n === 1, 'stejné userId -> stejný účet');
  // C) neplatné tokeny
  const bad = {
    'prošlý': await sign({ userId: 'cg-2' }, { exp: Math.floor(Date.now() / 1000) - 60 }),
    'špatný alg (RS384)': await sign({ userId: 'cg-2' }, { alg: 'RS384' }),
    'špatné gameId': await sign({ userId: 'cg-2', gameId: 'jina-hra' }),
    'cizí klíč': await sign({ userId: 'cg-2' }, { key: other.privateKey }),
    'bez userId': await new SignJWT({ gameId: GAME_ID }).setProtectedHeader({ alg: 'RS256', kid: 'ingame-auth' }).setExpirationTime('1h').sign(privateKey),
    'nesmysl': 'abc.def.ghi',
  };
  for (const [k, tok] of Object.entries(bad)) check((await cg(tok)).status === 401, `${k} -> 401`);
  check((await cg(undefined)).status === 401, 'bez tokenu -> 401');
  check(D.getUserIdByIdentity('crazygames', 'cg-2') === null, 'po neplatných tokenech žádný účet');
  // D) host s 0 hrami -> dostane CG identitu (stejné id)
  const g0 = A.createGuestAccount();
  r = await cg(await sign({ userId: 'cg-3', username: 'Nula' }), g0.token); j = await r.json();
  check(r.status === 200 && uidOf(j.token) === g0.userId && identities(g0.userId).join() === 'crazygames,device' && j.created === false, 'host s 0 hrami: CG identita přidána hostovi');
  // E) host s hrami -> nový účet, host nedotčen
  const g1 = A.createGuestAccount();
  D.updateStats(g1.userId, { goals: 2, games_played: 3, wins: 1 });
  r = await cg(await sign({ userId: 'cg-4', username: 'Hrac' }), g1.token); j = await r.json();
  const u4 = uidOf(j.token);
  check(r.status === 200 && u4 && u4 !== g1.userId && j.created === true, 'host s hrami: nový účet');
  check(D.getStats(g1.userId).games_played === 3 && identities(g1.userId).join() === 'device' && D.getStats(u4).games_played === 0, 'host s hrami zůstal nedotčen (nesloučen)');
  // F) CG účet vyhrává i když se přihlásí z jiného hosta
  const g2 = A.createGuestAccount();
  r = await cg(await sign({ userId: 'cg-4' }), g2.token); j = await r.json();
  check(uidOf(j.token) === u4 && !!D.getUserById(g2.userId), 'existující CG účet vyhrává, host se nesluče');
  // G) CG účet: jméno nejde přepsat jako hostovi, /auth/me kind=account
  const me = await (await fetch(BASE + '/auth/me', { headers: { authorization: 'Bearer ' + j.token } })).json();
  check(me.kind === 'account' && me.display_name === 'Karel', '/auth/me kind=account (jméno z posledního tokenu)');
  await fetch(BASE + '/auth/profile', { method: 'POST', headers: { authorization: 'Bearer ' + j.token, 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Hacker' }) });
  check(sdb.prepare('SELECT display_name FROM users WHERE id=?').get(u4).display_name === 'Karel', 'CG jméno nelze přepsat přes /auth/profile');
  // H) žebříček bez účtů s 0 her
  D.updateStats(u4, { games_played: 1 });
  const lbAll = D.getLeaderboard(50);
  check(lbAll.length >= 1 && lbAll.every(x => x.games_played > 0), `getLeaderboard vynechá 0 her (${lbAll.length} řádků, všechny > 0)`);
  const lb = await (await fetch(BASE + '/api/leaderboard')).json();
  const rows = Array.isArray(lb) ? lb : (lb.leaderboard || lb.rows || []);
  check(rows.every(x => x.games_played === undefined || x.games_played > 0), 'API /api/leaderboard bez 0 her');
  // I) CSP
  const csp = (await fetch(BASE + '/')).headers.get('content-security-policy') || '';
  check(csp.includes('https://app.crazygames.com') && csp.includes('capacitor://app.crazygames.com'), 'CSP frame-ancestors obsahuje app.crazygames.com');

  // ── Playwright: wrapper (jiný port) <-> hra v iframe ──
  const srv2 = await spawnServer(P_PW, DB_P); procs.push(srv2);
  const wrapHtml = readFileSync(join(ROOT, 'release/crazygames/index.html'));
  wrap = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(wrapHtml); }).listen(P_WRAP);
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
  const tok = await sign({ userId: 'cg-pw', username: 'Pavel' });
  const page = await (await browser.newContext()).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${P_WRAP}/?mockSdk=1&child=http://localhost:${P_PW}&mockToken=${tok}&mockName=Pavel`);
  const pdb = new Database(DB_P);
  let fr;
  for (let i = 0; i < 100 && !fr; i++) { fr = page.frames().find(f => f.url().startsWith(`http://localhost:${P_PW}`)); await page.waitForTimeout(100); }
  check(!!fr, 'hra se načetla v iframe wrapperu (CSP povolilo rodiče)');
  let acct = null;
  for (let i = 0; i < 80 && !acct; i++) { acct = pdb.prepare("SELECT user_id FROM identities WHERE provider='crazygames' AND provider_id='cg-pw'").get(); await page.waitForTimeout(100); }
  check(!!acct, 'hra poslala token přes postMessage, server vytvořil CG účet');
  await page.waitForTimeout(500);
  const ui = await fr.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; };
    return { cg: document.documentElement.classList.contains('cg'), flag: localStorage.getItem('fh_cg_acct'),
      discord: ['discord-login-btn', 'splash-discord-btn', 'profile-discord-btn', 'footer-signin-btn'].filter(vis),
      link: ['profile-link', 'link-issue', 'link-redeem', 'link-show-btn'].filter(vis) };
  });
  check(ui.cg && ui.flag === '1', 'hra v CG režimu, účet přepnut (fh_cg_acct)');
  check(ui.discord.length === 0 && ui.link.length === 0, 'Discord i link kód skryté (viditelné: ' + ui.discord.concat(ui.link).join(',') + ')');
  const me2 = await fr.evaluate(async () => (await (await fetch('/auth/me', { headers: { authorization: 'Bearer ' + localStorage.getItem('fh_device_token') } })).json()));
  check(me2.kind === 'account' && me2.display_name === 'Pavel', 'session v hře = CG účet Pavel');
  // padělaná zpráva od okna samotného (ne od rodiče) se ignoruje
  const fake = await sign({ userId: 'cg-evil' }, { key: other.privateKey });
  await fr.evaluate((fk) => window.postMessage({ type: 'cg:user', token: fk }, '*'), fake);
  await page.waitForTimeout(500);
  check(pdb.prepare("SELECT COUNT(*) n FROM identities WHERE provider='crazygames' AND provider_id='cg-evil'").get().n === 0, 'zpráva cg:user ne od rodiče se ignoruje');
  // gameplayStart / Stop přes wrapper
  await fr.evaluate(() => { const b = document.getElementById('splash-tutorial-btn'); b && b.click(); });
  await page.waitForTimeout(1500);
  const log1 = await page.evaluate(() => (window.__cgLog || []).slice());
  check(log1.includes('start'), 'gameplayStart doletělo do SDK po startu tutoriálu (log: ' + log1.join(',') + ')');
  check(errs.length === 0, 'žádné pageerror v rodiči (' + errs.join('|').slice(0, 100) + ')');
} catch (e) { check(false, 'výjimka: ' + (e.stack || e)); }
finally {
  try { await browser?.close(); } catch {}
  for (const p of procs) p.kill();
  jwksSrv.close(); wrap?.close();
  await new Promise(r => setTimeout(r, 300));
}
console.log(fails.length ? `\nSELHALO: ${fails.length}` : '\nVšechno OK');
process.exit(fails.length ? 1 : 0);
