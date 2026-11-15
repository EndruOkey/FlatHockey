// ŽIVÝ KROK ve hře: pohybují se brusle, když hráč jede? (rozkmit polohy brusle vůči tělu za každé 0,5 s okno, px v 1×)
// node scripts/stride_alive_game.mjs --port=P [--vis=..] [--k3='{json}']
// Ondřej 2026-11-15, videa F9: při stálé rychlosti ~124 px/s nohy přes 1,5 s „zamrznou" (jedna roztažená vzadu/do strany).
// RUBRIKA (předem): A1 při rychlosti > 60 px/s má každá brusle v každém 0,5 s okně rozkmit ≥ 3 px (krok běží; jízda vpřed má ~9 px).
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.vis) await p.evaluate(async v => { const { VIS } = await import('/js/vis.js'); for (const t of v.split(',')) VIS[t[0]] = +t.slice(1); }, A.vis);
if (A.k3) await p.evaluate(async j => { Object.assign((await import('/js/entities/Player.js')).SKATE_K3, JSON.parse(j)); }, A.k3);
const ROUTES = Object.fromEntries([0, 0.4, 0.7, 0.9, 1.1, 1.25, 1.4, 1.57].map(a => [`pohled ${Math.round(a * 57.3)}° od jízdy`, `t => ({ keys: ["KeyD"], aim: -${a} })`]));
for (const [name, fn] of Object.entries(ROUTES)) {
  const r = await p.evaluate(async src => { const route = eval(src), g = window.__fhGame, eng = g.engine, L = g.local; globalThis.__fhSkateDbg = 1; let f = 0; const win = []; let cur = { 0: [], 1: [] }, vs = [];
    L.x = 160; L.y = 300; L.vx = L.vy = 0;
    await new Promise(res => { const pv = eng.onDraw; eng.onDraw = (...a) => { pv && pv(...a); const t = f / 60, r = route(t), k = g.input.keys; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) k[kk] = r.keys.includes(kk);
      const cam = g._cam; g.input.mouseX = cam.ox + (L.x + Math.cos(r.aim) * 150) * cam.scale; g.input.mouseY = cam.oy + (L.y + Math.sin(r.aim) * 150) * cam.scale; f++;
      const d = L._dbgPose, v = Math.hypot(L.vx, L.vy); if (d && f > 40) { d.feet.forEach((q, i) => cur[i].push([q.x, q.y])); vs.push(v);
        if (vs.length === 30) { const amp = [0, 1].map(i => { const xs = cur[i].map(a => a[0]), ys = cur[i].map(a => a[1]); return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.198; });
          win.push({ v: vs.reduce((a, b) => a + b) / 30, amp: Math.min(...amp) }); cur = { 0: [], 1: [] }; vs = []; } }
      if (f > 40 + 30 * 7) { eng.onDraw = pv; for (const kk of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) k[kk] = false; res(); } }; });
    return win; }, fn);
  const bad = r.filter(w => w.v > 60 && w.amp < 3);
  console.log(`  ${bad.length ? 'NE' : 'OK'}  ${name.padEnd(26)} ${r.map(w => `v${w.v.toFixed(0)}:${w.amp.toFixed(1)}`).join('  ')}`);
  await p.waitForTimeout(600);
}
await b.close();
