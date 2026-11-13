// SNÍMKY BRUSLENÍ ze živé hry (trénink): po sobě jdoucí snímky jízdy vpřed / do strany / couvání v 1× (dpr 1) a v detailu (dpr 3).
// Snímá se přímo z herního canvasu po každém vykreslení (hook engine.onDraw) → opravdu po sobě jdoucí snímky, bez vynechání.
// Server musí běžet: PORT=46xx node server.js.  node scripts/skate_anim_shots.mjs --port=4611 --label=po --out=DIR [--vis=k3] [--n=12] [--gif=36]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, LABEL = A.label || 'po', OUT = A.out || '_skate_shots', N = +(A.n || 12), NG = +(A.gif || 36);
mkdirSync(OUT, { recursive: true });
// situace: kam míří myš (úhel těla) a které klávesy se drží; start = poloha hráče (svět), rozjezd v s
const SIT = [
  { id: 'vpred',  aim: [1, 0],  keys: ['KeyD'], start: [140, 300] },
  { id: 'bokem',  aim: [0, -1], keys: ['KeyD'], start: [140, 300] },
  { id: 'couvani', aim: [-1, 0], keys: ['KeyD'], start: [140, 300] },
];
const errs = [];
const b = await chromium.launch();
for (const dpr of [1, 3]) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr, reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(`http://localhost:${PORT}/?fhtest${A.vis ? '&vis=' + A.vis : ''}`, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await p.click('#go-solo'); await p.waitForTimeout(1500);
  for (const S of SIT) {
    // reset: hráč na start, puk daleko (ať ho nesebere), stojí
    await p.evaluate(([sx, sy]) => { const g = window.__fhGame, L = g.local; L.x = sx; L.y = sy; L.vx = 0; L.vy = 0;
      if (g.puck) { g.puck.x = 900; g.puck.y = 60; g.puck.vx = 0; g.puck.vy = 0; } }, S.start);
    const cam = await p.evaluate(() => { const c = window.__fhGame._cam; return { s: c.scale, ox: c.ox, oy: c.oy }; });
    // myš drží směr těla: bod daleko ve směru aim od hráče — aktualizuje se během jízdy
    const aimAt = async () => { const L = await p.evaluate(() => { const L = window.__fhGame.local; return [L.x, L.y]; });
      await p.mouse.move(cam.ox + (L[0] + S.aim[0] * 220) * cam.s, cam.oy + (L[1] + S.aim[1] * 220) * cam.s); };
    await aimAt(); await p.waitForTimeout(400);
    await p.evaluate(([sx, sy]) => { const L = window.__fhGame.local; L.x = sx; L.y = sy; L.vx = 0; L.vy = 0; }, S.start);
    for (const k of S.keys) await p.keyboard.down(k);
    for (let t = 0; t < 8; t++) { await p.waitForTimeout(170); await aimAt(); }   // ~1,4 s rozjezd na plnou rychlost
    const n = S.id === 'vpred' ? Math.max(N, NG) : N;
    const frames = await p.evaluate(async (n) => {
      const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas');
      const k = cv.width / cv.clientWidth, W = 48, out = [];
      const prev = eng.onDraw;
      await new Promise(res => {
        eng.onDraw = (c) => { prev(c); const cam = g._cam, L = g.local;
          const cx = (cam.ox + L.x * cam.scale) * k, cy = (cam.oy + L.y * cam.scale) * k, w = W * k;
          const o = document.createElement('canvas'); o.width = w; o.height = w;
          o.getContext('2d').drawImage(cv, cx - w / 2, cy - w / 2, w, w, 0, 0, w, w);
          out.push({ img: o.toDataURL('image/png'), v: Math.hypot(L.vx, L.vy), ba: L.bodyAngle, vx: L.vx, vy: L.vy });
          if (out.length >= n) { eng.onDraw = prev; res(); } };
      });
      return out;
    }, n);
    for (const k of S.keys) await p.keyboard.up(k);
    frames.forEach((f, i) => writeFileSync(join(OUT, `${LABEL}_${S.id}_d${dpr}_${String(i).padStart(2, '0')}.png`), Buffer.from(f.img.split(',')[1], 'base64')));
    console.log(`${LABEL} dpr${dpr} ${S.id}: ${frames.length} snímků, rychlost ${frames[0].v.toFixed(0)}–${frames.at(-1).v.toFixed(0)} px/s, úhel těla ${frames[0].ba.toFixed(2)}, pohyb ${Math.atan2(frames[0].vy, frames[0].vx).toFixed(2)}`);
    await p.waitForTimeout(600);
  }
  await ctx.close();
}
await b.close();
console.log('chyby v konzoli:', errs.length ? errs : 0);
process.exit(errs.length ? 1 : 0);
