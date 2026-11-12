// OVLÁDÁNÍ × MYŠ — srovnávací studie schémat ovládání (deterministická, 60 Hz, NEMĚNÍ herní soubory).
// Každé schéma = jen MAPOVÁNÍ VSTUPU (klávesy + kurzor → dx/dy/aim/aimDist/space/cruise) nad nasazeným
// pohybem (PlayerBase._move + obal „Pohyb v2", Player.js). Fyzika je pro všechna schémata stejná.
// Model hráče je společný (stejné „ruce" pro všechna schémata), jen schéma rozhoduje, co musí ruce dělat:
//   • klávesy: okamžité, ale jen 8 směrů (Input.dx/dy = −1/0/1, input.js:66-74)
//   • kurzor: úhlová rychlost max CUR_W rad/s + seedovaný třes σ CUR_NOISE rad/tick (ODHAD lidské ruky)
// Rubrika a body jsou napsané PŘEDEM (RUBRIC níže), měření je potom.
//   node scripts/control_study.mjs            → tabulka + body + pořadí
//   node scripts/control_study.mjs --json     → JSON (pro diff dvou běhů)
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { PLAYER, RINK } = await import('../public/js/constants.js');
const { Player } = await import('../public/js/entities/Player.js');
const { makeInput } = await import('../public/js/match-core.js');
const { angleDiff, clamp, lerpAngle } = await import('../public/js/utils.js');

const HZ = 60, DT = 1 / HZ, TOP = PLAYER.speed;
const CUR_W = 14;          // rad/s — přetočení kurzoru o 90° ≈ 0,11 s (ODHAD, flick myší)
const CUR_NOISE = ARG.noise != null ? +ARG.noise : 0.012;   // rad/tick — třes ruky (ODHAD; --noise=0 citlivost)
const CUR_DV = 1500;       // px/s — změna vzdálenosti kurzoru (ODHAD)
const FAR = 260;           // px — „kurzor daleko" (D: plná rychlost)
const D2R = 180 / Math.PI;

// ---------- RUBRIKA (PŘEDEM; body 2/1/0; váha) ----------
// two = pásmo pro 2 body, one = pásmo pro 1 bod; 'relA' = násobek hodnoty schématu A (twin-stick, nasazené)
const RUBRIC = {
  conflict_pct: { two: [0, 10],      one: [0, 25],     w: 2, why: 'konflikt míření × řízení: % ticků okna střely/pasu, kdy míření mine o >8,6° (po min(0,2 s; ½ okna)) NEBO kurz uhne o >8,6° NEBO rychlost <80 % startu' },
  aim_err_deg:  { two: [0, 4],       one: [0, 10],     w: 1, why: 'průměrná chyba míření v okně (po 0,2 s na přetočení)' },
  quant_err_deg:{ two: [0, 3],       one: [0, 8],      w: 1, why: '8směrová kvantizace: úhel mezi zadaným a ideálním směrem na trasách' },
  smooth_rel:   { two: [0, 0.6],     one: [0, 1.0],    w: 1, why: 'plynulost dráhy: průměrná |Δ křivosti| na trasách, poměr k A' },
  skill_gap:    { two: [1.15, 1.6],  one: [1.08, 1.8], w: 1, why: 'čas naivní / nejlepší model na trasách (movement_feel)' },
  course_rel:   { two: [0, 1.0],     one: [0, 1.05],   w: 1, why: 'čas naivního hráče na trasách, poměr k A (nižší = rychlejší)' },
  latency_ms:   { two: [0, 50],      one: [0, 83],     w: 1, why: 'odezva: záměr 90° → kurz se hne o 2°' },
  stopgo_gain:  { two: [0.10, 0.40], one: [0.05, 0.5], w: 1, why: 'obrat 180° brzdou vs. obloukem (odměna za techniku)' },
  carve_loss:   { two: [0, 0.08],    one: [0, 0.15],   w: 1, why: 'plynulý oblouk 0,5 rad/s drží rychlost' },
  r90_px:       { two: [30, 70],     one: [20, 90],    w: 1, why: 'poloměr obratu 90° na topu' },
  inputs_mean:  { two: [0, 1.8],     one: [0, 2.5],    w: 1, why: 'průměr současně ovládaných vstupů (klávesy + pohyb myši + tlačítka)' },
  // 2026-11-12, přidáno PŘED během schémat R1/R2: proxy „zajímavosti" pohybu (tvar dráhy, ne pocit hráče)
  curve_pct:    { two: [30, 100],    one: [15, 100],   w: 1, why: 'podíl jízdy na trasách v plynulém oblouku (0,3 < |úhlová rychlost kurzu| < 6 rad/s)' },
};
const RUB_MAX = Object.values(RUBRIC).reduce((s, r) => s + 2 * r.w, 0);

// ---------- deterministická náhoda ----------
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussOf(seed) { const r = rngOf(seed); return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// ---------- pomocné ----------
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const q8 = a => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
const keysOf = a => { const x = Math.round(Math.cos(a)), y = Math.round(Math.sin(a)); return (x !== 0) + (y !== 0); };
const spd = p => Math.hypot(p.vx, p.vy), hd = p => Math.atan2(p.vy, p.vx);
function mk(x, y, ang = 0) { const p = new Player('t', 'home', makeInput()); p.x = x; p.y = y; p._others = [];
  p.aimAngle = p.bodyAngle = p.skateAngle = p.carryAngle = ang; return p; }

// ---------- SCHÉMATA (mapování záměru → vstup) ----------
// want = { move: úhel|null, aim: úhel|null (null = dívám se, kam jedu), brake, window ('lmb'|'rmb'|null), exit: úhel|null, aimDist }
// S = stav modelu { ca (úhel kurzoru), cd (vzdálenost), frozen, exitT, wasBrake }
// vrací { dir: úhel|null, analog, keys, space, cruise, ctA (cíl kurzoru), ctD, shift }
const SCHEMES = {
  A: { name: 'Twin-stick 8 směrů (nasazené)', mouse: 'míří hůl', keys: 'WASD = směr ve světě',
    map(w) { return { ctA: w.aim ?? w.move ?? w.exit, dir: w.move == null ? null : q8(w.move), keys: w.move == null ? 0 : keysOf(q8(w.move)) }; } },
  B: { name: 'Brusle za kurzorem', mouse: 'směr jízdy + míření', keys: 'W ke kurzoru, S od něj, A/D bokem ke kurzoru',
    map(w, S) {
      if (w.move == null) return { ctA: w.aim ?? w.exit ?? S.ca, dir: null, keys: 0 };
      if (w.window) { const r = q8(angleDiff(w.move, S.ca)); return { ctA: w.aim, dir: S.ca + r, keys: keysOf(r) }; }  // míří jinam → pohyb jen 8 směrů VŮČI kurzoru
      return { ctA: w.move, dir: S.ca, keys: 1 }; } },
  B2: { name: 'Za kurzorem + zámek kurzu při nápřahu/pasu', mouse: 'směr jízdy; při LMB/RMB jen míření', keys: 'W ke kurzoru (S/A/D jako B)',
    map(w, S) {
      if (w.move == null) { S.frozen = null; return { ctA: w.aim ?? w.exit ?? S.ca, dir: null, keys: 0 }; }
      if (w.window) { if (S.frozen == null) S.frozen = S.ca; const r = q8(angleDiff(w.move, S.frozen)); return { ctA: w.aim, dir: S.frozen + r, keys: keysOf(r) }; }
      S.frozen = null; return { ctA: w.move, dir: S.ca, keys: 1 }; } },
  C: { name: 'WASD + kurzor ohýbá oblouk (±22,5°)', mouse: 'míří; je-li do 45° od směru kláves, dotočí jízdu', keys: 'WASD = směr ve světě',
    map(w, S) {
      if (w.move == null) return { ctA: w.aim ?? w.exit ?? S.ca, dir: null, keys: 0 };
      const k = q8(w.move), d = angleDiff(S.ca, k);
      return { ctA: w.aim ?? w.move, dir: Math.abs(d) <= Math.PI / 4 ? k + clamp(d, -Math.PI / 8, Math.PI / 8) : k, keys: keysOf(k) }; } },
  D: { name: 'WASD + vzdálenost kurzoru = tempo', mouse: 'míří; daleko = plná rychlost, blízko = pomalu', keys: 'WASD = směr ve světě',
    map(w, S) { const r = SCHEMES.A.map(w); return { ...r, ctD: w.window ? w.aimDist : FAR, cruise: clamp(S.cd / 240, 0.35, 1) }; } },
  E: { name: 'WASD + stop (Space) a výjezd ke kurzoru', mouse: 'míří; při brzdě a 0,45 s po ní určuje výjezd (analog)', keys: 'WASD = směr, Space = stop',
    map(w, S) {
      if (w.brake) { S.exitT = 0.45; return { ctA: w.exit ?? w.aim ?? S.ca, dir: null, keys: 0 }; }
      if (S.exitT > 0 && !w.window && w.move != null) { S.exitT -= DT; return { ctA: w.exit ?? w.move, dir: S.ca, keys: 0 }; }
      return SCHEMES.A.map(w); } },
  R1: { name: 'Zaoblené WASD (stáčení 6 rad/s)', mouse: 'míří hůl', keys: 'WASD = cílový směr, jízda se k němu stáčí obloukem',
    map(w, S) { return roundDir(SCHEMES.A.map(w), S, () => 6); } },
  R2: { name: 'Zaoblené WASD podle rychlosti (14 → 4 rad/s)', mouse: 'míří hůl', keys: 'WASD; pomalu ostře, rychle široký oblouk; Space = ostrý stop',
    map(w, S) { return roundDir(SCHEMES.A.map(w), S, () => 14 + (4 - 14) * clamp(S.sp / TOP, 0, 1)); } },
  G: { name: 'WASD + Shift = jeď ke kurzoru', mouse: 'míří; se Shiftem i řídí (analog)', keys: 'WASD směr; drž Shift = volant myší',
    map(w, S) {
      if (w.move != null && !w.window && Math.abs(angleDiff(w.move, q8(w.move))) > 0.17) return { ctA: w.move, dir: S.ca, keys: 0, shift: 1 };
      return SCHEMES.A.map(w); } },
};

// Zaoblení: směr jízdy se ke směru kláves stáčí omezenou úhlovou rychlostí (stav S.rd); bez kláves se stav zahodí
function roundDir(r, S, rate) {
  if (r.dir == null) { S.rd = null; return r; }
  if (S.rd == null) S.rd = S.sp > 20 ? S.hd : r.dir;
  S.rd = wrap(S.rd + clamp(angleDiff(r.dir, S.rd), -rate() * DT, rate() * DT));
  return { ...r, dir: S.rd };
}
// jeden tik: schéma → vstup → Player.update (stejně jako movement_feel.step)
function tick(p, S, sch, w, rec) {
  S.sp = spd(p); S.hd = hd(p);
  S.raw = S.ca; S.ca = S.fa; const m = SCHEMES[sch].map(w, S); S.ca = S.raw;
  const ca0 = S.ca, cd0 = S.cd;
  if (m.ctA != null) S.ca += clamp(angleDiff(m.ctA, S.ca), -CUR_W * DT, CUR_W * DT);
  S.ca = wrap(S.ca + S.noise() * CUR_NOISE);   // úhly držet v (−π, π]: utils.angleDiff/lerpAngle nesnesou |a−b| > 3π
  const ctD = m.ctD ?? w.aimDist ?? 100; S.cd += clamp(ctD - S.cd, -CUR_DV * DT, CUR_DV * DT);
  S.fa = wrap(lerpAngle(S.fa, S.ca, Math.min(1, clamp(S.cd / 35, 0.12, 1) * 28 * DT)));   // herní vyhlazení míření (match-core.js _updateAim)
  const i = p.input, brake = !!w.brake && !m.noBrake;
  if (m.dir == null || brake) { i.dx = 0; i.dy = 0; } else { i.dx = Math.cos(m.dir); i.dy = Math.sin(m.dir); }
  i.keys = { Space: brake }; i.lmb = w.window === 'lmb'; i.rmb = false; i.cruise = m.cruise ?? null;
  p.aimAngle = S.fa; p.aimDist = S.cd; i.aim = S.fa; i.aimDist = S.cd;
  p.update(DT, null);
  if (rec) { rec.n++;
    rec.inputs += (m.keys || 0) + (brake ? 1 : 0) + (m.shift ? 1 : 0) + (w.window ? 1 : 0)
      + ((Math.abs(angleDiff(S.ca, ca0)) > 0.02 || Math.abs(S.cd - cd0) > 2) ? 1 : 0);   // myš „aktivně" = pohyb > 1,1°/tick (víc než třes)
    if (m.dir != null && !brake && w.move != null) { rec.qn++; rec.qe += Math.abs(angleDiff(wrap(m.dir), wrap(w.move))); }
  }
  return m;
}
const newS = (seed, a = 0) => ({ ca: a, fa: a, cd: 100, frozen: null, exitT: 0, noise: gaussOf(seed) });
const newRec = () => ({ n: 0, inputs: 0, qn: 0, qe: 0 });

// ---------- manévry na otevřeném ledu (RINK dočasně 40000², jako movement_feel) ----------
function openIce(fn) { const W0 = RINK.w, H0 = RINK.h; RINK.w = RINK.h = 40000; try { return fn(); } finally { RINK.w = W0; RINK.h = H0; } }
function atTop(sch, rot, seed) { const p = mk(20000 - Math.cos(rot) * 300, 20000 - Math.sin(rot) * 300, rot), S = newS(seed, rot);
  for (let t = 0; t < 1.8 * HZ; t++) tick(p, S, sch, { move: rot }); return { p, S }; }
function manoeuvres(sch, rot, seed) { return openIce(() => {
  const R = {};
  { const { p, S } = atTop(sch, rot, seed), tgt = rot + Math.PI / 2, x0 = p.x, y0 = p.y; let mn = Infinity, t = 0;   // 90° cut
    while (Math.abs(angleDiff(hd(p), tgt)) > 0.17 && t < 4 * HZ) { tick(p, S, sch, { move: tgt }); mn = Math.min(mn, spd(p)); t++; }
    R.r90_px = (p.x - x0) * Math.cos(rot) + (p.y - y0) * Math.sin(rot); }
  { const { p, S } = atTop(sch, rot, seed); let mn = Infinity, k = 0;   // carve 0,5 rad/s
    const top0 = spd(p); for (let t = 0; t < 2 * HZ; t++) { tick(p, S, sch, { move: rot + 0.5 * t / HZ }); mn = Math.min(mn, spd(p)); }
    R.carve_loss = 1 - mn / top0; }
  const rev = useBrake => { const { p, S } = atTop(sch, rot, seed), back = rot + Math.PI; let t = 0, br = useBrake;   // 180°
    while (t < 5 * HZ) { if (br && spd(p) < 15) br = false;
      tick(p, S, sch, br ? { move: null, brake: true, exit: back } : { move: back }); t++;
      if (-(p.vx * Math.cos(rot) + p.vy * Math.sin(rot)) >= 0.9 * TOP) break; } return t / HZ; };
  R.stopgo_gain = 1 - rev(true) / rev(false);
  { const { p, S } = atTop(sch, rot, seed), h0 = hd(p); let t = 0;   // odezva
    while (Math.abs(angleDiff(hd(p), h0)) < 0.035 && t < 30) { tick(p, S, sch, { move: rot + Math.PI / 2 }); t++; } R.latency_ms = t / HZ * 1000; }
  return R; }); }

// ---------- konfliktní scénáře: jízda rovně + okno míření jinam ----------
// S1 nájezd + střela (LMB nápřah 0,6 s, s pukem) na úhly 60° / −100° / 135° (přes rameno)
// S2 přihrávka do strany za jízdy (RMB, 0,25 s) na ±90°. Kurzy 0°, 45°, 20°, −115° (8směrové i mimo).
const HEADINGS = [0, Math.PI / 4, 0.35, -2.0];
const SCEN = [ ...[1.05, -1.75, 2.36].map(o => ({ id: 'S1', off: o, win: 0.6, btn: 'lmb', puck: true })),
               ...[1.5708, -1.5708].map(o => ({ id: 'S2', off: o, win: 0.25, btn: 'rmb', puck: true })) ];
function scenario(sch, h, sc, seed, rec) { return openIce(() => {
  const p = mk(20000, 20000, h), S = newS(seed, h); p.hasPuck = !!sc.puck;
  p.vx = Math.cos(h) * TOP * 0.92; p.vy = Math.sin(h) * TOP * 0.92;   // už jede
  for (let t = 0; t < 0.6 * HZ; t++) tick(p, S, sch, { move: h }, rec);
  const h0 = hd(p), v0 = spd(p), aimT = h + sc.off; let bad = 0, n = 0, ae = 0, an = 0;
  for (let t = 0; t < sc.win * HZ; t++) {
    tick(p, S, sch, { move: h, aim: aimT, window: sc.btn, aimDist: 100 }, rec); n++;
    const aErr = Math.abs(angleDiff(p.aimAngle, aimT)), grace = t >= Math.min(0.2, 0.5 * sc.win) * HZ;   // čas na přetočení kurzoru
    if (grace) { ae += aErr; an++; }
    if ((grace && aErr > 0.15) || Math.abs(angleDiff(hd(p), h0)) > 0.15 || spd(p) < 0.8 * v0) bad++;
  }
  return { bad, n, ae, an }; }); }

// ---------- trasy (stejné seedy jako movement_feel.course) ----------
function course(seed) {
  const r = rngOf(seed * 7919 + 13), pts = [{ x: 160, y: RINK.h / 2 }];
  while (pts.length < 7) { const l = pts[pts.length - 1]; const q = { x: 140 + r() * 800, y: 90 + r() * 276 };
    const d = Math.hypot(q.x - l.x, q.y - l.y); if (d < 140 || d > 380) continue;
    if (pts.length >= 2) { const pr = pts[pts.length - 2]; const t = Math.abs(angleDiff(Math.atan2(q.y - l.y, q.x - l.x), Math.atan2(l.y - pr.y, l.x - pr.x))); if (t < 1.2) continue; }
    pts.push(q); }
  return pts;
}
const REACH = 18;
function runCourse(sch, pts, P, seed, rec, sm) {
  const p = mk(pts[0].x, pts[0].y, 0), S = newS(seed, 0); let i = 1, t = 0, hPrev = null, kPrev = null;
  while (i < pts.length && t < 30 * HZ) {
    const w = pts[i], nx = pts[i + 1], dx = w.x - p.x, dy = w.y - p.y, d = Math.hypot(dx, dy);
    let tx = dx / (d || 1), ty = dy / (d || 1);
    if (P.lead && nx && d < P.lead) { const ax = w.x + (nx.x - w.x) * P.leadK - p.x, ay = w.y + (nx.y - w.y) * P.leadK - p.y, n = Math.hypot(ax, ay) || 1; tx = ax / n; ty = ay / n; }
    if (P.comp) { const al = p.vx * tx + p.vy * ty, px = (p.vx - al * tx) / TOP, py = (p.vy - al * ty) / TOP; tx -= px * P.comp; ty -= py * P.comp; const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n; }
    if (P.weave && d > 70) { const a = Math.atan2(ty, tx) + P.weave * (Math.sin(2 * Math.PI * 2 * t / HZ) >= 0 ? 1 : -1); tx = Math.cos(a); ty = Math.sin(a); }
    const exit = nx ? Math.atan2(nx.y - w.y, nx.x - w.x) : null, turn = exit == null ? 0 : Math.abs(angleDiff(exit, Math.atan2(dy, dx)));
    const brake = !!(P.bAng && nx && turn > P.bAng && d < P.bDist && spd(p) > P.bFrac * TOP);
    const coast = !!(P.coast && nx && d < P.coast && !brake && turn > 1.2);
    tick(p, S, sch, { move: coast || brake ? null : Math.atan2(ty, tx), brake, exit }, rec); t++;
    if (sm && spd(p) > 20) { const h = hd(p); if (hPrev != null) { const k = angleDiff(h, hPrev) * HZ; sm.m = (sm.m || 0) + 1; if (Math.abs(k) > 0.3 && Math.abs(k) < 6) sm.c = (sm.c || 0) + 1; if (kPrev != null) { sm.s += Math.abs(k - kPrev); sm.n++; } kPrev = k; } hPrev = h; } else { hPrev = kPrev = null; }
    if (Math.hypot(w.x - p.x, w.y - p.y) < REACH) i++;
  }
  return i < pts.length ? 99 : t / HZ;
}
const GRID = [];
for (const comp of [0, 0.8, 1.6]) for (const bAng of [0, 1.2, 1.8, 2.4]) for (const bDist of (bAng ? [30, 55, 80] : [0])) for (const bFrac of (bAng ? [0.3, 0.6] : [0])) for (const coast of [0, 40]) for (const weave of [0, 0.35])
  for (const [lead, leadK] of [[0, 0], [45, 0.15], [70, 0.25]]) GRID.push({ comp, bAng, bDist, bFrac, coast, weave, lead, leadK });   // = movement_feel GRID
const N_COURSES = 6;

// ---------- vyhodnocení schématu ----------
function evaluate(sch) {
  const rec = newRec(), R = {};
  // manévry: 3 směry scény, průměr
  const rots = [0, Math.PI / 4, -Math.PI / 2], M   // 8směrové osy: fyzika obratu férově; kvantizaci měří trasy+scénáře
   = rots.map((r, k) => manoeuvres(sch, r, 100 + k));
  for (const key of Object.keys(M[0])) R[key] = M.reduce((s, m) => s + m[key], 0) / M.length;
  // konflikty
  let bad = 0, n = 0, ae = 0, an = 0, k = 0;
  for (const h of HEADINGS) for (const sc of SCEN) { const o = scenario(sch, h, sc, 500 + k++, rec); bad += o.bad; n += o.n; ae += o.ae; an += o.an; }
  R.conflict_pct = 100 * bad / n; R.aim_err_deg = ae / an * D2R;
  // trasy: naivní (kvantizace, plynulost, čas) + nejlepší z mřížky (skill gap)
  const C = Array.from({ length: N_COURSES }, (_, j) => course(j + 1)), sm = { s: 0, n: 0 };
  const naive = C.map((c, j) => runCourse(sch, c, {}, 900 + j, rec, sm));
  const per = C.map(() => Infinity);
  for (const P of GRID) C.forEach((c, j) => { per[j] = Math.min(per[j], runCourse(sch, c, P, 900 + j, null, null)); });
  const nSum = naive.reduce((a, b) => a + b, 0);
  R.course_s = nSum / N_COURSES; R.skill_gap = nSum / per.reduce((a, b) => a + b, 0);
  R.smooth = sm.s / sm.n; R.curve_pct = 100 * (sm.c || 0) / (sm.m || 1); R.quant_err_deg = rec.qe / rec.qn * D2R; R.inputs_mean = rec.inputs / rec.n;
  return R;
}
function points(R, A) {
  const V = { ...R, smooth_rel: R.smooth / A.smooth, course_rel: R.course_s / A.course_s };
  let sum = 0; const pts = {};
  for (const [k, r] of Object.entries(RUBRIC)) { const v = V[k]; const b = (v >= r.two[0] && v <= r.two[1]) ? 2 : (v >= r.one[0] && v <= r.one[1]) ? 1 : 0; pts[k] = b * r.w; sum += b * r.w; }
  return { V, pts, sum };
}

// ---------- běh ----------
const names = Object.keys(SCHEMES), RES = {};
for (const s of names) RES[s] = evaluate(s);
const det = JSON.stringify(evaluate('B')) === JSON.stringify(RES.B) && JSON.stringify(evaluate('A')) === JSON.stringify(RES.A);
const SC = Object.fromEntries(names.map(s => [s, points(RES[s], RES.A)]));
const order = [...names].sort((a, b) => SC[b].sum - SC[a].sum || SC[a].V.conflict_pct - SC[b].V.conflict_pct || SC[a].V.quant_err_deg - SC[b].V.quant_err_deg || a.localeCompare(b));
if (ARG.json) { process.stdout.write(JSON.stringify({ RES, order, det }) + '\n'); process.exit(0); }

const f = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
console.log(`determinismus (opakovaný výpočet A, B shodný): ${det ? 'OK' : 'NE'}  | model: kurzor ${CUR_W} rad/s, třes ${CUR_NOISE} rad/tick (ODHAD), trasy ${N_COURSES}, mřížka ${GRID.length}`);
console.log('\nSchémata:'); for (const s of names) console.log(`  ${s.padEnd(3)} ${SCHEMES[s].name} — myš: ${SCHEMES[s].mouse}; klávesy: ${SCHEMES[s].keys}`);
const keys = Object.keys(RUBRIC);
console.log('\n' + 'metrika (body)'.padEnd(16) + names.map(s => s.padStart(14)).join(''));
for (const k of keys) console.log(k.padEnd(16) + names.map(s => `${f(SC[s].V[k])} (${SC[s].pts[k]})`.padStart(14)).join(''));
console.log('SOUČET'.padEnd(16) + names.map(s => `${SC[s].sum}/${RUB_MAX}`.padStart(14)).join(''));
console.log('info course_s'.padEnd(16) + names.map(s => f(RES[s].course_s).padStart(14)).join(''));
console.log(`\nPOŘADÍ: ${order.map((s, i) => `${i + 1}. ${s} (${SC[s].sum})`).join('  ')}`);
console.log('\nRubrika (předem):'); for (const [k, r] of Object.entries(RUBRIC)) console.log(`  ${k.padEnd(14)} 2b ${JSON.stringify(r.two)} 1b ${JSON.stringify(r.one)} ×${r.w} — ${r.why}`);
process.exit(0);
