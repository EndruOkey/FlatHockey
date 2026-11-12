// Audit gólmana (deterministicky, server sim 2v2 boti): podíl času v postojích, zákroky/góly podle postoje a výšky,
// rozehrávka (zákrok/držení gólmana → spoluhráč u puku do 0,5 s = "okamžitá rozehrávka"), poke check.
// A/B: FH_GSTANCE=0 node scripts/goalie_stance_audit.mjs  vs  node scripts/goalie_stance_audit.mjs   (FH_SEEDS, FH_TEAM)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4641';
process.env.DB_PATH = join(tmpdir(), `fh-gsa-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Goalie, goalieGeom, goalieSilhouette } = await import('../public/js/entities/Goalie.js');
const { PUCK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const N = +(process.env.FH_TEAM || 2), SEEDS = +(process.env.FH_SEEDS || 16), HZ = 60;
const T = { ticks: 0, st: {}, saves: {}, goals: 0, goalSt: {}, goalHi: 0, saveHi: 0, outlets: 0, instant: 0, aimed: 0, pokes: 0, holds: 0 };
let curM = null;
const oSave = Goalie.prototype._markSave;
Goalie.prototype._markSave = function (type, dur) {
  const k = (this.stance || 'stand') + ':' + (curM && curM.puck.z > PUCK.gloveHeight ? 'hi' : 'lo');
  T.saves[k] = (T.saves[k] || 0) + 1;
  if (curM) curM._lastSave = { t: curM.tick, team: this.team, g: this };
  return oSave.call(this, type, dur);
};
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'gs' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < N; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < N; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop); curM = m;
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let sc = 0, lastZ = 0, prevHold = false, relT = null;
  while (!m.ended) {
    const zBefore = m.puck.z, stBefore = { L: m.goalieL.stance, R: m.goalieR.stance };
    stepMatch(m);
    const live = !(m.setup || m.stoppage || m.world._goalLock);
    if (live) { T.ticks++; for (const g of [m.goalieL, m.goalieR]) { const k = g.isHolding ? 'cover' : (g.stance || 'stand'); T.st[k] = (T.st[k] || 0) + 1; } }
    const tot = m.score.home + m.score.away;
    if (tot > sc) { T.goals++; const g = m.puck.x > 540 ? stBefore.R : stBefore.L; T.goalSt[g || 'stand'] = (T.goalSt[g || 'stand'] || 0) + 1; if (lastZ > PUCK.gloveHeight) T.goalHi++; sc = tot; }
    lastZ = zBefore;
    // rozehrávka: od zákroku/puštění z držení po převzetí spoluhráčem gólmana
    const hold = m.goalieL.isHolding || m.goalieR.isHolding;
    if (hold && !prevHold) T.holds++;
    if (m._lastSave && m._lastSave.t === m.tick) {
      relT = { t: m.tick, team: m._lastSave.team };
      // MÍŘENÁ rozehrávka: puk po zákroku letí ≥150 px/s přesně (cos > 0,985) na spoluhráče gólmana
      const pk = m.puck, sp = Math.hypot(pk.vx, pk.vy);
      if (sp > 150) for (const p of m.players.values()) if (p.team === relT.team) { const dx = p.x - pk.x, dy = p.y - pk.y, d = Math.hypot(dx, dy) || 1; if ((dx * pk.vx + dy * pk.vy) / (d * sp) > 0.985) { T.aimed++; break; } }
    }
    if (relT) {
      const c = [...m.players.values()].find(p => p.hasPuck);
      if (c) { if (c.team === relT.team) { T.outlets++; if (m.tick - relT.t < 0.5 * HZ) T.instant++; } relT = null; }
      else if (m.tick - relT.t > 4 * HZ || !live) relT = null;
    }
    prevHold = hold;
  }
  lobbies.delete(l.id);
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) : '0';
console.log(`GSTANCE=${process.env.FH_GSTANCE ?? 1} seeds=${SEEDS} team=${N}`);
console.log('čas v postoji %: ' + Object.entries(T.st).map(([k, v]) => `${k} ${pct(v, 2 * T.ticks)}`).join(' | '));
console.log('zákroky: ' + Object.entries(T.saves).sort().map(([k, v]) => `${k} ${v}`).join(' | '));
console.log('góly/zápas ' + (T.goals / SEEDS).toFixed(2) + ' | postoj při gólu: ' + Object.entries(T.goalSt).map(([k, v]) => `${k} ${v}`).join(' ') + ` | gólů vysoko ${pct(T.goalHi, T.goals)} %`);
console.log(`rozehrávka po zákroku → spoluhráč: ${T.outlets} | z toho do 0,5 s: ${T.instant} (${pct(T.instant, T.outlets)} %) | MÍŘENÁ přihrávka hned po zákroku: ${T.aimed} | držení ${T.holds}`);
const sil = st => goalieSilhouette(goalieGeom(st, 1));
const S = sil('stand'), B = sil('butterfly'), R = sil('rvh'), X = sil('stretch');
const rub = [
  ['motýlek ≥ 1,4× šíře stoje', B.span / S.span, 1.4], ['roztažení asymetrie ≥ 2', X.down / X.up, 2], ['RVH asymetrie ≥ 1,4', R.down / R.up, 1.4],
  ['motýlek nepřesáhne ústí (≤ 22 px na stranu)', 22 / B.down, 1], ['stoj symetrický', 1 / Math.abs(S.down / S.up), 1],
];
for (const [k, v, lo] of rub) console.log(`${v >= lo - 1e-9 ? 'OK  ' : 'FAIL'} ${k}: ${v.toFixed(2)}`);
process.exit(0);
