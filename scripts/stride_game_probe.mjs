// ŠKOBRTÁNÍ / SEKÁNÍ NOHOU ve skutečné hře (2026-11-16, Ondřej: „furt dost škobrtá a nohy se sekají, působí to jako chyba").
// node scripts/stride_game_probe.mjs --port=P [--vis=w1] [--fast]   (--fast = bez omezení snímků ≈ monitor 144+ Hz)
// Jízda vpřed z místa 3,5 s (D), brusle v lokálu těla po snímcích. RUBRIKA (předem):
//   G1 obraty pohybu brusle vpřed/vzad v ustálené jízdě (od 1,2 s) ≤ 2,2 na krok a nohu (ucelený krok)
//   G2 přepnutí ukotveno ↔ po póze za ustálené jízdy (st._fwB 0 ↔ > 0) ≤ 1
//   G3 skok brusle vůči tělu ≤ 3 px/snímek (1×)
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch({ args: A.fast ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [] });
const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4811}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
const r = await p.evaluate(async () => { const g = window.__fhGame, eng = g.engine, L = g.local, k = g.input.keys; globalThis.__fhSkateDbg = 1;
  L.x = 120; L.y = 330; L.vx = L.vy = 0; const fr = []; let t0 = null;
  await new Promise(res => { const pv = eng.onDraw; eng.onDraw = (...a) => { pv && pv(...a); const now = performance.now(); t0 ??= now; const t = (now - t0) / 1000;
    k.KeyD = true; const cam = g._cam; g.input.mouseX = cam.ox + (L.x + 150) * cam.scale; g.input.mouseY = cam.oy + L.y * cam.scale;
    const d = L._dbgPose; if (d) fr.push({ t, x: L.x, y: L.y, ba: L.bodyAngle, sp: Math.hypot(L.vx, L.vy), fw: L._fwB ?? -1, ml: L._mLocS, th: L._thr, f: d.feet.map(q => [q.x, q.y, q.lift || 0]) });
    if (t > 3.5) { eng.onDraw = pv; k.KeyD = false; res(); } }; });
  return fr; });
await b.close();
const S = 1.198, st = r.filter(q => q.t > 1.2); let rev = 0, tog = 0, jump = 0; const pd = [0, 0];
for (let i = 1; i < st.length; i++) { const a = st[i - 1], c = st[i];
  for (let j = 0; j < 2; j++) { const vx = (c.f[j][0] - a.f[j][0]) * S; if (Math.abs(vx) > 0.05) { if (pd[j] && Math.sign(vx) !== pd[j]) rev++; pd[j] = Math.sign(vx); }
    jump = Math.max(jump, Math.hypot(c.f[j][0] - a.f[j][0], c.f[j][1] - a.f[j][1]) * S); }
  if ((a.fw > 0) !== (c.fw > 0)) tog++; }
const dist = st[st.length - 1].x - st[0].x, steps = dist / (60 + 0.26 * Math.min(200, st[st.length - 1].sp)), G1 = rev / 2 / steps;
const fps = r.length / 3.5;
if (A.v) console.log(st.filter((q, i) => i % 20 === 0).map(q => `${q.t.toFixed(2)} fw ${q.fw.toFixed(2)} ml ${q.ml?.toFixed(2)} th ${q.th?.toFixed(0)} sp ${q.sp.toFixed(0)}`).join(' | '));
console.log(`fps ${fps.toFixed(0)}  rychlost ${st[st.length - 1].sp.toFixed(0)}  ${G1 <= 2.2 ? 'OK' : 'NE'} G1 obraty ${G1.toFixed(2)}/krok  ${tog <= 1 ? 'OK' : 'NE'} G2 přepnutí ${tog}  ${jump <= 3 ? 'OK' : 'NE'} G3 skok ${jump.toFixed(2)} px`);
