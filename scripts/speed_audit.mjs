// RYCHLOST POSTAV — co cítí člověk (boti rychlost nevyužijí, proto size_balance rychlost skoro nevidí).
// node scripts/speed_audit.mjs   [FH_SIZES='[{"speed":1.04},{},{}]' pro návrh]
// Měří skutečnou simulací (match-core, Player._move): max rychlost, čas na 90 %, dráha za 1 a 2 s, přejezd 600 px ze stání,
// otočka o 180° v plné rychlosti. Nosič puku jede × 0,92 (Player.js `if (this.hasPuck) topSpeed *= 0.92`) — honička obránce × nosič.
// RUBRIKA (předem, 2026-11-18, Ondřej: „malý je až moc rychlý"):
//  R1 obránce bez puku dožene nosiče stejné velikosti (přibližování > 0 px/s)
//  R2 střední obránce dožene malého nosiče (≥ +3 px/s)
//  R3 velký obránce proti malému nosiči neztrácí víc než 10 px/s
//  R4 max rychlost malého ≤ 1,05 × střední
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK, SIZES } = await import('../public/js/constants.js');
function run(size, inputFn, ticks) {
  const m = createMatch(7); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const H = new Player('h', 'home', makeInput()); H.size = size; m.players.set('h', H); m.inputs.set('h', H.input); rebuildEntities(m);
  m.goalieL.x = -999; m.goalieR.x = -999; m.puck.x = -999; m.puck.y = -999;
  H.x = 120; H.y = RINK.h / 2; H.aimAngle = H.carryAngle = H.bodyAngle = H.skateAngle = 0; H._isLocal = false;
  const out = []; for (let n = 0; n < ticks; n++) { const c = inputFn(n, H); Object.assign(H.input, { aimDist: 80, ...c }); stepMatch(m); out.push({ x: H.x, y: H.y, v: Math.hypot(H.vx, H.vy), a: Math.atan2(H.vy, H.vx) }); }
  return out;
}
const N = ['malý', 'střední', 'velký'], R = {};
for (let s = 0; s < 3; s++) {
  const st = run(s, () => ({ dx: 1, dy: 0, aim: 0 }), 240);   // rovně 4 s ze stání (pozor: mantinel — 120 + dráha < RINK.w)
  const top = Math.max(...st.map(o => o.v)), t90 = st.findIndex(o => o.v >= 0.9 * top) * DT;
  const d1 = st[Math.round(1 / DT) - 1].x - 120, d2 = st[Math.round(2 / DT) - 1].x - 120, i600 = st.findIndex(o => o.x - 120 >= 600);
  // otočka: 2 s rozjezd, pak vstup opačně — čas do pohybu opačným směrem (vx < 0)
  const tr = run(s, n => ({ dx: n < 120 ? 1 : -1, dy: 0, aim: n < 120 ? 0 : Math.PI }), 300), i0 = tr.findIndex((o, i) => i >= 120 && Math.cos(o.a) < 0 && o.v > 20);
  R[s] = { top, t90, d1, d2, t600: i600 >= 0 ? i600 * DT : NaN, turn: i0 >= 0 ? (i0 - 120) * DT : NaN, carry: top * 0.92 };
}
console.log(`FH_SIZES=${process.env.FH_SIZES || '—'}  (speed: ${SIZES.map(z => z.speed).join(' / ')}, accel: ${SIZES.map(z => z.accel).join(' / ')})`);
console.log('postava    max px/s  s nosičem  90 % za   1 s px  2 s px  600 px za  otočka 180°');
for (let s = 0; s < 3; s++) { const r = R[s]; console.log(`${N[s].padEnd(9)} ${r.top.toFixed(1).padStart(8)} ${r.carry.toFixed(1).padStart(10)} ${r.t90.toFixed(2).padStart(7)} s ${r.d1.toFixed(0).padStart(7)} ${r.d2.toFixed(0).padStart(7)} ${r.t600.toFixed(2).padStart(8)} s ${r.turn.toFixed(2).padStart(9)} s`); }
console.log('\nhonička — přibližování obránce (bez puku) k nosiči v plné rychlosti, px/s (+ = dožene, − = uteče):');
console.log('nosič \\ obránce   ' + N.map(n => n.padStart(9)).join(''));
const clo = (d, c) => R[d].top - R[c].carry;
for (let c = 0; c < 3; c++) console.log(`${N[c].padEnd(16)} ${[0, 1, 2].map(d => ((clo(d, c) >= 0 ? '+' : '') + clo(d, c).toFixed(1)).padStart(9)).join('')}`);
const chk = [
  ['R1 stejná velikost dožene', [0, 1, 2].every(s => clo(s, s) > 0)],
  [`R2 střední dožene malého nosiče (${clo(1, 0).toFixed(1)} ≥ +3)`, clo(1, 0) >= 3],
  [`R3 velký vs malý nosič (${clo(2, 0).toFixed(1)} ≥ −10)`, clo(2, 0) >= -10],
  [`R4 malý / střední = ${(R[0].top / R[1].top).toFixed(3)} ≤ 1,05`, R[0].top / R[1].top <= 1.05]];
let f = 0; for (const [k, ok] of chk) { if (!ok) f++; console.log(`${ok ? 'OK  ' : 'NE  '}${k}`); }
console.log(f ? `NEPROŠLO ${f}` : 'VŠE OK');
