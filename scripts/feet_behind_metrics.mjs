// NOHY POZADU — kde leží brusle vůči tělu (deterministicky, čisté funkce jako draw). node scripts/feet_behind_metrics.mjs [--k=3]
// Ondřej 2026-11-15: „nohy jsou pořád pozadu, některé typy bruslení nepůsobí dobře".
// Předloha (Wu, Pearsall a kol. 2015, Kinematic Comparisons Between Forward and Backward Skating): volná noha dopadá POD tělo,
// dozadu jde jen odrazová noha; trup je v předklonu (shora = kyčle/kolena pod hrudí, ne za ní).
// RUBRIKA (předem, 2026-11-15) — v souřadnicích SMĚRU JÍZDY (+ = vpřed), R = poloměr hráče, 1× = 1,198 px/j:
//  F1 dopad volné nohy (konec letu, první snímek na ledě) leží ve směru jízdy ≥ −0,15 R (pod tělem nebo před ním).
//  F2 průměrná poloha kotníků za cyklus ≥ −0,45 R (těžiště nohou pod pánví, ne za zadkem).
//  F3 nejzazší kotník ≥ −1,6 R (odraz nekončí metr za hráčem).
// REVIZE po 1. běhu: F1 a F3 se u jízdy BOKEM neměří — „dopad ve směru jízdy" je tam boční rozkročení (zadní noha je na zadní straně z principu).
// Měří se pro jízdu vpřed, šikmo vpřed, bokem, šikmo vzad, vzad (pohled pevně vpřed), 120 a 165 px/s.
import { PLAYER } from '../public/js/constants.js';
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const K = +(A.k ?? 3), R = PLAYER.radius, DT = 1 / 60;
let fail = 0;
for (const [lab, m] of [['vpřed', 0], ['šikmo vpřed', Math.PI / 4], ['bokem', Math.PI / 2], ['šikmo vzad', 3 * Math.PI / 4], ['vzad', Math.PI]]) for (const v of [120, 165]) {
  const st = {}; let x = 0, y = 0; const xs = [], lands = []; const prevLift = {};
  for (let i = 0; i < 300; i++) { x += Math.cos(m) * v * DT; y += Math.sin(m) * v * DT; skateAdvance(st, x, y, 0, v, K, m, DT);
    const P = skatePose({ k: K, phase: st._skatePhase ?? 0, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: 0, bwS: st._bwS, lbS: st._lbS });
    skateFeetSmooth(st, P.feet, DT); if (i < 120) { for (const f of P.feet) prevLift[f.side] = f.lift; continue; }
    for (const f of P.feet) { const ax = f.x - Math.cos(f.a) * 0.32 * R - P.body.x, ay = f.y - Math.sin(f.a) * 0.32 * R - P.body.y, along = (ax * Math.cos(m) + ay * Math.sin(m)) / R;
      xs.push(along); if ((prevLift[f.side] ?? 0) >= 0.05 && f.lift < 0.05) lands.push(along); prevLift[f.side] = f.lift; } }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length, mn = Math.min(...xs), land = lands.length ? Math.min(...lands) : NaN;
  const ok = (isNaN(land) || lab === "bokem" || land >= -0.15) && mean >= -0.45 && (lab === "bokem" || mn >= -1.6); if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}  ${lab.padEnd(12)} ${v}  F1 dopad ${isNaN(land) ? '  —  ' : land.toFixed(2).padStart(5)} R  F2 průměr ${mean.toFixed(2).padStart(5)} R  F3 nejzazší ${mn.toFixed(2)} R`);
}
console.log(fail ? `K${K}: NEPROŠLO ${fail}/10` : `K${K}: VŠE OK`); process.exit(fail ? 1 : 0);
