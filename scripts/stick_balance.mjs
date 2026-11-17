// DÉLKY HOLE — vyváženost (deterministicky, boti, sdílená simulace serveru). node scripts/stick_balance.mjs [--seeds=N] [--team=2] [--from=1001] [--pair=02] [--nostall] [--jobs=10]
// RUBRIKA (předem, 2026-11-17, před prvním měřením):
//  S1 vyváženost: týmy z jedné délky hole proti sobě (k–s, k–d, s–d), každý seed 2× s prohozenými stranami → podíl gólů každé strany 45–55 %
//     (2v2 120 seedů A 3v3 60 seedů; ověření na čerstvých seedech --from=3001)
//  S2 role: dlouhá hůl víc obrání (stealFrom) než soupeř; krátká hůl drží puk déle než soupeř (podíl držení > 50 %)
//  S3 hra žije: 4–10 gólů za zápas (jako test:balance goals_per_game_total)
//  S4 stall: test/balance-metrics.mjs stallTest (couvající nosič, kurzor u těla) s DLOUHOU holí nosiče → držení ≤ 85 %
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4650'; process.env.DB_PATH = join(tmpdir(), `fh-stick-${process.pid}.db`);
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const SEEDS = +(A.seeds ?? 12), N = +(A.team ?? 2), FROM = +(A.from ?? 1001), MIN = 5, HZ = 60;
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { STICKS } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let rec = null;
const oSteal = Player.prototype.stealFrom;
Player.prototype.stealFrom = function (c, p) { if (rec) rec.steals[this.team]++; return oSteal.call(this, c, p); };
function match(seed, sh, sa) {
  const id = `SL_${seed}_${sh}${sa}`;
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < N; i++) l.members.set('h' + i, makeMember({ name: 'H' + i, stickLen: sh }, 'home'));
  for (let i = 0; i < N; i++) l.members.set('a' + i, makeMember({ name: 'A' + i, stickLen: sa }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [pid, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + pid)); p.stickId = p.team === 'home' ? sh : sa; }
  rec = { steals: { home: 0, away: 0 }, pos: { home: 0, away: 0 } };
  for (let t = 0; t < MIN * 60 * HZ; t++) { stepMatch(m); for (const p of m.players.values()) if (p.hasPuck) rec.pos[p.team]++; }
  const r = { score: { ...m.score }, ...rec }; rec = null; lobbies.delete(l.id); return r;
}
const name = s => ['KRÁTKÁ', 'STŘEDNÍ', 'DLOUHÁ'][s] + `(${STICKS[s].len})`, pct = (a, b) => b ? 100 * a / b : 50;
let fail = 0; const t0 = Date.now();
const PAIRS = A.pair ? [String(A.pair).split('').map(Number)] : [[0, 1], [0, 2], [1, 2]];
function sumPair(x, y, from, seeds) {
  const S = { gx: 0, gy: 0, sx: 0, sy: 0, px: 0, py: 0, n: 0 };
  for (let s = 0; s < seeds; s++) for (const sw of [0, 1]) {
    const [h, a] = sw ? [y, x] : [x, y], r = match(from + s, h, a), X = sw ? 'away' : 'home', Y = sw ? 'home' : 'away';
    S.gx += r.score[X]; S.gy += r.score[Y]; S.sx += r.steals[X]; S.sy += r.steals[Y]; S.px += r.pos[X]; S.py += r.pos[Y]; S.n++;
  }
  return S;
}
if (A.child) {   // dílčí běh pro --jobs: jen součty jako JSON
  const [x, y] = PAIRS[0]; console.log('JSON ' + JSON.stringify(sumPair(x, y, FROM, SEEDS))); process.exit(0);
}
// --jobs=N: rozdělí seedy na N dílů na dvojici, každý díl vlastní proces a PORT (--port0, výchozí PORT+1); výsledek stejný jako postupně (součty)
async function runPair(x, y) {
  const J = Math.min(+(A.jobs ?? 1), SEEDS);
  if (J <= 1) return sumPair(x, y, FROM, SEEDS);
  const { spawn } = await import('child_process'), { fileURLToPath } = await import('url');
  const me = fileURLToPath(import.meta.url), per = Math.ceil(SEEDS / J), port0 = +(A.port0 ?? (+process.env.PORT + 1));
  const parts = [];
  for (let j = 0; j < J; j++) {
    const from = FROM + j * per, n = Math.min(per, FROM + SEEDS - from); if (n <= 0) break;
    const port = port0 + (x * 3 + y) * J + j;
    parts.push(new Promise((res, rej) => {
      const c = spawn(process.execPath, [me, '--child', `--pair=${x}${y}`, `--from=${from}`, `--seeds=${n}`, `--team=${N}`], { env: { ...process.env, PORT: String(port) } });
      let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', () => {});
      c.on('close', code => { const l = out.split(String.fromCharCode(10)).map(t => t.trim()).find(t => t.startsWith('JSON ')); l ? res(JSON.parse(l.slice(5))) : rej(new Error(`díl ${from} exit ${code}`)); });
    }));
  }
  const R = await Promise.all(parts), S = {};
  for (const r of R) for (const k in r) S[k] = (S[k] || 0) + r[k];
  return S;
}
console.log(`týmy ${N}v${N}, seedy ${FROM}–${FROM + SEEDS - 1} × 2 strany, ${MIN} min, FH_STICKS=${process.env.FH_STICKS || '—'}`);
const RES = await Promise.all(PAIRS.map(([x, y]) => runPair(x, y)));
PAIRS.forEach(([x, y], i) => {
  const S = RES[i];
  const share = pct(S.gx, S.gx + S.gy), gpg = (S.gx + S.gy) / S.n, se = 100 * Math.sqrt(0.25 / Math.max(1, S.gx + S.gy)), hold = pct(S.px, S.px + S.py);
  const s1 = share >= 45 && share <= 55, s3 = gpg >= 4 && gpg <= 10;
  const sLong = y === 2 ? S.sy > S.sx : x === 2 ? S.sx > S.sy : true;   // dlouhá víc obrání
  const sShort = x === 0 ? hold > 50 : true;                             // krátká drží déle (x je vždy menší index)
  const s2 = sLong && sShort;
  if (!(s1 && s2 && s3)) fail++;
  console.log(`${name(x)} vs ${name(y)}: góly ${S.gx}:${S.gy} → ${share.toFixed(1)} % (±${se.toFixed(1)}) S1 ${s1 ? 'OK' : 'NE'} | ${gpg.toFixed(1)} gólů/zápas S3 ${s3 ? 'OK' : 'NE'}`
    + ` | držení ${hold.toFixed(1)} %${x === 0 ? (sShort ? ' OK' : ' NE') : ''} | obrání ${S.sx}:${S.sy}${x === 2 || y === 2 ? (sLong ? ' OK' : ' NE') : ''}`);
});
if (!A.nostall) {
  const { stallTest } = await import('../test/balance-metrics.mjs');
  for (const sid of [2, 0]) {   // S4 = dlouhá (rubrika); krátká informativně
    const st = stallTest(1, 120, (m, h) => { h.stickId = sid; }), v = pct(st.held, st.liveT), ok = v <= 85;
    if (sid === 2 && !ok) fail++;
    console.log(`S4 stall nosič ${name(sid)}: držení ${v.toFixed(1)} %${sid === 2 ? (ok ? ' OK' : ' NE') : ' (info)'}`);
  }
}
console.log(`${fail ? `NEPROŠLO ${fail}` : 'VŠE OK'}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`); process.exit(fail ? 1 : 0);
