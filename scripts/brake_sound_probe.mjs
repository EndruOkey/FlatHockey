// Kolikrát za minutu by zazněl zvuk brzdy (Player.draw → SFX.iceStop) v zápase botů 2v2 — staré vs. nové pravidlo. Deterministicky.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4696'; process.env.DB_PATH = join(tmpdir(), `fh-bs-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const DT = 1 / 60, SEEDS = 6; let oldN = 0, newN = 0, live = 0;
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'BS' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const st = new Map(); let gCd = 0;
  for (let t = 0; t < 5 * 3600; t++) {
    stepMatch(m); live++; gCd -= DT;
    for (const [id, p] of m.players) {
      const s2 = Math.hypot(p.vx, p.vy), o = st.get(id) || { s: s2, cdO: 0, cdN: 0 }; o.cdO -= DT; o.cdN -= DT;
      const dec = (o.s - s2) / DT;
      if (dec > 450 && s2 > 35 && o.cdO <= 0) { oldN++; o.cdO = 1.0; }
      if (dec > 1500 && o.s > 160 && o.cdN <= 0 && gCd <= 0) { newN++; o.cdN = 1.0; gCd = 1.2; }   // = Player.draw BRAKE_OTHER
      o.s = s2; st.set(id, o);
    }
  }
  lobbies.delete(l.id);
}
const min = live * DT / 60;
console.log(`brzda (cizí hráči/boti): dřív ${(oldN / min).toFixed(1)}/min · nově ${(newN / min).toFixed(1)}/min`);
process.exit(0);
