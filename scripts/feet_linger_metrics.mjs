// NOHY ZŮSTÁVAJÍ ZA — přechodné situace (deterministicky, čisté funkce jako draw: skateAdvance → skatePose → skateFeetSmooth).
// node scripts/feet_linger_metrics.mjs   (FH_K3='{...}' přepis parametrů)
// Ondřej 2026-11-15: „nohy zůstávají občas až moc za a nevypadá to přirozeně". Hypotéza: fáze kroku jde podle ujeté dráhy → při
// dojíždění (zpomalování bez bruslení) se fáze skoro zastaví a odrazová noha zůstane natažená vzadu. Předloha: ve skluzu má hráč nohy pod sebou.
// RUBRIKA (předem, 2026-11-15) — v rámci TĚLA (+x = dopředu), R = poloměr hráče:
//  G1 kotník za tělem víc než 0,8 R souvisle nejvýš 0,25 s (odraz je krátký, noha se vrací pod tělo).
//  G2 nejzazší kotník ≥ −1,4 R.
// Situace (pohled po směru jízdy): dojíždění 165 → 0 třením 60 px/s² · dojíždění 165 → 0 třením 150 px/s² · rozjezd 0 → 165 ·
// jízda 165 a pak zpomalení na 60 · zatáčka R 90 · obrat 180° pohledu v jízdě 120.
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth, leanStep } = await import('../public/js/entities/Player.js');
const { lerpAngle } = await import('../public/js/utils.js');
const R = PLAYER.radius, DT = 1 / 60, ad = a => Math.atan2(Math.sin(a), Math.cos(a));
function run(T, fn) {
  const st = {}; let x = 0, y = 0, worst = 9, run0 = 0, longest = 0, wt = 0;
  for (let i = 0; i < Math.round(T / DT); i++) { const t = i * DT, s = fn(t); x += Math.cos(s.h) * s.v * DT; y += Math.sin(s.h) * s.v * DT;
    st._lean = leanStep(st, Math.cos(s.h) * s.v, Math.sin(s.h) * s.v, DT);
    const mLoc = s.v > 8 ? ad(s.h - s.ba) : 0; skateAdvance(st, x, y, s.ba, s.v, 3, mLoc, DT);
    const P = skatePose({ k: 3, phase: st._skatePhase ?? 0, spd: s.v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: st._lean, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS });
    skateFeetSmooth(st, P.feet, DT); if (i < 30) continue;
    let back = 9; for (const f of P.feet) back = Math.min(back, (f.x - Math.cos(f.a) * 0.32 * R - P.body.x) / R);
    if (back < worst) { worst = back; wt = t; } if (back < -0.8) { run0 += DT; longest = Math.max(longest, run0); } else run0 = 0; }
  return { worst, wt, longest };
}
const S = {
  'dojíždění tření 60': run(3.5, t => ({ h: 0, ba: 0, v: Math.max(0, 165 - Math.max(0, t - 0.8) * 60) })),
  'dojíždění tření 150': run(2.5, t => ({ h: 0, ba: 0, v: Math.max(0, 165 - Math.max(0, t - 0.8) * 150) })),
  'rozjezd 0→165': run(2.0, t => ({ h: 0, ba: 0, v: Math.min(165, Math.max(0, t - 0.5) * 330) })),
  'zpomalení 165→60': run(2.5, t => ({ h: 0, ba: 0, v: t < 1 ? 165 : Math.max(60, 165 - (t - 1) * 200) })),
  'zatáčka R90': run(3, t => ({ h: t * 150 / 90, ba: t * 150 / 90, v: 150 })),
  'obrat pohledu 180°': (() => { let ba = 0; return run(2.5, t => { if (t >= 1) ba = lerpAngle(ba, Math.PI - 0.001, Math.min(1, 14 * DT)); return { h: 0, ba, v: 120 }; }); })(),
};
let fail = 0;
for (const [n, r] of Object.entries(S)) { const ok = r.longest <= 0.25 && r.worst >= -1.4; if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}  ${n.padEnd(20)} G1 za > 0,8 R souvisle ${r.longest.toFixed(2)} s   G2 nejzazší ${r.worst.toFixed(2)} R (t ${r.wt.toFixed(2)})`); }
console.log(fail ? `NEPROŠLO ${fail}/${Object.keys(S).length}` : 'VŠE OK'); process.exit(fail ? 1 : 0);
