// A/B OPERACÍ CANVASU v Rychlé hře (GPU bez vsync, rozlišení 1810×1000 DPR 1,25): vypnutí jedné operace → úspora času snímku.
// node scripts/fps_ops_ab.mjs --port=P
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await (await b.newContext({ viewport: { width: 1810, height: 1000 }, deviceScaleFactor: 1.25 })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-play'); await p.waitForTimeout(4000);
for (const v of ['vše', 'fillText+strokeText', 'createRadialGradient→barva', 'clip', 'stroke', 'fill', 'roundRect']) {
  const ms = await p.evaluate(async v => { const C = CanvasRenderingContext2D.prototype, save = {}; const noop = function () {};
    const patch = (k, f) => { save[k] = C[k]; C[k] = f; };
    if (v === 'fillText+strokeText') { patch('fillText', noop); patch('strokeText', noop); }
    if (v === 'createRadialGradient→barva') patch('createRadialGradient', function () { return '#888'; });
    if (v === 'clip') patch('clip', noop);
    if (v === 'stroke') patch('stroke', noop);
    if (v === 'fill') patch('fill', noop);
    if (v === 'roundRect') patch('roundRect', noop);
    const runs = []; for (let k = 0; k < 3; k++) { const iv = []; let l = performance.now(); await new Promise(res => { const f = n => { iv.push(n - l); l = n; if (iv.length < 300) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); iv.sort((a, b) => a - b); runs.push(iv[150]); }
    for (const k in save) C[k] = save[k]; runs.sort((a, b) => a - b); return runs[1]; }, v);
  console.log(`${v.padEnd(28)} snímek ${ms.toFixed(2)} ms`);
}
await b.close();
