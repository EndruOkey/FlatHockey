// DOPAD VLASTNOSTÍ NA HRU (velikost × hůl) — deterministicky, boti, sdílená simulace serveru.
// node scripts/builds_impact.mjs [--seeds=N] [--from=1001]
// Část 1 — krajní buildy proti sobě (týmy z jednoho buildu, každý seed 2× s prohozenými stranami): podíl gólů.
// Část 2 — tempo hry: všichni výchozí (střední + střední hůl) vs náhodně rozdané buildy (seedovaně): góly, obrání,
//          změny držení a knocky za minutu. RUBRIKA (předem): podíl gólů krajních buildů 42–58 % (širší než 45–55 %, kombinace
//          dvou os); tempo se nesmí změnit o víc než ±15 % (hra má působit stejně, jen pestřeji).
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4660'; process.env.DB_PATH = join(tmpdir(), `fh-builds-${process.pid}.db`);
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const SEEDS = +(A.seeds ?? 40), FROM = +(A.from ?? 1001), N = 2, MIN = 5, HZ = 60;
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let rec = null, _mid = 0;
const oHit = Player.prototype.takeHit; Player.prototype.takeHit = function (I, nx, ny) { const r = oHit.call(this, I, nx, ny); if (rec && r > 0) rec.hits++; return r; };
const oSteal = Player.prototype.stealFrom; Player.prototype.stealFrom = function (...a) { if (rec) rec.steals++; return oSteal.apply(this, a); };
// build = [velikost, hůl]; assign(p, i) vrací build pro hráče
function match(seed, assign) {
  const id = `BI_${seed}_${++_mid}`;   // deterministické jméno lobby (pořadí zápasů je pevné)
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: MIN, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < N; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < N; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  let k = 0; for (const [pid, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(`BI_${seed}_${pid}`)); const [sz, st] = assign(p, k++); p.size = sz; p.stickId = st; }
  rec = { hits: 0, steals: 0, chg: 0 }; let last = null;
  for (let t = 0; t < MIN * 60 * HZ; t++) { stepMatch(m); let o = null; for (const p of m.players.values()) if (p.hasPuck) o = p.team; if (o && last && o !== last) rec.chg++; if (o) last = o; }
  const r = { score: { ...m.score }, ...rec }; rec = null; lobbies.delete(l.id); return r;
}
const NM = ['S', 'M', 'L'], SK = ['krátká', 'střední', 'dlouhá'], bn = b => `${NM[b[0]]}+${SK[b[1]]}`;
let fail = 0;
console.log(`2v2, seedy ${FROM}–${FROM + SEEDS - 1} × 2 strany, ${MIN} min`);
console.log('— 1) krajní buildy proti sobě (podíl gólů prvního, rubrika 42–58 %)');
const PAIRS = [[[0, 0], [2, 2]], [[0, 2], [2, 0]], [[0, 0], [1, 1]], [[2, 2], [1, 1]], [[0, 2], [1, 1]], [[2, 0], [1, 1]]];
for (const [x, y] of PAIRS) {
  let gx = 0, gy = 0;
  for (let s = 0; s < SEEDS; s++) for (const sw of [0, 1]) {
    const r = match(FROM + s, p => ((p.team === 'home') !== !!sw ? x : y));
    const X = sw ? 'away' : 'home', Y = sw ? 'home' : 'away'; gx += r.score[X]; gy += r.score[Y];
  }
  const sh = 100 * gx / Math.max(1, gx + gy), ok = sh >= 42 && sh <= 58; if (!ok) fail++;
  console.log(`  ${bn(x).padEnd(14)} vs ${bn(y).padEnd(14)} góly ${gx}:${gy} → ${sh.toFixed(1)} % (±${(100 * Math.sqrt(.25 / Math.max(1, gx + gy))).toFixed(1)}) ${ok ? 'OK' : 'NE'}`);
}
console.log('— 2) tempo hry: všichni výchozí vs náhodné buildy (rubrika ±15 %)');
const agg = () => ({ g: 0, st: 0, ch: 0, h: 0, n: 0 });
const base = agg(), mix = agg();
for (let s = 0; s < SEEDS; s++) {
  const a = match(FROM + s, () => [1, 1]); base.g += a.score.home + a.score.away; base.st += a.steals; base.ch += a.chg; base.h += a.hits; base.n++;
  const b = match(FROM + s, (p, k) => { const h = hashSeed(`${FROM + s}:${k}`) >>> 0; return [h % 3, Math.floor(h / 3) % 3]; });   // seedované rozdání
  mix.g += b.score.home + b.score.away; mix.st += b.steals; mix.ch += b.chg; mix.h += b.hits; mix.n++;
}
for (const [k, lab] of [['g', 'góly / zápas'], ['st', 'obrání / min'], ['ch', 'změny držení / min'], ['h', 'knocky / min']]) {
  const div = k === 'g' ? 1 : MIN, vb = base[k] / base.n / div, vm = mix[k] / mix.n / div, d = 100 * (vm - vb) / Math.max(1e-9, vb), ok = Math.abs(d) <= 15; if (!ok) fail++;
  console.log(`  ${lab.padEnd(20)} výchozí ${vb.toFixed(2).padStart(6)}   náhodné buildy ${vm.toFixed(2).padStart(6)}   ${d >= 0 ? '+' : ''}${d.toFixed(1)} % ${ok ? 'OK' : 'NE'}`);
}
console.log(fail ? `NEPROŠLO ${fail}` : 'VŠE OK'); process.exit(fail ? 1 : 0);
