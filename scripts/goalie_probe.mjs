// SONDA BRANKÁŘE — co „blbne“: poloha vůči ústí, vyjíždění, škubání, skoky, střídání postojů (bot zápasy 2v2, deterministicky).
// Rubrika předem (2026-11-12): body_out_pct ≤ 1 · out_mouth_pct ≤ 5 · in_net_pct ≤ 1 · jitter_rev_s ≤ 1,5 · jumps ≤ 0 (mimo buly) · stance_flips_s ≤ 1,2 · far_out_pct ≤ 3
// node scripts/goalie_probe.mjs [--seeds=6]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4697';
process.env.DB_PATH = join(tmpdir(), `fh-gp-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { RINK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const GY = RINK.goalY + RINK.goalH / 2, HALF = RINK.goalH / 2, DT = 1 / 60;
const A = { dekeN: 0, dekeOk: 0, dekeFlip: 0, bodyOut: 0, n: 0, outMouth: 0, inNet: 0, farOut: 0, rev: 0, jumps: 0, flips: 0, live: 0, maxOut: 0, maxDepth: 0 };
const SEEDS = +(ARG.seeds || 6);
// Nakreslený obrys brankáře (px od středu, změřeno po pixelech ze skinGoalie, 2026-11-12): up/down/front
const SIL = { stand: [12.7, 12.3, 13.4], butterfly: [17.5, 17.4, 12.9], 'rvh+': [11.5, 18.1, 11.9], 'rvh-': [18.2, 11.4, 11.9], 'stretch+': [9, 25, 11.9], 'stretch-': [25.1, 8.9, 11.9], cover: [17.5, 21.7, 13.9] };
const sil = g => SIL[g.stance] || SIL[g.stance + (g._side > 0 ? '+' : '-')] || SIL.stand;
const S = { saves: 0, phantom: 0, phantomPx: [], goals: 0, ghost: 0 };
const { Goalie } = await import('../public/js/entities/Goalie.js');
const _bp = Goalie.prototype.blockPuck;
Goalie.prototype.blockPuck = function (puck, world) {
  const held = this._holdTimer > 0, r = _bp.call(this, puck, world);
  if (r && !held && Math.hypot(puck.vx, puck.vy) > 60 && !this._probeT) {   // nový zákrok na letící puk
    this._probeT = 20; S.saves++;
    const [up, dn, fr] = sil(this), dy = puck.y - this.y, dx = (puck.x - this.x) * this.inX * -1;   // dx > 0 = před brankářem
    const outY = dy < 0 ? -dy - (up + 3 + 1) : dy - (dn + 3 + 1), outX = dx - (fr + 3 + 1);
    const out = Math.max(outY, outX); if (out > 0) { S.phantom++; S.phantomPx.push(out); }
  }
  return r;
};
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'GP' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const prev = new Map();
  for (let t = 0; t < 5 * 3600; t++) {
    const sc0 = (m.score?.home ?? 0) + (m.score?.away ?? 0); const pk = { x: m.puck.x, y: m.puck.y };
    stepMatch(m);
    for (const g of [m.goalieL, m.goalieR]) if (g._probeT) g._probeT--;
    if (((m.score?.home ?? 0) + (m.score?.away ?? 0)) > sc0) { S.goals++; const g = pk.x > RINK.w / 2 ? m.goalieR : m.goalieL; const [up, dn] = sil(g), dy = pk.y - g.y;
      if ((dy < 0 ? -dy < up - 3 : dy < dn - 3) && Math.abs(pk.x - g.x) < 10) S.ghost++; }
    const live = !(m.setup || m.stoppage);
    for (const g of [m.goalieL, m.goalieR]) {
      const lineX = g.side === 'left' ? RINK.goalLineLeft : RINK.goalLineRight, inX = g.side === 'left' ? 1 : -1;
      const pv = prev.get(g); prev.set(g, { x: g.x, y: g.y, vy: g.y - (pv ? pv.y : g.y), st: g.stance });
      if (!live || !pv) continue;
      A.n++;
      if (Math.abs(g.y - GY) > HALF - 8) A.bodyOut++;   // tělo (±11,5 px) přečnívá přes tyčku o víc než beton
      const dyM = Math.abs(g.y - GY) - HALF; if (dyM > 0) { A.outMouth++; A.maxOut = Math.max(A.maxOut, dyM); }
      const depth = (g.x - lineX) * inX;   // > 0 = před brankovou čárou (do hřiště), < 0 = v brance
      if (depth < -2) A.inNet++;
      if (depth > 30) A.farOut++;
      A.maxDepth = Math.max(A.maxDepth, depth);
      const vy = g.y - pv.y; if (Math.abs(vy) > 0.15 && Math.abs(pv.vy) > 0.15 && Math.sign(vy) !== Math.sign(pv.vy)) A.rev++;
      if (Math.hypot(g.x - pv.x, g.y - pv.y) > 6) A.jumps++;
      if (g.stance !== pv.st) A.flips++;
      { const inX2 = g.side === 'left' ? 1 : -1; const c = [...m.players.values()].find(p => p.hasPuck && p.team !== g.team);
        if (c && (c.x - lineX) * inX2 > 0 && Math.hypot(c.x - g.x, c.y - g.y) < 90 && Math.abs(c.vy || 0) > 90) {   // klička zblízka
          A.dekeN++; if (g.stance === 'stretch' || g.stance === 'butterfly') A.dekeOk++; if (g.stance !== pv.st) { if ((pv.st === 'stretch' || pv.st === 'butterfly') && g.stance === 'stand') A.dekeFlip++;   // cuknutí = opuštění rozkleku (vstup je správná reakce)
            const k = pv.st + '>' + g.stance; (A.tr ||= {})[k] = (A.tr[k] || 0) + 1; } } }
    }
  }
  lobbies.delete(l.id);
}
const sec = A.n * DT, R = {
  body_out_pct: 100 * A.bodyOut / A.n, out_mouth_pct: 100 * A.outMouth / A.n, max_out_px: A.maxOut, in_net_pct: 100 * A.inNet / A.n, far_out_pct: 100 * A.farOut / A.n, max_depth_px: A.maxDepth,
  jitter_rev_s: A.rev / sec, jumps: A.jumps, stance_flips_s: A.flips / sec,
};
// deke_flips_s = opuštění rozkleku/motýlku do stoje za s kličky (opraveno 2026-11-12: dřív počítalo i vstup do rozkleku)
R.deke_split_pct = 100 * A.dekeOk / Math.max(1, A.dekeN); R.deke_flips_s = A.dekeFlip / Math.max(1e-9, A.dekeN * DT); R.deke_s = A.dekeN * DT;
R.phantom_save_pct = 100 * S.phantom / Math.max(1, S.saves); R.phantom_med_px = S.phantomPx.sort((a, b) => a - b)[S.phantomPx.length >> 1] || 0; R.ghost_goal_pct = 100 * S.ghost / Math.max(1, S.goals); R.saves = S.saves; R.goals = S.goals;
const RUB = { deke_split_pct: -70, deke_flips_s: 2, phantom_save_pct: 10, ghost_goal_pct: 10, body_out_pct: 1, out_mouth_pct: 5, in_net_pct: 1, far_out_pct: 3, jitter_rev_s: 1.5, jumps: 0, stance_flips_s: 1.2 };
for (const [k, v] of Object.entries(R)) console.log(`${(k in RUB ? ((RUB[k] < 0 ? v >= -RUB[k] : v <= RUB[k]) ? 'OK  ' : 'NE  ') : 'info')} ${k.padEnd(16)} ${v.toFixed(2).padStart(8)}${k in RUB ? (RUB[k] < 0 ? `  (≥ ${-RUB[k]})` : `  (≤ ${RUB[k]})`) : ''}`);
if (process.env.GP_TR) console.log(JSON.stringify(A.tr));
process.exit(0);
