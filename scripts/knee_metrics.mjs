// KOLENA (2026-11-16, Ondřej: „buď kalhoty, nebo kolena jsou prověšená"). Deterministicky, stejné funkce jako kresba
// (skatePose → kotník jako v Player feetW → skinHip / skinKnee). node scripts/knee_metrics.mjs   (FH_VIS=w1 = /dev)
// RUBRIKA (předem): jízda vpřed 100 / 165 / 220 px/s, bokem 120, pozpátku 110:
//   KN1 koleno do boku VEN od středu kyčel–kotník (v rámci boků) ≤ 0,05 R (ne prověšené / vybočené)
//   (upřesněno po 1. běhu: dřív kolmo na stehno → posun vpřed u nohy vzad se počítal jako „ven“)
//   KN2 koleno nikdy ZA přímkou (vzad vůči bokům) — min ≥ −0,02 R
//   KN3 koleno vpřed od přímky ≤ 0,6 R (ne trčící koleno)
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { skinHip, skinKnee } = await import('../public/js/entities/skin.js');
const { VIS } = await import('../public/js/vis.js');
const R = 7, DT = 1 / 60; let fail = 0;
for (const [lab, v, m] of [['vpřed 100', 100, 0], ['vpřed 165', 165, 0], ['vpřed 220', 220, 0], ['bokem 120', 120, Math.PI / 2], ['pozpátku 110', 110, -Math.PI]]) {
  const st = { _skatePhase: 0 }; let x = 0, y = 0, out = -9, back = 9, fwd = -9;
  for (let t = 0; t < 300; t++) { x += Math.cos(m) * v * DT; y += Math.sin(m) * v * DT; skateAdvance(st, x, y, 0, v, 3, m, DT);
    const p = skatePose({ k: 3, phase: st._skatePhase, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
    skateFeetSmooth(st, p.feet, DT); if (t < 120) continue;
    const hh = p.body.hh ?? p.body.h ?? 0;
    for (const f of p.feet) { const ax = f.x - Math.cos(f.a) * 0.32 * R, ay = f.y - Math.sin(f.a) * 0.32 * R, hp = skinHip(f.side, hh), k = skinKnee(hp.x, hp.y, ax, ay, f.side, hh, VIS.w);
      const mx = (hp.x + ax) / 2, my = (hp.y + ay) / 2, c = Math.cos(hh), s = Math.sin(hh);   // posun kolena od středu stehna+lýtka v rámci boků
      const fw = ((k.x - mx) * c + (k.y - my) * s) / R, lat = f.side * (-(k.x - mx) * s + (k.y - my) * c) / R;   // fw + = vpřed, lat + = ven do boku
      out = Math.max(out, lat); back = Math.min(back, fw); fwd = Math.max(fwd, fw); } }
  const ok = out <= 0.05 && back >= -0.02 && fwd <= 0.6; if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}  ${lab.padEnd(13)} KN1 ven ${out.toFixed(2)} R  KN2 vzad min ${back.toFixed(2)} R  KN3 vpřed max ${fwd.toFixed(2)} R`); }
console.log(fail ? `NEPROŠLO ${fail}/5` : 'VŠE OK');
