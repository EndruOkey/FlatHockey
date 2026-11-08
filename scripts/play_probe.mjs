// „Zahraj si to": vlastní hráč jede ve skutečném zápase (míří myší na puk, mění směr WASD) a každý snímek měří,
// jak se jeho poloha na obrazovce rozchází se serverem a jestli jede tam, kam ho posílám.
// node scripts/play_probe.mjs <url> [sekund=30]   env: FH_UNCAP=1 (FPS bez stropu), FH_IP, LOCAL_CLIENT=1
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [url = 'http://localhost:4900/', secs = '30'] = process.argv.slice(2);
const args = [];
if (process.env.FH_IP) args.push(`--host-resolver-rules=MAP ${new URL(url).hostname} ${process.env.FH_IP}`);
if (process.env.FH_UNCAP) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const b = await chromium.launch({ args }); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
if (process.env.LOCAL_CLIENT) { const src = readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  await p.route(/\/js\/game\.js(\?|$)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: src })); }
await p.route(/\/js\/main\.js(\?|$)/, async route => { const r = await route.fetch(); let body = await r.text();
  if (!body.includes('__fhGame')) body = body.replace('inGame = true; currentGame = game;', 'inGame = true; currentGame = game; window.__fhGame = game;');
  route.fulfill({ response: r, body }); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-play'); await p.waitForTimeout(4000);
// měření v prohlížeči (běží souběžně s řízením)
await p.evaluate(() => {
  const g = window.__fhGame; const M = window.__M = { frames: 0, errSum: 0, errMax: 0, n: 0, jumps: 0, wrongDir: 0, moveN: 0, big: 0, fps: 0 };
  let lx = null, ly = null, lt = performance.now(), t0 = lt;
  const f = now => { const dt = (now - lt) / 1000; lt = now; M.frames++;
    const e = [...g.players.values()].find(e => e.isMe);
    if (e && !g.locked && e.sx != null) { const me = e.ent;
      const err = Math.hypot(me.x - e.sx, me.y - e.sy); M.errSum += err; M.n++; M.errMax = Math.max(M.errMax, err); if (err > 40) M.big++;
      if (lx != null && dt > 0) { const dx = me.x - lx, dy = me.y - ly, v = Math.hypot(dx, dy) / dt;
        if (v > 400) M.jumps++;   // rychleji, než hráč umí bruslit (180 px/s) → přeskok
        const ix = g.input.dx, iy = g.input.dy;
        if ((ix || iy) && v > 40) { M.moveN++; if ((dx * ix + dy * iy) < 0) M.wrongDir++; } }
      lx = me.x; ly = me.y; }
    M.fps = M.frames / ((now - t0) / 1000); requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
// řízení: míř na puk, jeď k němu / od něj, střídej směry (deterministicky)
const KEYS = [['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA'], ['KeyW']];
const end = Date.now() + +secs * 1000; let k = 0;
while (Date.now() < end) {
  const pk = await p.evaluate(() => { const g = window.__fhGame, c = g._cam; return c ? { x: c.ox + g.puck.x * c.scale, y: c.oy + g.puck.y * c.scale } : null; });
  if (pk) await p.mouse.move(pk.x, pk.y);
  const ks = KEYS[k++ % KEYS.length]; for (const key of ks) await p.keyboard.down(key);
  await p.waitForTimeout(700); for (const key of ks) await p.keyboard.up(key);
  if (k % 3 === 0) { await p.mouse.down(); await p.waitForTimeout(250); await p.mouse.up(); }   // střela, když má puk
}
const M = await p.evaluate(() => window.__M);
console.log(JSON.stringify({ fps: Math.round(M.fps), odchylkaOdServeru: { prumer: +(M.errSum / Math.max(1, M.n)).toFixed(1), max: Math.round(M.errMax), nad40pxPct: +(100 * M.big / Math.max(1, M.n)).toFixed(1) },
  preskokyPct: +(100 * M.jumps / Math.max(1, M.n)).toFixed(2), jedeOpacnePct: +(100 * M.wrongDir / Math.max(1, M.moveN)).toFixed(1) }), 'chyby JS:', errs.length ? errs : 0);
await b.close();
