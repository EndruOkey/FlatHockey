// A/B ROZPAD CENY SNÍMKU v Rychlé hře (GPU, bez vsync), rozlišení jako Ondřejův Chrome (1810×1000 CSS, DPR 1,25).
// Pro každou variantu (vypnutí části kreslení) 3× 300 snímků, medián intervalu. node scripts/fps_ab.mjs --port=P
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await (await b.newContext({ viewport: { width: +(A.w || 1810), height: +(A.h || 1000) }, deviceScaleFactor: +(A.dpr || 1.25) })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click(A.mode === 'train' ? '#go-train' : '#go-play'); if (A.mode === 'train') await p.click('#go-solo'); await p.waitForTimeout(4000);
const VARS = ['vše', 'bez hráčů', 'bez brankářů', 'bez puku', 'bez HUD (onDraw)', 'jen kluziště'];
for (const v of VARS) {
  const ms = await p.evaluate(async v => { const P = await import('/js/entities/Player.js'), G = await import('/js/entities/Goalie.js'), K = await import('/js/entities/Puck.js');
    const g = window.__fhGame, eng = g.engine;
    const save = { pd: P.Player.prototype.draw, gd: G.Goalie.prototype.draw, kd: K.Puck.prototype.draw, od: eng.onDraw };
    const noop = function () {};
    if (v === 'bez hráčů' || v === 'jen kluziště') P.Player.prototype.draw = noop;
    if (v === 'bez brankářů' || v === 'jen kluziště') G.Goalie.prototype.draw = noop;
    if (v === 'bez puku' || v === 'jen kluziště') K.Puck.prototype.draw = noop;
    if (v === 'bez HUD (onDraw)' || v === 'jen kluziště') eng.onDraw = null;
    const runs = [];
    for (let k = 0; k < 3; k++) { const iv = []; let l = performance.now(); await new Promise(res => { const f = n => { iv.push(n - l); l = n; if (iv.length < 300) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      iv.sort((a, b) => a - b); runs.push(iv[150]); }
    P.Player.prototype.draw = save.pd; G.Goalie.prototype.draw = save.gd; K.Puck.prototype.draw = save.kd; eng.onDraw = save.od;
    runs.sort((a, b) => a - b); return runs[1]; }, v);
  console.log(`${v.padEnd(18)} snímek ${ms.toFixed(2)} ms  (${(1000 / ms).toFixed(0)} FPS)`);
}
await b.close();
