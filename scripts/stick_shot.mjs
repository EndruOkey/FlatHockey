// SNÍMEK DÉLEK HOLE v herním rendereru (trénink, ?fhtest): krátká / střední / dlouhá, puk na čepeli, stoj + mírná jízda.
// Server: PORT=56xx node server.js.   node scripts/stick_shot.mjs --port=56xx --out=sticks.png
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 5690, OUT = A.out || 'sticks.png';
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
const res = await p.evaluate(async () => {
  const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas'), inp = g.input, L = g.local;
  const sc = cv.width / cv.clientWidth, W = 56, crops = [], info = [];
  for (const sid of [0, 1, 2]) {
    L.stickId = sid; L.x = 300; L.y = 300; L.vx = 0; L.vy = 0; L.bodyAngle = L.skateAngle = L.aimAngle = L.carryAngle = 0;
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) inp.keys[k] = false;
    const prev = eng.onDraw; let f = 0;
    await new Promise(r => {
      eng.onDraw = (c) => {
        const cam = g._cam; f++;
        if (f < 30 && !L.hasPuck && g.puck) { const t = L.stickTip; g.puck.x = t.x; g.puck.y = t.y; g.puck.vx = L.vx; g.puck.vy = L.vy; g.puck.z = 0; g.puck.vz = 0; }
        inp.mouseX = cam.ox + (L.x + 90) * cam.scale; inp.mouseY = cam.oy + L.y * cam.scale;   // kurzor 90 px vpravo = běžné vysunutí
        prev(c);
        if (f < 90) return;
        const cx = (cam.ox + L.x * cam.scale) * sc, cy = (cam.oy + L.y * cam.scale) * sc, w = W * cam.scale * sc;
        const o = document.createElement('canvas'); o.width = w; o.height = w;
        o.getContext('2d').drawImage(cv, cx - w / 2 + w * 0.22, cy - w / 2, w, w, 0, 0, w, w);
        crops.push(o); const t = L.stickTip;
        info.push({ sid, reach: +(L._dispReach).toFixed(2), tipFromGrip: +Math.hypot(t.x - L.gripPoint.x, t.y - L.gripPoint.y).toFixed(2), puckToTip: +Math.hypot(g.puck.x - t.x, g.puck.y - t.y).toFixed(2), has: !!L.hasPuck });
        eng.onDraw = prev; r();
      };
    });
  }
  const T = 360, H = 40, out = document.createElement('canvas'); out.width = 3 * T + 4 * 8; out.height = T + H + 8;
  const x = out.getContext('2d'); x.fillStyle = '#0b1424'; x.fillRect(0, 0, out.width, out.height);
  x.font = 'bold 20px Segoe UI, sans-serif'; x.fillStyle = '#eef4fb';
  ['Krátká (15)', 'Střední (16)', 'Dlouhá (17,4)'].forEach((s, i) => { x.fillText(s, 8 + i * (T + 8), 28); x.drawImage(crops[i], 8 + i * (T + 8), H, T, T); });
  return { png: out.toDataURL('image/png'), info };
});
writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(JSON.stringify(res.info)); console.log(errs.length ? errs.join('\n') : 'bez chyb stránky'); console.log('uloženo', OUT);
await b.close();
