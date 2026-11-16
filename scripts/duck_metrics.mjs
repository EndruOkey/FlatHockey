// „KAČER" — kolébání do stran při jízdě vpřed (2026-11-16, Ondřej: „nohy jsou na dobré pozici, lehce za, ale nebruslí jak naprcanej
// kačer do stran"). Deterministicky, čisté funkce kresby (jako leg_flap_metrics). node scripts/duck_metrics.mjs
// RUBRIKA (předem; biologie: kyčel je 0,58 R od středu, skinHip; hokejový odraz jde ven-vzad a noha se vrací pod kyčel):
//   K1 postoj: průměrná vzdálenost brusle do boku |y| ≤ 0,8 R (pod kyčlí, ne roznožka)
//   K2 odraz: největší vybočení |y| ≤ 1,35 R
//   (upřesněno po 1. běhu: K3 nemá v póze příznak odrazu → K1 jako průměr přes cyklus, ne „ve skluzu")
//   K3 špička ven vůči směru jízdy max ≤ 50°
//   K4 tělo do boku (body.y) rozkmit ≤ 0,15 R
//   Zachovat: střed bruslí vpřed/vzad (x) beze změny ± 0,1 R („lehce za" je dobře) — vypisuje se
const { skateAdvance, skatePose, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const { SKATE_K3 } = await import('../public/js/entities/Player.js');
const { VIS } = await import('../public/js/vis.js'); VIS.w = +(process.env.FH_W ?? 1);   // měří nové nohy (VIS.w 1); FH_W=0 dřívější
const SET = process.argv.find(a => a.startsWith('--set='));   // ladění: --set='{"y0":0.7}'
if (SET) Object.assign(SKATE_K3, JSON.parse(SET.slice(6)));
const R = PLAYER.radius, DT = 1 / 60;
for (const v of [100, 165, 220]) {
  const st = { _skatePhase: 0 }; let x = 0; const allY = [], ang = [], by = [], fx = [];
  for (let t = 0; t < 360; t++) { x += v * DT; skateAdvance(st, x, 0, 0, v, 3, 0, DT);
    const p = skatePose({ k: 3, phase: st._skatePhase, spd: v, mLoc: st._mLocS, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: st._thr ?? 0, bwS: st._bwS, lbS: st._lbS, bwV: st._bwV });
    skateFeetSmooth(st, p.feet, DT);
    if (t < 120) continue; by.push(p.body.y / R);
    for (const f of p.feet) { const y = Math.abs(f.y) / R, a = Math.abs(f.a) * 180 / Math.PI; fx.push(f.x / R); ang.push(a); allY.push(y); } }
  const mx = a => a.length ? Math.max(...a) : 0, mean = a => a.reduce((s, q) => s + q, 0) / a.length;
  const K1 = mean(allY), K2 = mx(allY), K3 = mx(ang), K4 = mx(by) - Math.min(...by);
  const ok = K1 <= 0.8 && K2 <= 1.35 && K3 <= 50 && K4 <= 0.15;
  console.log(`${ok ? 'OK' : 'NE'} ${v} px/s  K1 postoj |y| ${K1.toFixed(2)} R  K2 max |y| ${K2.toFixed(2)} R  K3 špička max ${K3.toFixed(0)}°  K4 tělo ${K4.toFixed(2)} R  | x střed ${mean(fx).toFixed(2)} R (min ${Math.min(...fx).toFixed(2)} max ${mx(fx).toFixed(2)})`);
}
