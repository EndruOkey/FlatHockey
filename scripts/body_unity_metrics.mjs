// TĚLO JAKO CELEK — deterministické měření (bez canvasu; stejné čisté funkce jako draw: skateAdvance, skatePose, skateFeetSmooth).
// node scripts/body_unity_metrics.mjs [--k=3,4]
// Ondřej 2026-11-13: „nohy jedou jinam než trup", „nohy kloužou, neodráží se", „nohy se při určitým pohybu zapomenou,
// tělo působí že vlaje a nepůsobí jako celek".
// RUBRIKA (stanovena PŘEDEM, 2026-11-13; 1× = 1,198 px na svět. jednotku; R = poloměr hráče):
//  N1 Celek: zkrut boky ↔ trup (ramena) ≤ 0,6 rad ve všech 24 směrech jízdy při 165 px/s (tělo čelem k myši).
//  N2 Odraz: v jízdě vpřed 165 px/s má každá noha za cyklus souvislé zaprutí: ≥ 4 snímky na ledě, kdy brusle jede
//     ve směru jízdy ≤ 40 % rychlosti těla (drží led), a během nich se vzdálí od středu těla ≥ 0,8 R.
//  N3 Nezapomene: švih myší o 180° (tělo se otočí jako ve hře) — a) v jízdě 120 px/s boční smyk brusle na ledě
//     (kolmo na ostří, ve světě) max ≤ 40 % rychlosti těla; b) ve stoje se brusle na ledě posune ≤ 0,5 j za snímek.
//  N4 Nevlaje: v jízdě vpřed 165 px/s se trup vůči bokům houpe ≤ 1,5 px (1×) špička–špička a jen v rytmu kroku (|r| ≥ 0,7).
const { PLAYER } = await import('../public/js/constants.js');
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { lerpAngle } = await import('../public/js/utils.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const KS = String(ARG.k ?? '3').split(',').map(Number);
const R = PLAYER.radius, SC = 1.198, DT = 1 / 60;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb || 1); };

// kinematika: step(t) → { vx, vy, ba }; vrací snímky { x, y, ba, spd, pose, feetW }
function run(k, step, T) {
  const st = { _skatePhase: 0 }; let x = 0, y = 0; const F = [];
  for (let t = 0; t < T; t++) {
    const s = step(t); x += s.vx * DT; y += s.vy * DT; const spd = Math.hypot(s.vx, s.vy);
    const mLoc = spd > 8 ? wrap(Math.atan2(s.vy, s.vx) - s.ba) : 0;
    skateAdvance(st, x, y, s.ba, spd, k, mLoc, DT);
    const pose = skatePose({ k, phase: st._skatePhase, spd, mLoc: k >= 3 ? st._mLocS : mLoc, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, bwV: st._bwV });
    if (k === 4) skateFeetSmooth(st, pose.feet, DT, s.ba, null, null, true); else if (k === 3) skateFeetSmooth(st, pose.feet, DT);
    const c = Math.cos(s.ba), sn = Math.sin(s.ba);
    const feetW = pose.feet.map(f => ({ side: f.side, lift: f.lift, x: x + f.x * c - f.y * sn, y: y + f.x * sn + f.y * c, a: f.a + s.ba }));
    F.push({ x, y, ba: s.ba, spd, vx: s.vx, vy: s.vy, pose, feetW, ph: st._skatePhase });
  }
  return F;
}
const res = {};
for (const k of KS) {
  const out = [];
  // N1
  let twMax = 0;
  for (let i = 0; i < 24; i++) { const m = -Math.PI + (i + 0.5) * Math.PI / 12;
    const F = run(k, () => ({ vx: Math.cos(m) * 165, vy: Math.sin(m) * 165, ba: 0 }), 180);
    for (const f of F.slice(120)) { const hip = f.pose.body.h ?? 0, tor = (f.pose.body.twT ?? 0) + (f.pose.body.tw ?? 0); twMax = Math.max(twMax, Math.abs(wrap(hip - tor))); } }
  out.push(['N1 zkrut boky↔trup ≤ 0,6 rad', twMax <= 0.6, `max ${twMax.toFixed(2)} rad`]);
  // N2
  { const F = run(k, () => ({ vx: 165, vy: 0, ba: 0 }), 300).slice(120); let okSides = 0; const det = [];
    for (const side of [-1, 1]) { let best = 0, bestOut = 0, run0 = 0, d0 = 0;
      for (let i = 1; i < F.length; i++) { const a = F[i].feetW.find(q => q.side === side), b = F[i - 1].feetW.find(q => q.side === side);
        const vAlong = (a.x - b.x) / DT, onIce = a.lift < 0.05 && b.lift < 0.05, dist = Math.hypot(a.x - F[i].x, a.y - F[i].y);
        if (onIce && vAlong <= 0.4 * 165) { if (run0 === 0) d0 = Math.hypot(b.x - F[i - 1].x, b.y - F[i - 1].y); run0++; const g = dist - d0; if (run0 > best || (run0 === best && g > bestOut)) { best = run0; bestOut = g; } }
        else run0 = 0; }
      det.push(`${side < 0 ? 'L' : 'P'} ${best} sn./+${(bestOut / R).toFixed(2)} R`); if (best >= 4 && bestOut >= 0.8 * R) okSides++; }
    out.push(['N2 zaprutí ≥4 sn. a ≥0,8 R', okSides === 2, det.join(' · ')]); }
  // N3a/b: švih o 180° (tělo jako ve hře: lerp 14/s) v jízdě a ve stoje
  for (const [lab, v] of [['a v jízdě 120', 120], ['b ve stoje', 0]]) {
    let ba = 0; const F = run(k, t => { if (t >= 90) ba = lerpAngle(ba, Math.PI - 0.001, Math.min(1, 14 * DT)); return { vx: v, vy: 0, ba }; }, 150).slice(88);
    let worst = 0;
    for (let i = 1; i < F.length; i++) for (const side of [-1, 1]) { const a = F[i].feetW.find(q => q.side === side), b = F[i - 1].feetW.find(q => q.side === side);
      if (a.lift > 0.05 || b.lift > 0.05) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      if (v > 0) { const perp = Math.abs(-Math.sin(a.a) * dx + Math.cos(a.a) * dy) / DT; worst = Math.max(worst, perp / v); }
      else worst = Math.max(worst, Math.hypot(dx, dy)); }
    out.push([v > 0 ? 'N3a smyk při švihu ≤ 40 % v' : 'N3b brusle ve stoje ≤ 0,5 j/sn.', v > 0 ? worst <= 0.4 : worst <= 0.5, v > 0 ? `max ${(worst * 100).toFixed(0)} %` : `max ${worst.toFixed(2)} j`]); }
  // N4
  { const F = run(k, () => ({ vx: 165, vy: 0, ba: 0 }), 300).slice(120);
    const lat = F.map(f => (f.pose.body.y ?? 0) * SC), lo = Math.min(...lat), hi = Math.max(...lat), ph = F.map(f => Math.sin(f.ph));
    const r = Math.max(Math.abs(corr(lat, ph)), Math.abs(corr(lat, F.map(f => Math.cos(f.ph)))));
    out.push(['N4 houpání trupu ≤1,5 px v rytmu', hi - lo <= 1.5 && r >= 0.7, `${(hi - lo).toFixed(2)} px, r = ${r.toFixed(2)}`]); }
  console.log(`== K${k} — ${out.filter(o => o[1]).length}/${out.length}`); for (const [n, ok, d] of out) console.log(`  ${ok ? 'OK  ' : 'NE  '} ${n.padEnd(34)} ${d}`);
  res[k] = out.every(o => o[1]);
}
process.exit(Object.values(res).every(Boolean) ? 0 : 1);
