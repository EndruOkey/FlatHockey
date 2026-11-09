// Obrání puku: nosič stojí/jede s pukem, útočník (člověk) najíždí z 16 směrů a míří kurzorem na puk.
// Měří, kolikrát se obrání povede do 2 s a jak blízko se špička hole dostane k puku. Deterministické (seed 1).
// node scripts/steal_probe.mjs   (FH_STKSTICK=0 / FH_GRACE=… pro porovnání)
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK, PLAYER } = await import('../public/js/constants.js');
const N = 16, MOVE = process.env.MOVE === '1';
let ok = 0, okGrace = 0; const rows = [];
for (const fresh of [false, true]) for (let k = 0; k < N; k++) {
  const m = createMatch(1); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const H = new Player('h', 'home', makeInput()), A = new Player('a', 'away', makeInput());
  const iH = H.input, iA = A.input;
  m.players.set('h', H); m.players.set('a', A); m.inputs.set('h', iH); m.inputs.set('a', iA); rebuildEntities(m);
  m.goalieL.x = -999; m.goalieR.x = -999;
  H.x = RINK.centerX; H.y = RINK.h / 2; H.vx = H.vy = 0; H.aimAngle = H.carryAngle = H.bodyAngle = H.skateAngle = 0; iH.aim = 0; iH.aimDist = 40;
  H.hasPuck = true; H._possT = fresh ? 0 : 99; m.puck.ownerId = 'h';
  for (let i = 0; i < 10; i++) stepMatch(m);   // usaď puk na čepel
  const th = k / N * Math.PI * 2, P0 = { x: m.puck.x, y: m.puck.y };
  A.x = P0.x + Math.cos(th) * 70; A.y = P0.y + Math.sin(th) * 70; A.vx = A.vy = 0;
  let stolen = -1, minD = 1e9;
  for (let t = 0; t < 120; t++) {
    if (MOVE) { iH.dx = 1; }
    const dx = m.puck.x - A.x, dy = m.puck.y - A.y, d = Math.hypot(dx, dy);
    iA.dx = Math.abs(dx) > 6 ? Math.sign(dx) : 0; iA.dy = Math.abs(dy) > 6 ? Math.sign(dy) : 0;
    iA.aim = Math.atan2(dy, dx); iA.aimDist = d;
    stepMatch(m);
    const tip = A.stickTip; minD = Math.min(minD, Math.hypot(tip.x - m.puck.x, tip.y - m.puck.y));
    if (!H.hasPuck) { stolen = t; break; }
  }
  if (stolen >= 0) { if (fresh) okGrace++; else ok++; }
  if (!fresh) rows.push(`${String(Math.round(th * 180 / Math.PI)).padStart(4)}°  ${stolen >= 0 ? 'OBRÁN za ' + (stolen * DT).toFixed(2) + ' s' : 'NIC       '}  min. špička–puk ${minD.toFixed(1)} px`);
}
console.log('(0° = zepředu, kam míří čepel; 180° = zezadu)'); console.log(rows.join('\n'));
console.log(`\nObrání (nosič má puk dlouho): ${ok}/${N}   | čerstvý puk (ochrana ${PLAYER.stealGrace} s): ${okGrace}/${N}   | práh dosahu ${(PLAYER.pickupTipRadius * 0.92).toFixed(1)} px`);
