// Závisí pohyb hráče na FPS? Stejný vstup 2 s při různém dt → uražená dráha. node scripts/fps_drift.mjs
import { Player } from '../public/js/entities/Player.js';
const run = (hz, secs = 2, dirSwitch = false) => { const inp = { dx: 1, dy: 0, keys: {}, lmb: false, rmb: false, mmb: false };
  const p = new Player('t', 'home', inp); p.x = 300; p.y = 200; p.aimAngle = 0; p.aimDist = 120;
  const n = Math.round(secs * hz); for (let i = 0; i < n; i++) { if (dirSwitch && i === Math.round(n / 2)) { inp.dx = 0; inp.dy = 1; } p.update(1 / hz); }
  return { hz, x: +p.x.toFixed(1), y: +p.y.toFixed(1), v: +Math.hypot(p.vx, p.vy).toFixed(1) }; };
for (const sw of [false, true]) console.log(sw ? 'se změnou směru:' : 'rovně:', JSON.stringify([60, 135, 170, 240].map(h => run(h, 2, sw))));
