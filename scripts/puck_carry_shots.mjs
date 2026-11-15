// SNÍMKY PUKU NA ČEPELI ze živé hry (trénink, ?fhtest): jízda vpřed, zatáčka, couvání, bokem, stoj, klička (forhend↔bekhend).
// Před každou situací se puk položí na špičku hole → hráč ho veze. Výřez kolem hráče, každý k-tý snímek (engine.onDraw).
// Server: PORT=48xx node server.js.   node scripts/puck_carry_shots.mjs --port=48xx --out=DIR --lab=pred|po [--dpr=1,4]
// List: python scripts/puck_carry_sheet.py DIR OUT.png
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4831, OUT = A.out || '_puck_shots', LAB = A.lab || 'pred', N = +(A.n || 8);
const DPRS = String(A.dpr || '1,4').split(',').map(Number);
mkdirSync(OUT, { recursive: true });
// keys = držené klávesy; aim = úhel myši (rad, svět) nebo 'vel' = po směru jízdy; osc = klička myší ±osc rad
const SIT = [
  { id: 'vpred', k: 3, keys: ['KeyD'], aim: 0 },
  { id: 'zatacka', k: 4, keys: ['KeyD'], aim: 'vel', turn: true },
  { id: 'couvani', k: 3, keys: ['KeyA'], aim: 0 },
  { id: 'bokem', k: 3, keys: ['KeyS'], aim: 0 },
  { id: 'stoj', k: 6, keys: [], aim: 0 },
  { id: 'klicka', k: 3, keys: [], aim: 0, osc: 0.9 },
];
const errs = [];
const b = await chromium.launch();
for (const dpr of DPRS) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr, reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(`http://localhost:${PORT}/?fhtest`, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
  for (const S of SIT) {
    const frames = await p.evaluate(async ({ S, n }) => {
      const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas'), inp = g.input, L = g.local;
      L.x = 300; L.y = S.id === 'bokem' ? 150 : 300; L.vx = 0; L.vy = 0; L.bodyAngle = L.skateAngle = L.aimAngle = L.carryAngle = 0;
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) inp.keys[k] = false;
      const sc = cv.width / cv.clientWidth, W = 96, out = [], prev = eng.onDraw; let f = 0;
      const aim = (a) => { const cam = g._cam; inp.mouseX = cam.ox + (L.x + Math.cos(a) * 160) * cam.scale; inp.mouseY = cam.oy + (L.y + Math.sin(a) * 160) * cam.scale; };
      await new Promise(res => {
        eng.onDraw = (c) => {
          const cam = g._cam; f++;
          // puk na čepel (na začátku a dokud ho hráč nemá)
          if (f < 20 && !L.hasPuck && g.puck) { const t = L.stickTip; g.puck.x = t.x; g.puck.y = t.y; g.puck.vx = L.vx; g.puck.vy = L.vy; g.puck.z = 0; g.puck.vz = 0; }
          if (f === 2) for (const k of S.keys) inp.keys[k] = true;
          if (S.turn) { const st = Math.floor(f / 30); inp.keys.KeyD = st < 3; inp.keys.KeyS = st >= 2; }
          let a = S.aim === 'vel' ? (Math.hypot(L.vx, L.vy) > 20 ? Math.atan2(L.vy, L.vx) : 0) : S.aim;
          if (S.osc) a += S.osc * Math.sin(f / 60 * Math.PI * 2 * 1.2);
          aim(a);
          prev(c);
          if (f < 60 || (f - 60) % S.k) return;
          const cx = (cam.ox + L.x * cam.scale) * sc, cy = (cam.oy + L.y * cam.scale) * sc, w = W * sc;
          const o = document.createElement('canvas'); o.width = w; o.height = w;
          o.getContext('2d').drawImage(cv, cx - w / 2, cy - w / 2, w, w, 0, 0, w, w);
          out.push({ img: o.toDataURL('image/png'), v: Math.hypot(L.vx, L.vy), has: !!L.hasPuck });
          if (out.length >= n) { eng.onDraw = prev; for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) inp.keys[k] = false; res(); }
        };
      });
      return out;
    }, { S, n: N });
    frames.forEach((fr, i) => writeFileSync(join(OUT, `${LAB}_${S.id}_d${dpr}_${String(i).padStart(2, '0')}.png`), Buffer.from(fr.img.split(',')[1], 'base64')));
    console.log(`${LAB} dpr${dpr} ${S.id}: ${frames.length} snímků, rychlost ${frames[0].v.toFixed(0)}–${frames.at(-1).v.toFixed(0)} px/s, s pukem ${frames.filter(f => f.has).length}/${frames.length}`);
    await p.waitForTimeout(300);
  }
  await ctx.close();
}
await b.close();
console.log('chyby v konzoli:', errs.length ? errs : 0);
process.exit(errs.length ? 1 : 0);
