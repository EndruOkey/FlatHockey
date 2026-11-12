// Dev playground pod heslem (dev-gate.js): heslo, podepsaná cookie, /dev jen po přihlášení, běžná hra bez pokusů.
// Testovací heslo přes env (skutečné heslo v repu není). Spuštění: npm run test:dev
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import crypto from 'crypto';

const PW = 'test-heslo-123', SALT = 'aa11', HASH = crypto.scryptSync(PW, SALT, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
process.env.DEV_PASS_SALT = SALT; process.env.DEV_PASS_HASH = HASH; process.env.JWT_SECRET = 'test-secret';
const { checkPassword, makeToken, validToken } = await import('../dev-gate.js');

const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

check(checkPassword(PW), 'správné heslo projde');
check(checkPassword('  TEST-HESLO-123 '), 'heslo bez ohledu na velikost písmen a mezery okolo');
check(!checkPassword('spatne'), 'špatné heslo neprojde');
check(!checkPassword(''), 'prázdné heslo neprojde');
check(!checkPassword(undefined) && !checkPassword({}), 'nesmyslný vstup neprojde');
check(!checkPassword('x'.repeat(500)), 'dlouhý vstup odmítnut (žádné drahé hashování)');
const now = 1_800_000_000_000, t = makeToken(now);
check(validToken(t, now), 'čerstvý token platí');
check(!validToken(t, now + 31 * 864e5), 'token po 30 dnech neplatí');
const [e, m] = t.split('.');
check(!validToken(`${+e + 864e5}.${m}`, now), 'prodloužená expirace (podvržená) neplatí');
check(!validToken(`${e}.${m.slice(0, -1)}0`, now) || m.endsWith('0'), 'změněný podpis neplatí');
check(!validToken('nesmysl', now) && !validToken(undefined, now), 'nesmyslný token neplatí');

const PORT = +process.env.PORT || 4241, BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmpdir(), `fh-devgate-${PORT}.db`) }, stdio: 'pipe' });
let log = ''; server.stderr.on('data', d => log += d); server.stdout.on('data', d => log += d);
await new Promise((res, rej) => { server.stdout.on('data', d => String(d).includes('listening') && res()); server.on('exit', c => rej(new Error('server exit ' + c + '\n' + log))); });
const T = () => ({ signal: AbortSignal.timeout(8000), redirect: 'manual' });
const login = pw => fetch(BASE + '/dev/login', { ...T(), method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(pw) });
try {
  const anon = await (await fetch(BASE + '/dev', T())).text();
  check(anon.includes('/dev/login') && !anon.includes('FH_DEV'), '/dev bez přihlášení = jen formulář, žádné pokusy');
  const bad = await login('spatne');
  check(bad.status === 401, 'špatné heslo → 401');
  const ok = await login(PW), ck = ok.headers.get('set-cookie') || '';
  check(ok.status === 303 && /fh_dev=/.test(ck) && /HttpOnly/i.test(ck), 'správné heslo → přesměrování + httpOnly cookie');
  const dev = await (await fetch(BASE + '/dev', { ...T(), headers: { cookie: ck.split(';')[0] } })).text();
  check(dev.includes('window.FH_DEV = 1') && dev.includes('/js/dev-panel.js') && dev.includes('/js/main.js'), '/dev s cookie = hra s dev panelem');
  const fake = await (await fetch(BASE + '/dev', { ...T(), headers: { cookie: 'fh_dev=9999999999999.abcd' } })).text();
  check(!fake.includes('FH_DEV'), 'podvržená cookie nepustí dál');
  const pub = await (await fetch(BASE + '/', T())).text();
  check(!pub.includes('FH_DEV') && !pub.includes('dev-panel'), 'běžná hra (/) pokusy neobsahuje');
  let codes = []; for (let i = 0; i < 9; i++) codes.push((await login('spatne' + i)).status);
  check(codes.includes(429), `pokusy o heslo omezené (${codes.join(',')})`);
} finally { server.kill(); }
console.log(fails.length ? `\n${fails.length} FAIL` : '\nvše OK');
process.exit(fails.length ? 1 : 0);
