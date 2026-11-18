// SNÍMEK VARIANT TLOUŠŤKY HOLE (VIS.s) v herním rendereru (trénink, ?fhtest), střední hůl, puk na čepeli; 2 natočení (vpravo, šikmo dolů).
// Server: PORT=56xx node server.js.   node scripts/stick_taper_shot.mjs --port=56xx --out=taper.png [--vis=3,4,5,6]
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 5690, OUT = A.out || 'taper.png', SV = String(A.vis || '3,4,5,6').split(',').map(Number);
const errs = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto(`http://localhost:${PORT}/?fhtest`, { waitUntil: 'load' });
await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
const res = await p.evaluate(async (SV) => {
  const VM = await import('/js/vis.js'); const jobs = []; for (const sv of SV) for (const ang of [0, 0.9]) jobs.push({ sv, ang });
  const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas'), inp = g.input, L = g.local;
  const sc = cv.width / cv.clientWidth, W = 56, crops = [], info = [];
  for (const { sv, ang } of jobs) {
    VM.VIS.s = sv; L.stickId = 1; L.x = 300; L.y = 300; L.vx = 0; L.vy = 0; L.bodyAngle = L.skateAngle = L.aimAngle = L.carryAngle = ang;
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) inp.keys[k] = false;
    const prev = eng.onDraw; let f = 0;
    await new Promise(r => {
      eng.onDraw = (c) => {
        const cam = g._cam; f++;
        if (f < 30 && !L.hasPuck && g.puck) { const t = L.stickTip; g.puck.x = t.x; g.puck.y = t.y; g.puck.vx = L.vx; g.puck.vy = L.vy; g.puck.z = 0; g.puck.vz = 0; }
        inp.mouseX = cam.ox + (L.x + 90 * Math.cos(ang)) * cam.scale; inp.mouseY = cam.oy + (L.y + 90 * Math.sin(ang)) * cam.scale;   // kurzor 90 px vpravo = běžné vysunutí
        prev(c);
        if (f < 90) return;
        const cx = (cam.ox + L.x * cam.scale) * sc, cy = (cam.oy + L.y * cam.scale) * sc, w = W * cam.scale * sc;
        const o = document.createElement('canvas'); o.width = w; o.height = w;
        o.getContext('2d').drawImage(cv, cx - w / 2 + w * 0.22, cy - w / 2, w, w, 0, 0, w, w);
        crops.push(o); const t = L.stickTip;
        info.push({ sv, ang, reach: +(L._dispReach).toFixed(2), tipFromGrip: +Math.hypot(t.x - L.gripPoint.x, t.y - L.gripPoint.y).toFixed(2), puckToTip: +Math.hypot(g.puck.x - t.x, g.puck.y - t.y).toFixed(2), has: !!L.hasPuck });
        eng.onDraw = prev; r();
      };
    });
  }
  const T = 300, H = 40, n = SV.length, out = document.createElement('canvas'); out.width = n * T + (n + 1) * 8; out.height = 2 * T + H + 16;
  const x = out.getContext('2d'); x.fillStyle = '#0b1424'; x.fillRect(0, 0, out.width, out.height);
  x.font = 'bold 20px Segoe UI, sans-serif'; x.fillStyle = '#eef4fb';
  const NM = { 0: 'S0 původní', 1: 'S1 štíhlá', 2: 'S2 lopatka', 3: 'S3 dnešní', 4: 'S4 zúžená', 5: 'S5 nejtenčí', 6: 'S6 silné zúžení' };
  SV.forEach((sv, i) => { x.fillText(NM[sv] || 'S' + sv, 8 + i * (T + 8), 28); for (let r = 0; r < 2; r++) x.drawImage(crops[i * 2 + r], 8 + i * (T + 8), H + r * (T + 8), T, T); });
  VM.VIS.s = 3;
  return { png: out.toDataURL('image/png'), info };
}, SV);
writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(JSON.stringify(res.info)); console.log(errs.length ? errs.join('\n') : 'bez chyb stránky'); console.log('uloženo', OUT);
await b.close();
