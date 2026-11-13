// BOKY / KALHOTY V TRUPU + NOHY POD TĚLEM — deterministické měření (bez canvasu; tytéž čisté funkce jako draw:
// skateAdvance, skatePose, skateFeetSmooth, skinPants). node scripts/hip_pants_metrics.mjs [--k=3,4]
// Ondřej 2026-11-13: „hips jsou pozadu a vyčnívají", „tělo vleče nohy, a ne že nohy vezou tělo".
// RUBRIKA (stanovena PŘEDEM, 2026-11-13; 1× = 1,198 px na svět. jednotku; R = poloměr hráče):
//  V1 (K3, K4) Plocha kalhot (2 elipsy 0,5 × 0,46 R, středy skinPants(side, B.hh)) MIMO trup (torso r = 1,04 R, natočený o twT),
//     px² při 1× — max přes 24 směrů jízdy 165 px/s a stop (stopT = 1, 60 px/s, 24 směrů).
//     Práh: ≤ 1,1 × plocha nenatočených kalhot (hh = 0, twT = 0 = původní návrh).
//  V2 (jen K4) Jízda vpřed 165 px/s: každá brusle (střed) je na ledě a před středem těla (x ≥ 0 ve směru jízdy) ≥ 25 % cyklu
//     a každé přistání (konec letu) je v x ≥ +0,2 R.
const { PLAYER } = await import('../public/js/constants.js');
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { skinPants } = await import('../public/js/entities/skin.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const KS = String(ARG.k ?? '3,4').split(',').map(Number);
const R = PLAYER.radius, SC = 1.198, DT = 1 / 60;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// trup = skin.js torso() (bez deformace jd), vzorkovaný polygon
const torsoPoly = (() => { const r = R * 1.04, pts = [], q = (a, c, b) => { for (let i = 1; i <= 24; i++) { const t = i / 24, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  let p0 = [r * 0.35, -r * 1.2]; const seg = [[[r * 0.75, -r * 0.6], [r * 0.55, 0]], [[r * 0.75, r * 0.6], [r * 0.35, r * 1.2]], [[-r * 0.15, r * 1.42], [-r * 0.75, r * 0.85]], [[-r * 1.05, 0], [-r * 0.75, -r * 0.85]], [[-r * 0.15, -r * 1.42], [r * 0.35, -r * 1.2]]];
  pts.push(p0); for (const [c, b] of seg) { q(p0, c, b); p0 = b; } return pts; })();
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const G = 0.05;   // mřížka (svět. j.; 1 bod = 0,0036 px² při 1×)
const _memo = new Map();
function pantsOut(hh, twT) {
  const key = hh.toFixed(4) + ',' + twT.toFixed(4); if (_memo.has(key)) return _memo.get(key);
  const c = Math.cos(-twT), s = Math.sin(-twT), PT = [-1, 1].map(sd => skinPants(sd, hh)); let n = 0, dMax = 0;
  const x0 = Math.min(...PT.map(q => q.x)) - 0.5 * R, x1 = Math.max(...PT.map(q => q.x)) + 0.5 * R, y0 = Math.min(...PT.map(q => q.y)) - 0.46 * R, y1 = Math.max(...PT.map(q => q.y)) + 0.46 * R;
  for (let i = 0; x0 + i * G <= x1; i++) for (let j = 0; y0 + j * G <= y1; j++) { const x = x0 + (i + 0.5) * G, y = y0 + (j + 0.5) * G;
    if (!PT.some(q => ((x - q.x) / (0.5 * R)) ** 2 + ((y - q.y) / (0.46 * R)) ** 2 <= 1)) continue;
    const tx = x * c - y * s, ty = x * s + y * c; if (!inPoly(tx, ty, torsoPoly)) { n++; let d = Infinity; for (const [px, py] of torsoPoly) d = Math.min(d, Math.hypot(tx - px, ty - py)); dMax = Math.max(dMax, d); } }   // bod do rámce trupu
  const A = n * G * G * SC * SC; _dMax.set(key, dMax * SC); _memo.set(key, A); return A; }
const _dMax = new Map(), protr = (hh, twT) => (pantsOut(hh, twT), _dMax.get(hh.toFixed(4) + ',' + twT.toFixed(4)));
if (ARG.scan) { for (let d = 0; d <= 1.25; d += 0.05) console.log(`hh ${d.toFixed(2)}: K3 ${pantsOut(d, 0).toFixed(1)} px² / ${protr(d, 0).toFixed(2)} px   K4 ${pantsOut(d, d * 0.5).toFixed(1)} px² / ${protr(d, d * 0.5).toFixed(2)} px`); process.exit(0); }
function run(k, vx, vy, T, stopT = 0) {
  const st = { _skatePhase: 0 }; let x = 0, y = 0; const F = [], spd = Math.hypot(vx, vy), mLoc = spd > 8 ? Math.atan2(vy, vx) : 0;
  for (let t = 0; t < T; t++) { x += vx * DT; y += vy * DT;
    skateAdvance(st, x, y, 0, spd, k, mLoc, DT);
    const pose = skatePose({ k, phase: st._skatePhase, spd, mLoc: st._mLocS, stopT, stopLoc: mLoc, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, bwV: st._bwV });
    if (k === 4) skateFeetSmooth(st, pose.feet, DT, 0, null, null, true); else skateFeetSmooth(st, pose.feet, DT);
    F.push(pose); }
  return F; }
const base = pantsOut(0, 0), lim = base * 1.1; let allOk = true;
for (const k of KS) {
  const out = []; let worst = 0, wl = '';
  for (const [lab, v, stopT] of [['jízda 165', 165, 0], ['stop', 60, 1]]) for (let i = 0; i < 24; i++) { const m = -Math.PI + (i + 0.5) * Math.PI / 12;
    for (const P of run(k, Math.cos(m) * v, Math.sin(m) * v, 150, stopT)    .filter((_, i) => i >= 120 && i % 5 === 0)) { const a = pantsOut(P.body.hh ?? P.body.h ?? 0, P.body.twT ?? 0);
      if (a > worst) { worst = a; wl = `${lab} ${(m * 180 / Math.PI).toFixed(0)}°`; } } }
  out.push(['V1 kalhoty mimo trup ≤ +10 %', worst <= lim + 1e-9, `max ${worst.toFixed(1)} px² (${wl}); nenatočené ${base.toFixed(1)} px², práh ${lim.toFixed(1)}`]);
  if (k === 4) { const F = run(4, 165, 0, 360).slice(120); const det = []; let ok = true;
    for (const side of [-1, 1]) { let fr = 0, minLand = Infinity;
      for (let i = 0; i < F.length; i++) { const f = F[i].feet.find(q => q.side === side);
        if (f.lift < 0.05 && f.x >= 0) fr++;
        if (i > 0 && F[i - 1].feet.find(q => q.side === side).lift >= 0.05 && f.lift < 0.05) minLand = Math.min(minLand, f.x); }
      const p = fr / F.length; det.push(`${side < 0 ? 'L' : 'P'} ${(p * 100).toFixed(0)} % před, přistání ${(minLand / R).toFixed(2)} R`);
      if (p < 0.25 || !(minLand >= 0.2 * R)) ok = false; }
    out.push(['V2 nohy vezou tělo (≥25 %, přist. ≥0,2 R)', ok, det.join(' · ')]); }
  console.log(`== K${k} — ${out.filter(o => o[1]).length}/${out.length}`); for (const [n, ok, d] of out) console.log(`  ${ok ? 'OK  ' : 'NE  '} ${n.padEnd(42)} ${d}`);
  if (!out.every(o => o[1])) allOk = false;
}
process.exit(allOk ? 0 : 1);
