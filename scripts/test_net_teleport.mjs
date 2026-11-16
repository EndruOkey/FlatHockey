// TELEPORT v jitter-bufferu (net-interp.js). Ondřej 2026-11-16: „při buly … občas roztažená šmouha".
// RUBRIKA (předem): T1 během teleportu žádná mezipoloha (vzdálenost od staré i nové polohy > 2 R = šmouha) — 0 snímků
//   T2 rychlost předaná kresbě po teleportu ≤ 400 px/s; T3 extrapolace po teleportu nevyjede > 1 R od nové polohy
//   T4 běžná jízda 200 px/s beze změny (interpolace = přesná poloha, rychlost 200 ± 1)
import { lerpSample, extrapSample } from '../public/js/net-interp.js';
const R = 7, iv = 1 / 30, A = { x: 100, y: 300 }, B = { x: 640, y: 290 };
let t1 = 0, t2 = 0; for (let i = 0; i <= 20; i++) { const s = lerpSample(A, B, i / 20, iv);
  if (Math.hypot(s.x - A.x, s.y - A.y) > 2 * R && Math.hypot(s.x - B.x, s.y - B.y) > 2 * R) t1++; t2 = Math.max(t2, Math.hypot(s.vx, s.vy)); }
const e = extrapSample(A, B, iv, 0.22), t3 = Math.hypot(e.x - B.x, e.y - B.y);
const n = lerpSample({ x: 0, y: 0 }, { x: 200 * iv, y: 0 }, 0.5, iv), t4 = Math.abs(n.x - 100 * iv) < 1e-9 && Math.abs(n.vx - 200) <= 1;
const ok = [t1 === 0, t2 <= 400, t3 <= R, t4];
console.log(`${ok[0] ? 'OK' : 'NE'} T1 mezipolohy ${t1}\n${ok[1] ? 'OK' : 'NE'} T2 rychlost ${t2.toFixed(0)} px/s\n${ok[2] ? 'OK' : 'NE'} T3 extrapolace ${t3.toFixed(1)}\n${ok[3] ? 'OK' : 'NE'} T4 běžná jízda`);
console.log(ok.every(Boolean) ? 'VŠE OK' : 'NEPROŠLO'); process.exit(ok.every(Boolean) ? 0 : 1);
