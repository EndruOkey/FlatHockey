// FPS BEZ OMEZENÍ (GPU, bez vsync a limitu snímků): skutečná cena snímku. node scripts/fps_uncapped.mjs --port=P [--url=https://...]
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BASE = A.url || `http://localhost:${A.port || 4611}`;
const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
async function run(lab, start) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }), p = await ctx.newPage();
  await p.goto(`${BASE}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await start(p); await p.waitForTimeout(4000);
  const r = await p.evaluate(async () => { const iv = []; let l = performance.now(); await new Promise(res => { const f = n => { iv.push(n - l); l = n; if (iv.length < 600) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const s = [...iv].sort((a, b) => a - b), q = p => s[Math.floor(p * (s.length - 1))]; return { med: q(0.5), p95: q(0.95), gpu: (() => { const c = document.createElement('canvas').getContext('webgl'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() }; });
  console.log(`${lab}: ${(1000 / r.med).toFixed(0)} FPS (snímek medián ${r.med.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms)  [${r.gpu.slice(0, 60)}]`);
  await ctx.close();
}
await run('Rychlá hra', p => p.click('#go-play'));
await run('Trénink   ', async p => { await p.click('#go-train'); await p.click('#go-solo'); });
await b.close();
