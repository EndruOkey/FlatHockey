// „FLEKATÝ MORPH" ve skutečné hře: co dělají brusle po zvednutí z pádu a po přemístění hráče (buly / posun).
// node scripts/morph_event_game.mjs --port=P [--vis=k3,n1]
// Ondřej 2026-11-16: „při zvedání nebo přemístění hráčů takový flekatý morph". RUBRIKA (předem):
//   M1 max skok brusle vůči tělu ≤ 3 px/snímek v 40 snímcích po události (jako Z1 ve skate_glitch_game); 1. snímek po události
//      = střih (tělo samo skočí jinam), vypisuje se zvlášť a do M1 nepočítá
//   M2 snímků, kdy se brusle hýbe vůči STOJÍCÍMU tělu o > 1 px (= dojíždění, morph), ≤ 2
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
const EV = ['zvednutí z pádu', 'posun 2 R', 'posun 3,5 R', 'buly (daleko)', 'buly při brzdě'];
const out = {};
for (const name of EV) {
  out[name] = await p.evaluate(async name => { const g = window.__fhGame, eng = g.engine, L = g.local, k = g.input.keys; globalThis.__fhSkateDbg = 1;
    L.x = 300; L.y = 330; L.vx = L.vy = 0; let f = 0, ev = -1, worst = 0, cut = 0, morph = 0, prev = null;
    await new Promise(res => { const pv = eng.onDraw; eng.onDraw = (...a) => { pv && pv(...a); f++;
      const cam = g._cam; g.input.mouseX = cam.ox + (L.x + 120) * cam.scale; g.input.mouseY = cam.oy + L.y * cam.scale;
      if (ev < 0) {   // rozjezd vpřed ~1 s, pak událost
        k.KeyD = f < 70; k.Space = name === 'buly při brzdě' && f >= 62;
        if (name === 'zvednutí z pádu' && f === 60) { L.takeHit(9999, 1, 0); }
        if (name === 'zvednutí z pádu' && f > 60 && !(L._downT > 0 || L._upT > 0)) ev = f;
        if (name === 'posun 2 R' && f === 75) { L.x += 2 * 7; L.vx = L.vy = 0; ev = f; }
        if (name === 'posun 3,5 R' && f === 75) { L.x += 3.5 * 7; L.vx = L.vy = 0; ev = f; }
        if (name === 'buly (daleko)' && f === 75) { L.x = 600; L.y = 300; L.vx = L.vy = 0; ev = f; }
        if (name === 'buly při brzdě' && f === 66) { L.x = 600; L.y = 300; L.vx = L.vy = 0; k.Space = false; ev = f; }
        if (f > 400) ev = f;
      } else { k.KeyD = false; k.Space = false; }
      const d = L._dbgPose;
      if (d && ev >= 0) { const c = Math.cos(L.bodyAngle), s = Math.sin(L.bodyAngle), W = d.feet.map(q => ({ x: L.x + q.x * c - q.y * s, y: L.y + q.x * s + q.y * c }));
        if (prev && f > ev) for (let i = 0; i < 2; i++) { const j = Math.hypot((W[i].x - prev.W[i].x) - (L.x - prev.x), (W[i].y - prev.W[i].y) - (L.y - prev.y)) * 1.198;
          if (f === ev + 1) { if (j > cut) cut = j; } else if (j > worst) worst = j; if (j > 1 && Math.hypot(L.vx, L.vy) < 15) morph++; }
        prev = { W, x: L.x, y: L.y }; }
      if (ev >= 0 && f > ev + 40) { eng.onDraw = pv; k.KeyD = k.Space = false; res(); } }; });
    return { worst, cut, morph }; }, name);
  await p.waitForTimeout(500);
}
let fail = 0;
for (const [n, r] of Object.entries(out)) { const ok = r.worst <= 3 && r.morph <= 2; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(17)} střih ${r.cut.toFixed(1)} px  M1 max skok ${r.worst.toFixed(2)} px   M2 snímků dojíždění: ${r.morph}`); }
console.log(fail ? `NEPROŠLO ${fail}/${EV.length}` : 'VŠE OK'); await b.close();
