// GLITCHE BRUSLENÍ ve skutečné hře: skok brusle (střed) vůči posunu těla mezi snímky, px v 1× (1,198 px/j).
// node scripts/skate_glitch_game.mjs --port=P [--vis=k3,n1]
// Ondřej 2026-11-15: „bruslení glitchuje". RUBRIKA (předem): Z1 skok ≤ 3 px/snímek ve všech manévrech (jako S3/T3);
// Z2 počet snímků se skokem > 3 px = 0. Manévry: kruh, esíčko, ostrá, stop-go, brzda+rozjezd opačně, couvání a zpět, švih myší.
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
const ROUTES = {
  'kruh': 't => ({ h: -t * 1.6, keys: true })',
  'esíčko': 't => ({ h: 1.0 * Math.sin(t * 2.2), keys: true })',
  'ostrá 90°': 't => ({ h: t < 0.9 ? 0 : -Math.PI / 2, keys: true })',
  'stop-go': 't => ({ h: 0, keys: (t % 1.2) < 0.7 })',
  'brzda + opačně': 't => ({ h: t < 1.3 ? 0 : Math.PI, keys: !(t > 1.0 && t < 1.3), space: t > 1.0 && t < 1.3 })',
  'couvání a zpět': 't => ({ h: t < 1.4 ? Math.PI : 0, keys: true, aim: 0 })',
  'švih myší': 't => ({ h: 0, keys: true, aim: t < 1.2 ? 0 : Math.PI })',
};
const out = {};
for (const [name, fn] of Object.entries(ROUTES)) {
  out[name] = await p.evaluate(async src => { const route = eval(src), g = window.__fhGame, eng = g.engine, L = g.local; globalThis.__fhSkateDbg = 1; let f = 0, worst = 0, wt = 0, bad = 0, prev = null;
    L.x = 300; L.y = 330; L.vx = L.vy = 0;
    await new Promise(res => { const pv = eng.onDraw; eng.onDraw = (...a) => { pv && pv(...a); const t = f / 60, r = route(t), k = g.input.keys, dx = Math.cos(r.h), dy = Math.sin(r.h);
      k.KeyD = r.keys && dx > 0.38; k.KeyA = r.keys && dx < -0.38; k.KeyS = r.keys && dy > 0.38; k.KeyW = r.keys && dy < -0.38; k.Space = !!r.space;
      const sp = Math.hypot(L.vx || 0, L.vy || 0), mh = r.aim != null ? r.aim : (sp > 20 ? Math.atan2(L.vy, L.vx) : r.h), cam = g._cam;
      g.input.mouseX = cam.ox + (L.x + Math.cos(mh) * 120) * cam.scale; g.input.mouseY = cam.oy + (L.y + Math.sin(mh) * 120) * cam.scale;
      f++; const d = L._dbgPose; if (d) { const c = Math.cos(L.bodyAngle), s = Math.sin(L.bodyAngle), W = d.feet.map(q => ({ x: L.x + q.x * c - q.y * s, y: L.y + q.x * s + q.y * c }));
        if (prev && f > 20) for (let i = 0; i < 2; i++) { const j = Math.hypot((W[i].x - prev.W[i].x) - (L.x - prev.x), (W[i].y - prev.W[i].y) - (L.y - prev.y)) * 1.198; if (j > worst) { worst = j; wt = t; } if (j > 3) bad++; }
        prev = { W, x: L.x, y: L.y }; }
      if (f > 60 * 3) { eng.onDraw = pv; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) k[kk] = false; res(); } }; });
    return { worst, wt, bad }; }, fn);
  await p.waitForTimeout(600);
}
let fail = 0;
for (const [n, r] of Object.entries(out)) { const ok = r.worst <= 3; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(16)} Z1 max skok ${r.worst.toFixed(2)} px (t ${r.wt.toFixed(2)})  Z2 snímků > 3 px: ${r.bad}`); }
console.log(fail ? `NEPROŠLO ${fail}/${Object.keys(out).length}` : 'VŠE OK'); await b.close();
