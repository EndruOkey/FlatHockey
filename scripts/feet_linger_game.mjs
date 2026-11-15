// NOHY ZA — měření ve SKUTEČNÉ hře (trénink, skriptovaný deterministický vstup, kresba přes __fhSkateDbg). node scripts/feet_linger_game.mjs --port=P
// Rubrika jako scripts/feet_linger_metrics.mjs: G1 kotník za tělem > 0,8 R souvisle ≤ 0,25 s; G2 nejzazší ≥ −1,4 R.
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
const ROUTES = {
  'kruh WASD': 't => ({ h: -t * 1.6, keys: true })',
  'esíčko': 't => ({ h: 1.0 * Math.sin(t * 2.2), keys: true })',
  'ostrá 90°': 't => ({ h: t < 0.9 ? 0 : -Math.PI / 2, keys: true })',
  'jízda a pustit (dojíždění)': 't => ({ h: 0, keys: t < 1.2 })',
  'stop-go': 't => ({ h: 0, keys: (t % 1.2) < 0.7 })',
  'obrat 180° kláves': 't => ({ h: t < 1.0 ? 0 : Math.PI, keys: true })',
};
const R = 7, out = {};
for (const [name, fn] of Object.entries(ROUTES)) {
  out[name] = await p.evaluate(async src => { const route = eval(src), g = window.__fhGame, eng = g.engine, L = g.local; globalThis.__fhSkateDbg = 1; let f = 0, worst = 9, run = 0, longest = 0, wt = 0;
    L.x = 300; L.y = 330; L.vx = L.vy = 0;
    await new Promise(res => { const prev = eng.onDraw; eng.onDraw = (...a) => { prev && prev(...a); const t = f / 60, r = route(t), k = g.input.keys, dx = Math.cos(r.h), dy = Math.sin(r.h);
      k.KeyD = r.keys && dx > 0.38; k.KeyA = r.keys && dx < -0.38; k.KeyS = r.keys && dy > 0.38; k.KeyW = r.keys && dy < -0.38;
      const sp = Math.hypot(L.vx || 0, L.vy || 0), mh = sp > 20 ? Math.atan2(L.vy, L.vx) : r.h, cam = g._cam; g.input.mouseX = cam.ox + (L.x + Math.cos(mh) * 120) * cam.scale; g.input.mouseY = cam.oy + (L.y + Math.sin(mh) * 120) * cam.scale;
      f++; const d = L._dbgPose; if (f > 30 && d) { let back = 9; for (const q of d.feet) back = Math.min(back, (q.x - Math.cos(q.a) * 0.32 * 7) / 7); if (back < worst) { worst = back; wt = t; } if (back < -0.8) { run += 1 / 60; longest = Math.max(longest, run); } else run = 0; }
      if (f > 60 * 3.2) { eng.onDraw = prev; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) k[kk] = false; res(); } }; });
    return { worst, wt, longest }; }, fn);
  await p.waitForTimeout(700);
}
let fail = 0;
for (const [n, r] of Object.entries(out)) { const ok = r.longest <= 0.25 && r.worst >= -1.4; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(28)} G1 ${r.longest.toFixed(2)} s   G2 ${r.worst.toFixed(2)} R (t ${r.wt.toFixed(2)})`); }
console.log(fail ? `NEPROŠLO ${fail}/${Object.keys(out).length}` : 'VŠE OK'); await b.close();
