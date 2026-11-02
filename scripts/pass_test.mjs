// Přihrávka do jízdy: nahrávač (míří kurzorem na spoluhráče) → příjemce jede plnou rychlostí v 8 směrech,
// 3 vzdálenosti. Úspěch = příjemce puk PŘEVEZME do 2 s. Soupeři stojí v rohu. Deterministické.
// node scripts/pass_test.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4676';
process.env.DB_PATH = join(tmpdir(), `fh-pass-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let ok = 0, n = 0, defl = 0; const miss = {};
const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
for (const dist of [100, 180, 260]) for (let di = 0; di < DIRS.length; di++) {
  const id = `P${dist}_${di}`;
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'A' }, 'home')); l.members.set('h1', makeMember({ name: 'B' }, 'home'));
  lobbies.set(id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  while (m.setup) stepMatch(m);
  const a = m.players.get('h0'), b = m.players.get('h1');
  for (const p of m.players.values()) if (p.team === 'away') { p.isBot = false; p.x = 40; p.y = 40; p.vx = p.vy = 0; }
  const cx = RINK.centerX, cy = RINK.h / 2;
  a.x = cx - dist / 2; a.y = cy; a.vx = a.vy = 0; a.hasPuck = true; a._possT = 99; m.puck.x = a.x + 12; m.puck.y = a.y; m.puck.faceoffTimer = 0;
  const [dx, dy] = DIRS[di]; const dl = Math.hypot(dx, dy);
  b.x = cx + dist / 2; b.y = cy; b.vx = dx / dl * 180; b.vy = dy / dl * 180; b.hasPuck = false;
  const ia = m.inputs.get('h0'), ib = m.inputs.get('h1');
  let passed = false, got = false, deflected = false;
  for (let t = 0; t < 150; t++) {
    ib.dx = dx; ib.dy = dy; ib.aim = Math.atan2(a.y - b.y, a.x - b.x); ib.aimDist = 40; ib._stamp = 0;
    ia.dx = ia.dy = 0; ia.aim = Math.atan2(b.y - a.y, b.x - a.x); ia.aimDist = 40; ia._stamp = 0;
    ia.rmb = (t === 10);                      // jeden klik pravým = přihrávka
    const vBefore = Math.hypot(m.puck.vx, m.puck.vy);
    stepMatch(m);
    if (t === 10) passed = !a.hasPuck;
    if (passed && !b.hasPuck && vBefore > 150 && Math.abs(Math.atan2(m.puck.vy, m.puck.vx) - Math.atan2(m.puck.vy, m.puck.vx)) === 0 && b._deflectCool > 0.25) deflected = true;
    if (b.hasPuck) { got = true; break; }
  }
  n++; if (got) ok++; else { miss[dist] = (miss[dist] || 0) + 1; if (deflected) defl++; }
  lobbies.delete(id);
}
console.log(JSON.stringify({ prevzato_pct: Math.round(100 * ok / n), z: n, netrefene_podle_vzdalenosti: miss, odrazeno_od_hole: defl }));
process.exit(0);
