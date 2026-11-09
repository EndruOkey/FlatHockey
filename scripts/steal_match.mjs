// Obrání a přihrávky v reálném zápase botů 2v2 (server sim, seedy 1..S, 5 min). Deterministické.
// Epizoda kontaktu = soupeřova špička hole ≤ 16 px od puku nosiče. Výsledek: obrání / proč ne.
// node scripts/steal_match.mjs [seedů=8]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4633'; process.env.DB_PATH = join(tmpdir(), `fh-steal-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const S = +(process.argv[2] || 8), TEAM = +(process.env.FH_TEAM || 2), R = PLAYER.stealR;
let stolenNow = false; const o0 = Player.prototype.stealFrom;
Player.prototype.stealFrom = function (c, p) { stolenNow = true; return o0.call(this, c, p); };
const T = { ep: 0, epSteal: 0, why: { grace: 0, reach: 0, cool: 0, air: 0 }, steals: 0, passes: 0, carries: 0, min: 0, clip: 0 };
for (let s = 1; s <= S; s++) {
  const l = { id: 'st' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < TEAM; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < TEAM; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const ep = new Map(); let prev = null;
  while (!m.ended) {
    stolenNow = false; stepMatch(m);
    if (m.setup || m.stoppage || m.world._goalLock) { ep.clear(); prev = null; continue; }
    T.min += 1 / 60 / 60;
    const ps = [...m.players.values()], C = ps.find(p => p.hasPuck);
    if (C && prev && prev !== C) { T.carries++; if (prev.team === C.team) T.passes++; }
    if (C) prev = C;
    if (stolenNow) T.steals++;
    const seen = new Set();
    for (const O of ps) {
      if (!C || O.team === C.team) continue;
      const tip = O.stickTip, d = Math.hypot(tip.x - m.puck.x, tip.y - m.puck.y);
      if (d > 16) continue;
      seen.add(O);
      let e = ep.get(O); if (!e) { e = { why: { grace: 0, reach: 0, cool: 0, air: 0 } }; ep.set(O, e); T.ep++; }
      if (d > R) { e.why.reach++; const g = O.gripPoint; if (Math.hypot(tip.x - g.x, tip.y - g.y) < (O._dispReach ?? 16) - 1) e.clip = true; }
      else if ((C._possT ?? 99) < PLAYER.stealGrace) e.why.grace++;
      else if (O._shootCooldown > 0) e.why.cool++;
      else if (m.puck.isAirborne) e.why.air++;
    }
    for (const [O, e] of ep) if (!seen.has(O) || stolenNow) {
      if (stolenNow) T.epSteal++;
      else { const k = Object.entries(e.why).sort((a, b) => b[1] - a[1])[0][0]; T.why[k]++; if (k === 'reach' && e.clip) T.clip++; }
      ep.delete(O);
    }
  }
}
const f = x => x.toFixed(1);
console.log(`${TEAM}v${TEAM}, ${S} zápasů × 5 min | hraný čas ${f(T.min)} min`);
console.log(`Kontakty hole s pukem nosiče (≤16 px): ${T.ep} | z toho obrání: ${T.epSteal} (${f(100 * T.epSteal / T.ep)} %)`);
console.log(`Bez obrání — hlavní důvod: ochrana čerstvého puku ${T.why.grace}, špička nedosáhla (9,2 px) ${T.why.reach} [z toho hůl zastavená o tělo/hůl ${T.clip}], cooldown ${T.why.cool}, puk ve vzduchu ${T.why.air}`);
console.log(`Obrání/min ${f(T.steals / T.min)} | přihrávky/min ${f(T.passes / T.min)} | podíl pasů na změnách nosiče ${f(100 * T.passes / Math.max(1, T.carries))} %`);
process.exit(0);
