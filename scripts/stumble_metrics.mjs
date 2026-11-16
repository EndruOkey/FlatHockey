// ŠKOBRTÁNÍ v běžné hře (2026-11-16, Ondřej: „furt dost škobrtá a nohy se sekají, působí to jako chyba"). Deterministicky,
// stejné funkce jako kresba vč. ukotvení. Trasy jako ve hře: zatáčky, esíčko, myš jinam než jízda, stop-go, rozjezd.
// node scripts/stumble_metrics.mjs   (FH_VIS=w1 = /dev)   RUBRIKA (předem):
//   U1 kroky navíc: zvednutí ukotvené nohy / zvednutí v póze ≤ 1,15 na každé trase (škobrtnutí = krok navíc)
//   U2 přepnutí ukotveno ↔ po póze ≤ 2 za 3 s trasy
//   U3 skok brusle vůči tělu ≤ 0,35 R za snímek
const { skateAdvance, skatePose, skateFeetSmooth, skateStopDrive } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const R = PLAYER.radius, DT = 1 / 60;
const { SKATE_K3 } = await import('../public/js/entities/Player.js'); const SET = process.argv.find(a => a.startsWith('--set=')); if (SET) Object.assign(SKATE_K3, JSON.parse(SET.slice(6)));
const ROUTES = {   // t → { h: směr jízdy, v: rychlost, aim: pohled (rad) }
  'rovně 165': t => ({ h: 0, v: 165, aim: 0 }),
  'kruh': t => ({ h: t * 1.6, v: 150, aim: t * 1.6 }),
  'esíčko': t => ({ h: Math.sin(t * 2.2), v: 150, aim: Math.sin(t * 2.2) }),
  'myš 40° vedle': t => ({ h: 0, v: 160, aim: 0.7 }),
  'myš kmitá': t => ({ h: 0, v: 160, aim: 0.8 * Math.sin(t * 3) }),
  'rozjezd + zpomalení': t => ({ h: 0, v: 165 * Math.min(1, t / 0.8) * (t > 2 ? Math.max(0.3, 1 - (t - 2)) : 1), aim: 0 }),
  'zatáčka 90°': t => ({ h: t < 1 ? 0 : -Math.PI / 2, v: 150, aim: t < 1 ? 0 : -Math.PI / 2 }),
};
let fail = 0;
for (const [name, fn] of Object.entries(ROUTES)) {
  const st = { _skatePhase: 0 }; let x = 0, y = 0, h = 0, ba = 0, v = 0, an = 0, ap = 0, tog = 0, jump = 0, pf = null, prevL = {}, prevP = {}, prevFw = false;
  for (let i = 0; i < 240; i++) { const t = i * DT, r = fn(t);
    h += Math.atan2(Math.sin(r.h - h), Math.cos(r.h - h)) * Math.min(1, 8 * DT); v += (r.v - v) * Math.min(1, 4 * DT);
    ba += Math.atan2(Math.sin(r.aim - ba), Math.cos(r.aim - ba)) * Math.min(1, 9 * DT);
    x += Math.cos(h) * v * DT; y += Math.sin(h) * v * DT;
    const mLoc = v > 8 ? Math.atan2(Math.sin(h - ba), Math.cos(h - ba)) : 0;
    skateAdvance(st, x, y, ba, v, 3, mLoc, DT);
    const p = skatePose({ k: 3, phase: st._skatePhase, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: st._rotSf ?? 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
    const pl = p.feet.map(f => (f.lift || 0) > 0.05);
    skateFeetSmooth(st, p.feet, DT, ba, x, y);
    const fw = (st._fwB ?? 0) > 0;
    if (i >= 30) { if (fw !== prevFw) tog++;
      p.feet.forEach((f, j) => { const s = f.side, l = (f.lift || 0) > 0.05; if (l && !prevL[s]) an++; if (pl[j] && !prevP[s]) ap++; });
      if (pf) p.feet.forEach((f, j) => { jump = Math.max(jump, Math.hypot(f.x - pf[j].x, f.y - pf[j].y) / R); }); }
    p.feet.forEach((f, j) => { prevL[f.side] = (f.lift || 0) > 0.05; prevP[f.side] = pl[j]; }); prevFw = fw; pf = p.feet.map(f => ({ x: f.x, y: f.y })); }
  const U1 = ap ? an / ap : (an ? 9 : 1), ok = U1 <= 1.15 && tog <= 2 && jump <= 0.35; if (!ok) fail++;
  console.log(`  ${ok ? 'OK' : 'NE'}  ${name.padEnd(20)} U1 kroky ${an}/${ap} = ${U1.toFixed(2)}  U2 přepnutí ${tog}  U3 skok ${jump.toFixed(2)} R`);
}
console.log(fail ? `NEPROŠLO ${fail}/${Object.keys(ROUTES).length}` : 'VŠE OK');
