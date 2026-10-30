// Balance harness: deterministicke merene metriky hry + pevna rubrika. Spusteni: node test/balance-metrics.mjs
// (vypise serazeny scorecard; kontrolu rubriky dela test/balance.mjs = npm run test:balance)
//
// RUBRIKA (navrh pro casual arkadovy hokej; klic: [min..max] duvod):
//   goals_per_game_total      4..10     5min zapas 3v3 ma byt zivy, ale ne gol-fest
//   games_with_goal_pct       90..100   skoro kazdy zapas musi mit gol (boti nejsou zablokovani)
//   home_away_ratio           0.6..1.67 domaci/hoste bez strukturalni vyhody strany
//   conversion_pct            15..30    strela -> gol; mimo to je gol nahoda nebo nemozny
//   conversion_close_pct      0..70     zadna blizka strela neni auto-gol (brankar se musi uplatnit)
//   conversion_far_pct        0..12     dalka (250+ px) je spis nahozeni nez gol
//   save_pct_wrist/slap/onetimer 45..90 zadny typ strely neni auto-gol ani auto-zachrana
//   longest_carry_s           0..25     puk nelze drzet donekonecna
//   steals_per_min            0.5..99   puk se musi dat vzit
//   stall_possession_pct      0..85     couvajici hrac s kurzorem u tela nesmi puk drzet navzdy (bylo ~98)
//   crease_block_pct          0..60     stojici obrance v brankovisti nesmi blokovat >60 % golu (bot se musi prizpusobit)
//   longslap_goal_pct         0..35     plna rana ze 600px (390 px od brany) nema padat v 40-60 %
//   bot_1v1_goals_of_10       8..10     bot proti stojicimu clovek porad skoruje
//   bot_3v3_seeds_with_goal_of_20 12..20 3v3 boti porad skoruji
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
process.env.PORT = process.env.PORT || '4620';
process.env.DB_PATH = join(tmpdir(), `fh-balance-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { Goalie } = await import('../public/js/entities/Goalie.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

const HZ = 60;
export const RUBRIC = {
  goals_per_game_total: [4, 10], games_with_goal_pct: [90, 100], home_away_ratio: [0.6, 1.67],
  conversion_pct: [15, 30], conversion_close_pct: [0, 70], conversion_far_pct: [0, 12],
  save_pct_wrist: [45, 90], save_pct_slap: [45, 90], save_pct_onetimer: [45, 90],
  longest_carry_s: [0, 25], steals_per_min: [0.5, 99],
  stall_possession_pct: [0, 85], crease_block_pct: [0, 60], longslap_goal_pct: [0, 35],
  bot_1v1_goals_of_10: [8, 10], bot_3v3_seeds_with_goal_of_20: [12, 20],
};

// ---- instrumentace (jen pozorovani, nic nemeni) ----
let rec = null;
const origShoot = Player.prototype.shoot, origSteal = Player.prototype.stealFrom, origSave = Goalie.prototype._markSave;
Player.prototype.shoot = function (puck, charge) { if (rec) rec.onShoot(this, charge); return origShoot.call(this, puck, charge); };
Player.prototype.stealFrom = function (c, p) { if (rec) rec.steals++; return origSteal.call(this, c, p); };
Goalie.prototype._markSave = function (type, dur) { if (rec) rec.onSave(this); return origSave.call(this, type, dur); };

function setup(id, seed, home, away, rules = false, long = false) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules, minutes: long ? 15 : 5, periods: long ? 3 : 1 }),
              members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < home; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < away; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);
  return { l, m };
}
const live = m => !(m.setup || m.stoppage || m.world._goalLock);
const botify = (l, m) => { for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); } };
const bucket = d => d < 120 ? '0-120' : d < 250 ? '120-250' : '250+';
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : 0;
const goalCenter = team => ({ x: team === 'home' ? RINK.goalLineRight : RINK.goalLineLeft, y: RINK.goalY + RINK.goalH / 2 });

function newRec(m) {
  return {
    steals: 0, shots: [],
    onShoot(p, c) {
      const g = goalCenter(p.team), tip = p.stickTip;
      const type = p._oneTimer ? 'onetimer' : c >= 0.6 ? 'slap' : 'wrist';
      this.shots.push({ team: p.team, d: Math.hypot(g.x - tip.x, g.y - tip.y), type, t: m.tick, res: null });
    },
    onSave(gl) { const s = this.pending(gl.team === 'home' ? 'away' : 'home'); if (s) s.res = 'save'; },
    pending(team) {
      for (let i = this.shots.length - 1; i >= 0; i--) { const s = this.shots[i]; if (s.team === team && !s.res && m.tick - s.t < 4 * HZ) return s; }
      return null;
    },
    goal(team) { const s = this.pending(team); if (s) s.res = 'goal'; },
  };
}

// ---- 3v3 boti ----
function sim3v3(seed, minutes) {
  const { l, m } = setup('B3_' + seed, seed, 3, 3, true);
  botify(l, m);
  const r = rec = newRec(m);
  let ph = 0, pa = 0, liveT = 0, carryT = 0, run = 0, runOwner = null, longest = 0;
  for (let t = 0; t < minutes * 60 * HZ; t++) {
    stepMatch(m);
    if (m.score.home > ph) r.goal('home');
    if (m.score.away > pa) r.goal('away');
    ph = m.score.home; pa = m.score.away;
    if (!live(m)) { run = 0; runOwner = null; continue; }
    liveT++;
    let o = null; for (const p of m.players.values()) if (p.hasPuck) o = p;
    if (o) { carryT++; if (o === runOwner) run++; else { run = 1; runOwner = o; } if (run > longest) longest = run; }
    else { run = 0; runOwner = null; }
  }
  rec = null; lobbies.delete(l.id);
  return { score: { ...m.score }, shots: r.shots, steals: r.steals, liveT, carryT, longest };
}

// ---- 1v1 bot (away) vs stojici clovek ----
function sim1v1(seed) {
  const { l, m } = setup('B1_' + seed, seed, 1, 0);
  for (let t = 0; t < 60 * HZ; t++) stepMatch(m);
  lobbies.delete(l.id);
  return m.score.away;
}

// ---- stall: clovek-sim nosic couva od soupere, kurzor u tela (aimDist 5) ----
export function stallTest(seed, secs, probe) {
  const { l, m } = setup('BS_' + seed, seed, 1, 0);
  const h = m.players.get('h0'), inp = m.inputs.get('h0');
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let liveT = 0, held = 0;
  for (let t = 0; t < secs * HZ; t++) {
    if (t % 6 === 0) {
      const opp = [...m.players.values()].find(p => p !== h);
      let best = null, bs = -Infinity;
      for (const [dx, dy] of dirs) {
        const n = Math.hypot(dx, dy), px = h.x + dx / n * 60, py = h.y + dy / n * 60;
        let s = Math.hypot(opp.x - px, opp.y - py);
        if (px < 50 || px > RINK.w - 50 || py < 50 || py > RINK.h - 50) s -= 500;
        if (s > bs) { bs = s; best = [dx, dy]; }
      }
      if (h.hasPuck) { inp.dx = best[0]; inp.dy = best[1]; inp.aim = Math.atan2(best[1], best[0]); }
      else { inp.dx = Math.sign(m.puck.x - h.x); inp.dy = Math.sign(m.puck.y - h.y); inp.aim = Math.atan2(m.puck.y - h.y, m.puck.x - h.x); }
      inp.aimDist = 5; inp.lmb = false; inp.rmb = false;
    }
    stepMatch(m);
    if (!live(m)) continue;
    liveT++; if (h.hasPuck) held++;
    if (probe && t % 30 === 0) probe(m, h);
  }
  lobbies.delete(l.id);
  return { liveT, held };
}

// ---- crease-park: 1 bot utocnik (away -> leva branka) vs stojici obrance (home) ----
function creaseTest(seed, minutes, x, y) {
  const { l, m } = setup('BC_' + seed, seed, 1, 0, false, true);   // 3 x 15 min, ať zápas neskončí uprostřed
  const h = m.players.get('h0'), inp = m.inputs.get('h0');
  let still = 0;
  for (let t = 0; t < minutes * 60 * HZ; t++) {
    // obrance je jen telo: nesbira, neobira, nestrili (_shootCooldown) a stoji na miste
    h.x = x; h.y = y; h.vx = 0; h.vy = 0; h._shootCooldown = 1; inp.dx = 0; inp.dy = 0; inp.aim = 0; inp.aimDist = 30; inp.lmb = false; inp.rmb = false;
    stepMatch(m);
    // pojistka harnessu: puk, co lezi 15 s bez pohybu (napr. v siti za caram), se vrati na stred
    const pk = m.puck, still0 = Math.hypot(pk.vx, pk.vy) < 3 && !h.hasPuck && live(m);
    for (const p of m.players.values()) if (p.hasPuck) still = 0;
    still = still0 ? still + 1 : 0;
    if (still > 15 * HZ) { pk.x = RINK.centerX; pk.y = RINK.h / 2; pk.vx = pk.vy = 0; still = 0; }
  }
  lobbies.delete(l.id);
  return m.score.away;
}

// ---- dlouha rana: charge 0.8 z (600,228) do rohu, N pokusu (kazdy novy zapas = jiny seed) ----
function longSlap(trials, x = 600, y = 228) {
  let goals = 0;
  for (let k = 0; k < trials; k++) {
    const { l, m } = setup('BL_' + k, k + 1, 1, 0);
    for (const p of [...m.players.values()]) if (p.isBot) { m.players.delete(p.id); m.inputs.delete(p.id); }
    m.world.entities = m.world.entities.filter(e => !(e.isPlayer && e.isBot));
    let guard = 0; while (!live(m) && guard++ < 600) stepMatch(m);
    const h = m.players.get('h0'), inp = m.inputs.get('h0');
    const cy = RINK.goalY + (k % 2 ? 3 : RINK.goalH - 3), gx = RINK.goalLineRight;
    const ang = Math.atan2(cy - y, gx - x);
    h.x = x; h.y = y; h.vx = h.vy = 0; h.bodyAngle = h.aimAngle = h.carryAngle = ang; h.hasPuck = true;
    m.puck.x = x; m.puck.y = y; m.puck.vx = m.puck.vy = 0;
    inp.aim = ang; inp.aimDist = 300; inp.dx = inp.dy = 0;
    const before = m.score.home;
    for (let t = 0; t < 40; t++) { inp.lmb = true; stepMatch(m); }
    inp.lmb = false;
    for (let t = 0; t < 4 * HZ; t++) stepMatch(m);
    if (m.score.home > before) goals++;
    lobbies.delete(l.id);
  }
  return pct(goals, trials);
}

export function runAll(opts = {}) {
  const seeds = opts.seeds ?? 30, minutes = opts.minutes ?? 5;
  const S = {};
  let hg = 0, ag = 0, withGoal = 0, shots = [], steals = 0, liveT = 0, carryT = 0, longest = 0;
  for (let s = 1; s <= seeds; s++) {
    const r = sim3v3(s, minutes);
    hg += r.score.home; ag += r.score.away; if (r.score.home + r.score.away > 0) withGoal++;
    shots.push(...r.shots); steals += r.steals; liveT += r.liveT; carryT += r.carryT; longest = Math.max(longest, r.longest);
  }
  S.goals_per_game_home = +(hg / seeds).toFixed(2); S.goals_per_game_away = +(ag / seeds).toFixed(2);
  S.goals_per_game_total = +((hg + ag) / seeds).toFixed(2);
  S.games_with_goal_pct = pct(withGoal, seeds);
  S.home_away_ratio = +((hg + 1) / (ag + 1)).toFixed(2);
  const gp = a => pct(a.filter(x => x.res === 'goal').length, a.length);
  S.shots_per_game = +(shots.length / seeds).toFixed(1);
  S.conversion_pct = gp(shots);
  S.conversion_close_pct = gp(shots.filter(x => bucket(x.d) === '0-120'));
  S.conversion_mid_pct = gp(shots.filter(x => bucket(x.d) === '120-250'));
  S.conversion_far_pct = gp(shots.filter(x => bucket(x.d) === '250+'));
  const onT = a => a.filter(x => x.res === 'goal' || x.res === 'save');
  const sv = a => pct(a.filter(x => x.res === 'save').length, onT(a).length);
  for (const t of ['wrist', 'slap', 'onetimer']) {
    const a = shots.filter(x => x.type === t);
    S['save_pct_' + t] = onT(a).length >= 20 ? sv(a) : null; S['shots_' + t] = a.length;   // null = bot tenhle typ nestrili, nelze merit
  }
  for (const b of ['0-120', '120-250', '250+']) S['save_pct_dist_' + b] = sv(shots.filter(x => bucket(x.d) === b));
  S.possession_pct = pct(carryT, liveT);
  S.longest_carry_s = +(longest / HZ).toFixed(1);
  S.steals_per_min = +(steals / (liveT / HZ / 60)).toFixed(2);
  const st = stallTest(1, 120); S.stall_possession_pct = pct(st.held, st.liveT);
  const cm = opts.creaseMin ?? 40;
  const parked = creaseTest(1, cm, 118, 228), corner = creaseTest(1, cm, 40, 40);
  S.crease_goals_parked = parked; S.crease_goals_corner = corner;
  S.crease_block_pct = corner ? +Math.max(0, 100 * (1 - parked / corner)).toFixed(1) : 0;
  S.longslap_goal_pct = longSlap(opts.slapTrials ?? 100);
  let b1 = 0; for (let s = 1; s <= 10; s++) if (sim1v1(s) > 0) b1++;
  S.bot_1v1_goals_of_10 = b1;
  let b3 = 0; for (let s = 1; s <= 20; s++) { const r = sim3v3(100 + s, 1.5); if (r.score.home + r.score.away > 0) b3++; }
  S.bot_3v3_seeds_with_goal_of_20 = b3;
  return S;
}

export function check(S) {
  return Object.entries(RUBRIC).filter(([k]) => S[k] !== null).map(([k, [lo, hi]]) => ({ k, v: S[k], lo, hi, ok: S[k] >= lo && S[k] <= hi }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t0 = Date.now();
  const S = runAll();
  console.log('=== BALANCE SCORECARD ===');
  for (const k of Object.keys(S).sort()) {
    const r = RUBRIC[k];
    console.log(k.padEnd(34), String(S[k] === null ? 'n/a' : S[k]).padStart(8), r && S[k] !== null ? `  rubrika [${r[0]}..${r[1]}]  ${S[k] >= r[0] && S[k] <= r[1] ? 'OK' : 'MIMO'}` : '');
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(0);
}
