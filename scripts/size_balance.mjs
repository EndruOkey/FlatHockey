// VELIKOSTI HRÁČE — vyváženost (deterministicky, boti, sdílená simulace serveru). node scripts/size_balance.mjs [--seeds=N] [--team=2]
// RUBRIKA (předem, 2026-11-17; Ondřej: „furt ale v rámci dobrého balancu, ať to není rozbitý"):
//  V1 vyváženost: týmy z jedné velikosti proti sobě (s–m, s–l, m–l), každý seed 2× s prohozenými stranami → podíl gólů každé strany 45–55 %
//  V2 role malého: malí drží puk déle než soupeř (podíl držení > 50 %)
//  V3 role velkého: velcí rozdají ≥ 1,3× víc knocků (zakolísání + rozplácnutí), než dostanou
//  V4 hra žije: 4–10 gólů za zápas (jako test:balance goals_per_game_total)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4640'; process.env.DB_PATH = join(tmpdir(), `fh-size-${process.pid}.db`);
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const SEEDS = +(A.seeds ?? 12), N = +(A.team ?? 2), FROM = +(A.from ?? 1001), MIN = 5, HZ = 60;   // --from = první seed (ověření mimo ladicí sadu)
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { SIZES } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let rec = null;
const oHit = Player.prototype.takeHit;
Player.prototype.takeHit = function (I, nx, ny) { const r = oHit.call(this, I, nx, ny); if (rec && r > 0) rec.hits[this.team]++; return r; };
function match(seed, sh, sa) {
  const id = `SZ_${seed}_${sh}${sa}`;
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < N; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < N; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [pid, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + pid)); p.size = p.team === 'home' ? sh : sa; }
  rec = { hits: { home: 0, away: 0 }, pos: { home: 0, away: 0 } };
  for (let t = 0; t < MIN * 60 * HZ; t++) { stepMatch(m); for (const p of m.players.values()) if (p.hasPuck) rec.pos[p.team]++; }
  const r = { score: { ...m.score }, ...rec }; rec = null; lobbies.delete(l.id); return r;
}
const name = s => SIZES[s].id.toUpperCase(), pct = (a, b) => b ? 100 * a / b : 50;
let fail = 0; const t0 = Date.now();
console.log(`týmy ${N}v${N}, seedy ${FROM}–${FROM + SEEDS - 1} × 2 strany, ${MIN} min, FH_SIZES=${process.env.FH_SIZES || '—'}`);
for (const [x, y] of (A.pair ? [String(A.pair).split('').map(Number)] : [[0, 1], [0, 2], [1, 2]])) {   // --pair=01 jen jedna dvojice
  const S = { gx: 0, gy: 0, hx: 0, hy: 0, px: 0, py: 0, n: 0 };
  for (let s = 1; s <= SEEDS; s++) for (const sw of [0, 1]) {
    const [h, a] = sw ? [y, x] : [x, y], r = match(FROM - 1 + s, h, a), X = sw ? 'away' : 'home', Y = sw ? 'home' : 'away';
    S.gx += r.score[X]; S.gy += r.score[Y]; S.hx += r.hits[Y]; S.hy += r.hits[X]; S.px += r.pos[X]; S.py += r.pos[Y]; S.n++;
  }
  const share = pct(S.gx, S.gx + S.gy), gpg = (S.gx + S.gy) / S.n, se = 100 * Math.sqrt(0.25 / Math.max(1, S.gx + S.gy));
  const v1 = share >= 45 && share <= 55, v4 = gpg >= 4 && gpg <= 10;
  const v2 = x !== 0 || pct(S.px, S.px + S.py) > 50;
  const big = y === 2 ? [S.hy, S.hx] : x === 2 ? [S.hx, S.hy] : null, v3 = !big || big[0] >= 1.3 * Math.max(1, big[1]);
  if (!(v1 && v2 && v3 && v4)) fail++;
  console.log(`${name(x)} vs ${name(y)}: góly ${S.gx}:${S.gy} → ${name(x)} ${share.toFixed(1)} % (±${se.toFixed(1)}) ${v1 ? 'OK' : 'NE'} | ${gpg.toFixed(1)} gólů/zápas ${v4 ? 'OK' : 'NE'} | držení ${name(x)} ${pct(S.px, S.px + S.py).toFixed(1)} %${x === 0 ? (v2 ? ' OK' : ' NE') : ''} | knocky rozdané ${name(x)} ${S.hx} / ${name(y)} ${S.hy}${big ? (v3 ? ' OK' : ' NE') : ''}`);
}
console.log(`${fail ? `NEPROŠLO ${fail}` : 'VŠE OK'}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`); process.exit(fail ? 1 : 0);
