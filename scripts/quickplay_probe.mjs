// RYCHLÁ HRA — sonda: FPS (intervaly rAF), čas kreslení světa, chyby konzole, snímky. node scripts/quickplay_probe.mjs --port=P --out=DIR
// Porovnání s tréninkem ve stejném prohlížeči (headless bez GPU → absolutní ms jsou horší než u hráče, porovnávají se poměry).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, OUT = A.out || '_qp'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
const errs = [];
async function measure(p, lab) {
  const r = await p.evaluate(async () => { const g = window.__fhGame, eng = g.engine, iv = [], dr = []; let last = performance.now();
    const w = eng._world || g.world, od = w && w.draw ? w.draw.bind(w) : null;
    if (od) w.draw = (...a) => { const t0 = performance.now(); const x = od(...a); dr.push(performance.now() - t0); return x; };
    await new Promise(res => { const f = n => { iv.push(n - last); last = n; if (iv.length < 300) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    if (od) w.draw = od;
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
    const ents = (g.players ? g.players.size : 0) + ' hráčů/entit';
    return { fps: 1000 / q(iv, 0.5), p95ms: q(iv, 0.95), drawMed: dr.length ? q(dr, 0.5) : -1, drawP95: dr.length ? q(dr, 0.95) : -1, ents }; });
  console.log(`${lab}: FPS medián ${r.fps.toFixed(0)}, snímek p95 ${r.p95ms.toFixed(1)} ms, kreslení světa medián ${r.drawMed.toFixed(1)} ms / p95 ${r.drawP95.toFixed(1)} ms (${r.ents})`);
}
const p = await ctx.newPage(); p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-play'); await p.waitForTimeout(6000);
await measure(p, 'Rychlá hra');
for (let i = 0; i < 4; i++) { await p.screenshot({ path: `${OUT}/qp_${i}.png` }); await p.waitForTimeout(700); }
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
const p2 = await ctx.newPage(); await p2.goto(`http://localhost:${PORT}/?fhtest`); await p2.waitForTimeout(1200);
if (await p2.isVisible('#splash-guest-btn')) { await p2.click('#splash-guest-btn'); await p2.waitForTimeout(800); }
await p2.click('#go-train'); await p2.click('#go-solo'); await p2.waitForTimeout(2500); await measure(p2, 'Trénink   ');
console.log('chyby:', errs.length ? [...new Set(errs)].slice(0, 8) : 0); await b.close();
