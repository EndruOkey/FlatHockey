// Snímek zóny převzetí puku (Player._drawPickupAid) ve 4 stavech vedle sebe: daleko / blízko / v dosahu / ztráta.
// Kreslí přímo modul Player.js do canvasu (deterministicky, bez zápasu). node scripts/pickup_aid_shot.mjs [url] [out.png]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4931/';
const out = process.argv[3] || 'pickup_aid.png';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 280 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.evaluate(async () => {
  const { Player } = await import('/js/entities/Player.js');
  const { PLAYER } = await import('/js/constants.js');
  document.body.innerHTML = ''; const c = document.createElement('canvas'); c.width = 1000; c.height = 280; document.body.appendChild(c);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#dfe9f2'; ctx.fillRect(0, 0, 1000, 280);
  const S = 4.2, labels = ['puk 45 px', 'puk 22 px', 'v dosahu', 'ztráta (záblesk)'];
  for (let i = 0; i < 4; i++) {
    const pl = new Player('me' + i, 'home', { dx: 0, dy: 0 });
    pl.x = 0; pl.y = 0; pl.vx = pl.vy = 0; pl.aimAngle = pl.carryAngle = pl.bodyAngle = pl.skateAngle = 0; pl.name = 'TY';
    pl._isLocal = true; pl._others = [];
    const tip = pl.stickTip;
    const dist = [45, 22, 4, 8][i];
    const puck = { x: tip.x + dist, y: tip.y + 3, vx: 0, vy: 0, z: 0, ownerId: null };
    pl._puckView = puck;
    if (i === 3) { pl.hasPuck = true; pl._aidHad = true; pl.hasPuck = false; pl._aidHad = true; }
    const cam = { scale: S, ox: 70 + i * 245, oy: 150 };
    if (i === 3) { pl._aidHad = true; }     // hrana hasPuck true→false se zaznamená při kreslení
    pl.draw(ctx, cam);
    // puk (zjednodušeně: černý disk) — kreslí se v hře POD hráčem, tady navrch kvůli čitelnosti snímku
    ctx.beginPath(); ctx.arc(cam.ox + puck.x * S, cam.oy + puck.y * S, 3 * S, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
    ctx.fillStyle = '#222'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(labels[i], 20 + i * 245, 265);
  }
});
await p.waitForTimeout(50);
await p.screenshot({ path: out });
console.log('snímek:', out, '| chyby JS:', errs.length ? errs : 0);
await b.close();
