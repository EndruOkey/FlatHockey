// JÍZDA BOKEM — deterministické měření (bez canvasu; tytéž čisté funkce jako draw: skateAdvance → skatePose → skateFeetSmooth).
// node scripts/side_skate_metrics.mjs
// Ondřej 2026-11-14: „jízda bokem furt jedna noha je hrozně vykloubená". Změřeno: hráč čelem vpřed, jede do boku → boky natočené
// o 40° k jízdě, krok „vpřed" v rámci boků → odrazová noha skončí 1,94 R PŘÍMO ZA TRUPEM (y ≈ 0), druhá stále vpředu.
// Předloha (hokejová technika): pohyb do strany čelem vpřed = boční krok (shuffle) — obě brusle pod tělem na své straně,
// ostří zhruba dopředu, odraz do strany; nohy se střídají.
// RUBRIKA (předem, 2026-11-14) — jízda kolmo k pohledu (směr ±90°) při 60, 120, 160 px/s, ustálená (po 1 s), 2 s:
//  J1 žádná noha za zády: kotník x ≥ −1,2 R (zadní okraj trupu ~1,1 R).
//  J2 každá noha na své straně: kotník y · strana ≥ +0,2 R (nekříží se pod tělem).
//  J3 noha z kyčle nevykloubená: kyčel → kotník ≤ 1,3 R.
//  J4 ostří vůči trupu ≤ 60° (zhruba dopředu, ne napříč/dozadu).
//  J5 nohy pracují: každá brusle za cyklus urazí do strany (rozkmit y) ≥ 0,3 R.
//  J6 (doplněno po kontrole snímků ze hry, 2026-11-14: nohy šly z kyčle šikmo dozadu jako žabí) noha kyčel → kotník
//     se odchýlí od čistého směru do strany ≤ 25° (brusle pod kyčlí, noha rovně do strany).
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth, SKATE_K3 } = await import('../public/js/entities/Player.js');
const { skinHip } = await import('../public/js/entities/skin.js');
if (process.env.FH_K3) Object.assign(SKATE_K3, JSON.parse(process.env.FH_K3));   // hledání parametrů (jen Node)
const R = PLAYER.radius, DT = 1 / 60, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
let fail = 0; const W = { J1: -9, J2: 9, J3: 0, J4: 0, J5: 9 };
for (const m of [Math.PI / 2, -Math.PI / 2]) for (const spd of [60, 120, 160]) {
  const st = {}; let x = 0, y = 0; const ys = { '-1': [], '1': [] }; let j1 = 9, j2 = 9, j3 = 0, j4 = 0, j6 = 0;
  for (let i = 0; i <= 180; i++) {
    x += Math.cos(m) * spd * DT; y += Math.sin(m) * spd * DT;
    skateAdvance(st, x, y, 0, spd, 3, m, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS });
    skateFeetSmooth(st, P.feet, DT);
    if (i < 60) continue;
    for (const f of P.feet) {
      const kx = f.x - Math.cos(f.a) * 0.32 * R, ky = f.y - Math.sin(f.a) * 0.32 * R, hp = skinHip(f.side, P.body.hh ?? 0);
      j1 = Math.min(j1, kx / R); j2 = Math.min(j2, ky * f.side / R); j3 = Math.max(j3, Math.hypot(kx - hp.x, ky - hp.y) / R); j4 = Math.max(j4, Math.abs(ad(f.a)) * 180 / Math.PI);
      j6 = Math.max(j6, Math.abs(Math.atan2(kx - hp.x, (ky - hp.y) * f.side)) * 180 / Math.PI);
      ys[f.side].push(ky / R);
    }
  }
  const j5 = Math.min(...Object.values(ys).map(a => Math.max(...a) - Math.min(...a)));
  const ok = j1 >= -1.2 && j2 >= 0.2 && j3 <= 1.3 && j4 <= 60 && j5 >= 0.3 && j6 <= 25; if (!ok) fail++;
  W.J1 = Math.max(W.J1, -j1); W.J2 = Math.min(W.J2, j2); W.J3 = Math.max(W.J3, j3); W.J4 = Math.max(W.J4, j4); W.J5 = Math.min(W.J5, j5);
  console.log(`${m > 0 ? 'doprava' : 'doleva '} ${String(spd).padStart(3)}  J1 kotník x ${j1.toFixed(2)}  J2 strana ${j2.toFixed(2)}  J3 noha ${j3.toFixed(2)}  J4 ostří ${j4.toFixed(0).padStart(3)}°  J5 rozkmit ${j5.toFixed(2)}  J6 ${j6.toFixed(0).padStart(2)}°  ${ok ? 'OK' : 'NEPROŠLO'}`);
}
console.log(`nejhorší: J1 ${(-W.J1).toFixed(2)} (≥ −1,2) · J2 ${W.J2.toFixed(2)} (≥ 0,2) · J3 ${W.J3.toFixed(2)} (≤ 1,3) · J4 ${W.J4.toFixed(0)}° (≤ 60) · J5 ${W.J5.toFixed(2)} (≥ 0,3)`);
console.log(fail ? `NEPROŠLO ${fail}/6` : 'VŠE OK');
process.exit(fail ? 1 : 0);
