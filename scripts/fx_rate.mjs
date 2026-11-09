// Četnost hlášek (match-core _detectFx) v zápasech botů 2v2, seedy 1..S × 5 min. node scripts/fx_rate.mjs [S=8]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4635'; process.env.DB_PATH = join(tmpdir(), `fh-fx-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const S = +(process.argv[2] || 8); const C = {}; let min = 0, goals = 0; const maxCombo = [];
for (let s = 1; s <= S; s++) {
  const l = { id: 'fx' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (const t of ['home', 'away']) for (let i = 0; i < 2; i++) l.members.set(t[0] + i, makeMember({ name: t + i }, t));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  while (!m.ended) { stepMatch(m); min += 1 / 3600; for (const e of (m._fx || []).splice(0)) { C[e.k] = (C[e.k] || 0) + 1; if (e.n) maxCombo.push(e.n); } }
  goals += m.score.home + m.score.away;
}
console.log(`${S} zápasů, ${min.toFixed(1)} min, gólů ${goals} |`, Object.entries(C).map(([k, v]) => `${k} ${v} (${(v / min).toFixed(2)}/min)`).join(' · '), `| max kombo ${Math.max(0, ...maxCombo)}`);
process.exit(0);
