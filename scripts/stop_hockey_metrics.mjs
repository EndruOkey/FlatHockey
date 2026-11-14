// HOKEJOVÝ STOP — deterministické měření (bez canvasu; tytéž čisté funkce jako draw: skateStopDrive → skatePose).
// node scripts/stop_hockey_metrics.mjs
// Ondřej 2026-11-14: „chceme hockey stop, najdi si a deterministicky zkoušej". Předloha (Hockey Canada Coach 1, MAHG skills, Riedell):
// boky se otočí, obě brusle kolmo (Riedell ~„2:30" = méně než 90°) a rovnoběžně, na šíři ramen, kolena pokrčená, váha na hranách.
// Shora: dvě rovnoběžná ostří napříč jízdy, brusle ZA SEBOU podél jízdy, před těžištěm.
// Fyzika brzdy (změřeno ve hře 2026-11-14, scripts/stop_shots.mjs): držený Space zpomalí ~620 px/s² (134 → 0 za ~0,22 s; 31 px/s za 3 snímky).
// RUBRIKA (předem, 2026-11-14):
//  ČASOVÁNÍ  H1 držený Space z 140 px/s: póza ≥ 0,8 do 0,1 s od začátku brzdy.
//            H2 póza > 0,3 trvá nejvýš doba brzdění + 0,3 s (ťuknutí Space 2 snímky; jízda 165 px/s a dojezd třením = póza 0).
//            H3 0,5 s po zastavení (Space dál držen) póza ≤ 0,1.
//            H10 (doplněno: nový rychlý náběh) jízda 140 px/s → držený Space: špička/pata brusle skočí ≤ 3 px za snímek (1×), jako S3.
//  GEOMETRIE (plná póza, směr jízdy vůči tělu 0°, ±45°, ±90°, 180°, pravák i levák):
//            H4 ostří vůči směru jízdy 70–100°.   H5 ostří navzájem rovnoběžná ±20°.
//            H6 středy bruslí od sebe podél jízdy 1,2–2,0 R, napříč ≤ 0,6 R.   H7 střed bruslí před středem těla (≥ 0 R po jízdě).
//            H8 kotník ≤ 1,6 R od kyčle.
//            H9 (doplněno po 1. běhu: brusle za sebou se schovaly pod trup, S1/R8 0 %) každá brusle ≥ 2 px a aspoň jedna ≥ 3 px
//               mimo siluetu těla (maska ze skate_stop_metrics / skate_anim_metrics), 1× = 1,198 px na jednotku.
import { PLAYER } from '../public/js/constants.js';
const { skateStopDrive, skatePose, skateAdvance, skateFeetSmooth, SKATE_K3 } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
const R = PLAYER.radius, DT = 1 / 60, DEC = 620, FRIC = 60, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
// ── silueta těla (kopie ze scripts/skate_anim_metrics.mjs)
const G = 0.2, N = 220, O = N / 2;
const inEll = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const torsoPoly = (() => { const r = R * 1.04, pts = [], q = (a, c, b) => { for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  let p0 = [r * 0.35, -r * 1.2]; const seg = [[[r * 0.75, -r * 0.6], [r * 0.55, 0]], [[r * 0.75, r * 0.6], [r * 0.35, r * 1.2]], [[-r * 0.15, r * 1.42], [-r * 0.75, r * 0.85]], [[-r * 1.05, 0], [-r * 0.75, -r * 0.85]], [[-r * 0.15, -r * 1.42], [r * 0.35, -r * 1.2]]];
  pts.push(p0); for (const [c, b] of seg) { q(p0, c, b); p0 = b; } return pts; })();
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function bodyMask(tw) {
  const m = new Uint8Array(N * N), S = [[R * 0.25, -R * 0.9], [R * 0.25, R * 0.9]].map(([x, y]) => [x * Math.cos(tw) - y * Math.sin(tw), x * Math.sin(tw) + y * Math.cos(tw)]);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = (i - O) * G, y = (j - O) * G;
    m[i * N + j] = inPoly(x, y, torsoPoly) || S.some(s => inEll(x, y, s[0] - R * 0.12, s[1] * 0.98, R * 0.48, R * 0.42)) || inEll(x, y, -R * 0.62, -R * 0.62, R * 0.5, R * 0.46)
      || inEll(x, y, -R * 0.62, R * 0.62, R * 0.5, R * 0.46) || inEll(x, y, R * 0.72, 0, R * 0.55 * 1.12, R * 0.5 * 1.12) ? 1 : 0; }
  const edge = []; for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) if (m[i * N + j] && (!m[(i + 1) * N + j] || !m[(i - 1) * N + j] || !m[i * N + j + 1] || !m[i * N + j - 1])) edge.push([(i - O) * G, (j - O) * G]);
  return { m, edge };
}
const _masks = new Map();
const maskFor = tw => { const key = Math.round(tw * 50); let v = _masks.get(key); if (!v) { v = bodyMask(key / 50); _masks.set(key, v); } return v; };
function outside(x, y, M) { const i = Math.round(x / G) + O, j = Math.round(y / G) + O;
  if (i >= 0 && i < N && j >= 0 && j < N && M.m[i * N + j]) return 0;
  let d = 1e9; for (const [ex, ey] of M.edge) { const q = (x - ex) ** 2 + (y - ey) ** 2; if (q < d) d = q; } return Math.max(0, Math.sqrt(d) - 1.0); }
const SK = []; for (let a = -0.62; a <= 0.521; a += 0.0285) for (const b of [-0.24, 0, 0.24]) SK.push([a * R, b * R + Math.sign(b) * 0.8]);
SK.push([-0.62 * R - 0.8, 0], [0.52 * R + 0.8, 0]);
const skatePts = f => { const c = Math.cos(f.a), s = Math.sin(f.a), k = 1 + 0.08 * (f.lift || 0); return SK.map(([a, b]) => [f.x + (a * c - b * s) * k, f.y + (a * s + b * c) * k]); };
const SC = 1.198;
const lineDiff = (a, b) => { const d = Math.abs(ad(a - b)) % Math.PI; return Math.min(d, Math.PI - d) * 180 / Math.PI; };
const res = [];
// časování: profil(t) → { space, brake } ; rychlost se integruje (brzda DEC jen při space, jinak tření FRIC)
function timeline(T, v0, spaceFn) {
  const st = {}; let v = v0; const out = [];
  for (let i = 0; i <= Math.round(T / DT); i++) { const t = i * DT, sp = spaceFn(t);
    v = Math.max(0, v - (sp ? DEC : FRIC) * DT); out.push({ t, v, sp, s: skateStopDrive(st, v, sp, DT) }); }
  return out;
}
{ // H1 + H3: držený Space od 0,2 s do konce (2 s)
  const tl = timeline(2, 140, t => t >= 0.2), t0 = 0.2, hit = tl.find(r => r.t >= t0 && r.s >= 0.8), stopT = tl.find(r => r.t > t0 && r.v === 0).t;
  const late = tl.filter(r => r.t >= stopT + 0.5);
  res.push(['H1 náběh ≥0,8 do 0,1 s', !!hit && hit.t - t0 <= 0.1 + 1e-9, hit ? `${((hit.t - t0) * 1000).toFixed(0)} ms` : 'nikdy']);
  res.push(['H3 po zastavení ≤0,1 za 0,5 s', late.every(r => r.s <= 0.1), `max ${Math.max(...late.map(r => r.s)).toFixed(2)} (zastaven v ${(stopT - t0).toFixed(2)} s)`]);
  const brakeDur = stopT - t0, poseDur = tl.filter(r => r.s > 0.3).length * DT;
  res.push(['H2a držení: póza ≤ brzda + 0,3 s', poseDur <= brakeDur + 0.3 + 1e-9, `póza ${poseDur.toFixed(2)} s, brzda ${brakeDur.toFixed(2)} s`]);
}
{ const tl = timeline(1.5, 140, t => t >= 0.2 && t < 0.2 + 2 * DT), poseDur = tl.filter(r => r.s > 0.3).length * DT;
  res.push(['H2b ťuknutí: póza ≤ 2 sn. + 0,3 s', poseDur <= 2 * DT + 0.3 + 1e-9, `póza ${poseDur.toFixed(2)} s, max ${Math.max(...tl.map(r => r.s)).toFixed(2)}`]); }
{ const st = {}; let mx = 0; for (let i = 0; i < 120; i++) mx = Math.max(mx, skateStopDrive(st, 165, false, DT));
  const tl = timeline(3, 165, () => false);
  res.push(['H2c jízda / dojezd třením: póza 0', mx === 0 && tl.every(r => r.s === 0), `max ${Math.max(mx, ...tl.map(r => r.s)).toFixed(2)}`]); }
{ // H10: plynulost náběhu (stejné čisté funkce jako draw)
  const st = {}, sd = {}; let v = 140, x = 0, prev = null, mx = 0, at = 0;
  for (let i = 0; i <= 90; i++) { const t = i * DT, sp = t >= 0.5; v = Math.max(0, v - (sp ? DEC : 0) * DT); x += v * DT;
    skateAdvance(st, x, 0, 0, v, 3, 0, DT); const s = skateStopDrive(sd, v, sp, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd: v, mLoc: st._mLocS ?? 0, stopT: s, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS });
    skateFeetSmooth(st, P.feet, DT);
    const th = P.feet.map(f => [[f.x + Math.cos(f.a) * 0.52 * R, f.y + Math.sin(f.a) * 0.52 * R], [f.x - Math.cos(f.a) * 0.62 * R, f.y - Math.sin(f.a) * 0.62 * R]]);
    if (prev && i > 30) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const d = Math.hypot(th[a][b][0] - prev[a][b][0], th[a][b][1] - prev[a][b][1]) * 1.198; if (d > mx) { mx = d; at = t; } }
    prev = th; }
  res.push(['H10 skok brusle ≤3 px/snímek', mx <= 3, `max ${mx.toFixed(2)} px (t ${at.toFixed(2)} s)`]); }
// geometrie plné pózy
const GG = { h4: [180, 0], h5: 0, h6a: [9, 0], h6n: 0, h7: 9, h8: 0, h9: [99, 99] };
for (const hs of [1, -1]) for (const m of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
  const P = skatePose({ k: 3, phase: 0, spd: 0, mLoc: 0, stopT: 1, stopLoc: m, rotSf: 0, lean: 0, hs, thr: 0 });
  const [f1, f2] = P.feet, tx = Math.cos(m), ty = Math.sin(m);
  for (const f of P.feet) { const d = lineDiff(f.a, m); GG.h4 = [Math.min(GG.h4[0], d), Math.max(GG.h4[1], d)];
    const kx = f.x - Math.cos(f.a) * 0.32 * R, ky = f.y - Math.sin(f.a) * 0.32 * R, hp = skinHip(f.side, P.body.hh ?? 0); GG.h8 = Math.max(GG.h8, Math.hypot(kx - P.body.x - hp.x, ky - P.body.y - hp.y) / R); }   // kyčel jede s trupem (záklon body.x/y), jako ve skinBody
  { const M = maskFor(P.body.tw), e = P.feet.map(ft => { let v = 0; for (const [x, y] of skatePts(ft)) v = Math.max(v, outside(x - P.body.x, y - P.body.y, M)); return v * SC; });
    GG.h9 = [Math.min(GG.h9[0], Math.min(...e)), Math.min(GG.h9[1], Math.max(...e))]; }
  GG.h5 = Math.max(GG.h5, lineDiff(f1.a, f2.a));
  const dx = f1.x - f2.x, dy = f1.y - f2.y, al = Math.abs(dx * tx + dy * ty) / R, ac = Math.abs(-dx * ty + dy * tx) / R;
  GG.h6a = [Math.min(GG.h6a[0], al), Math.max(GG.h6a[1], al)]; GG.h6n = Math.max(GG.h6n, ac);
  GG.h7 = Math.min(GG.h7, (((f1.x + f2.x) / 2 - P.body.x) * tx + ((f1.y + f2.y) / 2 - P.body.y) * ty) / R);
}
res.push(['H4 ostří 70–100° k jízdě', GG.h4[0] >= 70 && GG.h4[1] <= 100, `${GG.h4[0].toFixed(0)}–${GG.h4[1].toFixed(0)}°`]);
res.push(['H5 rovnoběžná ±20°', GG.h5 <= 20, `max ${GG.h5.toFixed(0)}°`]);
res.push(['H6 za sebou 1,2–2,0 R, napříč ≤0,6', GG.h6a[0] >= 1.2 && GG.h6a[1] <= 2.0 && GG.h6n <= 0.6, `podél ${GG.h6a[0].toFixed(2)}–${GG.h6a[1].toFixed(2)} R, napříč ${GG.h6n.toFixed(2)} R`]);
res.push(['H7 brusle před těžištěm', GG.h7 >= 0, `min ${GG.h7.toFixed(2)} R`]);
res.push(['H8 kotník ≤1,6 R od kyčle', GG.h8 <= 1.6, `max ${GG.h8.toFixed(2)} R`]);
res.push(['H9 brusle vidět (každá ≥2, jedna ≥3 px)', GG.h9[0] >= 2 && GG.h9[1] >= 3, `min ${GG.h9[0].toFixed(1)} px, lepší ${GG.h9[1].toFixed(1)} px`]);
let ok = 0; for (const [n, p, v] of res) { if (p) ok++; console.log(`  ${p ? 'OK' : 'NE'}   ${n.padEnd(36)} ${v}`); }
console.log(`stopV ${SKATE_K3.stopV}: ${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1);
