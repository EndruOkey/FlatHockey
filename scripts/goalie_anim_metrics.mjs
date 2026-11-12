// ŽIVOST BRANKÁŘE (animace) — jak moc se hýbou ruce/hokejka/pady vůči tělu (bot zápasy 2v2, deterministicky, bez canvasu).
// Polohy přesně jako draw() + skinGoalie: G = goalieGeom(holding ? 'cover' : stance, _side, spread=|_vy|/110, drop=_stanceT/DROP_T),
// bm = translate(bodyX + _saveRecoil*_saveRecoilX, bodyY) · rotate(_tilt); lapačka = bm·(handX, gloveY), vyrážečka = bm·(handX, blockY),
// hokejka (čepel) = stk.b1 bez bm (skin.js ř. 170–171); svět: X = g.x − inX·lx, Y = g.y + ly (ctx.scale(−inX, 1)).
// „Vůči tělu“ = vůči středu brankáře (g.x, g.y): měří jen animaci, ne posun po brankovišti.
// node scripts/goalie_anim_metrics.mjs [--seeds=6] [--min=5]
import { tmpdir } from 'os'; import { join } from 'path'; import { createHash } from 'crypto';
process.env.PORT = process.env.PORT || '4698';
process.env.DB_PATH = join(tmpdir(), `fh-gam-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { RINK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Goalie, goalieGeom } = await import('../public/js/entities/Goalie.js');
const { Player } = await import('../public/js/entities/Player.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const DT = 1 / 60, DROP_T = 0.12, SEEDS = +(ARG.seeds || 6), MIN = +(ARG.min || 5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── póza v lokálu brankáře (−X = k puku) → relativní světové souřadnice
function pose(g) {
  const holding = g._holdTimer > 0, st = holding ? 'cover' : g.stance;
  const spread = clamp(Math.abs(g._vy) / 110, 0, 1), drop = g.stance === 'stand' ? 1 : Math.min(1, g._stanceT / DROP_T);
  const G = goalieGeom(st, g._side, spread, drop), A = g._a, holdA = st === 'cover';
  if (A && !holdA) { G.handX += A.hx; G.gloveY += A.gy; G.blockY += A.by; G.bodyScale *= 1 - 0.05 * A.crouch;   // animace = stejně jako Goalie.draw
    if (A.kick > 0) for (const pd of G.pads) if (Math.sign(pd.ky || pd.dir) === (A.stepSide || 1)) pd.kx -= 1.2 * A.kick; }
  const rec = g._saveRecoil * g._saveRecoilX + (A ? A.rec * 1.5 : 0), c = Math.cos(g._tilt || 0), s = Math.sin(g._tilt || 0);
  const bm = (x, y) => [G.bodyX + rec + x * c - y * s, G.bodyY + x * s + y * c];
  const W = ([x, y]) => [-g.inX * x, y];
  let b1;   // hokejka — skin.js: stk
  if (st === 'cover') b1 = [-6.5, 19.5];
  else { const hx = G.handX + G.bodyX, hy = G.blockY + G.bodyY, bx = Math.min(hx - 5, -9); b1 = [bx - 0.6, hy * 0.55 - 7.5 * Math.sign(hy || 1)]; }
  const padTip = p => { const a = p.angle * p.dir, yy = p.dir > 0 ? p.ph : -p.ph; return [p.kx - yy * Math.sin(a), p.ky + yy * Math.cos(a)]; };
  return { glove: W(bm(G.handX, G.gloveY)), block: W(bm(G.handX, G.blockY)), stick: W(b1), pad0: W(padTip(G.pads[0])), pad1: W(padTip(G.pads[1])),
    body: W([G.bodyX + rec, G.bodyY]), st, geo: [G.handX, G.gloveY, G.blockY] };   // geo = póza rukou bez natočení/odskoku
}

// ── výstřely (Player.shoot) a zákroky (_markSave)
const SHOTS = [];
const _sh = Player.prototype.shoot;
Player.prototype.shoot = function (puck, ...a) { const r = _sh.call(this, puck, ...a); SHOTS.push({ vx: puck.vx, vy: puck.vy, x: puck.x }); return r; };
let saves = 0; const _ms = Goalie.prototype._markSave;
Goalie.prototype._markSave = function (...a) { saves++; return _ms.apply(this, a); };

const A = { n: 0, still: 0, vG: [], vB: [], vS: [], vP: [], vBody: [], flips: 0, lat: [], noReact: 0, latG: [], noReactG: 0, shots: 0, ampG: [], ampB: [], ampS: [] };
const sp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) / DT;
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'GA' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const st = new Map();   // g → { prev, pend: [{t0, ref}], ep: {gx,gy,..} }
  for (const g of [m.goalieL, m.goalieR]) st.set(g, { prev: null, pend: [], ep: null });
  for (let t = 0; t < MIN * 3600; t++) {
    SHOTS.length = 0;
    stepMatch(m);
    const live = !(m.setup || m.stoppage);
    for (const g of [m.goalieL, m.goalieR]) {
      const S = st.get(g), P = pose(g), prev = S.prev; S.prev = P;
      if (!live || !prev) { S.pend = []; S.ep = null; continue; }
      A.n++;
      const vg = sp(P.glove, prev.glove), vb = sp(P.block, prev.block);
      A.vG.push(vg); A.vB.push(vb); A.vS.push(sp(P.stick, prev.stick)); A.vP.push((sp(P.pad0, prev.pad0) + sp(P.pad1, prev.pad1)) / 2); A.vBody.push(sp(P.body, prev.body));
      if (vg < 1 && vb < 1) A.still++;
      if (P.st !== prev.st) A.flips++;
      // výstřel na tuto branku: puk > 250 px/s směrem k brance (−inX)
      for (const sh of SHOTS) if (Math.hypot(sh.vx, sh.vy) > 250 && Math.sign(sh.vx) === -g.inX) { A.shots++; S.pend.push({ t0: t, ref: prev, a: 1, b: 1 }); }
      S.pend = S.pend.filter(q => {   // a = jakýkoli pohyb rukou (vč. natočení), b = změna pózy (geomerie rukou / postoj, bez natočení)
        const age = t - q.t0, ms = (age + 1) * DT * 1000;
        if (q.a && (P.st !== q.ref.st || d(P.glove, q.ref.glove) > 1 || d(P.block, q.ref.block) > 1)) { A.lat.push(ms); q.a = 0; }
        if (q.b && (P.st !== q.ref.st || Math.abs(P.geo[0] - q.ref.geo[0]) + Math.abs(P.geo[1] - q.ref.geo[1]) + Math.abs(P.geo[2] - q.ref.geo[2]) > 1)) { A.latG.push(ms); q.b = 0; }
        if (age >= 59) { if (q.a) A.noReact++; if (q.b) A.noReactG++; return false; }
        return q.a || q.b;
      });
      // útok: puk v obranném pásmu této branky
      const inZone = g.side === 'left' ? m.puck.x < RINK.blueLineLeft : m.puck.x > RINK.blueLineRight;
      if (inZone) {
        const e = S.ep || (S.ep = { n: 0, b: { glove: [1e9, -1e9, 1e9, -1e9], block: [1e9, -1e9, 1e9, -1e9], stick: [1e9, -1e9, 1e9, -1e9] } });
        e.n++; for (const k of ['glove', 'block', 'stick']) { const bb = e.b[k], p = P[k]; bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.max(bb[1], p[0]); bb[2] = Math.min(bb[2], p[1]); bb[3] = Math.max(bb[3], p[1]); }
      } else if (S.ep) {
        if (S.ep.n >= 30) for (const [k, arr] of [['glove', A.ampG], ['block', A.ampB], ['stick', A.ampS]]) { const bb = S.ep.b[k]; arr.push(Math.hypot(bb[1] - bb[0], bb[3] - bb[2])); }
        S.ep = null;
      }
    }
  }
  lobbies.delete(l.id);
}
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const liveMin = A.n * DT / 60;   // součet za oba brankáře
const R = {
  glove_v_mean: mean(A.vG), glove_v_p95: q(A.vG, 0.95), blocker_v_mean: mean(A.vB), blocker_v_p95: q(A.vB, 0.95),
  stick_v_mean: mean(A.vS), pads_v_mean: mean(A.vP), body_v_mean: mean(A.vBody),
  glove_amp_med: q(A.ampG, 0.5), blocker_amp_med: q(A.ampB, 0.5), stick_amp_med: q(A.ampS, 0.5), attacks: A.ampG.length,
  hands_still_pct: 100 * A.still / Math.max(1, A.n),
  react_ms_med: q(A.lat, 0.5), react_ms_p90: q(A.lat, 0.9), no_react_pct: 100 * A.noReact / Math.max(1, A.shots),
  pose_react_ms_med: q(A.latG, 0.5), pose_react_ms_p90: q(A.latG, 0.9), pose_no_react_pct: 100 * A.noReactG / Math.max(1, A.shots), shots: A.shots,
  stance_changes_min: A.flips / Math.max(1e-9, liveMin), saves, live_goalie_mins: liveMin,
};
const UNIT = { _v_: 'px/s', _amp_: 'px', _pct: '%', _ms_: 'ms', _min: '/min' };
for (const [k, v] of Object.entries(R)) console.log(`${k.padEnd(20)} ${v.toFixed(2).padStart(9)}  ${Object.entries(UNIT).find(([u]) => k.includes(u))?.[1] || ''}`);
console.log('hash', createHash('sha1').update(JSON.stringify(R)).digest('hex').slice(0, 12));
process.exit(0);
