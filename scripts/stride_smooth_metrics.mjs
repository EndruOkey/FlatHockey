// „PO KOUSKÁCH" — plynulost kroku (2026-11-16, Ondřej: „bruslí po kouskách, hrozně se zasekává po pidi kouscích, měla by být
// víc ucelená a hokejová"). Deterministicky, čisté funkce kresby vč. ukotvení (skateFeetSmooth s x, y). node scripts/stride_smooth_metrics.mjs
// RUBRIKA (předem): jízda vpřed 165 px/s, 4 s, poloha brusle v lokálu těla:
//   P1 obraty pohybu brusle vpřed/vzad ≤ 2 na krok a nohu (ucelený krok: tam a zpět, žádné cukání)
//   P2 „zaseknutí": snímky uprostřed pohybu, kdy brusle (lokál) stojí < 0,1 px a pak se zase rozjede, ≤ 2 % snímků
//   P3 trhanost: medián |změny rychlosti| / medián |rychlosti| ≤ 0,35
const { skateAdvance, skatePose, skateFeetSmooth, skateCycle } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const SC = 1.198, DT = 1 / 60, v = 165;
const med = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const st = { _skatePhase: 0 }; let x = 0; const P = { '-1': [], '1': [] };
for (let t = 0; t < 360; t++) { x += v * DT; skateAdvance(st, x, 0, 0, v, 3, 0, DT);
  const p = skatePose({ k: 3, phase: st._skatePhase, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
  skateFeetSmooth(st, p.feet, DT, 0, x, 0);
  if (t >= 120) for (const f of p.feet) P[f.side].push([f.x * SC, f.y * SC]); }
const steps = 240 * DT * v / skateCycle(3, v);
let rev = 0, stall = 0, n = 0; const dv = [], vv = [];
for (const s of ['-1', '1']) { const a = P[s]; let pd = 0;
  for (let i = 1; i < a.length; i++) { const vx = a[i][0] - a[i - 1][0], vy = a[i][1] - a[i - 1][1], sp = Math.hypot(vx, vy); n++; vv.push(sp);
    if (i > 1) { const ux = a[i - 1][0] - a[i - 2][0], uy = a[i - 1][1] - a[i - 2][1]; dv.push(Math.hypot(vx - ux, vy - uy));
      if (Math.abs(vx) > 0.05 && pd && Math.sign(vx) !== pd) rev++;
      if (sp < 0.1 && i + 1 < a.length && Math.hypot(a[i + 1][0] - a[i][0], a[i + 1][1] - a[i][1]) > 0.3 && Math.hypot(ux, uy) > 0.3) stall++; }
    if (Math.abs(vx) > 0.05) pd = Math.sign(vx); } }
const P1 = rev / 2 / steps, P2 = stall / n * 100, P3 = med(dv) / med(vv);
console.log(`${P1 <= 2 ? 'OK' : 'NE'} P1 obraty ${P1.toFixed(2)}/krok  ${P2 <= 2 ? 'OK' : 'NE'} P2 zaseknutí ${P2.toFixed(1)} %  ${P3 <= 0.35 ? 'OK' : 'NE'} P3 trhanost ${P3.toFixed(2)}  (kroků ${steps.toFixed(1)})`);
