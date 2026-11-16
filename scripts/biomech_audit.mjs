// AUDIT POHYBU TĚLA — nepřirozené polohy a pohyby pro hokejistu (2026-11-16, Ondřej: „projdi celý vizuál pohybu, dělej deterministické
// testy s odhalením nepřirozeného pohybu pro lidské tělo při hokeji"). Bez prohlížeče: skutečná simulace (match-core stepMatch, 60 Hz,
// pevný seed) + SKUTEČNÁ kresba Player.draw() do atrapy plátna; klouby se čtou z kresby (p._dbgPose = brusle, p._dbgBody = tělo pro skinBody).
// node scripts/biomech_audit.mjs [--detail]     FH_VIS=w1 = /dev nohy (jinak výchozí hráčů)
//
// RUBRIKA (stanovena PŘEDEM; jednotky R = PLAYER.radius ≈ ½ šířky ramen; lokál těla +x vpřed, +y vpravo):
//  A1 noha nepřetažená: kyčel → kotník ≤ 1,6 R (anatomicky délka nohy shora ~1,7 R při plném natažení)
//  A2 (ZRUŠENO po 1. běhu: shora je stojící noha svislá → kotník pod kyčlí je správně; počítá se, ale do výsledku nejde)
//  A3 koleno se ohýbá jen vpřed: posun kolena od středu stehno–lýtko vzad ≤ 0,05 R
//  A4 koleno nevybočené do boku (prověšené): ≤ 0,15 R
//  A5 vytočení chodidla vůči bokům: špička ven ≤ 70°, dovnitř ≤ 20° (mimo hokejový stop, tam ostří napříč — ≤ 110° ven;
//     couvání C-cut: dovnitř ≤ 45° — upřesněno po 1. běhu, pata ven = špička dovnitř je technika)
//  A6 nohy se nekříží: brusle nepřejde na druhou stranu osy boků o víc než 0,2 R (animace nemá crossover)
//  A7 zkrut trupu vůči bokům ≤ 1,2 rad (~70°)
//  A8 hlava vůči ramenům ≤ 1,3 rad
//  A9 plynulost: brusle i koleno se vůči tělu posunou ≤ 0,35 R za snímek (mimo prvních 20 snímků scénáře)
//  A10 v jízdě (> 30 j/s, mimo stop) vždy aspoň jedna brusle na ledě (lift ≤ 0,05)
//  A11 paže nepřetažená: rameno → rukavice ≤ 2,6 R (upřesněno po 1. běhu: 2,1 R bylo podhodnocené, paže rameno–zápěstí ≈ 2,4–3 R; odhad)
//  A12 kroky navíc: zvednutí brusle za s ≤ 1,15 × očekávané kadence (rychlost / délka cyklu) + 0,5 /s
//      (upřesněno 2026-11-17: kadence vč. výbušného rozjezdu accHz — schválené rychlé krátké kroky, skate_anim R11)
// Výstup: tabulka scénář × pravidlo (počet snímků mimo); „VŠE OK" jen když 0 všude. Dva běhy = stejný otisk (deterministické).
import { createHash } from 'crypto';
globalThis.Path2D = globalThis.Path2D || class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
globalThis.DOMMatrix = globalThis.DOMMatrix || class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new globalThis.DOMMatrix()) }); } };
globalThis.__fhSkateDbg = 1; globalThis.__fhBodyDbg = 1;
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player, skateCycle, SKATE_K3: SK3 } = await import('../public/js/entities/Player.js');
const { skinHip, skinKnee, skinRig } = await import('../public/js/entities/skin.js');
{ const M = await import('../public/js/entities/Player.js'); if (process.env.FH_K3) Object.assign(M.SKATE_K3, JSON.parse(process.env.FH_K3)); if (process.env.FH_HIPV) Object.assign(M.SKATE_HIPV, JSON.parse(process.env.FH_HIPV)); }   // ladění
const { RINK, PLAYER } = await import('../public/js/constants.js');
const DETAIL = process.argv.includes('--detail');
const R = PLAYER.radius;
const mk = () => { const f = function () {}; const P = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : (k in t ? t[k] : P), set: (t, k, v) => { t[k] = v; return true; }, apply: () => P }); return P; };
const ctx = mk(); const cam = { scale: 1.198, ox: 0, oy: 0, dt: DT };
const ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// scénáře: n = tik, vrací { dx, dy (WASD −1..1), aim (rad), space }
const SCN = {
  'rovně':            n => ({ dx: 1, dy: 0, aim: 0 }),
  'rozjezd z místa':  n => ({ dx: n < 30 ? 0 : 1, dy: 0, aim: 0 }),
  'kruh':             n => { const h = n * DT * 1.6; return { dx: Math.cos(h), dy: Math.sin(h), aim: h }; },
  'esíčko':           n => { const h = Math.sin(n * DT * 2.2); return { dx: Math.cos(h), dy: Math.sin(h), aim: h }; },
  'myš 40° vedle':    n => ({ dx: 1, dy: 0, aim: 0.7 }),
  'myš kmitá':        n => ({ dx: 1, dy: 0, aim: 0.8 * Math.sin(n * DT * 3) }),
  'švih myší 180°':   n => ({ dx: 1, dy: 0, aim: n < 90 ? 0 : Math.PI }),
  'couvání':          n => ({ dx: -1, dy: 0, aim: 0 }),
  'bokem':            n => ({ dx: 0, dy: 1, aim: 0 }),
  'brzda + opačně':   n => ({ dx: n < 80 ? 1 : n < 110 ? 0 : -1, dy: 0, aim: n < 110 ? 0 : Math.PI, space: n >= 80 && n < 110 }),
  'stop-go':          n => ({ dx: (n % 70) < 40 ? 1 : 0, dy: 0, aim: 0 }),
  'otočka na místě':  n => ({ dx: 0, dy: 0, aim: n * DT * 4 }),
  'ostrá zatáčka':    n => ({ dx: n < 60 ? 1 : 0, dy: n < 60 ? 0 : 1, aim: n < 60 ? 0 : Math.PI / 2 }),
};
const RULES = ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'];

function run(name, fn) {
  const m = createMatch(7); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const H = new Player('h', 'home', makeInput());
  m.players.set('h', H); m.inputs.set('h', H.input); rebuildEntities(m);
  m.goalieL.x = -999; m.goalieR.x = -999; m.puck.x = -999; m.puck.y = -999;
  H.x = RINK.centerX - 200; H.y = RINK.h / 2; H.aimAngle = H.carryAngle = H.bodyAngle = H.skateAngle = 0; H._isLocal = false;
  const bad = Object.fromEntries(RULES.map(r => [r, 0])), worst = {}; let prev = null, lifts = 0, liftExp = 0, pl = {}, hash = createHash('sha1');
  const note = (r, v, n) => { bad[r]++; if (worst[r] == null || v > worst[r].v) worst[r] = { v, n }; };
  for (let n = 0; n < 200; n++) {
    const c = fn(n); H.input.dx = c.dx; H.input.dy = c.dy; H.input.aim = c.aim; H.input.aimDist = 80; H.input.space = !!c.space;
    if (H.x > RINK.w - 60 || H.x < 60 || H.y < 50 || H.y > RINK.h - 50) { H.x = RINK.centerX; H.y = RINK.h / 2; prev = null; }   // daleko od mantinelu
    stepMatch(m); H.draw(ctx, cam);
    const P = H._dbgPose, B = H._dbgBody; if (!P || !B) continue;
    const hh = B.hh || 0, stop = (P.stopT ?? 0) > 0.05, spd = Math.hypot(H.vx, H.vy);
    const feet = P.feet, ank = B.feet;
    const cur = { feet: feet.map(f => ({ x: f.x, y: f.y })), knee: [] };
    for (let i = 0; i < ank.length; i++) {
      const a = ank[i], s = a.side, hp = skinHip(s, hh), d = Math.hypot(a.x - hp.x, a.y - hp.y) / R;
      if (d > 1.6) note('A1', d, n); if (d < 0.25) bad.A2x = (bad.A2x || 0) + 1;
      const k = skinKnee(hp.x, hp.y, a.x, a.y, s, hh, B.kv), mx = (hp.x + a.x) / 2, my = (hp.y + a.y) / 2, ch = Math.cos(hh), sh = Math.sin(hh);
      const fw = ((k.x - mx) * ch + (k.y - my) * sh) / R, lat = s * (-(k.x - mx) * sh + (k.y - my) * ch) / R;
      if (fw < -0.05) note('A3', -fw, n); if (lat > 0.15) note('A4', lat, n);
      cur.knee.push(k);
      const f = feet.find(q => q.side === s), toe = s * ad(f.a, hh) * 180 / Math.PI;   // + = špička ven
      const tin = 20 + 25 * Math.min(1, (H._bwS ?? 0) / 0.5); if (toe > (stop ? 110 : 70) + 0.5 || toe < -tin - 0.5) {   /* 0,5° = zaokrouhlení na hranici omezení */ if (process.env.FH_A5DBG === name) console.log(`  A5 ${name} tik ${n} strana ${s} špička ${toe.toFixed(0)}° stopT ${(P.stopT ?? 0).toFixed(2)} bw ${(H._bwS ?? 0).toFixed(2)} lb ${(H._lbS ?? 0).toFixed(2)} hh ${hh.toFixed(2)} mLoc ${(H._mLocS ?? 0).toFixed(2)} v ${spd.toFixed(0)} lift ${(f.lift||0).toFixed(2)}`); note('A5', Math.max(toe - (stop ? 110 : 70), -tin - toe), n); }
      const yl = -f.x * sh + f.y * ch; if (s * yl < -0.2 * R) note('A6', (-s * yl) / R - 0.2, n);
      const l = (f.lift || 0) > 0.05; if (l && !pl[s] && n >= 20) { lifts++; if (process.env.FH_A12DBG === name) console.log(`  krok ${name} tik ${n} strana ${s} v ${spd.toFixed(0)} stopT ${(P.stopT ?? 0).toFixed(2)} rot ${(H._rotSf ?? 0).toFixed(2)} fwB ${(H._fwB ?? 0).toFixed(2)} lb ${(H._lbS ?? 0).toFixed(2)}`); } pl[s] = l;
    }
    const tw = Math.abs(ad(B.tw || 0, hh)); if (tw > 1.2) note('A7', tw, n);
    if (Math.abs(B.hd || 0) > 1.3) note('A8', Math.abs(B.hd), n);
    if (prev && n >= 20) for (let i = 0; i < 2; i++) {
      const j = Math.hypot(cur.feet[i].x - prev.feet[i].x, cur.feet[i].y - prev.feet[i].y) / R; if (j > 0.35) note('A9', j, n);
      if (cur.knee[i] && prev.knee[i]) { const jk = Math.hypot(cur.knee[i].x - prev.knee[i].x, cur.knee[i].y - prev.knee[i].y) / R; if (jk > 0.35) note('A9', jk, n); } }
    if (spd > 30 && !stop && feet.every(f => (f.lift || 0) > 0.05)) { if (process.env.FH_A10DBG === name) console.log(`  A10 ${name} tik ${n} v ${spd.toFixed(0)} lift ${feet.map(f => (f.lift || 0).toFixed(2))} stopT ${(P.stopT ?? 0).toFixed(2)} bw ${(H._bwS ?? 0).toFixed(2)} lb ${(H._lbS ?? 0).toFixed(2)} rot ${(H._rotSf ?? 0).toFixed(2)} fwB ${(H._fwB ?? 0).toFixed(2)} mLoc ${(H._mLocS ?? 0).toFixed(2)}`); note('A10', 1, n); }
    const rig = skinRig(B); for (let i = 0; i < 2; i++) { const S = rig.S[i], Hh = rig.H[i], d = Math.hypot(Hh.x - S.x, Hh.y - S.y) / R; if (d > 2.6) note('A11', d, n); }
    if (n >= 20 && spd > 30) { const K = SK3, e = Math.max(0, Math.min(1, ((H._thr ?? 0) - K.accLo) / (K.accHi - K.accLo))), acc = K.accHz * e * e * (3 - 2 * e); liftExp += 2 * (spd / skateCycle(3, spd) + acc) * DT; }   // + výbušný rozjezd (accHz, R11)
    hash.update(feet.map(f => f.x.toFixed(3) + f.y.toFixed(3) + f.a.toFixed(3)).join() + (B.tw ?? 0).toFixed(3));
    prev = cur;
  }
  if (liftExp > 0.5 && lifts > liftExp * 1.15 + 0.5 * 180 * DT) note('A12', lifts / liftExp, -1);
  return { bad, worst, hash: hash.digest('hex').slice(0, 10), lifts, liftExp };
}

const out = {}; let total = 0, h1 = '', h2 = '';
for (const [name, fn] of Object.entries(SCN)) { out[name] = run(name, fn); h1 += out[name].hash; }
for (const [name, fn] of Object.entries(SCN)) h2 += run(name, fn).hash;
console.log('scénář'.padEnd(18) + RULES.map(r => r.padStart(5)).join(''));
for (const [name, r] of Object.entries(out)) {
  console.log(name.padEnd(18) + RULES.map(k => String(r.bad[k] || '·').padStart(5)).join(''));
  if (DETAIL) for (const k of RULES) if (r.worst[k]) console.log(`    ${k} nejhorší ${r.worst[k].v.toFixed(2)} @ tik ${r.worst[k].n}`);
  total += RULES.reduce((s, k) => s + r.bad[k], 0);
}
const sums = Object.fromEntries(RULES.map(k => [k, Object.values(out).reduce((s, r) => s + r.bad[k], 0)]));
console.log('celkem'.padEnd(18) + RULES.map(k => String(sums[k] || '·').padStart(5)).join(''));
console.log(`deterministické: ${h1 === h2 ? 'ano' : 'NE'}   ${total ? `NEPROŠLO (${total} snímků mimo)` : 'VŠE OK'}`);
// CI (--budget=N): hlídač regrese — selže, když snímků mimo pravidla je víc než N (dnešní stav), nebo běh není deterministický.
{ const B = process.argv.find(a => a.startsWith('--budget=')); if (B) { const N = +B.slice(9), ok = h1 === h2 && total <= N;
  console.log(`CI rozpočet ≤ ${N}: ${ok ? 'OK' : 'NEPROŠLO'} (${total})`); process.exit(ok ? 0 : 1); } }
