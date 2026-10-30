// Test determinismu simulace: stejný seed + stejné vstupy => stejný výsledek (hash stavu každých 600 ticků).
// Spuštění: npm run test:determinism  (exit 1 = selhání). Krokuje skutečný server.js stepMatch bez sítě.
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4150';
process.env.DB_PATH = join(tmpdir(), `fh-determinism-${process.pid}.db`);
const { __test } = await import('../server.js');
const { botThink, makeBotBrain, hashSeed } = await import('../bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

const TICKS = 3600, EVERY = 600;
const results = [];
const check = (ok, name) => { results.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + name); };
const q = v => Math.round(v * 1e6);

function hashState(m) {
  const parts = [m.tick, m.score.home, m.score.away, q(m.clock), m.period, m.setup ? 1 : 0, m.stoppage ? 1 : 0,
                 m.icing ? 1 : 0, m.offside ? 1 : 0, m.world.rng.state];
  const pk = m.puck; parts.push(q(pk.x), q(pk.y), q(pk.z), q(pk.vx), q(pk.vy));
  for (const g of [m.goalieL, m.goalieR]) parts.push(q(g.x), q(g.y), q(g._form), q(g._saveFlash));
  for (const [id, p] of m.players) parts.push(id, q(p.x), q(p.y), q(p.vx), q(p.vy), q(p.aimAngle), q(p.charge), p.hasPuck ? 1 : 0);
  return hashSeed(parts.join('|'));
}

function run(lobbyId, matchSeq) {
  const l = { id: lobbyId, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 3 }),
              members: new Map(), matchSeq: matchSeq - 1 };
  for (let i = 0; i < 2; i++) {
    l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
    l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  }
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);          // krokujeme ručně, ne wall-clockem
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }   // boti generují vstupy za oba týmy
  const hashes = [];
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random volán v simulaci'); };
  try {
    for (let t = 1; t <= TICKS; t++) { stepMatch(m); if (t % EVERY === 0) hashes.push(hashState(m)); }
  } finally { Math.random = real; }
  lobbies.delete(l.id);
  return { seed: m.seed, hashes, score: { ...m.score }, ticks: m.tick };
}

let a, b, c, noRandom = true;
try { a = run('DET01', 1); b = run('DET01', 1); c = run('DET01', 2); }
catch (e) { noRandom = false; console.error(e); }
check(noRandom, 'žádný Math.random během 3 × 3600 ticků');
if (noRandom) {
  console.log('seed A', a.seed, 'seed C', c.seed, 'skóre A', JSON.stringify(a.score), 'C', JSON.stringify(c.score));
  console.log('A', a.hashes.join(' ')); console.log('B', b.hashes.join(' ')); console.log('C', c.hashes.join(' '));
  check(a.hashes.length === TICKS / EVERY && a.ticks === TICKS, `${a.hashes.length} kontrolních hashů, ${a.ticks} ticků`);
  check(a.hashes.every((h, i) => h === b.hashes[i]), 'stejný seed + stejné vstupy => identické hashe');
  check(a.seed !== c.seed && a.hashes.some((h, i) => h !== c.hashes[i]), 'jiný seed => jiný průběh');
  check(a.score.home + a.score.away > 0 || c.score.home + c.score.away > 0, 'za běhu padl alespoň jeden gól (pokryt gól + buly)');
}
const fails = results.filter(x => !x).length;
console.log(fails ? `\n${fails} selhání` : '\nVše OK');
process.exit(fails ? 1 : 0);
