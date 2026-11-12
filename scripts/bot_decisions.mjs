// Rozhodování botů s pukem (server sim, seedy 1..S, 5 min, FH_TEAM hráčů na tým). Deterministické.
// Použití: node scripts/bot_decisions.mjs [S=8] [seedOffset=0]     (FH_TEAM=2|3)
//  křivost  = délka dráhy nosiče / posun (držení ≥ 1 s, posun > 40 px), medián
//  blok %   = střely, kde soupeřův bruslař (ne gólman) je do BLOCK_R px od úsečky čepel→cíl
//  zóna→st. = % útočných držení týmu (vstup do útočné třetiny → ztráta/přerušení), během kterých tým vystřelil
//  resety   = geometricky (i nechtěné): nosič v útočné třetině ujede ≥ 70 px zpět k modré NEBO je ≥ 0,5 s za brankovou čarou
//  plány nosiče/min = záměrná rozhodnutí bota (b.stats): reset / cyklus / kraj / klička od hole / zrušený nápřah
//  FH_DIAG=1 → navíc konverze podle výšky/vzdálenosti/postoje gólmana, krádeže podle plánu, křivost podle délky držení
//  entropie = Shannon (bity) nad rozhodnutími v útočné třetině: střela / pas / kličkování / reset (max 2,0)
//  ostrý úhel = % střel s úhlem od osy branky > 55°
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4635'; process.env.DB_PATH = join(tmpdir(), `fh-dec-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const S = +(process.argv[2] || 8), OFF = +(process.argv[3] || 0), TEAM = +(process.env.FH_TEAM || 2);
const CY = RINK.goalY + RINK.goalH / 2, BLOCK_R = 16;
const T = { min: 0, tort: [], shots: 0, blocked: 0, sharp: 0, zp: 0, zpShot: 0, resets: 0, passes: 0, dangle: 0, goals: 0, lift: { hi: 0, lo: 0 }, list: [], bs: {}, lost: {}, st: {}, tl: [], short: 0 };
let M = null;
const origSteal = Player.prototype.stealFrom;
Player.prototype.stealFrom = function (c, pk) {
  if (M && c && c.brain) {
    const dir = c.team === 'home' ? 1 : -1, gx = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft;
    const zone = Math.abs(gx - c.x) < 330 ? 'Z' : 'N';
    const k = zone + ':' + ((c.charge || 0) > 0.05 ? 'charge' : (c.brain.plan && c.brain.plan.kind) || 'none');
    T.st[k] = (T.st[k] || 0) + 1;
  }
  return origSteal.call(this, c, pk);
};
const origShoot = Player.prototype.shoot;
Player.prototype.shoot = function (puck, charge, perfect) {
  if (M && this.isBot) {
    const dir = this.team === 'home' ? 1 : -1, gx = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft;
    const tip = this.stickTip, b = this.brain || {}, ty = b.shotY ?? CY;
    const sx = gx - tip.x, sy = ty - tip.y, L2 = sx * sx + sy * sy || 1;
    let blk = false;
    for (const o of M.players.values()) {
      if (o.team === this.team) continue;
      const u = ((o.x - tip.x) * sx + (o.y - tip.y) * sy) / L2;
      if (u <= 0 || u >= 1) continue;
      if (Math.hypot(tip.x + sx * u - o.x, tip.y + sy * u - o.y) < BLOCK_R) { blk = true; break; }
    }
    T.shots++; if (blk) T.blocked++;
    if (Math.atan2(Math.abs(CY - tip.y), Math.abs(gx - tip.x)) > 55 * Math.PI / 180) T.sharp++;
    if (charge >= 0.6) T.lift.hi++; else T.lift.lo++;
    if (M._zp && M._zp.team === this.team) M._zp.shot = true;
    T.list.push({ team: this.team, t: M.tick, hi: charge >= 0.6, d: Math.hypot(gx - tip.x, CY - tip.y), v: Math.hypot(this.vx, this.vy), g: 0, blk, st: b.lastStance || '?' });
  }
  return origShoot.call(this, puck, charge, perfect);
};
for (let s = 1 + OFF; s <= S + OFF; s++) {
  const l = { id: 'bd' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < TEAM; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < TEAM; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = M = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let cur = null, path = null, prevC = null, gh = 0, ga = 0;
  const endZp = () => { if (m._zp) { T.zp++; if (m._zp.shot) T.zpShot++; else { const k = m._zp.last || '-'; T.lost[k] = (T.lost[k] || 0) + 1; } m._zp = null; } };
  const close = () => { if (path && path.n < 60) T.short++; if (path && path.n >= 60) { const d = Math.hypot(path.x - path.x0, path.y - path.y0); if (d > 40) { T.tort.push(path.len / d); T.tl.push([path.n, path.len / d, d]); } } path = null; };
  while (!m.ended) {
    stepMatch(m);
    for (const [tm, dd] of [['home', m.score.home - gh], ['away', m.score.away - ga]]) if (dd > 0) { for (let i = T.list.length - 1; i >= 0; i--) { const q = T.list[i]; if (q.team === tm && m.tick - q.t < 240) { q.g = 1; break; } } }
    T.goals += (m.score.home - gh) + (m.score.away - ga); gh = m.score.home; ga = m.score.away;
    if (m.setup || m.stoppage || m.world._goalLock) { close(); endZp(); cur = prevC = null; continue; }
    T.min += 1 / 3600;
    const C = [...m.players.values()].find(p => p.hasPuck);
    if (C && prevC && C !== prevC && C.team === prevC.team) T.passes++;
    if (C) prevC = C;
    if (C && m._zp && m._zp.team !== C.team) endZp();
    if (C !== cur) {
      close(); cur = C;
      if (C) path = { x0: C.x, y0: C.y, x: C.x, y: C.y, len: 0, n: 0, deep: -1, behindT: 0, reset: false, latT: 0 };
    }
    if (C && path) {
      path.len += Math.hypot(C.x - path.x, C.y - path.y); path.x = C.x; path.y = C.y; path.n++;
      const dir = C.team === 'home' ? 1 : -1, gx = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft;
      const att = dir > 0 ? C.x > RINK.w * 2 / 3 : C.x < RINK.w / 3;
      if (att) {
        if (!m._zp) m._zp = { team: C.team, shot: false };
        if (m._zp.team === C.team) m._zp.last = (C.brain.plan && C.brain.plan.kind) || 'none';
        const depth = C.x * dir;                         // čím víc, tím hlouběji v pásmu
        if (depth > path.deep) path.deep = depth;
        const behind = (C.x - gx) * dir > 2;
        path.behindT = behind ? path.behindT + 1 : 0;
        if (!path.reset && (path.deep - depth > 70 || path.behindT === 30)) { path.reset = true; T.resets++; }
        // kličkování: boční rychlost výrazně převažuje nad dopřednou (≥ 0,5 s v kuse) a je to nosič s pukem
        if (Math.abs(C.vy) > 60 && Math.abs(C.vy) > 1.5 * Math.abs(C.vx)) { if (++path.latT === 30) T.dangle++; } else path.latT = 0;
      }
    }
  }
  close(); endZp(); lobbies.delete(l.id);
  for (const p of m.players.values()) for (const [k, v] of Object.entries(p.brain.stats || {})) T.bs[k] = (T.bs[k] || 0) + v;
}
M = null;
const f = (x, n = 2) => x.toFixed(n), med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
const cnt = [T.shots, T.passes, T.dangle, T.resets], tot = cnt.reduce((a, b) => a + b, 0) || 1;
const H = -cnt.reduce((a, c) => a + (c ? (c / tot) * Math.log2(c / tot) : 0), 0);
console.log(`TEAM=${TEAM} seedy ${1 + OFF}..${S + OFF} | křivost ${f(med(T.tort))} | střely ${T.shots} (${f(T.shots / T.min)}/min) | blok ${f(100 * T.blocked / Math.max(1, T.shots), 1)} % | ostrý úhel ${f(100 * T.sharp / Math.max(1, T.shots), 1)} % | zóna→střela ${f(100 * T.zpShot / Math.max(1, T.zp), 1)} % (n=${T.zp}) | resety ${f(T.resets / T.min)}/min | klička ${f(T.dangle / T.min)}/min | pasy ${f(T.passes / T.min)}/min | entropie ${f(H)} b | zvednuté ${f(100 * T.lift.hi / Math.max(1, T.shots), 0)} % | góly/zápas ${f(T.goals / S, 1)}`);
console.log(`  plány nosiče/min: reset ${f((T.bs.reset || 0) / T.min)} | cyklus ${f((T.bs.cycle || 0) / T.min)} | kraj ${f((T.bs.wide || 0) / T.min)} | klička od hole ${f((T.bs.dangle || 0) / T.min)} | zrušený nápřah ${f((T.bs.cancel || 0) / T.min)}`);
if (process.env.FH_DIAG) { { const B = [[60, 120], [120, 240], [240, 1e9]]; console.log('křivost podle délky držení:', B.map(([a, c]) => { const q = T.tl.filter(x => x[0] >= a && x[0] < c); return `${a / 60}-${c / 60}s n=${q.length} med=${f(med(q.map(x => x[1])))}`; }).join(' | '), '| nekvalifikováno (<1 s nebo posun ≤ 40):', T.short); }
  console.log('krádeže (pásmo:stav):', JSON.stringify(T.st)); console.log('plány bota:', JSON.stringify(T.bs), '| držení bez střely, plán při ztrátě:', JSON.stringify(T.lost)); const c = (fl) => { const a = T.list.filter(fl); return `${a.length}/${f(100 * a.reduce((x, q) => x + q.g, 0) / Math.max(1, a.length), 0)}%`; };
  for (const st of ['stand', 'butterfly', 'rvh', 'stretch']) console.log(`  postoj ${st}: zvednuté ${c(q => q.st === st && q.hi)} přízemní ${c(q => q.st === st && !q.hi)}`);
  console.log(`konverze: vše ${c(() => 1)} | zvednuté ${c(q => q.hi)} přízemní ${c(q => !q.hi)} | <80 ${c(q => q.d < 80)} 80-130 ${c(q => q.d >= 80 && q.d < 130)} 130+ ${c(q => q.d >= 130)} | blok ${c(q => q.blk)} volná ${c(q => !q.blk)} | v<40 ${c(q => q.v < 40)} v≥40 ${c(q => q.v >= 40)}`); }
process.exit(0);
