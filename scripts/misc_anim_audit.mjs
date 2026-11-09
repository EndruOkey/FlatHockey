// AUDIT dalších vizuálů: crosscheck (pravák/levák), puk ve vzduchu (z = 0 / 6 / 14 / 22 = nad břevnem).
// Kontrola: u crosschecku jsou obě ruce na holi (vzdálenost rukavic od dříku < 2 px). Server: PORT=4931 node server.js → _misc_audit.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 400 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  const { Player } = await import('/js/entities/Player.js');
  const { Puck } = await import('/js/entities/Puck.js');
  const { RINK } = await import('/js/constants.js');
  document.body.innerHTML = ''; const c = document.createElement('canvas'); c.width = 1000; c.height = 400; document.body.appendChild(c);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#dfe9f2'; ctx.fillRect(0, 0, 1000, 400);
  const S = 4.5, CX = RINK.w / 2, CY = RINK.h / 2;
  [[1, 'crosscheck pravák'], [-1, 'crosscheck levák'], [1, 'pravák s pukem'], [-1, 'levák s pukem']].forEach(([h, lab], i) => {
    const pl = new Player('p' + i, 'home', { dx: 0, dy: 0, rmb: i < 2 }); pl.rng = { next: () => 0.5 };
    pl.x = CX; pl.y = CY; pl.aimAngle = pl.carryAngle = pl.bodyAngle = pl._stickDisp = 0; pl.handed = h; pl._others = []; pl.aimDist = 70;
    pl.crossCheck = i < 2; pl.hasPuck = i >= 2;
    const pk = new Puck(); if (pl.hasPuck) pk._cradleTo(pl);
    for (let k = 0; k < 20; k++) pl._updateStickDisplay(1 / 60);
    const cx = 110 + i * 230, cy = 110, cam = { scale: S, ox: cx - CX * S, oy: cy - CY * S, t: 0, dt: 0 };
    pl.draw(ctx, cam);
    ctx.fillStyle = '#123'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(lab, cx, cy + 80);
  });
  [0, 6, 14, 22].forEach((z, i) => {
    const pk = new Puck(); pk.x = CX; pk.y = CY; pk.z = z; pk.vx = 200; pk.vy = 0; pk._trail = [];
    const cx = 110 + i * 230, cy = 300, cam = { scale: S, ox: cx - CX * S, oy: cy - CY * S, t: 0, dt: 0 };
    pk.draw(ctx, cam);
    ctx.fillStyle = '#123'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`puk z = ${z}${z > 21 ? ' (nad břevnem)' : ''}`, cx, cy + 80);
  });
});
await p.screenshot({ path: '_misc_audit.png' }); console.log('chyby JS:', errs.length ? errs : 0); await b.close();
