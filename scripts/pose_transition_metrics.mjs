// PŘECHODY TĚLA — deterministické měření (bez canvasu; tytéž čisté funkce jako draw: skateAdvance → skatePose → skateFeetSmooth).
// node scripts/pose_transition_metrics.mjs [--k=3] [--v]
// Ondřej 2026-11-14 (klipy z vlastní hry F9): „tělo se furt dostává do momentů, kdy jsou nohy nebo tělo v nepřirozené pozici".
// Klipy ukázaly: (a) jízda jinam, než se dívá → nohy trčí z boku/zezadu jako „ocas"; (b) zpomalení s otočkou → noha vyjede daleko.
// SITUACE (z klipů): S1 jízda dokola s pevným pohledem (směr jízdy vůči tělu projde 360° za 3 s, 130 px/s);
//  S2 švih myší o 180° v jízdě 130 px/s (tělo se otočí rychlostí hry 9 rad/s), dál jede stejným směrem;
//  S3 zpomalení 130 → 20 px/s za 1 s a současně otočka pohledu o 90°; S4 couvání 110 px/s (pohled proti jízdě) ustálené;
//  S5 jízda bokem 120 px/s ustálená.
// RUBRIKA (předem, 2026-11-14). Základ = ustálená jízda vpřed 130 px/s (tu Ondřej bere jako „není špatně"):
//  T1 kotník (pata brusle) od středu těla ≤ max(základ) × 1,15 v každém snímku každé situace.
//  T2 špička brusle od středu těla ≤ max(základ) × 1,15.
//  T3 skok brusle v lokálu těla mezi snímky ≤ 0,25 R (bez teleportů).
//  T4 (doplněno po 1. běhu, 2026-11-14: brusle špičkou dozadu za trupem) úhel ostří vůči trupu ≤ 115°
//     (odhad z anatomie: boky vůči ramenům ~70° + vytočení chodidla ~45°; 1. pokus „základ + 10°“ = 37° byl chybný — bokem je ~90° přirozené).
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth, SKATE_K3 } = await import('../public/js/entities/Player.js');
if (process.env.FH_K3) Object.assign(SKATE_K3, JSON.parse(process.env.FH_K3));   // hledání parametrů (jen Node)
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const K = +(A.k ?? 3), R = PLAYER.radius, DT = 1 / 60, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
// jeden běh: fn(t) → { mv (směr jízdy ve světě), spd, ba (pohled) }
function run(T, fn) {
  const st = {}; let x = 0, y = 0; const fr = []; let prev = null;
  for (let i = 0; i <= Math.round(T / DT); i++) {
    const t = i * DT, { mv, spd, ba } = fn(t); x += Math.cos(mv) * spd * DT; y += Math.sin(mv) * spd * DT;
    const mLoc = spd > 8 ? ad(mv - ba) : 0;
    skateAdvance(st, x, y, ba, spd, K, mLoc, DT);
    const P = skatePose({ k: K, phase: st._skatePhase ?? 0, spd, mLoc: K >= 3 ? st._mLocS : mLoc, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
    if (K === 4) skateFeetSmooth(st, P.feet, DT, ba, null, null, true); else if (K === 3) skateFeetSmooth(st, P.feet, DT);
    const feet = P.feet.map(f => ({ side: f.side, a: Math.abs(ad(f.a)), hx: f.x - Math.cos(f.a) * 0.32 * R, hy: f.y - Math.sin(f.a) * 0.32 * R, tx: f.x + Math.cos(f.a) * 0.55 * R, ty: f.y + Math.sin(f.a) * 0.55 * R, x: f.x, y: f.y }));
    const row = { t, mLoc, feet, jump: 0 };
    if (prev) for (const f of feet) { const q = prev.feet.find(g => g.side === f.side); row.jump = Math.max(row.jump, Math.hypot(f.x - q.x, f.y - q.y) / R); }
    fr.push(row); prev = row;
  }
  return fr.slice(30);   // první 0,5 s = rozjezd vyhlazení, neměří se
}
const ang = r => Math.max(...r.feet.map(f => f.a)) * 180 / Math.PI;
const heel = r => Math.max(...r.feet.map(f => Math.hypot(f.hx, f.hy) / R)), toe = r => Math.max(...r.feet.map(f => Math.hypot(f.tx, f.ty) / R));
const base = run(4, () => ({ mv: 0, spd: 130, ba: 0 }));
const LA = 115;
const bH = Math.max(...base.map(heel)), bT = Math.max(...base.map(toe)), LH = bH * 1.15, LT = bT * 1.15, LJ = 0.25;
console.log(`K${K} základ (vpřed 130): kotník max ${bH.toFixed(2)} R, špička max ${bT.toFixed(2)} R → limity T1 ${LH.toFixed(2)}, T2 ${LT.toFixed(2)}, T3 ${LJ}, T4 ${LA.toFixed(0)}°`);
const S = {
  'S1 dokola, pohled pevný': run(3.5, t => ({ mv: Math.max(0, t - 0.5) / 3 * 2 * Math.PI, spd: 130, ba: 0 })),
  'S2 švih myší 180°':        run(2.5, t => ({ mv: 0, spd: 130, ba: Math.min(Math.PI, Math.max(0, t - 1) * 9) })),
  'S3 zpomalení + otočka 90°': run(2.0, t => { const u = Math.min(1, Math.max(0, t - 0.8)); return { mv: 0, spd: 130 - 110 * u, ba: u * Math.PI / 2 }; }),
  'S4 couvání 110':           run(3, () => ({ mv: Math.PI, spd: 110, ba: 0 })),
  'S5 bokem 120':             run(3, () => ({ mv: Math.PI / 2, spd: 120, ba: 0 })),
};
let fail = 0;
for (const [n, fr] of Object.entries(S)) {
  const h = Math.max(...fr.map(heel)), to = Math.max(...fr.map(toe)), j = Math.max(...fr.map(r => r.jump));
  const an = Math.max(...fr.map(ang)), bad = fr.filter(r => heel(r) > LH || toe(r) > LT || r.jump > LJ || ang(r) > LA);
  const ok = bad.length === 0; if (!ok) fail++;
  console.log(`${n.padEnd(27)} kotník ${h.toFixed(2)}  špička ${to.toFixed(2)}  skok ${j.toFixed(2)}  úhel ${an.toFixed(0).padStart(3)}°  mimo ${String(bad.length).padStart(3)}/${fr.length}  ${ok ? 'OK' : 'NEPROŠLO'}`);
  if (A.v && bad.length) { const w = bad.reduce((a, b) => toe(b) > toe(a) ? b : a); console.log(`   nejhorší t=${w.t.toFixed(2)} s, směr jízdy vůči tělu ${(w.mLoc * 180 / Math.PI).toFixed(0)}°`); }
}
console.log(fail ? `NEPROŠLO ${fail}/${Object.keys(S).length}` : 'VŠE OK');
process.exit(fail ? 1 : 0);
