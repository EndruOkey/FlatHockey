// Měří "cukání" botů: jak často bot za zápas změní režim (honič / podpora / obrana-marking / nosič).
// Vysoké číslo = boti se přehazují v roli → vizuální chaos, "nedrží pozici". Deterministické.
// Spuštění: node scripts/role_churn.mjs   (30 seedů, 5 min, jako balance harness)
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4621';
process.env.DB_PATH = join(tmpdir(), `fh-churn-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../bot.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const HZ = 60;

function setup(id, seed) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }),
              members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < 3; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < 3; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);
  for (const [id2, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id2)); }
  return { l, m };
}
const live = m => !(m.setup || m.stoppage || m.world._goalLock);

// Reálný režim, který si bot sám orazítkuje v botThink (p._botMode) — měří rozhodnutí, ne geometrii.
const mode = (p) => p._botMode || '?';

let seeds = 30, totalSwitch = 0, totalMin = 0;
const trans = {};
for (let s = 1; s <= seeds; s++) {
  const { l, m } = setup('CH_' + s, s);
  const last = new Map();
  let switches = 0, liveT = 0;
  for (let t = 0; t < 5 * 60 * HZ; t++) {
    stepMatch(m);
    if (!live(m)) continue;
    liveT++;
    for (const p of m.players.values()) {
      const md = mode(p), lv = last.get(p.id);
      if (lv !== undefined && lv !== md) { switches++; trans[lv + '→' + md] = (trans[lv + '→' + md] || 0) + 1; }
      last.set(p.id, md);
    }
  }
  totalSwitch += switches; totalMin += liveT / HZ / 60;
  lobbies.delete(l.id);
}
console.log(`přepnutí režimu bota: ${(totalSwitch / totalMin).toFixed(1)} /min (napříč všemi 6 boty)`);
console.log(`= ${(totalSwitch / totalMin / 6).toFixed(1)} /min na jednoho bota`);
const top = Object.entries(trans).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('nejčastější přechody:', top.map(([k, v]) => `${k} ${(v / totalMin).toFixed(0)}`).join('  '));
process.exit(0);
