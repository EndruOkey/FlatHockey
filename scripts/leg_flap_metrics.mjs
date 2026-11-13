// VLÁNÍ NOHOU — deterministické měření (bez canvasu; stejné čisté funkce jako draw). node scripts/leg_flap_metrics.mjs [--k=3,4]
// Ondřej 2026-11-14: „pořád nohy hrozně vlajou". Změřeno: brusle se vůči tělu rozkmitaly o 13–17 px (1×), tělo je široké ~17 px.
// RUBRIKA (předem): F1 rozkmit každé brusle vůči tělu (lokál, špička–špička v ose x i y) ≤ 9 px (1×, ≈ ½ šířky těla)
// v jízdě 165 px/s vpřed, bokem, šikmo vpřed, šikmo vzad a pozpátku. (Čitelnost kroku hlídá skate_anim_metrics R1/R2 a skate_visibility.py.)
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const KS = String(ARG.k ?? '3,4').split(',').map(Number);
const SC = 1.198, DT = 1 / 60, LIM = 9;
let allOk = true;
for (const k of KS) {
  const rows = []; let worst = 0;
  for (const [lab, m] of [['vpřed', 0], ['bokem', Math.PI / 2], ['šikmo vpřed', Math.PI / 4], ['šikmo vzad', 3 * Math.PI / 4], ['pozpátku', Math.PI]]) {
    const st = { _skatePhase: 0 }; let x = 0, y = 0; const P = { '-1': [], '1': [] };
    for (let t = 0; t < 300; t++) { x += Math.cos(m) * 165 * DT; y += Math.sin(m) * 165 * DT;
      skateAdvance(st, x, y, 0, 165, k, m > Math.PI - 1e-9 ? -Math.PI : m, DT);
      const pose = skatePose({ k, phase: st._skatePhase, spd: 165, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, bwV: st._bwV });
      if (k === 4) skateFeetSmooth(st, pose.feet, DT, 0, null, null, true); else skateFeetSmooth(st, pose.feet, DT);
      if (t >= 120) for (const f of pose.feet) P[f.side].push([f.x * SC, f.y * SC]); }
    let w = 0; for (const s of ['-1', '1']) { const xs = P[s].map(p => p[0]), ys = P[s].map(p => p[1]); w = Math.max(w, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }
    worst = Math.max(worst, w); rows.push(`${lab} ${w.toFixed(1)}`);
  }
  const ok = worst <= LIM; allOk &&= ok;
  console.log(`${ok ? 'OK  ' : 'NE  '} K${k} F1 rozkmit ≤ ${LIM} px: max ${worst.toFixed(1)} px  (${rows.join(' · ')})`);
}
process.exit(allOk ? 0 : 1);
