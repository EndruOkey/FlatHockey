// KALHOTY / STEHNA ZA ZÁDY — viditelná plocha (deterministicky, čisté funkce jako draw). node scripts/pants_behind_metrics.mjs
// (FH_HIP='{"hx":-0.4,"px":-0.42}' přepis polohy kyčlí/kalhot)
// Ondřej 2026-11-15: „kalhoty nebo stehna (za zády), je to prostě až moc". Kalhoty a stehna se kreslí POD dres → vidět je jen to,
// co vyčnívá mimo trup + ramena + helmu (skin.js skinBody). Kyčle 0,6 R a kalhoty 0,62 R za středem trupu.
// RUBRIKA (předem, 2026-11-15): plocha kalhot+stehen mimo horní polovinu těla (px² v 1×), průměr přes jízdu vpřed / šikmo / bokem /
// vzad při 165 px/s (48 fází):  K1 ≤ 50 % dnešní (hx −0,6, px −0,62)   K2 ≥ 30 % dnešní (nohy dál čitelné).
// K3 (ostatní rubriky nohou) hlídají leg_attach / hip_pants / skate_visibility zvlášť.
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { skinHip, skinPants, SKIN_HIP } = await import('../public/js/entities/skin.js');
const R = PLAYER.radius, DT = 1 / 60, SC = 1.198, G = 0.2, N = 220, O = N / 2;
const inEll = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const torsoPoly = (() => { const r = R * 1.04, pts = [], q = (a, c, b) => { for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  let p0 = [r * 0.35, -r * 1.2]; const seg = [[[r * 0.75, -r * 0.6], [r * 0.55, 0]], [[r * 0.75, r * 0.6], [r * 0.35, r * 1.2]], [[-r * 0.15, r * 1.42], [-r * 0.75, r * 0.85]], [[-r * 1.05, 0], [-r * 0.75, -r * 0.85]], [[-r * 0.15, -r * 1.42], [r * 0.35, -r * 1.2]]];
  pts.push(p0); for (const [c, b] of seg) { q(p0, c, b); p0 = b; } return pts; })();
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

const UP = new Uint8Array(N * N);
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = (i - O) * G, y = (j - O) * G;
  UP[i * N + j] = inPoly(x, y, torsoPoly) || [[R * 0.25, -R * 0.9], [R * 0.25, R * 0.9]].some(s => inEll(x, y, s[0] - R * 0.12, s[1] * 0.98, R * 0.48, R * 0.42)) || inEll(x, y, R * 0.72, 0, R * 0.55 * 1.12, R * 0.5 * 1.12) ? 1 : 0; }
const capD = (x, y, ax, ay, ra, bx, by, rb) => { const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)); return Math.hypot(x - ax - vx * t, y - ay - vy * t) <= ra + (rb - ra) * t; };
function area(SH) {
  if (SH) Object.assign(SKIN_HIP, SH);
  let tot = 0, n = 0;
  for (const m of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI]) {
    const st = {}; let x = 0, y = 0;
    for (let i = 0; i < 168; i++) { x += Math.cos(m) * 165 * DT; y += Math.sin(m) * 165 * DT; skateAdvance(st, x, y, 0, 165, 3, m, DT);
      const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd: 165, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: 0, bwS: st._bwS, lbS: st._lbS });
      skateFeetSmooth(st, P.feet, DT); if (i < 120) continue;
      const hh = P.body.hh ?? 0, legs = P.feet.map(f => { const hp = skinHip(f.side, hh), ax = f.x - Math.cos(f.a) * 0.32 * R - P.body.x, ay = f.y - Math.sin(f.a) * 0.32 * R - P.body.y;
        return { hx: hp.x, hy: hp.y, kx: (hp.x + ax) / 2, ky: (hp.y + ay) / 2 + f.side * R * 0.12 }; });
      const PT = [-1, 1].map(sd => skinPants(sd, hh)); let c = 0;
      for (let i2 = 0; i2 < N; i2++) for (let j = 0; j < N; j++) { if (UP[i2 * N + j]) continue; const px = (i2 - O) * G, py = (j - O) * G;
        if (PT.some(q => inEll(px, py, q.x, q.y, R * 0.5, R * 0.46)) || legs.some(L => capD(px, py, L.hx, L.hy, R * 0.4, L.kx, L.ky, R * 0.3))) c++; }
      tot += c * G * G * SC * SC; n++; } }
  return tot / n;
}
const DEF = { hx: SKIN_HIP.hx, px: SKIN_HIP.px }, base = area({ hx: -0.6, px: -0.62 });
const env = process.env.FH_HIP ? JSON.parse(process.env.FH_HIP) : null, now = area(env || DEF);
const k1 = now <= 0.5 * base, k2 = now >= 0.3 * base;
console.log(`dnešní (hx −0,6, px −0,62): ${base.toFixed(1)} px² · teď (hx ${SKIN_HIP.hx}, px ${SKIN_HIP.px}): ${now.toFixed(1)} px² = ${(now / base * 100).toFixed(0)} %`);
console.log(`  ${k1 ? 'OK' : 'NE'}   K1 ≤ 50 %   ${k2 ? 'OK' : 'NE'}   K2 ≥ 30 %`); process.exit(k1 && k2 ? 0 : 1);
