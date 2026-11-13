// OBRAT (brzda + rozjezd opačně) — deterministické měření pózy nohou bez canvasu. Stejné čisté funkce jako draw():
// skateAdvance + skateStopBlend + skatePose (+ skateFeetSmooth) z public/js/entities/Player.js; spouštění stopu a směr _hsDir
// opisují blok „Hockey stop" v _renderPlayer (Player.js ~ř. 1200). 60 fps, předepsaná kinematika.
// node scripts/skate_stop_metrics.mjs [--k=3,4] [--detail]
//
// Scénář (Ondřej 2026-11-13: „když změním směr prudce a udělá to brzdu, nohy jsou úplně rozbité"): jízda 165 px/s doprava,
// tělo čelem doprava (myš), v t = 1,2 s vstup opačně → zpomalení −620 px/s² do nuly, pak rozjezd doleva 330 px/s² (max 200 px/s).
// RUBRIKA (stanovena PŘEDEM, 2026-11-13; 1× = 1,198 px na svět. jednotku):
//  S1 Stop čitelný: ve snímcích se stopT > 0,5 jsou OBĚ brusle napříč k původní jízdě (90° ± 25°) a aspoň jedna vyjede
//     ≥ 3 px mimo siluetu těla (maska jako skate_anim_metrics) — v ≥ 90 % těchto snímků.
//  S2 Anatomie: kotník (bod nad botou u paty, jako feetW v draw) ≤ 1,6 R od kyčle (skinHip, posunuté s tělem) po celý obrat
//     a žádné zkřížení: levá brusle (kotník) vlevo od osy těla, pravá vpravo, po celý obrat.
//  S3 Plynulost bruslí: žádný skok špičky/paty > 3 px (1×) mezi snímky v celém obratu.
//  S4 Plynulost těla: posun těla (záklon) se mezi snímky změní ≤ 1 px (1×).
//  S5 Deterministické: dva běhy = stejný hash.
import { createHash } from 'crypto';
const { PLAYER } = await import('../public/js/constants.js');
const { skateAdvance, skateStopBlend, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
const { angleDiff } = await import('../public/js/utils.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const KS = String(ARG.k ?? '3,4').split(',').map(Number);
const R = PLAYER.radius, SC = 1.198, DT = 1 / 60;

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
const tipHeel = f => { const c = Math.cos(f.a), s = Math.sin(f.a); return [[f.x + c * 0.52 * R, f.y + s * 0.52 * R], [f.x - c * 0.62 * R, f.y - s * 0.62 * R]]; };

function run(k) {
  const p = { x: 0, y: 0, vx: 165, vy: 0, bodyAngle: 0, _lean: 0 }, F = [], hash = createHash('sha256');
  let prevS = 165, stopCd = 0, rev = false;
  for (let n = 0; n < 3.2 * 60; n++) {
    const t = n * DT;
    if (t >= 1.2) { if (!rev && p.vx > 0) p.vx = Math.max(0, p.vx - 620 * DT); else { rev = true; p.vx = Math.max(-200, p.vx - 330 * DT); } }
    p.x += p.vx * DT;
    const ba = 0, spd = Math.abs(p.vx);
    // == _renderPlayer: blok „Hockey stop"
    if (spd > 30 && !((p._stopFx ?? 0) > 0) && !(ARG.old ? 0 : (p._stopK3 ?? 0) > 0)) p._hsDir = Math.atan2(p.vy, p.vx);
    const decel = (prevS - spd) / DT; prevS = spd;
    if (stopCd > 0) stopCd -= DT;
    if ((p._stopFx ?? 0) > 0) p._stopFx -= DT;
    if (decel > 450 && spd > 35 && !(stopCd > 0)) { if (!ARG.old) p._hsDir = Math.atan2(p.vy, p.vx); p._stopFx = 0.55 + Math.min(1, (spd + decel * DT - 35) / 145) * 0.35; stopCd = 1; }
    p._stopTSmooth = skateStopBlend(p._stopTSmooth ?? 0, (p._stopFx ?? 0) > 0, DT); p._stopK3 = skateStopBlend(p._stopK3 ?? 0, (p._stopFx ?? 0) > 0, DT, 3.5, 3, true);
    if (!p._stopTSmooth && !p._stopK3) p._hsDir = null;
    const stopT = p._stopK3, mLoc = spd > 8 ? angleDiff(Math.atan2(p.vy, p.vx), ba) : 0;
    skateAdvance(p, p.x, p.y, ba, spd, k, mLoc, DT);
    const stopLoc = p._hsDir != null ? angleDiff(p._hsDir, ba) : 0;
    const pose = skatePose({ k, phase: p._skatePhase ?? 0, spd, mLoc: p._mLocS, stopT, stopLoc, rotSf: p._rotSf ?? 0, lean: 0, hs: 1, thr: p._thr ?? 0, bwS: p._bwS, bwV: p._bwV });
    if (k === 4) skateFeetSmooth(p, pose.feet, DT, ba, null, null, true); else skateFeetSmooth(p, pose.feet, DT);
    for (const f of pose.feet) hash.update(f.x.toFixed(4) + f.y.toFixed(4) + f.a.toFixed(4));
    F.push({ t, spd, vx: p.vx, stopT, stopLoc, pose });
  }
  return { F, hash: hash.digest('hex').slice(0, 16) };
}

function analyze(k) {
  const { F, hash } = run(k), from = 60;   // obrat od 1,0 s (0,2 s ustálené jízdy před vstupem)
  let s1N = 0, s1Ok = 0, reach = 0, cross = 1e9, jump = 0, jumpAt = 0, bj = 0; const det = [];
  for (let n = from; n < F.length; n++) {
    const f = F[n], P = f.pose, M = maskFor(P.body.tw);
    let best = 0;
    for (const ft of P.feet) { let e = 0; for (const [x, y] of skatePts(ft)) e = Math.max(e, outside(x - P.body.x, y - P.body.y, M)); best = Math.max(best, e * SC); }
    const ang = P.feet.map(ft => Math.abs(angleDiff(ft.a, f.stopLoc)) * 180 / Math.PI);
    if (f.stopT > 0.5) { s1N++; if (ang.every(a => Math.abs(a - 90) <= 25 || Math.abs(a - 90) <= 25) && best >= 3) s1Ok++; }
    const leg = [];
    for (const ft of P.feet) { const ax = ft.x - Math.cos(ft.a) * 0.32 * R - P.body.x, ay = ft.y - Math.sin(ft.a) * 0.32 * R - P.body.y, hp = skinHip(ft.side, P.body.h || 0);
      const L = Math.hypot(ax - hp.x, ay - hp.y) / R; leg.push(L); reach = Math.max(reach, L); cross = Math.min(cross, ft.side * ay / R); }
    if (n > from) { const Q = F[n - 1].pose;
      for (let i = 0; i < 2; i++) { const a = tipHeel(P.feet[i]), b = tipHeel(Q.feet[i]); for (let j = 0; j < 2; j++) { const d = Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]) * SC; if (d > jump) { jump = d; jumpAt = f.t; } } }
      bj = Math.max(bj, Math.hypot(P.body.x - Q.body.x, P.body.y - Q.body.y) * SC); }
    if (n % 6 === 0) det.push(`   t ${f.t.toFixed(2)} v ${f.vx.toFixed(0).padStart(4)} stopT ${f.stopT.toFixed(2)} m ${f.stopLoc.toFixed(2)}  úhly ${ang.map(a => a.toFixed(0).padStart(3)).join('/')}°  ven ${best.toFixed(1)} px  noha ${leg.map(l => l.toFixed(2)).join('/')} R  L(${P.feet[0].x.toFixed(1)},${P.feet[0].y.toFixed(1)}) P(${P.feet[1].x.toFixed(1)},${P.feet[1].y.toFixed(1)}) tělo(${P.body.x.toFixed(1)},${P.body.y.toFixed(1)})`);
  }
  return { s1: s1N ? s1Ok / s1N : 0, s1N, reach, cross, jump, jumpAt, bj, hash, det };
}
const f2 = v => (+v).toFixed(2);
for (const k of KS) {
  const A = analyze(k), B = analyze(k);
  const rub = [
    ['S1 stop napříč 90±25° + ≥3 px (≥90 %)', A.s1 >= 0.9, `${(A.s1 * 100).toFixed(0)} % z ${A.s1N} snímků`],
    ['S2 kotník ≤1,6 R od kyčle, bez zkřížení', A.reach <= 1.6 && A.cross > 0, `max ${f2(A.reach)} R, min. strana ${f2(A.cross)} R (>0)`],
    ['S3 skok brusle ≤3 px/snímek', A.jump <= 3, `max ${f2(A.jump)} px (t ${f2(A.jumpAt)} s)`],
    ['S4 skok těla ≤1 px/snímek', A.bj <= 1, `max ${f2(A.bj)} px`],
    ['S5 deterministické', A.hash === B.hash, A.hash],
  ];
  console.log(`\n== K${k} obrat — ${rub.filter(x => x[1]).length}/${rub.length}`);
  for (const [n, ok, v] of rub) console.log(`  ${ok ? 'OK  ' : 'NE  '} ${n.padEnd(42)} ${v}`);
  if (ARG.detail) console.log(A.det.join('\n'));
}
