// VÁHA NOHOU — deterministické měření (bez canvasu; tytéž čisté funkce jako draw: skateAdvance → skatePose → skateFeetSmooth).
// node scripts/leg_weight_metrics.mjs [--k=3]   (FH_K3='{"plant":1}' = ukotvení k ledu)
// Ondřej 2026-11-14: „bruslení působí jako ragdoll — trup vede nohy, ne nohy trup; nohy nemají váhu".
// Rešerše: foot locking (opěrná noha drží místo ve světě, tělo se pohybuje nad ní; SideFX Houdini crowds footplanting),
// brusle klouže jen podél ostří; metrika „foot skating ratio" = podíl kontaktních snímků s rychlostí nad prahem
// (NVIDIA Kimodo benchmark: 0,2 m/s; UniMate: foot locking sníží ratio 0,107 → 0,023).
// Měřítko: R = 7 j ≈ ½ šířky ramen 0,25 m → 0,2 m/s ≈ 5,6 j/s.
// RUBRIKA (předem, 2026-11-14):
//  W1 skating ratio: podíl snímků brusle NA LEDĚ (lift < 0,05), kdy klouže do strany (kolmo na ostří, ve světě) > 5,6 j/s — ≤ 5 %
//     v každé situaci (jízda vpřed 165, dokola s pevným pohledem, švih myší 180° v jízdě 120, bokem 120, rozjezd 0 → 165).
//  W2 ve stoje při švihu myší 180°: brusle na ledě se posune ≤ 0,5 j za snímek (tělo se otočí nad nohama).
//  W3 noha nepřetažená: kotník ≤ 1,6 R od kyčle ve všech snímcích (ukotvení nesmí nohu utrhnout).
//  W4 (doplněno po 1. běhu automatu: bokem jen 47 snímků na ledě = noha „hrabe") kroky ≤ 3 za s na nohu v každé situaci
//     (C-cut 2,2–2,4 kroku/s, „Analysis of Selected Mechanics of the Backward C-Cut", ojs.ub.uni-konstanz.de/cpa/article/view/1699; +25 % rezerva = odhad).
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth, SKATE_K3 } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
const { lerpAngle } = await import('../public/js/utils.js');
const R = PLAYER.radius, DT = 1 / 60, VT = 5.6, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
function run(step, T) {
  const st = {}; let x = 0, y = 0; const F = [];
  for (let i = 0; i < Math.round(T / DT); i++) {
    const s = step(i * DT); x += s.vx * DT; y += s.vy * DT; const spd = Math.hypot(s.vx, s.vy), mLoc = spd > 8 ? ad(Math.atan2(s.vy, s.vx) - s.ba) : 0;
    skateAdvance(st, x, y, s.ba, spd, 3, mLoc, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS });
    if (SKATE_K3.plant) skateFeetSmooth(st, P.feet, DT, s.ba, x, y); else skateFeetSmooth(st, P.feet, DT);
    const c = Math.cos(s.ba), sn = Math.sin(s.ba);
    F.push({ t: i * DT, x, y, ba: s.ba, P, W: P.feet.map(f => ({ side: f.side, lift: f.lift, a: f.a + s.ba, x: x + f.x * c - f.y * sn, y: y + f.x * sn + f.y * c })) });
  }
  return F.slice(45);   // 0,75 s rozjezd vyhlazení se neměří
}
const flick = v => { let ba = 0; return t => { if (t >= 1.2) ba = lerpAngle(ba, Math.PI - 0.001, Math.min(1, 14 * DT)); return { vx: v, vy: 0, ba }; }; };
const S = {
  'vpřed 165': run(() => ({ vx: 165, vy: 0, ba: 0 }), 3),
  'dokola, pohled pevný': run(t => { const m = t / 3 * 2 * Math.PI; return { vx: Math.cos(m) * 130, vy: Math.sin(m) * 130, ba: 0 }; }, 3.5),
  'švih 180° v jízdě 120': run(flick(120), 2.2),
  'bokem 120': run(() => ({ vx: 0, vy: 120, ba: 0 }), 3),
  'rozjezd 0→165': run(t => ({ vx: Math.min(165, Math.max(0, t - 0.8) * 330), vy: 0, ba: 0 }), 2.2),
};
let fail = 0, w3 = 0, w4 = 0, w4n = '';
for (const [n, F] of Object.entries(S)) {
  let on = 0, bad = 0;
  for (let i = 1; i < F.length; i++) for (const side of [-1, 1]) {
    const a = F[i].W.find(q => q.side === side), b = F[i - 1].W.find(q => q.side === side);
    if (a.lift < 0.05 && b.lift < 0.05) { on++; const vx = (a.x - b.x) / DT, vy = (a.y - b.y) / DT, perp = Math.abs(-vx * Math.sin(a.a) + vy * Math.cos(a.a)); if (perp > VT) bad++; }
  }
  for (const f of F) for (const ft of f.P.feet) { const kx = ft.x - Math.cos(ft.a) * 0.32 * R, ky = ft.y - Math.sin(ft.a) * 0.32 * R, hp = skinHip(ft.side, f.P.body.hh ?? 0); { const d = Math.hypot(kx - f.P.body.x - hp.x, ky - f.P.body.y - hp.y) / R; if (d > w3) { w3 = d; globalThis.__w3 = `${n} t=${f.t.toFixed(2)} s${ft.side} lift ${ft.lift.toFixed(2)}`; } } }
  { let steps = 0; for (let i = 1; i < F.length; i++) for (const side of [-1, 1]) { const a = F[i].W.find(q => q.side === side), b = F[i - 1].W.find(q => q.side === side); if (a.lift >= 0.05 && b.lift < 0.05) steps++; }
    const rate = steps / 2 / (F.length * DT); if (rate > w4) { w4 = rate; w4n = n; } }
  const r = on ? bad / on : 0, ok = r <= 0.05; if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}   W1 ${n.padEnd(22)} skating ratio ${(r * 100).toFixed(1).padStart(5)} %  (na ledě ${on} sn.)`);
}
{ const F = run(flick(0), 2.2).filter(f => f.t >= 1.15); let worst = 0;
  for (let i = 1; i < F.length; i++) for (const side of [-1, 1]) { const a = F[i].W.find(q => q.side === side), b = F[i - 1].W.find(q => q.side === side); if (a.lift < 0.05 && b.lift < 0.05) worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y)); }
  const ok = worst <= 0.5; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}   W2 švih ve stoje: posun brusle na ledě max ${worst.toFixed(2)} j/sn. (≤ 0,5)`); }
{ const ok = w3 <= 1.6; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}   W3 kotník od kyčle max ${w3.toFixed(2)} R (≤ 1,6) — ${globalThis.__w3 ?? ""}`); }
{ const ok = w4 <= 3; if (!ok) fail++; console.log(`  ${ok ? 'OK' : 'NE'}   W4 kroky max ${w4.toFixed(2)} /s na nohu (${w4n}) (≤ 3)`); }
console.log(`plant ${SKATE_K3.plant}: ${fail ? 'NEPROŠLO ' + fail : 'VŠE OK'}`); process.exit(fail ? 1 : 0);
