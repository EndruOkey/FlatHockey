// Gólman pod tlakem podrží puk → píšťalka → buly na bodě v JEHO obranném pásmu na straně puku.
// Bez tlaku puk normálně rozehraje (žádná píšťalka). Deterministické (pevné pozice, krokování simulace).
// node test/goalie-freeze.test.mjs
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4630';
process.env.DB_PATH = join(tmpdir(), `fh-freeze-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };

function setup(id) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'H' }, 'home'));
  l.members.set('a0', makeMember({ name: 'A' }, 'away'));
  lobbies.set(id, l); startMatch(l);
  const m = l.match; clearInterval(m.loop);
  while (m.setup) stepMatch(m);                       // počkej na konec úvodního buly
  return m;
}
function scenario(id, pressure, puckTop) {
  const m = setup(id);
  const g = m.goalieL;                                // gólman domácích (brání vlevo)
  const pk = m.puck;
  pk.x = g.x; pk.y = g.y; pk.vx = pk.vy = 0;
  g._holdTimer = 0.05; g._heldPuck = pk; g._froze = false;
  const [h, a] = [...m.players.values()];
  h.x = RINK.centerX; h.y = RINK.h / 2;                // spoluhráč daleko
  a.x = pressure ? g.x + 30 : RINK.w - 60; a.y = puckTop ? g.y - 20 : g.y + 20;
  if (puckTop) { g.y -= 30; pk.y = g.y; } else { g.y += 30; pk.y = g.y; }
  const yAtFreeze = pk.y;
  let whistled = false;
  for (let i = 0; i < 60 * 3; i++) { stepMatch(m); if (m.stoppage && m._faceoff) whistled = true; if (m.setup && whistled) break; }
  return { m, whistled, yAtFreeze };
}

console.log('Gólman pod tlakem:');
{
  const { m, whistled, yAtFreeze } = scenario('fz1', true, true);
  ok(whistled, 'píšťalka po podržení puku');
  const expY = yAtFreeze < RINK.h / 2 ? 114 : RINK.h - 114;
  ok(Math.abs(m.puck.x - 248) < 1 && Math.abs(m.puck.y - expY) < 1, `buly v obranném pásmu domácích na straně puku (puk ${m.puck.x.toFixed(0)},${m.puck.y.toFixed(0)}; čekáno 248,${expY})`);
  ok(!m.goalieL._heldPuck && m.goalieL._holdTimer === 0, 'gólman po buly puk nedrží');
}
{
  const { m, whistled, yAtFreeze } = scenario('fz2', true, false);
  const expY = yAtFreeze < RINK.h / 2 ? 114 : RINK.h - 114;
  ok(whistled && Math.abs(m.puck.y - expY) < 1, `spodní strana: buly na y=${expY} (puk y=${m.puck.y.toFixed(0)})`);
}
console.log('Bez tlaku:');
{
  const { whistled } = scenario('fz3', false, true);
  ok(!whistled, 'gólman rozehraje, žádná píšťalka');
}
console.log(fails ? `NEPROŠLO: ${fails}` : 'OK');
process.exit(fails ? 1 : 0);
