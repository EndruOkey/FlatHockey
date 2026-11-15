// PLYNULOST JÍZDY BOKEM — ráz bruslí (2. diference polohy v rámci těla, px/snímek² v 1×). node scripts/side_smooth_metrics.mjs
// Ondřej 2026-11-15: „bruslení do boků je hnusný, přešlapování do stran působí, jak kdyby se sekal".
// RUBRIKA (předem): S1 max ráz bokem (120 i 165 px/s, oba směry) ≤ 1,2 × max ráz jízdy vpřed 165 (tu Ondřej bere jako plynulou).
// S2 rubrika jízdy bokem (side_skate_metrics J1–J6) a viditelnost hlídají zvlášť.
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const R = PLAYER.radius, DT = 1 / 60, SC = 1.198;
function jerk(m, v) { const st = {}; let x = 0, y = 0; const H = { '-1': [], '1': [] }; let mx = 0;
  for (let i = 0; i < 240; i++) { x += Math.cos(m) * v * DT; y += Math.sin(m) * v * DT; skateAdvance(st, x, y, 0, v, 3, m, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: 0, bwS: st._bwS, lbS: st._lbS });
    skateFeetSmooth(st, P.feet, DT); if (i < 90) continue;
    for (const f of P.feet) { const h = H[f.side]; h.push([f.x - P.body.x, f.y - P.body.y]); if (h.length >= 3) { const [a, b, c] = h.slice(-3); mx = Math.max(mx, Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]) * SC); } } }
  return mx; }
const base = jerk(0, 165), L = base * 1.2; let fail = 0;
console.log(`vpřed 165: max ráz ${base.toFixed(3)} px/sn² → limit ${L.toFixed(3)}`);
for (const m of [Math.PI / 2, -Math.PI / 2]) for (const v of [120, 165]) { const j = jerk(m, v), ok = j <= L; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}  bokem ${m > 0 ? 'doprava' : 'doleva '} ${v}: max ráz ${j.toFixed(3)} (${(j / base).toFixed(1)}×)`); }
console.log(fail ? `NEPROŠLO ${fail}/4` : 'VŠE OK'); process.exit(fail ? 1 : 0);
