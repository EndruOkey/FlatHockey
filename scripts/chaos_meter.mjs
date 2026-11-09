// CHAOS METR — jedno číslo za každý zdroj „chaosu", 3v3 boti, 20 seedů × 5 min, deterministicky.
// node scripts/chaos_meter.mjs [--json]   (env FH_* platí jako jinde)
// Měří, CO hráč vidí jako chaos:
//  držení   — jak dlouho tým/hráč drží puk, kolikrát/min puk přejde k soupeři
//  volný puk— % živého času, kdy puk nikdo nedrží; % času „skrumáž" (≥3 bruslaři do 40 px od puku)
//  ztráty   — čím končí držení (obrání / pas / střela / sklouznutí z hole / gólman / jiné)
//  střely   — střel/min, gólů/zápas
//  cukání   — otočky bruslaře o >90° během 0,1 s (při rychlosti >50 px/s) na bota za minutu
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4677';
process.env.DB_PATH = join(tmpdir(), `fh-chaosm-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { Goalie } = await import('../public/js/entities/Goalie.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const SEEDS = Number(process.env.CM_SEEDS || 20), HZ = 60, TEAM = Number(process.env.FH_TEAM || 3);

let cause = null;   // co v tomto ticku ukončilo držení
const wrap = (proto, name, tag, cond) => { const o = proto[name]; proto[name] = function (...a) { const before = cond(this, a); const r = o.apply(this, a); if (before && !cause) cause = tag; return r; }; };
wrap(Player.prototype, 'shoot', 'shot', p => p.hasPuck);
wrap(Player.prototype, 'pass', 'pass', p => p.hasPuck);
wrap(Player.prototype, 'stealFrom', 'steal', () => true);
{ const o = Player.prototype._updateStick; Player.prototype._updateStick = function (...a) { const h = this.hasPuck; const r = o.apply(this, a); if (h && !this.hasPuck && !cause) cause = 'slip'; return r; }; }
{ const o = Goalie.prototype.pokeCheck; Goalie.prototype.pokeCheck = function (pl, ...a) { const h = pl.hasPuck; const r = o.call(this, pl, ...a); if (h && !pl.hasPuck && !cause) cause = 'goalie'; return r; }; }

const A = { liveT: 0, looseT: 0, scrumT: 0, samples: 0, teamChanges: 0, teamRuns: [], carryRuns: [], ends: {}, shots: 0, goals: 0, flips: 0, botMin: 0, creaseT: 0, gContactT: 0, stuck: 0, whistles: {} };
const { RINK } = await import('../public/js/constants.js'); const GY = RINK.goalY + RINK.goalH / 2;
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'CM' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < TEAM; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const sk = [...m.players.values()];
  { const ow = m.world.onWhistle; m.world.onWhistle = (e) => { if (!(m.ended || m.stoppage || m.offside || m.icing || m.setup)) A.whistles[e.reason] = (A.whistles[e.reason] || 0) + 1; return ow(e); }; }
  const stuckT = new Map();
  let owner = null, run = 0, team = null, trun = 0; const head = new Map();
  for (let t = 0; t < 5 * 60 * HZ; t++) {
    cause = null; stepMatch(m);
    const live = !(m.setup || m.stoppage || m.world._goalLock);
    if (!live) { if (owner) { A.carryRuns.push(run); } if (team) A.teamRuns.push(trun); owner = null; team = null; run = trun = 0; head.clear(); continue; }
    A.liveT++;
    let o = null; for (const p of sk) if (p.hasPuck) o = p;
    if (owner && o !== owner) { const c = cause || (o ? 'direct' : 'other'); A.ends[c] = (A.ends[c] || 0) + 1; if (c === 'shot') A.shots++; A.carryRuns.push(run); run = 0; }
    if (o) { run++; if (team && o.team !== team) { A.teamChanges++; A.teamRuns.push(trun); trun = 0; } team = o.team; }
    if (team) trun++;
    if (!o) A.looseT++;
    owner = o;
    if (t % 6 === 0) {
      A.samples++;
      const pk = m.puck; let near = 0; for (const p of sk) if (Math.hypot(p.x - pk.x, p.y - pk.y) < 40) near++;
      if (near >= 3) A.scrumT++;
      for (const p of sk) {
        // brankoviště soupeře (půlkruh r=goalH/2 před brankovou čárou) + kontakt s gólmanem + zaseknutí u gólmana
        for (const g of [m.goalieL, m.goalieR]) {
          if (g.team === p.team) continue;
          const inIce = (p.x - g.netX) * g.inX > 0;
          if (inIce && Math.hypot(p.x - g.netX, p.y - GY) < RINK.goalH / 2) A.creaseT++;
          const gd = Math.hypot(p.x - g.x, p.y - g.y);
          if (gd < g.radius + p.radius + 1.5) A.gContactT++;
          const k = p.id + g.netX, slow = Math.hypot(p.vx, p.vy) < 15 && gd < 30;
          const st = slow ? (stuckT.get(k) || 0) + 1 : 0; stuckT.set(k, st); if (st === 5) A.stuck++;   // 5 vzorků = 0,5 s
        }
        const v = Math.hypot(p.vx, p.vy), h = Math.atan2(p.vy, p.vx), prev = head.get(p.id);
        if (prev && v > 50 && prev.v > 50) { let d = Math.abs(h - prev.h); if (d > Math.PI) d = 2 * Math.PI - d; if (d > Math.PI / 2) A.flips++; }
        head.set(p.id, { h, v });
      }
    }
  }
  A.goals += (m.score?.home ?? 0) + (m.score?.away ?? 0);
  lobbies.delete(l.id);
}
const min = A.liveT / HZ / 60, avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length / HZ : 0, r1 = x => Math.round(x * 10) / 10;
const totEnds = Object.values(A.ends).reduce((a, b) => a + b, 0);
const R = {
  team_possession_s: r1(avg(A.teamRuns)),
  carry_s: r1(avg(A.carryRuns)),
  team_changes_per_min: r1(A.teamChanges / min),
  loose_pct: r1(100 * A.looseT / A.liveT),
  scrum_pct: r1(100 * A.scrumT / A.samples),
  shots_per_min: r1(A.shots / min),
  goals_per_game: r1(A.goals / SEEDS),
  flips_per_bot_min: r1(A.flips / min / (2 * TEAM)),
  crease_pct_skater: r1(100 * A.creaseT / A.samples / (2 * TEAM)),
  goalie_contact_pct: r1(100 * A.gContactT / A.samples / (2 * TEAM)),
  stuck_at_goalie_per_game: r1(A.stuck / SEEDS),
  whistles_per_game: Object.fromEntries(Object.entries(A.whistles).map(([k, v]) => [k, r1(v / SEEDS)])),
  ends_pct: Object.fromEntries(Object.entries(A.ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(100 * v / totEnds)])),
};
if (process.argv.includes('--json')) console.log(JSON.stringify(R));
else for (const [k, v] of Object.entries(R)) console.log(k.padEnd(22), typeof v === 'object' ? JSON.stringify(v) : v);
process.exit(0);
