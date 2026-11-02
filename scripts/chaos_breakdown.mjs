// Čím končí držení puku (3v3 boti, deterministicky): odebrání / přihrávka / střela / jiné, a kdo puk získá potom.
// node scripts/chaos_breakdown.mjs  (env FH_GRACE apod. platí)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4670';
process.env.DB_PATH = join(tmpdir(), `fh-chaos-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let last = null;   // poslední akce nositele v tomto ticku
const wrap = (name) => { const o = Player.prototype[name]; Player.prototype[name] = function (...a) { if (this.hasPuck || name === 'stealFrom') last = name; return o.apply(this, a); }; };
['shoot', 'pass', 'stealFrom'].forEach(wrap);
const ends = { stealFrom: 0, pass: 0, shoot: 0, other: 0 }, after = { pass_mate: 0, pass_opp: 0, shoot_opp: 0, shoot_mate: 0 };
let pending = null, liveT = 0, carries = [];
for (let seed = 1; seed <= 20; seed++) {
  const l = { id: 'C' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < 3; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let owner = null, run = 0;
  for (let t = 0; t < 5 * 60 * 60; t++) {
    last = null; stepMatch(m);
    const liveNow = !(m.setup || m.stoppage || m.world._goalLock); if (!liveNow) { owner = null; pending = null; run = 0; continue; }
    liveT++;
    let o = null; for (const p of m.players.values()) if (p.hasPuck) o = p;
    if (owner && o !== owner) { ends[last || 'other']++; carries.push(run); if (last === 'pass' || last === 'shoot') pending = { kind: last, team: owner.team }; else pending = null; run = 0; }
    if (o && pending && o !== owner) { after[pending.kind + (o.team === pending.team ? '_mate' : '_opp')]++; pending = null; }
    if (o) run++;
    owner = o;
  }
  lobbies.delete(l.id);
}
const min = liveT / 60 / 60, tot = Object.values(ends).reduce((a, b) => a + b, 0);
console.log('konce držení za minutu:', Object.fromEntries(Object.entries(ends).map(([k, v]) => [k, +(v / min).toFixed(1)])), '| podíl %:', Object.fromEntries(Object.entries(ends).map(([k, v]) => [k, Math.round(100 * v / tot)])));
console.log('kdo získá puk po:', after, '| průměrné držení s:', +(carries.reduce((a, b) => a + b, 0) / carries.length / 60).toFixed(2));
process.exit(0);
