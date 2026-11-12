// ŘETĚZEC ČÁST 3: BRANKA → BRANKÁŘ → ROZEHRA. Mrtvý čas, pauzy podle příčiny, držení vs rozehrávka gólmana,
// komu gólman rozehrává, férovost buly, čas rozehra → první střela. Boti 2v2, deterministicky (seedy = id lobby).
// Rubrika předem (2026-11-12):
//   dead_pct ≤ 15 · pause_goal_s ≤ 2,5 · pause_freeze_s (chycení → hra) ≤ 3,0 · pause_out_s ≤ 2,5
//   release_loss3_pct ≤ 25 · release_opp_attack_pct ≤ 30 · |fo_home_pct − 50| ≤ 10 · |fo_defzone_pct − 50| ≤ 15
//   fo_none_pct ≤ 10 (buly, kde do 3 s nikdo puk nezíská)
// node scripts/chain_restart.mjs [--seeds=8] [--min=5] [--json] [--det]
import { tmpdir } from 'os'; import { join } from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
if (ARG.det) {   // determinismus: dva samostatné procesy, stejný výstup?
  const me = fileURLToPath(import.meta.url), extra = process.argv.slice(2).filter(a => a !== '--det');
  const run = port => execFileSync(process.execPath, [me, '--json', ...extra], { env: { ...process.env, PORT: String(port) }, encoding: 'utf8' });
  const a = run(4711), b = run(4712);
  console.log(a === b ? `DETERMINISMUS OK (2 běhy shodné, ${a.length} B)` : 'DETERMINISMUS NE — běhy se liší');
  process.exit(a === b ? 0 : 1);
}
process.env.PORT = process.env.PORT || '4698';
process.env.DB_PATH = join(tmpdir(), `fh-cr-${process.pid}.db`);
const { RINK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Goalie } = await import('../public/js/entities/Goalie.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const HZ = 60, SEEDS = +(ARG.seeds || 8), MIN = +(ARG.min || 5);

// ── Odposlech _release (komu/jak gólman rozehrál, nebo pokus o podržení) ──
let REL = []; const MATE = { n: 0, far: 0, cov: 0 };   // události z aktuálního ticku
const _rel = Goalie.prototype._release;
Goalie.prototype._release = function (world) {
  const held = !!this._heldPuck, froze0 = this._froze;
  if (held && world) {   // proč ne pas: spoluhráč daleko (> 170 px) nebo krytý (soupeř < 90 px)
    let md = Infinity, mate = null; for (const q of world.players) if (q.team === this.team) { const d = Math.hypot(q.x - this.x, q.y - this.y); if (d < md) { md = d; mate = q; } }
    MATE.n++; if (md >= 170) MATE.far++; else if (mate && world.players.some(o => o.team !== this.team && Math.hypot(o.x - mate.x, o.y - mate.y) < 90)) MATE.cov++;
  }
  _rel.call(this, world);
  if (!held) return;
  if (this._froze && !froze0 && this._heldPuck) { REL.push({ g: this, kind: 'freeze' }); return; }
  if (!this._heldPuck) {
    const pk = world.puck, sp = Math.hypot(pk.vx, pk.vy);
    const toBoard = this.y < RINK.h / 2 ? -1 : 1, ba = Math.atan2(toBoard * 60, this.inX * 120);
    const board = Math.abs(sp - 80) < 0.01 && Math.abs(Math.atan2(pk.vy, pk.vx) - ba) < 1e-6;
    REL.push({ g: this, kind: board ? 'board' : 'pass' });
  }
};

const T = {   // agregace
  ticks: 0, dead: 0, deadBy: {}, pauses: {}, catches: 0, holdTicks: 0,
  rel: { pass: 0, board: 0, freezeTry: 0, freezeWhistle: 0, freezeDenied: 0 },
  relWin: { own: 0, opp: 0, none: 0, regrab: 0 }, relOppAttack: 0, relOwnShot: 0, relOwnShotT: [], relFirstShotN: 0,
  freezeTotal: [], fo: { n: 0, home: 0, away: 0, none: 0, zoneN: 0, def: 0, att: 0, center: 0, centerHome: 0, centerAway: 0, afterGoalN: 0, concWin: 0 },
  foShotT: [], foShotWinTeam: 0, foShotN: 0, goals: 0, shots: 0,
};
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
const push = (o, k, v) => { (o[k] || (o[k] = [])).push(v); };

for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'CR' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let lastReason = null; const ow = m.world.onWhistle;
  m.world.onWhistle = e => { lastReason = e.reason; ow(e); };
  let lastCause = 'start', lastConceded = null, lastScorer = null, lock = true, cause = 'start', lockT0 = 0, setup = m.setup, lastShot = m.puck._shot || null;
  const held = new Map([[m.goalieL, null], [m.goalieR, null]]);   // gólman → tick chycení
  const watch = [];   // otevřená okna: { type:'rel'|'fo', t0, team, ... }
  const pendingFreeze = [];
  for (let t = 0; t < MIN * 60 * HZ && !m.ended; t++) {
    const pre = { ic: !!m.icing, of: !!m.offside, st: m.stoppage, sc: m.score.home + m.score.away, h: m.score.home };
    REL = []; lastReason = null;
    stepMatch(m);
    const tk = m.tick; T.ticks++;
    // gól / střela
    const goal = m.score.home + m.score.away > pre.sc; if (goal) { T.goals++; lastScorer = m.score.home > pre.h ? 'home' : 'away'; }
    const sh = m.puck._shot; let shotTeam = null;
    if (sh && sh !== lastShot) { lastShot = sh; shotTeam = sh.team; T.shots++; }
    // mrtvý čas (zámek = časomíra stojí)
    const L = !!m.world._goalLock;
    if (L && !lock) {
      cause = m._goalAt ? 'goal' : m.icing ? 'icing' : m.offside ? 'offside' : m.stoppage ? (lastReason || 'out') : 'other';
      lockT0 = tk;
    }
    if (L && lock && m.stoppage && !pre.st && (pre.ic || pre.of)) cause = pre.ic ? 'icing' : 'offside';   // čekající pravidlo → píšťalka
    if (L) { T.dead++; add(T.deadBy, cause); }
    if (!L && lock) { push(T.pauses, cause, (tk - lockT0) / HZ); lastCause = cause; lastConceded = cause === 'goal' ? lastScorer : null;
      for (const f of pendingFreeze.splice(0)) if (f.cause === cause) T.freezeTotal.push((tk - f.t0) / HZ); }
    lock = L;
    // držení gólmanem
    for (const g of [m.goalieL, m.goalieR]) {
      const h = held.get(g);
      if (g._heldPuck && h === null) { held.set(g, tk); T.catches++; }
      if (g._heldPuck) T.holdTicks++;
      if (!g._heldPuck && h !== null) held.set(g, null);
    }
    for (const e of REL) {
      if (e.kind === 'freeze') {
        T.rel.freezeTry++;
        if (m.stoppage && !pre.st) { T.rel.freezeWhistle++; pendingFreeze.push({ t0: held.get(e.g) ?? tk, cause: 'freeze' }); }
        else T.rel.freezeDenied++;   // píšťalka zablokovaná (debounce) → drží dál 1,6 s a pak stejně rozehraje
        continue;
      }
      T.rel[e.kind]++;
      watch.push({ type: 'rel', t0: tk, team: e.g.team, win: null, shot: null });
    }
    // buly: konec setupu
    if (setup && !m.setup) {
      const fx = m.puck.x, center = Math.abs(fx - RINK.centerX) < 1;
      watch.push({ type: 'fo', t0: tk, center, after: lastCause, scorer: lastConceded, def: center ? null : (fx < RINK.centerX ? 'home' : 'away'), win: null, shot: null });
    }
    setup = m.setup;
    // vyhodnocení oken
    let car = null; for (const p of m.players.values()) if (p.hasPuck) { car = p; break; }
    const gHold = [m.goalieL, m.goalieR].find(g => g._heldPuck);
    for (let i = watch.length - 1; i >= 0; i--) {
      const w = watch[i], age = tk - w.t0;
      if (w.win === null && age > 0) {
        if (car) w.win = car.team;
        else if (w.type === 'rel' && gHold) w.win = 'regrab';
        else if (age >= 3 * HZ || goal || L) w.win = 'none';
      }
      if (w.shot === null && shotTeam && age > 0) w.shot = { team: shotTeam, t: age / HZ };
      const done = (w.win !== null && (w.shot !== null || age >= 20 * HZ)) || (L && age > 0);
      if (!done) continue;
      watch.splice(i, 1);
      if (w.type === 'rel') {
        const k = w.win === w.team ? 'own' : w.win === 'regrab' ? 'regrab' : w.win === 'none' ? 'none' : 'opp'; T.relWin[k]++;
        if (w.shot && w.shot.t <= 8) { T.relFirstShotN++; if (w.shot.team !== w.team) T.relOppAttack++; else { T.relOwnShot++; T.relOwnShotT.push(w.shot.t); } }
      } else {
        const F = T.fo; F.n++;
        if (w.win === 'home' || w.win === 'away') F[w.win]++; else F.none++;
        if (w.center) { F.center++; if (w.win === 'home') F.centerHome++; if (w.win === 'away') F.centerAway++; }
        else if (w.win === 'home' || w.win === 'away') { F.zoneN++; if (w.win === w.def) F.def++; else F.att++; }
        if (w.scorer && (w.win === 'home' || w.win === 'away')) { F.afterGoalN++; if (w.win !== w.scorer) F.concWin++; }
        if (w.shot) { T.foShotN++; T.foShotT.push(w.shot.t); if (w.shot.team === w.win) T.foShotWinTeam++; }
      }
    }
  }
  lobbies.delete(l.id);
}

const med = a => { if (!a || !a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const avg = a => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, b) => 100 * a / Math.max(1, b);
const relN = T.rel.pass + T.rel.board, F = T.fo;
const R = {
  dead_pct: pct(T.dead, T.ticks),
  pause_goal_s: avg(T.pauses.goal), pause_freeze_s: avg(T.freezeTotal), pause_freeze_lock_s: avg(T.pauses.freeze),
  pause_out_s: avg(T.pauses.out), pause_icing_s: avg(T.pauses.icing), pause_offside_s: avg(T.pauses.offside),
  n_goal: (T.pauses.goal || []).length, n_freeze: (T.pauses.freeze || []).length, n_out: (T.pauses.out || []).length,
  n_icing: (T.pauses.icing || []).length, n_offside: (T.pauses.offside || []).length, n_other: Object.keys(T.pauses).filter(k => !['goal', 'freeze', 'out', 'icing', 'offside', 'start'].includes(k)).map(k => k + ':' + T.pauses[k].length).join(',') || '-',
  dead_goal_pct: pct(T.deadBy.goal || 0, T.dead), dead_freeze_pct: pct(T.deadBy.freeze || 0, T.dead), dead_out_pct: pct(T.deadBy.out || 0, T.dead), dead_rules_pct: pct((T.deadBy.icing || 0) + (T.deadBy.offside || 0), T.dead),
  held_pct: pct(T.holdTicks, T.ticks * 1), catches: T.catches,
  release_n: relN, release_pass_pct: pct(T.rel.pass, relN), release_board_pct: pct(T.rel.board, relN),
  freeze_try: T.rel.freezeTry, freeze_whistle: T.rel.freezeWhistle, freeze_denied: T.rel.freezeDenied,
  hold_vs_release_pct: pct(T.rel.freezeWhistle, T.rel.freezeWhistle + relN),
  release_own3_pct: pct(T.relWin.own, relN), release_loss3_pct: pct(T.relWin.opp, relN), release_none3_pct: pct(T.relWin.none, relN), release_regrab_pct: pct(T.relWin.regrab, relN),
  release_opp_attack_pct: pct(T.relOppAttack, relN), release_own_shot8_pct: pct(T.relOwnShot, relN), release_own_shot_med_s: med(T.relOwnShotT),
  fo_n: F.n, fo_home_pct: pct(F.home, F.home + F.away), fo_none_pct: pct(F.none, F.n), fo_center_home_pct: pct(F.centerHome, F.centerHome + F.centerAway),
  fo_zone_n: F.zoneN, fo_defzone_pct: pct(F.def, F.zoneN), fo_to_shot_med_s: med(T.foShotT), fo_shot_by_winner_pct: pct(T.foShotWinTeam, T.foShotN),
  fo_after_goal_conceder_pct: pct(F.concWin, F.afterGoalN),
  rel_mate_far_pct: pct(MATE.far, MATE.n), rel_mate_covered_pct: pct(MATE.cov, MATE.n),
  goals: T.goals, shots: T.shots,
};
if (ARG.json) { console.log(JSON.stringify(R, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v)); process.exit(0); }
const RUB = { dead_pct: v => v <= 15, pause_goal_s: v => v <= 2.5, pause_freeze_s: v => v <= 3.0, pause_out_s: v => v <= 2.5,
  release_loss3_pct: v => v <= 25, release_opp_attack_pct: v => v <= 30, fo_home_pct: v => Math.abs(v - 50) <= 10, fo_defzone_pct: v => Math.abs(v - 50) <= 15, fo_none_pct: v => v <= 10 };
const RT = { dead_pct: '≤ 15', pause_goal_s: '≤ 2,5', pause_freeze_s: '≤ 3,0', pause_out_s: '≤ 2,5', release_loss3_pct: '≤ 25', release_opp_attack_pct: '≤ 30', fo_home_pct: '50 ± 10', fo_defzone_pct: '50 ± 15', fo_none_pct: '≤ 10' };
console.log(`chain_restart: ${SEEDS} zápasů 2v2 × ${MIN} min, ${(T.ticks / HZ / 60).toFixed(1)} min simulace`);
for (const [k, v] of Object.entries(R)) console.log(`${k in RUB ? (RUB[k](v) ? 'OK  ' : 'NE  ') : 'info'} ${k.padEnd(24)} ${typeof v === 'number' ? v.toFixed(2).padStart(8) : String(v).padStart(8)}${k in RT ? `  (${RT[k]})` : ''}`);
process.exit(0);
