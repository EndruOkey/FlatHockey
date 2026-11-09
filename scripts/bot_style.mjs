// Styl hry botů (2v2, seedy 1..S, 5 min, server sim). Deterministické.
//  pasy/min, podíl pasů na změnách nosiče, křivost dráhy nosiče (délka dráhy / posun, držení ≥ 1 s),
//  šířka: % času nosiče v útočné třetině mimo střed (|y−střed| > 60 px), rozptyl Y vstupu do útočné třetiny.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4634'; process.env.DB_PATH = join(tmpdir(), `fh-style-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const S = +(process.argv[2] || 8), TEAM = +(process.env.FH_TEAM || 2), CY = RINK.goalY + RINK.goalH / 2;
const T = { min: 0, passes: 0, changes: 0, tort: [], wide: 0, zone: 0, entryY: [] };
for (let s = 1; s <= S; s++) {
  const l = { id: 'bs' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < TEAM; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < TEAM; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let prev = null, cur = null, path = null;   // prev = poslední NOSIČ (přes volný puk), cur = nosič teď
  const close = () => { if (path && path.n >= 60) { const d = Math.hypot(path.x - path.x0, path.y - path.y0); if (d > 40) T.tort.push(path.len / d); } path = null; };
  while (!m.ended) {
    stepMatch(m);
    if (m.setup || m.stoppage || m.world._goalLock) { close(); prev = cur = null; continue; }
    T.min += 1 / 3600;
    const C = [...m.players.values()].find(p => p.hasPuck);
    if (C !== cur) { close(); cur = C; if (C) { if (prev && prev !== C) { T.changes++; if (prev.team === C.team) T.passes++; } prev = C; path = { x0: C.x, y0: C.y, x: C.x, y: C.y, len: 0, n: 0, inZone: false }; } }
    if (C && path) {
      path.len += Math.hypot(C.x - path.x, C.y - path.y); path.x = C.x; path.y = C.y; path.n++;
      const dir = C.team === 'home' ? 1 : -1, att = dir > 0 ? C.x > RINK.w * 2 / 3 : C.x < RINK.w / 3;
      if (att) { T.zone++; if (Math.abs(C.y - CY) > 60) T.wide++; if (!path.inZone) { path.inZone = true; T.entryY.push(C.y - CY); } }
    }
  }
}
const f = x => x.toFixed(2), med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
const sd = a => { const mu = a.reduce((x, y) => x + y, 0) / (a.length || 1); return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length || 1)); };
console.log(`pasy/min ${f(T.passes / T.min)} | pasy z změn nosiče ${f(100 * T.passes / Math.max(1, T.changes))} % | křivost dráhy (medián) ${f(med(T.tort))} | v útoč. třetině mimo střed ${f(100 * T.wide / Math.max(1, T.zone))} % | rozptyl Y vstupu ${f(sd(T.entryY))} px (n=${T.entryY.length})`);
process.exit(0);
