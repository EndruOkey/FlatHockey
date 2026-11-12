// POHYB — „feel" scorecard (deterministický, 60 Hz, žádná náhoda mimo seedy). NEMĚNÍ herní soubory.
// Rubrika je napsaná PŘEDEM (RUBRIC níže) z rešerše game feel (Swink, Nealen „low floor/high ceiling",
// Rocket League momentum/powerslide, NHL hustle/hard stop). Měří Player._move na skriptovaných manévrech,
// skill gap (naivní vs. nejlepší vstup na seedovaných trasách) a monotónnost tempa v bot zápasech (server sim 2v2).
// What-if: varianty mechanik jako RUNTIME obal Player._move (mění PLAYER.accel/speed jen v paměti tohoto procesu)
// + env FH_PSPEED přes child proces.
//   node scripts/movement_feel.mjs                  → scorecard base + všechny what-if
//   node scripts/movement_feel.mjs --only=base      → jen současný stav
//   node scripts/movement_feel.mjs --json --only=X  → JSON (pro child proces)
import { tmpdir } from 'os'; import { join } from 'path'; import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';
process.env.PORT = process.env.PORT || '4651';
process.env.DB_PATH = join(tmpdir(), `fh-feel-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { PLAYER, RINK, TEMPO } = await import('../public/js/constants.js');
const { Player, PlayerBase } = await import('../public/js/entities/Player.js');
const { makeInput } = await import('../public/js/match-core.js');
const { angleDiff, clamp } = await import('../public/js/utils.js');

const HZ = 60, DT = 1 / HZ, BASE = { accel: PLAYER.accel, speed: PLAYER.speed };

// ---------- RUBRIKA (předem; [lo, hi], zdůvodnění) ----------
const RUBRIC = {
  t90_s:          [0.35, 0.80, 'rozjezd 0→90 % top: svižný první krok, ale rychlost se buduje (bugnet/Swink: pomalá rampa = „floaty")'],
  brake_s:        [0.18, 0.50, 'tvrdá brzda z top do stání: hokejový stop je ostrý'],
  brake_px:       [12,   45,   'brzdná dráha: čitelná, ~1,5–5 těl'],
  glide_s:        [1.5,  3.5,  'skluz po puštění: cítit led, ale ne nekonečný'],
  r90_px:         [30,   70,   'poloměr obratu 90° na top (4–9 těl): ostrý, ale ne pivot'],
  cut90_loss:     [0.15, 0.40, 'ztráta rychlosti při ostrém 90° cutu: obrat MÁ stát tempo (rozhodnutí)'],
  carve_loss:     [0.00, 0.08, 'mírný oblouk (~0,5 rad/s) drží rychlost (carve/powerslide v RL)'],
  rev_s:          [0.55, 1.10, 'obrat 180° na top → 90 % rychlosti opačně'],
  stopgo_gain:    [0.10, 0.40, 'technika: brzda+výjezd je o X rychlejší než obloukový obrat (odměna za stop-and-go)'],
  pump_gain:      [0.03, 0.12, 'technika: crossover/kličkování dá krátkodobě víc rychlosti než držet rovně (rychlostní stupně)'],
  skill_gap:      [1.15, 1.60, 'čas naivní/nejlepší vstup na trase: dovednost se musí vyplácet (low floor, high ceiling)'],
  skill_gap_glob: [1.10, 1.60, 'totéž pro JEDNU naučitelnou techniku (stejné parametry na všech trasách)'],
  puck_ratio:     [0.82, 0.95, 'top s pukem / bez: riziko–odměna (s pukem tě dojedou)'],
  back_ratio:     [0.65, 0.85, 'couvání / vpřed'],
  latency_ms:     [0,    50,   'odezva: změna vstupu → viditelná změna směru (≤3 ticky)'],
  bot_full_pct:   [20,   45,   'zápas: % času ≥90 % top (víc = monotónní „všichni naplno")'],
  bot_cv:         [0.40, 9,    'zápas: variační koeficient rychlosti (pestrost tempa)'],
  bot_shifts_min: [8,    99,   'zápas: změny tempa pomalu(<40 %)↔rychle(≥85 %) na hráče za minutu'],
  bot_stretch_s:  [0,    2.5,  'zápas: průměrná délka úseku na ≥90 % top (dlouhé = nuda)'],
};

// ---------- WHAT-IF varianty (runtime obal, herní soubory beze změny) ----------
const VARIANTS = {
  base:      {},
  accel260:  { accel: 260 },                                   // jen rychlejší rozjezd
  acurve:    { acurve: [420, 120] },                           // výbušný 1. krok, top se buduje (420 px/s² ze stání → 120 u topu)
  stopgo:    { stopgo: { k: 2.5, t: 0.45, pivot: 30 } },       // hockey stop: po tvrdé brzdě z rychlosti 0,45 s × 2,5 akcelerace + pod 30 px/s se odrazíš rovnou do směru vstupu (ne oblouk)
  carve:     { carve: { lo: 0.12, hi: 0.75, k: 1.10, hold: 0.5 } }, // crossover v oblouku: top × 1,10 (dojíždí po 0,5 s)
  cut:       { cut: 4 },                                       // ostrý cut (>45°) stojí rychlost navíc: sp × (1 − k·x·dt), x = 0..1 dle úhlu
  combo:     { acurve: [420, 120], stopgo: { k: 2.5, t: 0.45, pivot: 30 }, carve: { lo: 0.12, hi: 0.75, k: 1.10, hold: 0.5 }, cut: 4 },
};
const ENV_VARIANTS = { pspeed180: { FH_PSPEED: '180' } };

let V = VARIANTS.base;
const origMove = PlayerBase.prototype._move;
PlayerBase.prototype._move = function (input, dt) {
  if (!V || !Object.keys(V).length) return origMove.call(this, input, dt);
  const sp = Math.hypot(this.vx, this.vy), top = BASE.speed;
  let acc = V.accel ?? BASE.accel, spd = BASE.speed;
  if (V.acurve) acc = V.acurve[0] + (V.acurve[1] - V.acurve[0]) * clamp(sp / top, 0, 1);
  const braking = !!(input.keys && input.keys.Space);
  if (V.stopgo) {
    if (braking && sp > 0.5 * top) this._sgArm = true;
    if (!braking && this._sgArm) { this._sgArm = false; this._sgT = V.stopgo.t; }
    if (this._sgT > 0) { acc *= V.stopgo.k; this._sgT -= dt;
      const il = Math.hypot(input.dx, input.dy);
      if (V.stopgo.pivot && il > 0.01 && sp < V.stopgo.pivot) { const a = Math.atan2(input.dy, input.dx); this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp; } }
  }
  if (V.carve) {
    const il = Math.hypot(input.dx, input.dy);
    if (il > 0.01 && sp > 0.7 * top) {
      const dA = Math.abs(angleDiff(Math.atan2(input.dy, input.dx), Math.atan2(this.vy, this.vx)));
      if (dA >= V.carve.lo && dA <= V.carve.hi) this._cvT = V.carve.hold;
    }
    if (this._cvT > 0) { spd *= V.carve.k; this._cvT -= dt; }
  }
  let cutX = 0;
  if (V.cut && !braking && Math.hypot(input.dx, input.dy) > 0.01 && sp > 20)
    cutX = clamp((Math.abs(angleDiff(Math.atan2(input.dy, input.dx), Math.atan2(this.vy, this.vx))) - 0.8) / (Math.PI - 0.8), 0, 1);
  PLAYER.accel = acc; PLAYER.speed = spd;
  try { origMove.call(this, input, dt); } finally { PLAYER.accel = BASE.accel; PLAYER.speed = BASE.speed; }
  if (cutX > 0) { const f = 1 - V.cut * cutX * dt; this.vx *= f; this.vy *= f; }
};

// ---------- harness: jeden bruslař, ručně řízený vstup ----------
function mk(x, y, ang = 0) {
  const p = new Player('t', 'home', makeInput()); p.x = x; p.y = y; p._others = [];
  p.aimAngle = p.bodyAngle = p.skateAngle = p.carryAngle = ang; return p;
}
// ctl(t, p) → { dx, dy, aim?, aimDist?, space? }; aim default = směr vstupu (hráč kouká, kam jede)
function step(p, c) {
  const i = p.input; i.dx = c.dx; i.dy = c.dy; i.keys = { Space: !!c.space }; i.lmb = false; i.rmb = false;
  const a = c.aim ?? ((c.dx || c.dy) ? Math.atan2(c.dy, c.dx) : p.aimAngle);
  p.aimAngle = a; p.aimDist = c.aimDist ?? 100; i.aim = a; i.aimDist = p.aimDist;
  p.update(DT, null);
}
const spd = p => Math.hypot(p.vx, p.vy);
const hd = p => Math.atan2(p.vy, p.vx);
const dirIn = a => ({ dx: Math.cos(a), dy: Math.sin(a) });

// Manévry. `rot` = otočení celé scény (stabilita vůči směru), výsledky mají být nezávislé.
// Manévry běží na „otevřeném ledu" (RINK dočasně 40000², jen v paměti) → žádné mantinely nezkreslí obrat/skluz.
function manoeuvres(rot = 0) {
  const W0 = RINK.w, H0 = RINK.h; RINK.w = RINK.h = 40000;
  try { return _man(rot); } finally { RINK.w = W0; RINK.h = H0; }
}
function _man(rot) {
  const R = {}, F = dirIn(rot), cx = RINK.w / 2, cy = RINK.h / 2;
  const startBack = (k) => ({ x: cx - Math.cos(rot) * k, y: cy - Math.sin(rot) * k });
  // 1 sprint
  { const s = startBack(380); const p = mk(s.x, s.y, rot); let t90 = null, top = 0;
    for (let t = 0; t < 3 * HZ; t++) { step(p, F); top = Math.max(top, spd(p)); }
    const q = mk(s.x, s.y, rot); for (let t = 0; t < 3 * HZ; t++) { step(q, F); if (t90 == null && spd(q) >= 0.9 * top) t90 = (t + 1) / HZ; }
    R.top = top; R.t90_s = t90; }
  const TOP = R.top;
  const atTop = (s) => { const p = mk(s.x, s.y, rot); for (let t = 0; t < 1.8 * HZ; t++) step(p, F); return p; };
  // 2 brzda / 3 skluz
  { const p = atTop(startBack(420)); const x0 = p.x, y0 = p.y; let t = 0;
    while (spd(p) > 3 && t < 5 * HZ) { step(p, { dx: 0, dy: 0, aim: rot, space: true }); t++; }
    R.brake_s = t / HZ; R.brake_px = Math.hypot(p.x - x0, p.y - y0); }
  { const p = atTop(startBack(480)); let t = 0;
    while (spd(p) > 3 && t < 8 * HZ) { step(p, { dx: 0, dy: 0, aim: rot }); t++; }
    R.glide_s = t / HZ; }
  // 4 obrat 90° (cut): poloměr = posun ve směru původní jízdy do srovnání kurzu; ztráta = min rychlost
  { const p = atTop(startBack(300)); const x0 = p.x, y0 = p.y, tgt = rot + Math.PI / 2, D = dirIn(tgt); let mn = Infinity, t = 0;
    while (Math.abs(angleDiff(hd(p), tgt)) > 0.17 && t < 4 * HZ) { step(p, D); mn = Math.min(mn, spd(p)); t++; }
    R.r90_px = (p.x - x0) * Math.cos(rot) + (p.y - y0) * Math.sin(rot); R.cut90_loss = 1 - mn / TOP; R.cut90_s = t / HZ; }
  // 5 carve: vstup se stáčí 0,5 rad/s po dobu 2 s
  { const p = atTop(startBack(250)); let mn = Infinity;
    for (let t = 0; t < 2 * HZ; t++) { step(p, dirIn(rot + 0.5 * t / HZ)); mn = Math.min(mn, spd(p)); }
    R.carve_loss = 1 - mn / TOP; }
  // 6 obrat 180°: oblouk vs. brzda+výjezd (technika)
  const rev = (useBrake) => { const p = atTop(startBack(150)); const B = dirIn(rot + Math.PI); let t = 0, braking = useBrake;
    while (t < 5 * HZ) {
      if (braking && spd(p) < 15) braking = false;
      step(p, braking ? { dx: 0, dy: 0, aim: rot, space: true } : B); t++;
      const vback = -(p.vx * Math.cos(rot) + p.vy * Math.sin(rot));
      if (vback >= 0.9 * TOP) break;
    } return t / HZ; };
  R.rev_s = rev(false); R.rev_brake_s = rev(true); R.stopgo_gain = 1 - R.rev_brake_s / R.rev_s;
  // 7 kličkování (crossover pumpa): vstup kmitá ±θ s frekvencí f; průměrná rychlost VPŘED / top
  { let best = 0; for (const th of [0.2, 0.35, 0.5, 0.7]) for (const f of [1, 1.5, 2, 3]) {
      const p = atTop(startBack(400)); let fwd = 0, n = 0;
      for (let t = 0; t < 2 * HZ; t++) { const a = rot + th * Math.sign(Math.sin(2 * Math.PI * f * t / HZ) || 1); step(p, dirIn(a));
        if (t >= HZ / 2) { fwd += p.vx * Math.cos(rot) + p.vy * Math.sin(rot); n++; } }
      best = Math.max(best, fwd / n / TOP); }
    R.pump_gain = best - 1; }
  // 8 kruh plným rejdem (vstup kolmo na kurz) — ustálená rychlost a poloměr („kolotoč")
  { const p = atTop({ x: cx, y: cy + 60 }); let ang = 0, n = 0, s = 0;
    for (let t = 0; t < 3 * HZ; t++) { const h0 = hd(p); step(p, dirIn(h0 + Math.PI / 2)); if (t > 2 * HZ) { ang += Math.abs(angleDiff(hd(p), h0)); s += spd(p); n++; } }
    const w = ang / (n / HZ); R.circle_v = s / n / TOP; R.circle_r_px = (s / n) / w; }
  // 9 couvání, puk, stažený puk
  const topWith = (c, setup) => { const s = startBack(380); const p = mk(s.x, s.y, rot); setup && setup(p); let top = 0;
    for (let t = 0; t < 3 * HZ; t++) { step(p, c); top = Math.max(top, spd(p)); } return top; };
  R.back_ratio = topWith({ ...F, aim: rot + Math.PI }) / TOP;
  R.puck_ratio = topWith({ ...F, aimDist: 100 }, p => { p.hasPuck = true; }) / TOP;
  R.tuck_ratio = topWith({ ...F, aimDist: 10 }, p => { p.hasPuck = true; }) / TOP;
  // 10 odezva: na topu vstup o 90° → ticky do změny kurzu > 2°
  { const p = atTop(startBack(300)); const h0 = hd(p), D = dirIn(rot + Math.PI / 2); let t = 0;
    while (Math.abs(angleDiff(hd(p), h0)) < 0.035 && t < 30) { step(p, D); t++; } R.latency_ms = (t / HZ) * 1000; }
  return R;
}

// ---------- skill gap: seedované trasy, naivní vs. nejlepší vstup ----------
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function course(seed) {
  const r = rngOf(seed * 7919 + 13), pts = [{ x: 160, y: RINK.h / 2 }];
  while (pts.length < 7) { const l = pts[pts.length - 1]; const q = { x: 140 + r() * 800, y: 90 + r() * 276 };
    const d = Math.hypot(q.x - l.x, q.y - l.y); if (d < 140 || d > 380) continue;
    if (pts.length >= 2) { const pr = pts[pts.length - 2]; const t = Math.abs(angleDiff(Math.atan2(q.y - l.y, q.x - l.x), Math.atan2(l.y - pr.y, l.x - pr.x))); if (t < 1.2) continue; }  // ostré obraty ≥ ~70°
    pts.push(q); }
  return pts;
}
const REACH = 18;
function runCourse(pts, P) {
  const p = mk(pts[0].x, pts[0].y, 0); let i = 1, t = 0, brakeT = 0;
  while (i < pts.length && t < 30 * HZ) {
    const w = pts[i], nx = pts[i + 1], dx = w.x - p.x, dy = w.y - p.y, d = Math.hypot(dx, dy);
    let tx = dx / (d || 1), ty = dy / (d || 1);
    if (P.lead && nx && d < P.lead) { const ax = w.x + (nx.x - w.x) * P.leadK - p.x, ay = w.y + (nx.y - w.y) * P.leadK - p.y, n = Math.hypot(ax, ay) || 1; tx = ax / n; ty = ay / n; }   // nájezd do další brány (závodní stopa)
    if (P.comp) { const along = p.vx * tx + p.vy * ty, px = (p.vx - along * tx) / PLAYER.speed, py = (p.vy - along * ty) / PLAYER.speed;   // boční drift vůči cíli
      tx -= px * P.comp; ty -= py * P.comp; const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n; }
    if (P.weave && d > 70) { const a = Math.atan2(ty, tx) + P.weave * (Math.sin(2 * Math.PI * 2 * t / HZ) >= 0 ? 1 : -1); tx = Math.cos(a); ty = Math.sin(a); }
    let space = false;
    if (P.bAng && nx) { const turn = Math.abs(angleDiff(Math.atan2(nx.y - w.y, nx.x - w.x), Math.atan2(dy, dx)));
      if (turn > P.bAng && d < P.bDist && spd(p) > P.bFrac * PLAYER.speed) space = true; }
    if (P.coast && nx && d < P.coast && !space) { const turn = Math.abs(angleDiff(Math.atan2(nx.y - w.y, nx.x - w.x), Math.atan2(dy, dx))); if (turn > 1.2) { step(p, { dx: 0, dy: 0, aim: p.aimAngle }); t++; if (Math.hypot(w.x - p.x, w.y - p.y) < REACH) i++; continue; } }
    step(p, space ? { dx: 0, dy: 0, aim: p.aimAngle, space: true } : { dx: tx, dy: ty }); t++;
    if (Math.hypot(w.x - p.x, w.y - p.y) < REACH) i++;
  }
  return i < pts.length ? 99 : t / HZ;
}
const NAIVE = {};
const GRID = [];
for (const comp of [0, 0.8, 1.6]) for (const bAng of [0, 1.2, 1.8, 2.4]) for (const bDist of (bAng ? [30, 55, 80] : [0])) for (const bFrac of (bAng ? [0.3, 0.6] : [0])) for (const coast of [0, 40]) for (const weave of [0, 0.35]) for (const [lead, leadK] of [[0, 0], [45, 0.15], [70, 0.25]]) GRID.push({ comp, bAng, bDist, bFrac, coast, weave, lead, leadK });
function skillGap(nCourses) {
  const C = Array.from({ length: nCourses }, (_, k) => course(k + 1));
  const naive = C.map(c => runCourse(c, NAIVE));
  const per = C.map(() => Infinity); let globBest = Infinity, globP = null;
  for (const P of GRID) { let sum = 0; C.forEach((c, k) => { const tt = runCourse(c, P); per[k] = Math.min(per[k], tt); sum += tt; }); if (sum < globBest) { globBest = sum; globP = P; } }
  const nSum = naive.reduce((a, b) => a + b, 0);
  return { skill_gap: nSum / per.reduce((a, b) => a + b, 0), skill_gap_glob: nSum / globBest, globP, naive_s: nSum / nCourses };
}

// ---------- bot zápasy: monotónnost tempa ----------
async function botTempo(nSeeds) {
  const { __test } = await import('../server.js');
  const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
  const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
  const TOP = BASE.speed * TEMPO; let n = 0, full = 0, s1 = 0, s2 = 0, shifts = 0, liveT = 0, stretchN = 0, stretchT = 0;
  for (let s = 1; s <= nSeeds; s++) {
    const l = { id: 'mf' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 3, periods: 1 }), members: new Map(), matchSeq: s - 1 };
    for (let i = 0; i < 2; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
    for (let i = 0; i < 2; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    const st = new Map();
    while (!m.ended) {
      stepMatch(m);
      if (m.setup || m.stoppage || m.world._goalLock) { for (const v of st.values()) { if (v.run > 0) { stretchN++; stretchT += v.run; } v.run = 0; } continue; }
      liveT++;
      for (const p of m.players.values()) {
        const f = Math.hypot(p.vx, p.vy) / TOP; n++; s1 += f; s2 += f * f;
        let v = st.get(p.id); if (!v) st.set(p.id, v = { band: null, run: 0 });
        if (f >= 0.9) { full++; v.run++; } else if (v.run > 0) { stretchN++; stretchT += v.run; v.run = 0; }
        const band = f < 0.4 ? 'lo' : f >= 0.85 ? 'hi' : v.band;
        if (v.band && band !== v.band) shifts++; v.band = band;
      }
    }
    lobbies.delete(l.id);
  }
  const mu = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - mu * mu)), players = n / liveT;
  return { bot_full_pct: 100 * full / n, bot_cv: sd / mu, bot_mean_pct: 100 * mu, bot_shifts_min: shifts / players / (liveT / HZ / 60), bot_stretch_s: stretchN ? stretchT / stretchN / HZ : 0 };
}

// ---------- běh s kontrolou stability (rozšiřuje vstupy, dokud se metriky nehnou o < 3 %) ----------
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-6, Math.abs(b));
function avgMan(rots) { const A = rots.map(manoeuvres), out = {}; for (const k of Object.keys(A[0])) { const v = A.map(a => a[k]); out[k] = v.reduce((x, y) => x + y, 0) / v.length; out[k + '_spread'] = Math.max(...v) - Math.min(...v); } return out; }
async function evaluate(name, quick) {
  V = VARIANTS[name] || {};
  const man = avgMan([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]);   // 5 směrů scény
  let sg = null, nC = 3, prev = null, stab = [];
  while (nC <= 12) { sg = skillGap(nC); stab.push(`${nC}:${sg.skill_gap.toFixed(3)}`); if (prev && rel(sg.skill_gap, prev.skill_gap) < 0.03 && rel(sg.skill_gap_glob, prev.skill_gap_glob) < 0.03) break; prev = sg; nC += 3; }
  let bt = null, nS = 2, pb = null, bstab = [];
  while (nS <= (quick ? 4 : 8)) { bt = await botTempo(nS); bstab.push(`${nS}:${bt.bot_full_pct.toFixed(1)}`); if (pb && rel(bt.bot_full_pct, pb.bot_full_pct) < 0.03 && rel(bt.bot_cv, pb.bot_cv) < 0.03) break; pb = bt; nS += 2; }
  return { name, ...man, ...sg, ...bt, stab_courses: stab.join(' '), stab_seeds: bstab.join(' ') };
}
function determinism() { V = VARIANTS.base; return JSON.stringify(manoeuvres(0)) + JSON.stringify(skillGap(3)) === JSON.stringify(manoeuvres(0)) + JSON.stringify(skillGap(3)); }

const fmt = v => v == null ? 'n/a' : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
function scorecard(R) {
  let ok = 0, tot = 0; const lines = [];
  for (const [k, [lo, hi, why]] of Object.entries(RUBRIC)) { const v = R[k]; if (v == null) continue; tot++; const pass = v >= lo && v <= hi; if (pass) ok++;
    lines.push(`  ${pass ? 'OK  ' : 'FAIL'} ${k.padEnd(15)} ${fmt(v).padStart(8)}  [${lo}..${hi}]${R[k + '_spread'] > 1e-3 ? `  (rozptyl směrů ${fmt(R[k + '_spread'])})` : ''}  — ${why}`); }
  return { ok, tot, text: lines.join('\n') };
}

// ---------- SWEEP: pevná mřížka kombinací, pevné skóre (počet OK v rubrice; remíza = součet vzdáleností od středu pásma, pak pořadí) ----------
// node scripts/movement_feel.mjs --sweep [--top=4]  → fáze 1 bez botů (manévry 2 směry + skill gap 3 trasy), fáze 2 plné hodnocení top N
function centerDist(R, keys) { let s = 0; for (const k of keys) { const [lo, hi0] = RUBRIC[k], hi = Math.min(hi0, lo * 3 + 1), v = R[k]; if (v == null) continue; s += Math.abs(v - (lo + hi) / 2) / Math.max(1e-6, (hi - lo) / 2); } return s; }
function okCount(R, keys) { return keys.filter(k => R[k] != null && R[k] >= RUBRIC[k][0] && R[k] <= RUBRIC[k][1]).length; }
if (ARG.sweep) {
  const NB = Object.keys(RUBRIC).filter(k => !k.startsWith('bot_'));
  const cand = [];
  for (const a0 of [320, 420, 560]) for (const a1 of [120, 180]) for (const sk of [0, 2.0, 2.5])
    for (const ck of [0, 1.08, 1.14]) for (const cut of [0, 5, 8])
      cand.push({ acurve: [a0, a1], ...(sk ? { stopgo: { k: sk, t: 0.45, pivot: 30 } } : {}), ...(ck ? { carve: { lo: 0.12, hi: 0.75, k: ck, hold: 0.5 } } : {}), ...(cut ? { cut } : {}) });
  const res = [];
  for (const [i, c] of cand.entries()) { V = c; const R = { ...avgMan([0, Math.PI / 2]), ...skillGap(3) }; res.push({ i, c, R, ok: okCount(R, NB), d: centerDist(R, NB) }); }
  res.sort((a, b) => b.ok - a.ok || a.d - b.d || a.i - b.i);
  console.log(`fáze 1: ${cand.length} kombinací, rubrika bez botů (${NB.length} metrik)`);
  for (const r of res.slice(0, 10)) console.log(`  #${r.i} ${r.ok}/${NB.length} d=${r.d.toFixed(2)} ${JSON.stringify(r.c)} | fail: ${NB.filter(k => !(r.R[k] >= RUBRIC[k][0] && r.R[k] <= RUBRIC[k][1])).map(k => k + '=' + fmt(r.R[k])).join(' ')}`);
  const N = +(ARG.top || 4), fin = [];
  for (const r of res.slice(0, N)) { const nm = 'sw' + r.i; VARIANTS[nm] = r.c; const F = await evaluate(nm, true); const s = scorecard(F); fin.push({ nm, c: r.c, ok: s.ok, d: centerDist(F, Object.keys(RUBRIC)) }); console.log(`\n=== ${nm} ${s.ok}/${s.tot} ${JSON.stringify(r.c)} ===\n${s.text}`); }
  fin.sort((a, b) => b.ok - a.ok || a.d - b.d || a.nm.localeCompare(b.nm));
  console.log(`\nVÍTĚZ: ${fin[0].nm} ${fin[0].ok}/19 d=${fin[0].d.toFixed(2)} ${JSON.stringify(fin[0].c)}`);
  process.exit(0);
}

const only = ARG.only ? String(ARG.only).split(',') : null;
if (ARG.json) { const R = await evaluate(only?.[0] || 'base', true); process.stdout.write('@@' + JSON.stringify(R) + '@@'); process.exit(0); }

const names = only || [...Object.keys(VARIANTS), ...Object.keys(ENV_VARIANTS)];
const all = [];
console.log(`determinismus (2 běhy stejně): ${determinism() ? 'OK' : 'NE'}`);
for (const nm of names) {
  let R;
  if (ENV_VARIANTS[nm]) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--json', '--only=base'], { env: { ...process.env, ...ENV_VARIANTS[nm], PORT: '4652' }, encoding: 'utf8', maxBuffer: 1 << 26 });
    R = { ...JSON.parse(r.stdout.split('@@')[1]), name: nm };
  } else R = await evaluate(nm, nm !== 'base');
  all.push(R); const sc = scorecard(R);
  console.log(`\n=== ${nm}  ${sc.ok}/${sc.tot} OK ===\n${sc.text}`);
  console.log(`  info: top ${R.top.toFixed(0)} px/s | obrat brzdou ${R.rev_brake_s.toFixed(2)} s | kruh plným rejdem: ${(100 * R.circle_v).toFixed(0)} % top, r=${R.circle_r_px.toFixed(0)} px | stažený puk ${(100 * R.tuck_ratio).toFixed(0)} % | prům. rychlost botů ${R.bot_mean_pct.toFixed(0)} % | naivní trasa ${R.naive_s.toFixed(2)} s | nejlepší globální vstup ${JSON.stringify(R.globP)}`);
  console.log(`  stabilita: trasy ${R.stab_courses} | seedy ${R.stab_seeds}`);
}
if (all.length > 1) {
  const keys = Object.keys(RUBRIC);
  console.log('\n=== SROVNÁNÍ ===\n' + 'metrika'.padEnd(16) + all.map(r => r.name.padStart(10)).join(''));
  for (const k of keys) console.log(k.padEnd(16) + all.map(r => fmt(r[k]).padStart(10)).join(''));
  console.log('OK/celkem'.padEnd(16) + all.map(r => { const s = scorecard(r); return `${s.ok}/${s.tot}`.padStart(10); }).join(''));
}
process.exit(0);
