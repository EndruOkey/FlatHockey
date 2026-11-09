// Ťuknutí vs podržení RMB: soupeř stojí v dráze přihrávky (hůl k nosiči). Kdo dostane puk?
// 3 vzdálenosti × 5 bočních posunů soupeře; ťuknutí (2 ticky RMB) vs podržení (0,25 s). Deterministické.
// node scripts/saucer_test.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4691';
process.env.DB_PATH = join(tmpdir(), `fh-saucer-${process.pid}.db`);
const { __test } = await import('../server.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const res = { tap: { mate: 0, opp: 0, none: 0 }, hold: { mate: 0, opp: 0, none: 0 } };
let n = 0;
for (const dist of [120, 170, 220]) for (const lat of [-8, -4, 0, 4, 8]) for (const mode of ['tap', 'hold']) {
  const l = { id: 'SC' + (n++), hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1, botFill: 0 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'A' }, 'home')); l.members.set('h1', makeMember({ name: 'B' }, 'home')); l.members.set('a0', makeMember({ name: 'O' }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (let i = 0; i < 600 && (m.setup || m.stoppage); i++) stepMatch(m);
  const ids = [...m.players.keys()], [c, r, o] = ids.map(id => m.players.get(id));
  const Y = 228, X0 = 380;
  Object.assign(c, { x: X0, y: Y, vx: 0, vy: 0 }); Object.assign(r, { x: X0 + dist, y: Y, vx: 0, vy: 0 });
  Object.assign(o, process.env.SC_FREE ? { x: 900, y: 80, vx: 0, vy: 0 } : { x: X0 + dist / 2, y: Y + lat, vx: 0, vy: 0 });   // SC_FREE=1 = volná dráha (kontrola)
  const inp = id => { const i = m.inputs.get(id); Object.assign(i, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aimDist: 60, _stamp: Date.now() }); return i; };
  const ic = inp(ids[0]), ir = inp(ids[1]), io = inp(ids[2]);
  ic.aim = 0; ir.aim = Math.PI; io.aim = Math.PI;   // soupeř míří holí proti nosiči = hůl v dráze
  for (const p of [c, r, o]) { p.aimAngle = p.carryAngle = p.bodyAngle = p.skateAngle = (p === c ? 0 : Math.PI); }
  m.puck.x = c.stickTip.x; m.puck.y = c.stickTip.y; m.puck.vx = m.puck.vy = 0; m.puck.z = 0; m.puck.vz = 0; m.puck.faceoffTimer = 0;   // po buly by puk chvíli nešel převzít
  c._grabPuck(); c._possT = 5;
  const holdT = mode === 'tap' ? 2 : 15;
  let who = 'none';
  for (let t = 0; t < 120; t++) {
    for (const i of [ic, ir, io]) i._stamp = Date.now();
    ic.rmb = t < holdT;
    stepMatch(m);
    if (t > holdT) { if (r.hasPuck) { who = 'mate'; break; } if (o.hasPuck) { who = 'opp'; break; } }
  }
  res[mode][who]++;
  lobbies.delete(l.id);
}
const tot = 15;
for (const k of ['tap', 'hold']) console.log(`${k === 'tap' ? 'ťuknutí (po ledě) ' : 'podržení (vzduchem)'}: spoluhráč ${res[k].mate}/${tot} | soupeř ${res[k].opp}/${tot} | nikdo ${res[k].none}/${tot}`);
process.exit(0);
