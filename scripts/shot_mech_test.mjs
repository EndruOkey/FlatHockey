// Střelecké mechaniky (deterministicky):
//  A) okno přesné rány: pustit LMB v okně (0,9 s) = rána; držet 1,4 s = puk ujede (žádná rána sama od sebe)
//  B) finta: nosič 150 px před brankou nabíjí 0,5 s, zruší RMB, ujede bokem 0,35 s a hned vystřelí
//     vs. stejný pohyb BEZ finty. Měří góly z 12 pozic.
// node scripts/shot_mech_test.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4693';
process.env.DB_PATH = join(tmpdir(), `fh-shotm-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let n = 0;
function setup(x, y) {
  const l = { id: 'SM' + (n++), hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1, botFill: 0 }), members: new Map(), matchSeq: n };
  l.members.set('h0', makeMember({ name: 'A' }, 'home')); lobbies.set(l.id, l); startMatch(l);
  const m = l.match; clearInterval(m.loop); for (let i = 0; i < 600 && (m.setup || m.stoppage); i++) stepMatch(m);
  const id = [...m.players.keys()][0], p = m.players.get(id), inp = m.inputs.get(id);
  Object.assign(p, { x, y, vx: 0, vy: 0 }); p.aimAngle = p.carryAngle = p.bodyAngle = p.skateAngle = 0;
  Object.assign(inp, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aimDist: 120, aim: 0 });
  m.puck.x = p.stickTip.x; m.puck.y = p.stickTip.y; m.puck.vx = m.puck.vy = m.puck.vz = m.puck.z = 0; m.puck.faceoffTimer = 0;
  p._grabPuck(); p._possT = 5;
  for (let i = 0; i < 30; i++) { inp._stamp = Date.now(); stepMatch(m); }   // gólman se usadí
  return { l, m, p, inp };
}
const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2;
// A
for (const [label, hold] of [['pustit v okně (0,90 s)', 54], ['držet moc dlouho (1,40 s)', 84]]) {
  const { l, m, p, inp } = setup(GX - 200, GY);
  let shot = false, lost = false, pv = 0;
  for (let t = 0; t < hold + 5; t++) {
    inp._stamp = Date.now(); inp.lmb = t < hold; inp.aim = Math.atan2(GY - p.y, GX - p.x);
    const had = p.hasPuck; stepMatch(m);
    if (had && !p.hasPuck) { pv = Math.hypot(m.puck.vx, m.puck.vy); if (pv > 200) shot = true; else lost = true; break; }
  }
  console.log(`A ${label}: ${shot ? 'RÁNA' : lost ? 'PUK UJEL' : 'nic'} (rychlost puku ${pv.toFixed(0)} px/s)`);
  lobbies.delete(l.id);
}
// B
const res = { fake: 0, plain: 0 }; let N = 0, fakes = 0;
for (const y0 of [GY - 50, GY - 30, GY - 10, GY + 10, GY + 30, GY + 50]) for (const side of [-1, 1]) {
  N++;
  for (const mode of ['fake', 'plain']) {
    const { l, m, p, inp } = setup(GX - 150, y0);
    const goals0 = m.score.home;
    for (let t = 0; t < 200; t++) {
      inp._stamp = Date.now();
      const aimG = Math.atan2(GY + side * (RINK.goalH / 2 - 3) - p.y, GX - p.x);   // na tyčku na straně ujetí
      inp.aim = aimG; inp.rmb = false; inp.dx = 0; inp.dy = 0;
      if (t < 30) inp.lmb = mode === 'fake';                 // nápřah 0,5 s (jen finta)
      else if (t === 30) { inp.lmb = false; inp.rmb = mode === 'fake'; }   // zrušení nápřahu = finta
      else if (t < 51) { inp.lmb = false; inp.dy = side; }  // ujetí bokem 0,35 s
      else if (t < 51 + Number(process.env.SM_HOLD || 20)) { inp.lmb = true; inp.dy = 0; }   // rána (nápřah SM_HOLD ticků, výchozí 0,33 s = rychlá rána po fintě)
      else inp.lmb = false;
      stepMatch(m);
      if (t === 32 && mode === 'fake' && (m.goalieR._fakeT > 0)) fakes++;
      if (m.score.home > goals0) { res[mode]++; break; }
    }
    lobbies.delete(l.id);
  }
}
console.log(`B finta → gól ${res.fake}/${N} | bez finty → gól ${res.plain}/${N} | gólman skočil na fintu ${fakes}/${N}`);
process.exit(0);
