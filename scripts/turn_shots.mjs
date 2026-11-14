// SNÍMKY ZATÁČEK ze živé hry (trénink), skriptovaný deterministický vstup: WASD podle trasy, myš vždy 120 px před hráčem po směru jízdy.
// node scripts/turn_shots.mjs --port=P --out=DIR [--tag=x] [--vis=n1] [--dpr=3]
// Trasy: kruh doleva, esíčko, ostrá zatáčka 90°. Snímá se přes engine.onDraw každý 3. snímek (výřez kolem hráče z canvasu).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, OUT = A.out || '_turn', TAG = A.tag || 'x', DPR = +(A.dpr || 3); mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: DPR })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
// trasa: funkce času → požadovaný směr jízdy (rad); WASD = 8 směrů nejblíž k němu, myš před hráčem po směru jízdy (skutečné rychlosti)
const ROUTES = {
  kruh: 't => -t * 1.6',                                         // kruh doleva ~1,6 rad/s
  esicko: 't => 1.0 * Math.sin(t * 2.2)',                       // esíčko
  ostra: 't => t < 0.9 ? 0 : -Math.PI / 2',                     // ostrá zatáčka doleva (nahoru)
};
for (const [name, fn] of Object.entries(ROUTES)) {
  const shots = await p.evaluate(async ([src, N]) => { const route = eval(src), g = window.__fhGame, eng = g.engine, cv = g.canvas, L = g.local, out = []; let f = 0;
    L.x = 300; L.y = 330; L.vx = L.vy = 0;
    const setIn = t => { const h = route(t), k = g.input.keys; const dx = Math.cos(h), dy = Math.sin(h);
      k.KeyD = dx > 0.38; k.KeyA = dx < -0.38; k.KeyS = dy > 0.38; k.KeyW = dy < -0.38;
      const sp = Math.hypot(L.vx || 0, L.vy || 0), mh = sp > 20 ? Math.atan2(L.vy, L.vx) : h, cam = g._cam, r = cv.getBoundingClientRect();
      const mx = r.left + cam.ox + (L.x + Math.cos(mh) * 120) * cam.scale, my = r.top + cam.oy + (L.y + Math.sin(mh) * 120) * cam.scale;
      g.input.mouseX = mx - r.left; g.input.mouseY = my - r.top; };   // input.js čte myš vůči canvasu
    await new Promise(res => { const prev = eng.onDraw; eng.onDraw = (...a) => { prev && prev(...a); const t = f / 60; setIn(t); f++;
      if (f > 40 && f % 3 === 0) { const cam = g._cam, k = cv.width / cv.getBoundingClientRect().width, sx = (cam.ox + L.x * cam.scale) * k, sy = (cam.oy + L.y * cam.scale) * k, h = 30 * k * cam.scale / 1.2;
        const c = document.createElement('canvas'); c.width = c.height = 200; c.getContext('2d').drawImage(cv, sx - h, sy - h, 2 * h, 2 * h, 0, 0, 200, 200);
        out.push({ img: c.toDataURL('image/png'), v: Math.round(Math.hypot(L.vx || 0, L.vy || 0)) }); }
      if (out.length >= N) { eng.onDraw = prev; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) g.input.keys[kk] = false; res(); } }; });
    return out; }, [fn, 24]);
  shots.forEach((s, i) => writeFileSync(`${OUT}/${TAG}_${name}_${String(i).padStart(2, '0')}.png`, Buffer.from(s.img.split(',')[1], 'base64')));
  console.log(name, shots.map(s => s.v).join(' '));
  await p.waitForTimeout(800);
}
console.log('chyby:', errs.length ? errs : 0); await b.close();
