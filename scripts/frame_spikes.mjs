// ŠPIČKY SNÍMKŮ v Rychlé hře: rozpad každého snímku (onTick, update, afterTick, draw, onDraw) + čas mimo smyčku (síť, GC, prohlížeč).
// GPU bez vsync. node scripts/frame_spikes.mjs --port=P [--mode=play|train]
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
if ((A.mode || 'play') === 'play') await p.click('#go-play'); else { await p.click('#go-train'); await p.click('#go-solo'); }
await p.waitForTimeout(4000);
const r = await p.evaluate(async () => { const eng = window.__fhGame.engine, w = eng._world, T = {}, F = []; const now = () => performance.now();
  const wrap = (o, k, lab) => { const f = o[k]; if (!f) return; o[k] = function (...a) { const t0 = now(); const x = f.apply(this, a); T[lab] = (T[lab] || 0) + now() - t0; return x; }; };
  wrap(eng, 'onTick', 'tick'); wrap(w, 'update', 'upd'); wrap(eng, 'onAfterTick', 'after'); wrap(w, 'draw', 'draw'); wrap(eng, 'onDraw', 'hud');
  let msg = 0; const WS = window.WebSocket.prototype, od = Object.getOwnPropertyDescriptor(WS, 'onmessage');
  const ol = eng._loop.bind(eng); let last = null;
  eng._loop = function (t) { for (const k in T) T[k] = 0; const t0 = now(); ol(t); const loop = now() - t0; if (last !== null) F.push({ iv: t - last, loop, ...T }); last = t; };
  await new Promise(r => setTimeout(r, 6000));
  const s = [...F].sort((a, b) => b.iv - a.iv), q = (k, p) => { const v = F.map(f => f[k] || 0).sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
  return { n: F.length, med: q('iv', 0.5), p95: q('iv', 0.95), loopMed: q('loop', 0.5), loopP95: q('loop', 0.95), drawP95: q('draw', 0.95), updP95: q('upd', 0.95),
    worst: s.slice(0, 8).map(f => `iv ${f.iv.toFixed(1)} loop ${f.loop.toFixed(1)} [tick ${(f.tick||0).toFixed(1)} upd ${(f.upd||0).toFixed(1)} after ${(f.after||0).toFixed(1)} draw ${(f.draw||0).toFixed(1)} hud ${(f.hud||0).toFixed(1)}]`) }; });
console.log(`${A.mode || 'play'}: snímků ${r.n}, interval medián ${r.med.toFixed(2)} / p95 ${r.p95.toFixed(2)} ms; smyčka medián ${r.loopMed.toFixed(2)} / p95 ${r.loopP95.toFixed(2)} ms (draw p95 ${r.drawP95.toFixed(2)}, update p95 ${r.updP95.toFixed(2)})`);
console.log('nejhorší snímky:\n  ' + r.worst.join('\n  ')); await b.close();
