// ZATÁČKY — deterministické měření (bez canvasu; tytéž čisté funkce jako draw). node scripts/turn_metrics.mjs  (FH_K3='{"plant":2}' = ukotvení)
// Ondřej 2026-11-14 (po ukotvení): „lepší, ale furt to není ono — pořád blbnou zatáčky, pořád to někde vyčnívá, kdy to vyčnívat nemá".
// Situace = běžná hra: pohled po směru jízdy (myš vpředu), zatáčky: kruh R 220 a R 90 px při 150 px/s, esíčko (±R 120, 150 px/s),
// ostrá zatáčka 90° za 0,25 s při 165 px/s. Základ = rovná jízda vpřed 165 px/s.
// RUBRIKA (předem, 2026-11-14):
//  P1 brusle mimo siluetu těla (px, 1×) ≤ max(základ) + 10 % v každém snímku (nic nečouhá víc než v rovné jízdě).
//  P2 skating ratio (brusle na ledě klouže do strany > 5,6 j/s) ≤ 5 % (jen s ukotvením; bez něj informativně).
//  P3 skok špičky/paty brusle ≤ 3 px za snímek (1×).
//  P4 kotník ≤ 1,6 R od kyčle.
//  P5 (doplněno: ve hře náklon kmital −0,17 ↔ −0,67 podle kláves) náklon do zatáčky (leanStep, jako hra) se mění ≤ 0,05 za snímek.
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth, SKATE_K3, leanStep } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
const R = PLAYER.radius, DT = 1 / 60, SC = 1.198, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
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

function run(T, heading) {   // heading(t) → směr jízdy (rad), rychlost spd(t); pohled = směr jízdy
  const st = {}; let x = 0, y = 0; const F = [];
  for (let i = 0; i < Math.round(T / DT); i++) { const t = i * DT, { h, v } = heading(t); x += Math.cos(h) * v * DT; y += Math.sin(h) * v * DT;
    const ba = h, spd = v; st._lean = leanStep(st, Math.cos(h) * v, Math.sin(h) * v, DT); skateAdvance(st, x, y, ba, spd, 3, 0, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: st._lean, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS });
    if (SKATE_K3.plant) skateFeetSmooth(st, P.feet, DT, ba, x, y); else skateFeetSmooth(st, P.feet, DT);
    const c = Math.cos(ba), s = Math.sin(ba);
    F.push({ t, lean: st._lean, P, W: P.feet.map(f => ({ side: f.side, lift: f.lift, a: f.a + ba, x: x + f.x * c - f.y * s, y: y + f.x * s + f.y * c })) }); }
  return F.slice(50);
}
function score(F) {
  let p1 = 0, p1t = 0, on = 0, bad = 0, p3 = 0, p4 = 0, p5 = 0, lmax = 0;
  for (let i = 0; i < F.length; i++) { const P = F[i].P, M = maskFor(P.body.tw);
    for (const ft of P.feet) { let e = 0; for (const [x, y] of skatePts(ft)) e = Math.max(e, outside(x - P.body.x, y - P.body.y, M)); if (e * SC > p1) { p1 = e * SC; p1t = F[i].t; }
      const kx = ft.x - Math.cos(ft.a) * 0.32 * R, ky = ft.y - Math.sin(ft.a) * 0.32 * R, hp = skinHip(ft.side, P.body.hh ?? 0); p4 = Math.max(p4, Math.hypot(kx - P.body.x - hp.x, ky - P.body.y - hp.y) / R); }
    lmax = Math.max(lmax, Math.abs(F[i].lean)); if (i) p5 = Math.max(p5, Math.abs(F[i].lean - F[i - 1].lean));
    if (i) { for (const side of [-1, 1]) { const a = F[i].W.find(q => q.side === side), b = F[i - 1].W.find(q => q.side === side);
        if (a.lift < 0.05 && b.lift < 0.05) { on++; const vx = (a.x - b.x) / DT, vy = (a.y - b.y) / DT; if (Math.abs(-vx * Math.sin(a.a) + vy * Math.cos(a.a)) > 5.6) bad++; } }
      const Q = F[i - 1].P; for (let k = 0; k < 2; k++) { const f = P.feet[k], g = Q.feet[k];
        for (const [u, w] of [[0.52, 0.52], [-0.62, -0.62]]) p3 = Math.max(p3, Math.hypot((f.x + Math.cos(f.a) * u * R) - (g.x + Math.cos(g.a) * w * R), (f.y + Math.sin(f.a) * u * R) - (g.y + Math.sin(g.a) * w * R)) * SC); } } }
  return { p1, p1t, sr: on ? bad / on : 0, p3, p4, p5, lmax };
}
const base = score(run(3, () => ({ h: 0, v: 165 }))), L1 = base.p1 * 1.1;
console.log(`plant ${SKATE_K3.plant} · základ vpřed: vyčnívá ${base.p1.toFixed(1)} px → limit P1 ${L1.toFixed(1)} px`);
const S = {
  'kruh R220 150': run(4, t => ({ h: t * 150 / 220, v: 150 })),
  'kruh R90 150': run(4, t => ({ h: t * 150 / 90, v: 150 })),
  'esíčko R120': run(4, t => ({ h: 0.9 * Math.sin(t * 150 / 120 / 0.9), v: 150 })),
  'ostrá 90° 165': run(3, t => ({ h: Math.PI / 2 * Math.min(1, Math.max(0, (t - 1.5) / 0.25)), v: 165 })),
};
let fail = 0;
for (const [n, F] of Object.entries(S)) { const r = score(F), ok = r.p1 <= L1 && (!SKATE_K3.plant || r.sr <= 0.05) && r.p3 <= 3 && r.p4 <= 1.6 && r.p5 <= 0.05; if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(15)} P1 vyčnívá ${r.p1.toFixed(1).padStart(4)} px (t ${r.p1t.toFixed(2)})  P2 klouže ${(r.sr * 100).toFixed(0).padStart(3)} %  P3 skok ${r.p3.toFixed(2)} px  P4 noha ${r.p4.toFixed(2)} R  P5 Δnáklon ${r.p5.toFixed(3)} (max ${r.lmax.toFixed(2)})`); }
console.log(fail ? `NEPROŠLO ${fail}/4` : 'VŠE OK'); process.exit(fail ? 1 : 0);
