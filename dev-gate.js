// DEV PLAYGROUND pod heslem (2026-11-12): /dev = hra se zapnutými pokusy (režimy ovládání, varianty vzhledu).
// Heslo NENÍ v repu (repo je veřejné) — jen scrypt otisk se solí. Přepis: env DEV_PASS_SALT + DEV_PASS_HASH.
// Přihlášení = podepsaná httpOnly cookie na 30 dní (HMAC klíčem z JWT_SECRET, jinak z otisku hesla).
// Pozn.: heslo chrání před náhodným objevením pokusů; samotné pokusy jsou jen kresba a offline ovládání (žádná výhoda online).
import crypto from 'crypto';
import { readFileSync } from 'fs';

const DEF = {"salt":"8a0937f882fc4753d4fa8ba79493ab92","hash":"dae884bac432f8aaae03ed6175161990d5a0b552cb73d4e19d642e88e11223f8"};
const SALT = process.env.DEV_PASS_SALT || DEF.salt, HASH = process.env.DEV_PASS_HASH || DEF.hash;
const KEY = crypto.createHash('sha256').update('fh-dev|' + (process.env.JWT_SECRET || HASH)).digest();
const COOKIE = 'fh_dev', DAYS = 30;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 1 || pw.length > 200) return false;
  const h = crypto.scryptSync(pw.trim().toLowerCase(), SALT, 32, SCRYPT), want = Buffer.from(HASH, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const sign = exp => crypto.createHmac('sha256', KEY).update(String(exp)).digest('hex');
export function makeToken(now = Date.now()) { const exp = now + DAYS * 864e5; return exp + '.' + sign(exp); }
export function validToken(t, now = Date.now()) {
  if (typeof t !== 'string') return false;
  const [exp, mac] = t.split('.'); if (!exp || !mac || +exp < now) return false;
  const a = Buffer.from(mac, 'hex'), b = Buffer.from(sign(exp), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const loginPage = (err) => `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlatHockey · dev</title><meta name="robots" content="noindex"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1424;color:#eef4fb;font:16px/1.4 system-ui,sans-serif}
form{background:#13213a;border:2px solid #4cc3ff;border-radius:10px;padding:28px;width:min(320px,calc(100vw - 32px));box-sizing:border-box}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 16px;color:#a9bdd6;font-size:14px}
input,button{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:6px;font:inherit}
input{border:1px solid #3a5476;background:#0b1424;color:#fff;margin-bottom:12px}
button{border:0;background:#4cc3ff;color:#06121f;font-weight:700;cursor:pointer}
.e{color:#ff8a8a;margin:-4px 0 12px;font-size:14px}</style></head><body>
<form method="post" action="/dev/login"><h1>Dev playground</h1><p>Pokusy s ovládáním a vzhledem. Jen pro vývoj.</p>
${err ? '<div class="e">Špatné heslo.</div>' : ''}<input type="password" name="password" placeholder="Heslo" autofocus autocomplete="current-password">
<button type="submit">Vstoupit</button></form></body></html>`;

// app = express, publicDir = cesta k public/, limit = rateLimit middleware ze serveru
export function mountDev(app, express, publicDir, limit) {
  const devHtml = () => readFileSync(publicDir + '/index.html', 'utf8')
    .replace('<script type="module" src="/js/main.js"></script>', '<script>window.FH_DEV = 1;</script>\n  <script type="module" src="/js/dev-panel.js"></script>\n  <script type="module" src="/js/main.js"></script>');
  const head = res => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('Referrer-Policy', 'no-referrer'); };
  app.get('/dev', (req, res) => { head(res); res.type('html').send(validToken(req.cookies?.[COOKIE]) ? devHtml() : loginPage(false)); });
  app.post('/dev/login', limit, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    head(res);
    if (!checkPassword(req.body?.password)) return res.status(401).type('html').send(loginPage(true));
    res.cookie(COOKIE, makeToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: DAYS * 864e5, path: '/dev' });
    res.redirect(303, '/dev');
  });
  app.post('/dev/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/dev' }); res.redirect(303, '/dev'); });
}
