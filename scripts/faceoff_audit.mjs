// Audit buly (deterministicky): pro každé buly v offline jádru (match-core) i serveru změří
// rozestavení (hráči v hřišti, centr u bodu), čas do prvního dotyku, kdo vyhrál, zaseknutí (nikdo 3 s).
// node scripts/faceoff_audit.mjs   (FH_TEAM=2 default)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4627';
process.env.DB_PATH = join(tmpdir(), `fh-fo-${process.pid}.db`);
const core = await import('../public/js/match-core.js');
const { __test } = await import('../server.js');
const { Player } = await import('../public/js/entities/Player.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const N = Number(process.env.FH_TEAM || 2), SEEDS = Number(process.env.FH_SEEDS || 12), HZ = 60;

function coreMatch(seed) {
  const m = core.createMatch(seed, {}); m.rules = true; m.minutes = 5; m.periods = 1; m.period = 1; m.clock = 300;
  for (const team of ['home', 'away']) for (let i = 0; i < N; i++) { const id = `bot:${team}:${i}`; const p = new Player(id, team, core.makeInput());
    p.isBot = true; p.brain = makeBotBrain(hashSeed('F' + seed + id)); m.players.set(id, p); m.inputs.set(id, p.input); }
  core.rebuildEntities(m); core.faceoff(m); return { m, step: () => core.stepMatch(m), done: () => {} };
}
function serverMatch(seed) {
  const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
  const l = { id: 'FO' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < N; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < N; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  return { m, step: () => stepMatch(m), done: () => lobbies.delete(l.id) };
}
function audit(make, label) {
  const r = { n: 0, zone: 0, badPlace: 0, farCenter: 0, stuck: 0, tFirst: [], home: 0, away: 0, goalie: 0 };
  for (let s = 1; s <= SEEDS; s++) {
    const { m, step, done } = make(s);
    let fo = null, wasSetup = false;
    for (let t = 0; t < 300 * HZ && !m.ended; t++) {
      step();
      if (m.setup && !wasSetup) {   // nové buly rozestaveno
        const px = m.puck.x, py = m.puck.y; r.n++; if (Math.abs(py - RINK.h / 2) > 20) r.zone++;
        let bad = false, nearest = Infinity;
        for (const p of m.players.values()) { if (p.x < 8 || p.x > RINK.w - 8 || p.y < 8 || p.y > RINK.h - 8) bad = true; nearest = Math.min(nearest, Math.hypot(p.x - px, p.y - py)); }
        if (bad) r.badPlace++; if (nearest > 30) r.farCenter++;
        fo = { t0: null, x: px, y: py };
      }
      if (fo && !m.setup && fo.t0 == null) fo.t0 = t;
      if (fo && fo.t0 != null) {
        const c = [...m.players.values()].find(p => p.hasPuck);
        const gh = m.goalieL.isHolding || m.goalieR.isHolding;
        if (c || gh || m.world._goalLock) { if (c) { r[c.team]++; r.tFirst.push((t - fo.t0) / HZ); } else if (gh) r.goalie++; fo = null; }
        else if (t - fo.t0 > 3 * HZ) { r.stuck++; fo = null; }
      }
      wasSetup = m.setup;
    }
    done();
  }
  const ts = r.tFirst.sort((a, b) => a - b), med = ts.length ? ts[ts.length >> 1] : 0;
  console.log(`${label.padEnd(7)} buly ${r.n} (pásmo ${r.zone}) | mimo hřiště ${r.badPlace} | centr >30px od puku ${r.farCenter} | zaseklé >3s ${r.stuck} | vyhráli H/A ${r.home}/${r.away} | medián do dotyku ${med.toFixed(2)} s`);
  return r;
}
const a = audit(coreMatch, 'offline'), b = audit(serverMatch, 'server');
const bad = a.badPlace + a.farCenter + a.stuck + b.badPlace + b.farCenter + b.stuck;
console.log(bad ? `PROBLÉMY: ${bad}` : 'OK'); process.exit(0);
