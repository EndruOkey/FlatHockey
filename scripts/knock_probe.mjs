// SONDA KNOCKBACKU — crosschecky, srážky hráčů a odstupňovaný knockback v zápasech botů 2v2 (deterministicky).
// Síla zásahu I = rychlost srážky po normále (rel. rychlost × cos úhlu), px/s; crosscheck + PLAYER.ccBonus.
// RUBRIKA PŘEDEM (2026-11-12, před laděním prahů):
//   heavy_min      0,3–2   rozplácnutí za minutu hry (ne spam, ale stane se)  → 2026-11-13 (designér: „ne tak často“): 0,1–0,25
//   mid_min        ≤ 4     zakolísání za minutu                                → 2026-11-13: ≤ 1,5
//   down_input_pct = 100   % ticků v leže bez zrychlení z vlastního vstupu (rychlost neroste v _move)
//   down_puck_pct  = 100   % ticků v leže bez puku
//   down_s         0,5–0,8 doba ležení (s)
//   heavy_min_I    ≥ kbHeavy (destruktivní jen při silném nárazu)
//   det            1       dva běhy = stejný otisk událostí
//   góly/zápas a střely: vliv mimo rubriku hlídá test/balance.mjs (FH_TEAM=2 i 3)
// node scripts/knock_probe.mjs [--seeds=12]   (FH_KBHEAVY=9999 FH_KBMID=9999 = bez stupňů, srovnání)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4699';
process.env.DB_PATH = join(tmpdir(), `fh-kp-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { PlayerBase } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const SEEDS = +(ARG.seeds || 12);

function run() {
  const A = { contacts: [], cc: 0, tiers: [0, 0, 0], heavyI: [], downTicks: 0, downNoInput: 0, downNoPuck: 0, downDur: [], liveT: 0, goals: 0, sig: 0 };
  let tick = 0; const touch = new Map();
  const _cw = PlayerBase.prototype.collideWith, _tc = PlayerBase.prototype.tryCrossCheck, _th = PlayerBase.prototype.takeHit, _mv = PlayerBase.prototype._move;
  PlayerBase.prototype.collideWith = function (o) {
    const dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy), key = this.id < o.id ? this.id + '|' + o.id : o.id + '|' + this.id;
    if (d < 2 * PLAYER.bodyRadius && d > 0 && this.team !== o.team) {
      const nx = dx / d, ny = dy / d, rel = (o.vx - this.vx) * nx + (o.vy - this.vy) * ny;
      if (!touch.has(key) || touch.get(key) < tick - 1) A.contacts.push(Math.max(0, -rel));
      touch.set(key, tick);
    }
    return _cw.call(this, o);
  };
  PlayerBase.prototype.tryCrossCheck = function (o) { const c0 = this._crossCheckCool; _tc.call(this, o); if (this._crossCheckCool > c0 + 0.5) A.cc++; };
  PlayerBase.prototype.takeHit = function (I, nx, ny) { const r = _th.call(this, I, nx, ny); A.tiers[r]++; if (r === 2) A.heavyI.push(I); A.sig = (A.sig * 31 + r * 7 + Math.round(I) + tick) >>> 0; return r; };
  PlayerBase.prototype._move = function (input, dt) {
    const wasDown = this._downT > dt * 1.5, sp0 = Math.hypot(this.vx, this.vy);   // celý tik v leže
    _mv.call(this, input, dt);
    if (wasDown) { A.downTicks++; if (Math.hypot(this.vx, this.vy) <= sp0 + 1e-9) A.downNoInput++; this._kpDown = (this._kpDown || 0) + 1; }
    else if (this._kpDown) { A.downDur.push((this._kpDown + 1) * dt); this._kpDown = 0; }
  };
  for (let s = 1; s <= SEEDS; s++) {
    const l = { id: 'KP' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
    for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    for (let t = 0; t < 5 * 3600; t++) {
      tick++; stepMatch(m); if (!(m.setup || m.stoppage)) A.liveT++;
      for (const p of m.players.values()) if (p._downT > 0 && p._downT < PLAYER.downT - 1e-9) { if (!p.hasPuck) A.downNoPuck++; else A.downPuckBad = (A.downPuckBad || 0) + 1; }
    }
    A.goals += m.score.home + m.score.away;
    lobbies.delete(l.id);
  }
  Object.assign(PlayerBase.prototype, { collideWith: _cw, tryCrossCheck: _tc, takeHit: _th, _move: _mv });
  return A;
}
const A = run(), B = run();
const min = A.liveT / 3600, cls = [...A.contacts].sort((a, b) => a - b), q = p => cls[Math.min(cls.length - 1, Math.floor(p * cls.length))] || 0;
const downPuckN = A.downNoPuck + (A.downPuckBad || 0);
const R = {
  contacts_min: A.contacts.length / min, cc_min: A.cc / min, I_q50: q(0.5), I_q90: q(0.9), I_q99: q(0.99),
  light_min: (A.contacts.length - A.tiers[1] - A.tiers[2]) / min, mid_min: A.tiers[1] / min, heavy_min: A.tiers[2] / min,
  heavy_min_I: A.heavyI.length ? Math.min(...A.heavyI) : PLAYER.kbHeavy,
  down_input_pct: A.downTicks ? 100 * A.downNoInput / A.downTicks : 100, down_puck_pct: downPuckN ? 100 * A.downNoPuck / downPuckN : 100,
  down_s: A.downDur.length ? A.downDur.reduce((a, b) => a + b, 0) / A.downDur.length : PLAYER.downT,
  goals_match: A.goals / SEEDS, det: A.sig === B.sig && A.tiers.join() === B.tiers.join() ? 1 : 0,
};
const RUB = { heavy_min: [0.1, 0.25], mid_min: [0, 1.5], down_input_pct: [100, 100], down_puck_pct: [100, 100], down_s: [0.5, 0.8], heavy_min_I: [PLAYER.kbHeavy, 1e9], det: [1, 1] };
let ok = true;
console.log(`live ${min.toFixed(1)} min, ${SEEDS} zápasů 2v2, prahy kbMid ${PLAYER.kbMid} kbHeavy ${PLAYER.kbHeavy}`);
for (const [k, v] of Object.entries(R)) { const r = RUB[k], pass = !r || (v >= r[0] - 1e-9 && v <= r[1] + 1e-9); if (!pass) ok = false;
  console.log(`${r ? (pass ? 'OK  ' : 'NE  ') : 'info'} ${k.padEnd(15)} ${v.toFixed(2).padStart(8)}${r ? `  (${r[0]}–${r[1] > 1e8 ? '∞' : r[1]})` : ''}`); }
console.log(ok ? 'RUBRIKA OK' : 'RUBRIKA NEPROŠLA'); process.exit(ok ? 0 : 1);
