// NOHY PŘI BRZDĚ (Space, K3) — deterministické měření bez canvasu. Tytéž čisté funkce a pořadí jako draw (_renderPlayerUp):
// směr stopu (_hsDir: zmrazený od stisku / během pózy) → skateStopDrive → skateStopSig → skateAdvance → skatePose → skateFeetSmooth
// → kotník = brusle − 0,32 R po ostří, kyčel = skinHip + posun těla (záklon body.x/y), jako skinBody.
// node scripts/brake_legs_metrics.mjs            (výchozí SKATE_K3)
// node scripts/brake_legs_metrics.mjs --grid     (mřížka parametrů stopV 3, vypíše kombinace podle počtu splněných bodů)
// FH_K3='{"stopV":1}' node scripts/brake_legs_metrics.mjs   (přepis parametrů)
//
// Ondřej 2026-11-14: „Brždění je stále problém animační, vznikají divné nohy."
// Co bylo divné (snímky scripts/brake_shots.mjs, stopV 1): brusle obě napříč ŠPIČKAMI VEN (ostří k sobě 150°, „žabí roznožka"),
// při jízdě bokem vůči tělu jedna noha 1,8 R daleko do strany (natažená jak tyčka) a druhá schovaná pod trupem, špička jedné brusle dozadu.
//
// RUBRIKA (stanovena PŘED úpravou, 2026-11-14). Situace: S-celem (tělo po jízdě), S-kolmo± (tělo ±90° k jízdě), S-zpět (brzda při couvání),
// S-obrat (brzda 14 sn. → rozjezd opačně), S-zatáčka (směr jízdy se točí 2,5 rad/s), S-otočka (tělo se při brzdě točí 4 rad/s).
// Plná póza: směr stopu vůči tělu 0°, ±45°, ±90°, ±135°, 180°, pravák i levák (16 póz).
//  B1 noha kyčel→kotník ≤ 1,6 R (všechny snímky s pózou > 0 + plná póza). Stehno + lýtko jsou kreslené kapslemi z kyčle ke kotníku;
//     nad 1,6 R noha vyjede z proporcí kalhot (stejný práh jako S2 / H8, kde dřívější „utržená noha" měla 2,8 R).
//  B2 bez zkřížení: kotník na své straně těla (strana · y ≥ 0,1 R) a úsečky kyčel→kotník se neprotnou (jinak „zamotané" nohy pod trupem).
//  B3 skok brusle ≤ 3 px za snímek (špička i pata, 1× = 1,198 px na jednotku) od stisku do 0,6 s po puštění, ve všech situacích.
//     3 px ≈ šíře brusle v 1× — větší posun oko čte jako přeskok (stejný práh jako S3 / H10).
//  B4 plná póza: ostří 70–100° ke směru jízdy (hokejový stop = ostří napříč; Riedell „2:30" ≈ 75°, H4).
//  B5 brusle nikdy přes záda: při póze > 0,05 žádný bod brusle za zády mezi kyčlemi (x < −0,8 R a |y| < 0,55 R vůči trupu)
//     a špička nemíří dozadu víc než 100° od předku těla (víc boky bez otočení trupu neumí; odhad z anatomie, ne měření).
//  B6 plynulý návrat: po konci brzdy je póza 0 nejpozději za 0,4 s a brusle pak sedí na póze jízdy bez stopu (≤ 0,5 px) — bez „dojíždění".
//  B7 plná póza: každá brusle ≥ 2 px a aspoň jedna ≥ 3 px mimo siluetu těla (H9; schovaná brusle = noha „chybí").
//  B8 plná póza: ostří navzájem rovnoběžná ±20° (předloha hokejového stopu; 150° od sebe = roznožka, kterou koleno neudělá).
//  B9 deterministické: dva běhy = stejný otisk.
// DOPLNĚNO PO 1. BĚHU (stopV 1, 4/9), práh beze změny: B5 se počítá při póze ≥ 0,5 (při menší převládá póza jízdy/klidu, jejíž pata
//  už dnes leží za zády — mimo úkol); B8 měří úhel ostří VČETNĚ směru špičky (jako přímky dávala roznožka ±75° jen 30°).
import { createHash } from 'crypto';
const { PLAYER } = await import('../public/js/constants.js');
const { skateStopDrive, skateStopSig, skatePose, skateAdvance, skateFeetSmooth, SKATE_K3 } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
const R = PLAYER.radius, DT = 1 / 60, DEC = 620, ACC = 600, VMAX = 165, PX = 1.198, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
const lineDiff = (a, b) => { const d = Math.abs(ad(a - b)) % Math.PI; return Math.min(d, Math.PI - d) * 180 / Math.PI; };
// ── silueta těla (kopie ze scripts/stop_hockey_metrics.mjs → skate_anim_metrics.mjs)
const G = 0.2, N = 220, O = N / 2;
const inEll = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const torsoPoly = (() => { const r = R * 1.04, pts = [], q = (a, c, b) => { for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  let p0 = [r * 0.35, -r * 1.2]; const seg = [[[r * 0.75, -r * 0.6], [r * 0.55, 0]], [[r * 0.75, r * 0.6], [r * 0.35, r * 1.2]], [[-r * 0.15, r * 1.42], [-r * 0.75, r * 0.85]], [[-r * 1.05, 0], [-r * 0.75, -r * 0.85]], [[-r * 0.15, -r * 1.42], [r * 0.35, -r * 1.2]]];
  pts.push(p0); for (const [c, b] of seg) { q(p0, c, b); p0 = b; } return pts; })();
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
let MASK = null;
function bodyMask() {
  const m = new Uint8Array(N * N), S = [[R * 0.25, -R * 0.9], [R * 0.25, R * 0.9]];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = (i - O) * G, y = (j - O) * G;
    m[i * N + j] = inPoly(x, y, torsoPoly) || S.some(s => inEll(x, y, s[0] - R * 0.12, s[1] * 0.98, R * 0.48, R * 0.42)) || inEll(x, y, -R * 0.62, -R * 0.62, R * 0.5, R * 0.46)
      || inEll(x, y, -R * 0.62, R * 0.62, R * 0.5, R * 0.46) || inEll(x, y, R * 0.72, 0, R * 0.55 * 1.12, R * 0.5 * 1.12) ? 1 : 0; }
  const edge = []; for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) if (m[i * N + j] && (!m[(i + 1) * N + j] || !m[(i - 1) * N + j] || !m[i * N + j + 1] || !m[i * N + j - 1])) edge.push([(i - O) * G, (j - O) * G]);
  return { m, edge };
}
function outside(x, y) { const M = MASK || (MASK = bodyMask()), i = Math.round(x / G) + O, j = Math.round(y / G) + O;
  if (i >= 0 && i < N && j >= 0 && j < N && M.m[i * N + j]) return 0;
  let d = 1e9; for (const [ex, ey] of M.edge) { const q = (x - ex) ** 2 + (y - ey) ** 2; if (q < d) d = q; } return Math.max(0, Math.sqrt(d) - 1.0); }
const SK = []; for (let a = -0.62; a <= 0.521; a += 0.0285) for (const b of [-0.24, 0, 0.24]) SK.push([a * R, b * R + Math.sign(b) * 0.8]);
const skatePts = f => { const c = Math.cos(f.a), s = Math.sin(f.a); return SK.map(([a, b]) => [f.x + a * c - b * s, f.y + a * s + b * c]); };
const tips = f => [[f.x + Math.cos(f.a) * 0.52 * R, f.y + Math.sin(f.a) * 0.52 * R], [f.x - Math.cos(f.a) * 0.62 * R, f.y - Math.sin(f.a) * 0.62 * R]];
const ankle = f => [f.x - Math.cos(f.a) * 0.32 * R, f.y - Math.sin(f.a) * 0.32 * R];
const segX = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };

// geometrie jedné pózy vůči trupu (posun těla bo odečten jako ve skinBody)
function legGeo(P) {
  const bo = P.body, hh = P.body.hh ?? 0, out = { leg: 0, side: 9, cross: false, back: 0, toe: 0 }, L = [];
  for (const f of P.feet) { const [kx, ky] = ankle(f), hp = skinHip(f.side, hh), ax = kx - bo.x, ay = ky - bo.y;
    out.leg = Math.max(out.leg, Math.hypot(ax - hp.x, ay - hp.y) / R); out.side = Math.min(out.side, f.side * ay / R); L.push([[hp.x, hp.y], [ax, ay]]);
    for (const [x, y] of skatePts(f)) { const rx = x - bo.x, ry = y - bo.y; if (rx < -0.8 * R && Math.abs(ry) < 0.55 * R) out.back++; }
    out.toe = Math.max(out.toe, Math.abs(ad(f.a)) * 180 / Math.PI); }
  out.cross = segX(L[0][0], L[0][1], L[1][0], L[1][1]);
  return out;
}

// ── simulace situace: fn(i) → { space, dir (směr kláves, null = nic), ba }
function run(name, frames, fn, v0 = 140, dir0 = 0) {
  const p = { x: 0, y: 0, vx: Math.cos(dir0) * v0, vy: Math.sin(dir0) * v0 }, H = createHash('sha256'), rows = [];
  let prevSpace = false, stopFx = 0, hsDir = null, prevT = null, prevSp = Math.hypot(p.vx, p.vy), relI = null;
  for (let i = 0; i < frames; i++) { const c = fn(i), sp0 = Math.hypot(p.vx, p.vy);
    if (c.space && sp0 > 0) { const n = Math.max(0, sp0 - DEC * DT) / sp0; p.vx *= n; p.vy *= n; }
    else if (c.dir != null) { p.vx += Math.cos(c.dir) * ACC * DT; p.vy += Math.sin(c.dir) * ACC * DT; const s = Math.hypot(p.vx, p.vy); if (s > VMAX) { p.vx *= VMAX / s; p.vy *= VMAX / s; } }
    if (c.turn && sp0 > 0) { const a = Math.atan2(p.vy, p.vx) + c.turn * DT, s = Math.hypot(p.vx, p.vy); p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; }
    p.x += p.vx * DT; p.y += p.vy * DT;
    const spd = Math.hypot(p.vx, p.vy), ba = c.ba;
    // směr stopu jako draw (Player.js „Hockey stop" blok)
    if (spd > 30 && !(stopFx > 0) && !((p._stopK3 ?? 0) > 0)) hsDir = Math.atan2(p.vy, p.vx);
    if (stopFx > 0) stopFx -= DT;
    const edge = c.space && !prevSpace; prevSpace = c.space;
    if (edge && spd > 35) { hsDir = Math.atan2(p.vy, p.vx); stopFx = 0.55 + Math.min(1, (prevSp - 35) / 145) * 0.35; }
    prevSp = spd;
    p._stopK3 = skateStopDrive(p, spd, c.space, DT);
    if (!(stopFx > 0) && !p._stopK3) hsDir = null;
    const stopLoc = hsDir != null ? ad(hsDir - ba) : 0;
    p._hsSig = skateStopSig(p._hsSig, p._stopK3, stopLoc, 1);
    const mLoc = spd > 8 ? ad(Math.atan2(p.vy, p.vx) - ba) : 0;
    skateAdvance(p, p.x, p.y, ba, spd, 3, mLoc, DT);
    const o = { k: 3, phase: p._skatePhase ?? 0, spd, mLoc: p._mLocS, stopT: p._stopK3, stopLoc, rotSf: p._rotSf ?? 0, lean: 0, hs: 1, thr: p._thr ?? 0, bwS: p._bwS, lbS: p._lbS, hsSig: p._hsSig, stopDn: !!p._sdDn };
    const P = skatePose(o); skateFeetSmooth(p, P.feet, DT);
    // pro B6: stejná póza bez stopu (kam se má vrátit) — bez vyhlazení úhlu, to je stejné u obou
    const P0 = skatePose({ ...o, stopT: 0 });
    if (!c.space && prevT && relI == null && rows.some(r => r.space)) relI = i;
    rows.push({ i, space: c.space, st: p._stopK3, P, P0, ba });
    H.update(P.feet.map(f => `${f.x.toFixed(4)},${f.y.toFixed(4)},${f.a.toFixed(4)}`).join(';'));
    prevT = P;
  }
  return { name, rows, hash: H.digest('hex').slice(0, 16), relI };
}
const S = SKATE_K3;
function scenarios() {
  const hold = (a, b) => i => i >= a && i < b;
  return [
    run('celem', 110, i => ({ space: hold(20, 60)(i), dir: i < 20 ? 0 : null, ba: 0 })),
    run('kolmo+', 110, i => ({ space: hold(20, 60)(i), dir: i < 20 ? 0 : null, ba: -Math.PI / 2 })),
    run('kolmo-', 110, i => ({ space: hold(20, 60)(i), dir: i < 20 ? 0 : null, ba: Math.PI / 2 })),
    run('zpet', 110, i => ({ space: hold(20, 60)(i), dir: i < 20 ? 0 : null, ba: Math.PI })),
    run('obrat', 110, i => ({ space: hold(20, 34)(i), dir: i < 20 ? 0 : i >= 34 ? Math.PI : null, ba: 0 })),
    run('zatacka', 110, i => ({ space: hold(20, 60)(i), dir: null, turn: 2.5, ba: 0.04 * i })),
    run('otocka', 110, i => ({ space: hold(20, 60)(i), dir: i < 20 ? 0 : null, ba: i < 20 ? 0 : Math.min(1.6, 4 * (i - 20) * DT) })),
  ];
}
function evaluate() {
  const res = [], W = { leg: 0, side: 9, cross: 0, jump: 0, jAt: '', back: 0, toe: 0, ret: 0, retD: 0 };
  const sc = scenarios();
  for (const s of sc) {
    let last = s.rows.findLastIndex(r => r.st > 0), endI = s.rows.findIndex((r, k) => k > 20 && !r.space);
    for (let k = 0; k < s.rows.length; k++) { const r = s.rows[k];
      if (r.st > 0) { const g = legGeo(r.P); W.leg = Math.max(W.leg, g.leg); W.side = Math.min(W.side, g.side); if (g.cross) W.cross++;
        if (r.st >= 0.5) { if (g.back && process.env.BLDBG) console.log('B5', s.name, k, r.st.toFixed(2), g.back, r.P.feet.map(f => (f.x / R).toFixed(2) + ',' + (f.y / R).toFixed(2) + ',' + (f.a * 57.3).toFixed(0)).join(' ')); W.back += g.back; W.toe = Math.max(W.toe, g.toe); } }
      if (k > 19 && k <= endI + 36) { const a = tips(...[r.P.feet[0]]).concat(tips(r.P.feet[1])), b = tips(s.rows[k - 1].P.feet[0]).concat(tips(s.rows[k - 1].P.feet[1]));
        for (let q = 0; q < 4; q++) { const d = Math.hypot(a[q][0] - b[q][0], a[q][1] - b[q][1]) * PX; if (process.env.BLDBG === '3' && d > 2.5) console.log('B3', s.name, k, q, d.toFixed(2), r.st.toFixed(2), s.rows[k - 1].st.toFixed(2)); if (d > W.jump) { W.jump = d; W.jAt = `${s.name} sn.${k}`; } } } }
    W.ret = Math.max(W.ret, (last - endI + 1) * DT);
    for (let k = last + 1; k < Math.min(s.rows.length, last + 25); k++) { const r = s.rows[k]; for (let q = 0; q < 2; q++) W.retD = Math.max(W.retD, Math.hypot(r.P.feet[q].x - r.P0.feet[q].x, r.P.feet[q].y - r.P0.feet[q].y) * PX); }
  }
  // plná póza
  const F = { leg: 0, side: 9, cross: 0, a: [180, 0], par: 0, vis: [99, 99], back: 0, toe: 0 };
  for (const hs of [1, -1]) for (let j = 0; j < 8; j++) { const m = ad(j * Math.PI / 4);
    const sig = skateStopSig(null, 1, m, hs), P = skatePose({ k: 3, phase: 0, spd: 0, mLoc: 0, stopT: 1, stopLoc: m, rotSf: 0, lean: 0, hs, thr: 0, hsSig: sig }), g = legGeo(P);
    F.leg = Math.max(F.leg, g.leg); F.side = Math.min(F.side, g.side); if (g.cross) F.cross++; F.back += g.back; F.toe = Math.max(F.toe, g.toe);
    for (const f of P.feet) { const d = lineDiff(f.a, m); F.a = [Math.min(F.a[0], d), Math.max(F.a[1], d)]; }
    F.par = Math.max(F.par, Math.abs(ad(P.feet[0].a - P.feet[1].a)) * 180 / Math.PI);
    const e = P.feet.map(f => { let v = 0; for (const [x, y] of skatePts(f)) v = Math.max(v, outside(x - P.body.x, y - P.body.y)); return v * PX; });
    F.vis = [Math.min(F.vis[0], Math.min(...e)), Math.min(F.vis[1], Math.max(...e))]; }
  const h1 = sc.map(s => s.hash).join(''), h2 = scenarios().map(s => s.hash).join('');
  res.push(['B1 noha kyčel→kotník ≤1,6 R', Math.max(W.leg, F.leg) <= 1.6, `max ${Math.max(W.leg, F.leg).toFixed(2)} R (plná ${F.leg.toFixed(2)})`]);
  res.push(['B2 bez zkřížení (strana ≥0,1 R)', Math.min(W.side, F.side) >= 0.1 && !W.cross && !F.cross, `min strana ${Math.min(W.side, F.side).toFixed(2)} R, zkřížení ${W.cross + F.cross}`]);
  res.push(['B3 skok brusle ≤3 px/snímek', W.jump <= 3, `max ${W.jump.toFixed(2)} px (${W.jAt})`]);
  res.push(['B4 ostří 70–100° k jízdě', F.a[0] >= 70 && F.a[1] <= 100, `${F.a[0].toFixed(0)}–${F.a[1].toFixed(0)}°`]);
  res.push(['B5 nikdy přes záda, špička ≤100°', !W.back && !F.back && Math.max(W.toe, F.toe) <= 100, `body za zády ${W.back + F.back}, špička max ${Math.max(W.toe, F.toe).toFixed(0)}°`]);
  res.push(['B6 návrat ≤0,4 s, pak ≤0,5 px', W.ret <= 0.4 + 1e-9 && W.retD <= 0.5, `${W.ret.toFixed(2)} s, odchylka ${W.retD.toFixed(2)} px`]);
  res.push(['B7 brusle vidět (každá ≥2, jedna ≥3)', F.vis[0] >= 2 && F.vis[1] >= 3, `min ${F.vis[0].toFixed(1)} px, lepší ${F.vis[1].toFixed(1)} px`]);
  res.push(['B8 ostří rovnoběžná ±20°', F.par <= 20, `max ${F.par.toFixed(0)}°`]);
  res.push(['B9 deterministické', h1 === h2, h1.slice(0, 16)]);
  return res;
}
if (process.argv.includes('--grid')) {   // mřížka stopV 3: pevné pořadí, žádná náhoda
  const base = { ...S }, out = [];
  for (const st3W of [0.75, 0.9, 0.95, 1, 1.05, 1.2]) for (const st3L of [0, 0.3, 0.45]) for (const st3N of [0, 0.5]) for (const stopBack of [0, 0.25]) for (const st3A0 of [0, 0.1]) for (const st3A of [0.8, 1]) {
    Object.assign(S, base, { stopV: 3, st3W, st3L, st3N, stopBack, st3A0, st3A }); const r = evaluate(), ok = r.filter(x => x[1]).length;
    out.push({ ok, k: { st3W, st3L, st3N, stopBack, st3A0, st3A }, fail: r.filter(x => !x[1]).map(x => x[0].slice(0, 2) + ' ' + x[2]).join(' | ') }); }
  Object.assign(S, base);
  out.sort((a, b) => b.ok - a.ok); for (const o of out.slice(0, 15)) console.log(o.ok, JSON.stringify(o.k), o.fail);
  console.log(`plných ${out.filter(o => o.ok === 9).length}/${out.length}`);
} else {
  const res = evaluate(); let ok = 0;
  for (const [n, p, v] of res) { if (p) ok++; console.log(`  ${p ? 'OK' : 'NE'}   ${n.padEnd(38)} ${v}`); }
  console.log(`stopV ${S.stopV}: ${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1);
}
