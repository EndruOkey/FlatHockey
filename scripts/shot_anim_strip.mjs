// Filmový pás střely tahem: nápřah (stažení) → výstřel → švih + dokončení. Pevný krok 1/60 s, bez zápasu (deterministické).
// Server: PORT=4931 node server.js. node scripts/shot_anim_strip.mjs [out=_shot_strip.png]
import { chromium } from 'playwright';
const out = process.argv[2] || '_shot_strip.png';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 620 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
const res = await p.evaluate(async () => {
  const { Player } = await import('/js/entities/Player.js');
  const { Puck } = await import('/js/entities/Puck.js');
  const { RINK } = await import('/js/constants.js'); const CX = RINK.w / 2, CY = RINK.h / 2;
  document.body.innerHTML = ''; const c = document.createElement('canvas'); c.width = 1200; c.height = 620; document.body.appendChild(c);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#dfe9f2'; ctx.fillRect(0, 0, 1200, 620);
  const res = [];
  for (const [row, H] of [[0, 1], [1, -1]]) {
  const pl = new Player('me', 'home', { dx: 0, dy: 0 }); pl.rng = { next: () => 0.5 }; pl.handed = H;
  pl.x = CX; pl.y = CY; pl.vx = pl.vy = 0; pl.aimAngle = pl.carryAngle = pl.bodyAngle = pl.skateAngle = pl._stickDisp = -Math.PI / 2;
  pl.aimDist = 90; pl.hasPuck = true; pl._others = []; pl.name = '';
  const puck = new Puck(); const dt = 1 / 60;
  // [frame index, label] — nabíjení 0,7 s (42 f), výstřel na f 42, pak 14 f dokončení
  const keys = { 0: 'klid', 14: 'nápřah 0,23 s', 28: 'nápřah 0,47 s', 41: 'plně staženo', 43: 'výstřel +1 f', 46: '+4 f švih', 50: '+8 f dokončení', 56: '+14 f návrat' };
  let col = 0; const S = 3.6;
  for (let f = 0; f <= 56; f++) {
    if (f < 42) pl.charge = Math.min(1, f / 30);
    if (f === 42) { pl.shoot(puck, 1, false); pl.charge = 0; }
    pl._updateStick(dt); pl._updateStickDisplay(dt);
    if (pl.hasPuck) puck._cradleTo(pl); else { puck.x += puck.vx * dt; puck.y += puck.vy * dt; }
    if (f === 41) { const d = pl._visStick - pl.bodyAngle, side = Math.sign(Math.sin(d)); res.push({ H, side, ok: side === H }); }
    if (keys[f] != null) {
      const cam = { scale: S, ox: 75 + col * 148 - CX * S, oy: 190 + row * 300 - CY * S };
      ctx.save(); ctx.beginPath(); ctx.rect(col * 148, row * 300, 148, 290); ctx.clip(); pl.draw(ctx, cam);
      puck.z = 0; puck._trail = []; puck.draw(ctx, cam); const g = pl.gripPoint; ctx.fillStyle = '#e33'; ctx.fillRect(cam.ox + g.x * S - 3, cam.oy + g.y * S - 3, 6, 6); ctx.restore();
      ctx.fillStyle = '#223'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(keys[f], 75 + col * 148, 285 + row * 300);
      col++;
    }
  }

  ctx.fillStyle = '#c00'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(H === 1 ? 'PRAVÁK (R)' : 'LEVÁK (L)', 6, 20 + row * 300);
  }
  return res;
});
await p.screenshot({ path: out }); console.log('nápřah na straně rukou:', res.map(r => `${r.H === 1 ? 'pravák' : 'levák'} ${r.ok ? 'OK' : 'ŠPATNĚ'}`).join(', ')); console.log('snímek', out, '| chyby JS:', errs.length ? errs : 0); await b.close();
