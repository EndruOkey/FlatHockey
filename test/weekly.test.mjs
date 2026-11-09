// Týdenní pravidlo: skóre = góly + bonusy, simulace beze změny (stejný seed s/bez pravidla). node test/weekly.test.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4636'; process.env.DB_PATH = join(tmpdir(), `fh-wk-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { WEEK_RULES } = await import('../public/js/weekly.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const run = (seed, rule) => {
  const l = { id: 'wk' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1, quick: !!rule }), members: new Map(), matchSeq: seed - 1 };
  for (const t of ['home', 'away']) for (let i = 0; i < 2; i++) l.members.set(t[0] + i, makeMember({ name: t + i }, t));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop); m.weekRule = rule;
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let bonus = 0; while (!m.ended) { stepMatch(m); for (const e of (m._fx || []).splice(0)) if (e.k === 'bonus') bonus++; }
  lobbies.delete(l.id); return { total: m.score.home + m.score.away, bonus };
};
let bad = 0;
for (const rule of WEEK_RULES) {
  let b = 0, g = 0;
  for (let s = 1; s <= 6; s++) { const base = run(s, null), r = run(s, rule); g += base.total; b += r.bonus;
    if (r.total !== base.total + r.bonus) { bad++; console.log('FAIL', rule, s, base, r); } }
  console.log(`${rule.padEnd(9)} góly ${g} | bonusů ${b}`);
}
console.log(bad ? `${bad} FAIL` : 'vše OK'); process.exit(bad ? 1 : 0);
