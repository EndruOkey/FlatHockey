// KROKY UKOTVENÉ NOHY (2026-11-16, Ondřej: „bruslí po kouskách, zasekává se po pidi kouscích"): ukotvení (foot locking,
// skateFeetSmooth s x, y) dělalo 2× víc kroků než póza (165 px/s: 19–20 zvednutí na 9,6 cyklu) → krok rozsekaný.
// node scripts/anchor_steps_metrics.mjs [--set='{"stepD":0.5}']   (FH_VIS=w1 = /dev nohy)
// RUBRIKA (předem): S1 zvednutí ukotvené nohy ≤ zvednutí v póze + 1 (na nohu, 6 s jízdy) při 80, 165 a 220 px/s
//   S2 brusle neuteče od pózy: max vzdálenost ukotvené brusle od pózy ≤ 0,6 R
const M = await import('../public/js/entities/Player.js');
const { skateAdvance, skatePose, skateFeetSmooth, SKATE_K3 } = M;
const { PLAYER } = await import('../public/js/constants.js');
const SET = process.argv.find(a => a.startsWith('--set=')); if (SET) Object.assign(SKATE_K3, JSON.parse(SET.slice(6)));
const DT = 1 / 60, R = PLAYER.radius; let fail = 0;
for (const v of [80, 165, 220]) { const st = { _skatePhase: 0 }; let x = 0, drift = 0; const on = { '-1': 0, '1': 0 }, pOn = { '-1': 0, '1': 0 }, pv = {}, ppv = {};
  for (let t = 0; t < 480; t++) { x += v * DT; skateAdvance(st, x, 0, 0, v, 3, 0, DT);
    const p = skatePose({ k: 3, phase: st._skatePhase, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
    const raw = p.feet.map(f => ({ s: f.side, x: f.x, y: f.y, l: (f.lift || 0) > 0.05 }));
    skateFeetSmooth(st, p.feet, DT, 0, x, 0);
    p.feet.forEach((f, i) => { const s = f.side, l = (f.lift || 0) > 0.05, r = raw[i];
      if (t >= 120) { if (l && !pv[s]) on[s]++; if (r.l && !ppv[s]) pOn[s]++; drift = Math.max(drift, Math.hypot(f.x - r.x, f.y - r.y) / R); }
      pv[s] = l; ppv[s] = r.l; }); }
  const ok1 = on['-1'] <= pOn['-1'] + 1 && on['1'] <= pOn['1'] + 1, ok2 = drift <= 0.6; if (!ok1 || !ok2) fail++;
  console.log(`  ${v} px/s  S1 kroky L ${on['-1']}/${pOn['-1']} P ${on['1']}/${pOn['1']} (ukotvení/póza) ${ok1 ? 'OK' : 'NE'}  S2 únik od pózy ${drift.toFixed(2)} R ${ok2 ? 'OK' : 'NE'}`); }
console.log(fail ? `NEPROŠLO ${fail}/3` : 'VŠE OK');
