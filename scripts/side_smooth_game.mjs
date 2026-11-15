// PLYNULOST JÍZDY BOKEM ve skutečné hře: ráz bruslí (2. diference polohy vůči tělu, px/snímek² v 1×) + přepínání ukotvení.
// node scripts/side_smooth_game.mjs --port=P   Rubrika jako side_smooth_metrics S1: bokem ≤ 1,2 × vpřed.
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.k3) await p.evaluate(async j => { Object.assign((await import('/js/entities/Player.js')).SKATE_K3, JSON.parse(j)); }, A.k3);
const res = {};
for (const [name, key, y0, aimDx, aimDy] of [['vpřed', 'KeyD', 330, 1, 0], ['bokem dolů', 'KeyS', 120, 1, 0], ['bokem nahoru', 'KeyW', 400, 1, 0], ['šikmo', 'KeyS', 120, 1, 0.4]]) {
  res[name] = await p.evaluate(async ([key, y0, adx, ady]) => { const g = window.__fhGame, eng = g.engine, L = g.local; globalThis.__fhSkateDbg = 1; let f = 0, mx = 0, flips = 0, last = null; const H = [[], []];
    L.x = key === 'KeyD' ? 150 : 500; L.y = y0; L.vx = L.vy = 0;
    await new Promise(res => { const pv = eng.onDraw; eng.onDraw = (...a) => { pv && pv(...a); g.input.keys[key] = true; if (key !== 'KeyD' && ady) g.input.keys.KeyD = (f % 20) < 10;
      const cam = g._cam; g.input.mouseX = cam.ox + (L.x + adx * 200) * cam.scale; g.input.mouseY = cam.oy + (L.y + ady * 200) * cam.scale; f++;
      const d = L._dbgPose; if (d && f > 50) { d.feet.forEach((q, i) => { const h = H[i]; h.push([q.x, q.y]); if (h.length >= 3) { const [a, b2, c] = h.slice(-3); const j = Math.hypot(a[0] - 2 * b2[0] + c[0], a[1] - 2 * b2[1] + c[1]) * 1.198; if (j > mx) { mx = j; window.__jinfo = `snímek ${f} noha ${i} lbS ${(L._lbS ?? 0).toFixed(2)} bwS ${(L._bwS ?? 0).toFixed(2)} v ${Math.hypot(L.vx, L.vy).toFixed(0)} lift ${q.lift.toFixed(2)} pos ${q.x.toFixed(1)},${q.y.toFixed(1)} předtím ${b2[0].toFixed(1)},${b2[1].toFixed(1)}`; } } });
        const mode = (L._lbS ?? 0) > 0.5 ? 'L' : 'P'; if (last && mode !== last) flips++; last = mode; }
      if (f > 50 + 100) { eng.onDraw = pv; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) g.input.keys[kk] = false; res(); } }; });
    return { mx, flips, info: window.__jinfo }; }, [key, y0, aimDx, aimDy]);
  await p.waitForTimeout(500);
}
const base = res['vpřed'].mx; let fail = 0;
for (const [n, r] of Object.entries(res)) { const ok = n === 'vpřed' || r.mx <= base * 1.2; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(13)} max ráz ${r.mx.toFixed(2)} px/sn² (${(r.mx / base).toFixed(1)}× vpřed)  přepnutí ukotvení ${r.flips}×  [${r.info}]`); }
console.log(fail ? `NEPROŠLO ${fail}/3` : 'VŠE OK'); await b.close();
