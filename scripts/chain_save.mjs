// ŘETĚZEC ČÁST 2: PUK → BRANKÁŘ (zákrok). Typy zákroků, chycení vs. odraz, kam a jak rychle letí odrazy, nebezpečné odrazy,
// góly z dorážky, doba držení, soulad kresby (lapačka/vyrážečka/betony) s místem zásahu. Bot zápasy 2v2 + 3v3, deterministicky.
// Rubrika předem (2026-11-12, ODHAD cílových pásem z hokejové praxe, ne z dat):
//   R1 caught_pct (chyceno+přikryto ze zákroků na letící puk) 35–65 · R2 danger_pct (odraz → slot ≤ 60 px a útočník do 1 s) 8–25
//   R3 rebound_goal_pct (gól do 2 s po odrazu, z odrazů) 2–10 · R4 reb_speed_med 60–160 px/s · R5 instant_cover_pct (odraz přikrytý týž tick) ≤ 10
//   R6 hand_mismatch_pct (lapačka/vyrážečka: puk blíž k druhé ruce) ≤ 10 · R7 hand_far_med_px (střed ruky ↔ místo zásahu) ≤ 8 · R8 hold_med_s 0,6–2,0
// node scripts/chain_save.mjs [--seeds=6] [--min=5] [--sizes=2,3]
import { tmpdir } from 'os'; import { join } from 'path'; import { createHash } from 'crypto';
process.env.PORT = process.env.PORT || '4699';
process.env.DB_PATH = join(tmpdir(), `fh-cs-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { RINK, PUCK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Goalie, goalieGeom } = await import('../public/js/entities/Goalie.js');
const { Player } = await import('../public/js/entities/Player.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const DT = 1 / 60, DROP_T = 0.12, SEEDS = +(ARG.seeds || 6), MIN = +(ARG.min || 5), SIZES = String(ARG.sizes || '2,3').split(',').map(Number);
const GY = RINK.goalY + RINK.goalH / 2, HALF = RINK.goalH / 2;
const SLOT_D = 60, SLOT_W = HALF + 8;   // slot: do 60 px před brankovou čárou, |dy| ≤ 30 px (šířka ODHAD)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lineX = g => g.side === 'left' ? RINK.goalLineLeft : RINK.goalLineRight;
const inSlot = (g, x, y) => { const d = (x - lineX(g)) * g.inX; return d >= 0 && d <= SLOT_D && Math.abs(y - GY) <= SLOT_W; };

// póza rukou ve světě — přesně jako Goalie.draw (stejně jako goalie_anim_metrics.mjs)
function hands(g) {
  const holding = g._holdTimer > 0, st = holding ? 'cover' : g.stance;
  const spread = clamp(Math.abs(g._vy) / 110, 0, 1), drop = g.stance === 'stand' ? 1 : Math.min(1, g._stanceT / DROP_T);
  const G = goalieGeom(st, g._side, spread, drop), A = g._a;
  if (A && st !== 'cover') { G.handX += A.hx; G.gloveY += A.gy; G.blockY += A.by; }
  const rec = g._saveRecoil * g._saveRecoilX + (A ? A.rec * 1.5 : 0), c = Math.cos(g._tilt || 0), s = Math.sin(g._tilt || 0);
  const W = (x, y) => [g.x - g.inX * (G.bodyX + rec + x * c - y * s), g.y + G.bodyY + x * s + y * c];
  return { glove: W(G.handX, G.gloveY), block: W(G.handX, G.blockY) };
}

// ── háčky: kontext volání → _markSave zapíše událost
let CTX = null, TICK = 0, EV = [];
const _ms = Goalie.prototype._markSave;
Goalie.prototype._markSave = function (type, dur) { if (CTX && CTX.g === this) CTX.types.push(type); return _ms.call(this, type, dur); };
const wrap = (name, kind) => { const f = Goalie.prototype[name]; Goalie.prototype[name] = function (puck, ...a) {
  const p = puck && puck.x !== undefined ? puck : a[0];   // pokeCheck(player, puck)
  const pre = p ? { x: p.x, y: p.y, z: p.z || 0, vx: p.vx, vy: p.vy, px: p.prevX ?? p.x, py: p.prevY ?? p.y } : null;
  const held = this._holdTimer > 0, stance = this.stance, side = this._side;
  CTX = { g: this, types: [] }; const r = f.call(this, puck, ...a); const types = CTX.types; CTX = null;
  if (!held && types.length) EV.push({ kind, type: types[types.length - 1], g: this, pre, post: p ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy } : null, stance, side, t: TICK });
  return r; }; };
wrap('blockPuck', 'block'); wrap('controlLoosePuck', 'loose'); wrap('pokeCheck', 'poke');
let SHOOTERS = [];
const _sh = Player.prototype.shoot;
Player.prototype.shoot = function (...a) { SHOOTERS.push(this); return _sh.apply(this, a); };

const pct = (a, b) => 100 * a / Math.max(1, b);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : 0; };

function run(size) {
  const R = { save: 0, types: {}, caught: 0, defl: 0, instCover: 0, danger: 0, rebGoal: 0, anyGoal2: 0, goals: 0, ang: [], spd: [], dist: [], firstTouch: { att: 0, def: 0, goalie: 0, none: 0 },
    hold: [], snap: [], off: [], freeze: 0, handN: 0, handBad: 0, handDist: [], hiPads: 0, lowN: 0, loose: 0, poke: 0, hash: createHash('sha1') };
  for (let s = 1; s <= SEEDS; s++) {
    const l = { id: `CS${size}-${s}`, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: s - 1 };
    for (let i = 0; i < size; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    const open = [];   // sledované odrazy
    const holdT = new Map([[m.goalieL, 0], [m.goalieR, 0]]), froze = new Map();
    for (let t = 0; t < MIN * 3600; t++) {
      TICK = t; EV = []; SHOOTERS = [];
      const sc0 = { h: m.score?.home ?? 0, a: m.score?.away ?? 0 }, pk = { x: m.puck.x };
      stepMatch(m);
      const scored = (m.score?.home ?? 0) + (m.score?.away ?? 0) > sc0.h + sc0.a;
      const goalG = scored ? (pk.x > RINK.w / 2 ? m.goalieR : m.goalieL) : null;
      if (scored) R.goals++;
      // nové události
      for (const e of EV) {
        if (e.kind === 'loose') { R.loose++; const o = open.find(o => o.g === e.g && o.t0 === t); if (o) { o.inst = true; R.instCover++; } continue; }
        if (e.kind === 'poke') { R.poke++; continue; }
        if (Math.hypot(e.pre.vx, e.pre.vy) <= 60) continue;   // jen zákrok na letící puk
        R.save++; R.types[e.type] = (R.types[e.type] || 0) + 1;
        const g = e.g, high = e.pre.z > PUCK.gloveHeight;
        // místo zásahu: průsečík dráhy s rovinou gólmana (jinak poloha před voláním)
        let iy = e.pre.y; const den = e.pre.x - e.pre.px; if (Math.abs(den) > 1e-6) { const k = (g.x - e.pre.px) / den; if (k >= 0 && k <= 1) iy = e.pre.py + (e.pre.y - e.pre.py) * k; }
        if (e.type === 'glove' || e.type === 'blocker') {
          const H = hands(g), dG = Math.abs(H.glove[1] - iy), dB = Math.abs(H.block[1] - iy);
          R.handN++; if ((e.type === 'glove' ? dG : dB) > (e.type === 'glove' ? dB : dG)) R.handBad++;
          const hp = e.type === 'glove' ? H.glove : H.block; R.handDist.push(Math.abs(hp[1] - iy));   // svisle (shora je to osa, podle které oko čte stranu)
        }
        if (e.type === 'pads') { R.lowN++; if (high) R.hiPads++; }
        if (e.type === 'glove' || e.type === 'cover') { R.caught++; continue; }   // cover = přízemní puk přikrytý přímo ze zákroku
        R.defl++;
        const v = e.post, ang = Math.atan2(v.vy, v.vx * g.inX) * 180 / Math.PI, sp = Math.hypot(v.vx, v.vy);
        R.ang.push(Math.abs(ang)); R.spd.push(sp); R.snap.push(Math.abs(v.y - iy)); R.off.push(Math.abs(iy - g.y));
        open.push({ g, t0: t, x0: v.x, y0: v.y, danger: false, touched: false, inst: false, done: false });
      }
      // sledování odrazů
      const carrier = [...m.players.values()].find(p => p.hasPuck);
      for (const o of open) {
        if (o.done) continue;
        const dt = (t - o.t0) * DT;
        if (dt > 0 && !o.touched) {
          const who = o.g.isHolding ? 'goalie' : carrier ? (carrier.team === o.g.team ? 'def' : 'att') : null;
          const sh = SHOOTERS.find(p => p.team !== o.g.team);
          if (who || sh || Math.hypot(m.puck.vx, m.puck.vy) < 5 || dt >= 2 || m.stoppage) {
            o.touched = true; R.firstTouch[who || (sh ? 'att' : 'none')]++; R.dist.push(Math.hypot(m.puck.x - o.x0, m.puck.y - o.y0));
          }
          if ((who === 'att' || sh) && dt <= 1 && inSlot(o.g, m.puck.x, m.puck.y)) o.danger = true;
        } else if (dt > 0 && dt <= 1 && !o.danger && carrier && carrier.team !== o.g.team && inSlot(o.g, m.puck.x, m.puck.y)) o.danger = true;
        if (scored && goalG === o.g && dt <= 2) { R.rebGoal++; o.done = true; }
        if (dt > 2) o.done = true;
        if (o.done || dt > 2) { if (o.danger) R.danger++; o.counted = true; }
      }
      for (let i = open.length - 1; i >= 0; i--) if (open[i].counted) open.splice(i, 1);
      // držení
      for (const g of [m.goalieL, m.goalieR]) {
        if (g._heldPuck) holdT.set(g, holdT.get(g) + DT);
        else if (holdT.get(g) > 0) { R.hold.push(holdT.get(g)); holdT.set(g, 0); }
        if (g._froze && !froze.get(g)) R.freeze++; froze.set(g, !!g._froze);
      }
      if (t % 60 === 0) R.hash.update(`${m.puck.x.toFixed(3)},${m.puck.y.toFixed(3)};`);
    }
    for (const o of open) if (o.danger) R.danger++;
    lobbies.delete(l.id);
  }
  return R;
}

const RUB = { caught_pct: [35, 65], danger_pct: [8, 25], rebound_goal_pct: [2, 10], reb_speed_med: [60, 160], instant_cover_pct: [0, 10], hand_mismatch_pct: [0, 10], hand_far_med_px: [0, 8], hold_med_s: [0.6, 2.0] };
for (const size of SIZES) {
  const R = run(size);
  const out = {
    saves: R.save, goals: R.goals,
    glove_pct: pct(R.types.glove || 0, R.save), blocker_pct: pct(R.types.blocker || 0, R.save), pads_pct: pct(R.types.pads || 0, R.save),
    caught_pct: pct(R.caught + R.instCover, R.save), deflect_pct: pct(R.defl - R.instCover, R.save), instant_cover_pct: pct(R.instCover, R.defl),
    ang_0_15: pct(R.ang.filter(a => a < 15).length, R.ang.length), ang_15_45: pct(R.ang.filter(a => a >= 15 && a < 45).length, R.ang.length), ang_45_90: pct(R.ang.filter(a => a >= 45).length, R.ang.length),
    reb_speed_med: med(R.spd), reb_speed_p90: q(R.spd, 0.9), reb_snap_med_px: med(R.snap), reb_snap_p90_px: q(R.snap, 0.9), hit_off_med_px: med(R.off), reb_dist_med: med(R.dist), reb_dist_p90: q(R.dist, 0.9),
    first_att_pct: pct(R.firstTouch.att, R.defl), first_def_pct: pct(R.firstTouch.def, R.defl), first_goalie_pct: pct(R.firstTouch.goalie, R.defl), first_none_pct: pct(R.firstTouch.none, R.defl),
    danger_pct: pct(R.danger, R.defl), rebound_goal_pct: pct(R.rebGoal, R.defl), rebound_goal_share: pct(R.rebGoal, R.goals),
    hold_med_s: med(R.hold), hold_p90_s: q(R.hold, 0.9), freezes: R.freeze, loose_covers: R.loose, pokes: R.poke,
    hand_mismatch_pct: pct(R.handBad, R.handN), hand_far_med_px: med(R.handDist), high_on_pads_pct: pct(R.hiPads, R.lowN),
  };
  console.log(`\n== ${size}v${size} · ${SEEDS} seedů × ${MIN} min · hash ${R.hash.digest('hex').slice(0, 12)}`);
  for (const [k, v] of Object.entries(out)) { const r = RUB[k]; console.log(`${r ? (v >= r[0] && v <= r[1] ? 'OK  ' : 'NE  ') : 'info'} ${k.padEnd(20)} ${v.toFixed(2).padStart(8)}${r ? `  (${r[0]}–${r[1]})` : ''}`); }
}
process.exit(0);
