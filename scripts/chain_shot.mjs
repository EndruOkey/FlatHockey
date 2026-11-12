// ŘETĚZEC ČÁST 1: STŘELA → PUK. Každou ránu v zápasech botů (2v2, seedováno) zachytí v Player.shoot a sleduje
// puk do výsledku: gól / zákrok / blok tělem / mimo (vedle, nad břevnem) / tyčka / zachycen holí / vyprchala.
// Měří: rychlost a výšku ran, čas letu k brankové čáře, přesnost míření (rozklad chyby), výšku v ústí, xG podle vzdálenosti a úhlu.
// Rubrika předem (2026-11-12, NHL-like poměry + čitelnost):
//   R1 sog_pct ≥ 45 (gól+zákrok / všechny rány) · R2 block_pct ≤ 25 · R3 miss_pct ≤ 30 (vedle+nad+tyčka)
//   R4 aim_err_med_px ≤ 6 (|y v brankové čáře − cíl bota|, ústí 44 px, roh 22 px) · R5 hi_half_pct 20–60 (z > břevno/2 v ústí)
//   R6 overbar_pct ≤ 10 (ústí přeletí nad břevnem) · R7 xG klesá se vzdáleností (monotónní) · R8 fly_ms_med ≤ 450
// node scripts/chain_shot.mjs [--seeds=6] [--verify]   (--verify = 2 běhy v podprocesech, porovná hash výstupu)
import { tmpdir } from 'os'; import { join } from 'path'; import { createHash } from 'crypto';
import { spawnSync } from 'child_process'; import { fileURLToPath } from 'url';
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
if (ARG.verify) {
  const me = fileURLToPath(import.meta.url), args = process.argv.slice(2).filter(a => a !== '--verify');
  const run = () => spawnSync(process.execPath, [me, ...args], { encoding: 'utf8', env: { ...process.env, PORT: '' } }).stdout;
  const a = run(), b = run(), h = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
  console.log(a); console.log(`DETERMINISMUS: běh1 ${h(a)} · běh2 ${h(b)} → ${a === b ? 'SHODA' : 'ROZDÍL'}`);
  process.exit(a === b ? 0 : 1);
}
process.env.PORT = process.env.PORT || String(4700 + (process.pid % 200));
process.env.DB_PATH = join(tmpdir(), `fh-cs-${process.pid}.db`);
const { RINK, PUCK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Player } = await import('../public/js/entities/Player.js');
const { Puck } = await import('../public/js/entities/Puck.js');
const { Goalie } = await import('../public/js/entities/Goalie.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const GY = RINK.goalY + RINK.goalH / 2, HALF = RINK.goalH / 2, BAR = PUCK.crossbarHeight, SEEDS = +(ARG.seeds || 6);
const ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let M = null, tick = 0, cur = null; const SHOTS = [];

// ── Háčky (jen pozorování, fyziku nemění) ──
const _shoot = Player.prototype.shoot;
Player.prototype.shoot = function (puck, charge, perfect) {
  if (cur && !cur.res) cur.res = 'další rána';
  const tip = this.stickTip, rawAim = M?.inputs.get(this.id)?.aim, aimA = this.aimAngle, carry = this.carryAngle, b = this.brain;
  _shoot.call(this, puck, charge, perfect);
  const dir = Math.atan2(puck.vy, puck.vx), gx = this.team === 'home' ? RINK.goalLineRight : RINK.goalLineLeft, sgn = this.team === 'home' ? 1 : -1;
  const tx = b?.shotX ?? gx, ty = b?.shotY ?? GY, tgt = Math.atan2(ty - tip.y, tx - tip.x);
  cur = { t0: tick, team: this.team, sgn, gx, x: tip.x, y: tip.y, charge, perfect: !!perfect, spd: Math.hypot(puck.vx, puck.vy), vz: puck.vz,
    dist: Math.hypot(gx - tip.x, GY - tip.y), ang: Math.abs(Math.atan2(GY - tip.y, (gx - tip.x) * sgn)) * 180 / Math.PI, ty,
    eAimErr: b?.aimErr ?? 0, eAimLag: ad(aimA, rawAim ?? aimA), eCarry: ad(carry, aimA), eSpread: ad(dir, carry), eTot: ad(dir, tgt),
    ot: !!this._oneTimer, res: null, post: false, cross: null, maxZ: puck.vz * puck.vz / (2 * PUCK.gravity) };
  SHOTS.push(cur);
};
const _pu = Puck.prototype.update;
Puck.prototype.update = function (dt, world) {
  const px = this.x, py = this.y, pz = this.z;
  _pu.call(this, dt, world);
  if (!cur || cur.res) return;
  if ((this._ev & 10) && !cur.post) cur.post = true;                     // 2 tyčka, 8 břevno
  if (this._blockBy && !cur.res) { cur.res = 'blok tělem'; cur.t1 = tick; }
  if (!cur.cross && (px - cur.gx) * cur.sgn < 0 && (this.x - cur.gx) * cur.sgn >= 0) {
    const k = (cur.gx - px) / ((this.x - px) || 1e-9); cur.cross = { y: py + k * (this.y - py), z: pz + k * (this.z - pz), t: tick };
  }
};
const _bp = Goalie.prototype.blockPuck;
Goalie.prototype.blockPuck = function (puck, world) {
  const held = this._holdTimer > 0, r = _bp.call(this, puck, world);
  if (r && !held && cur && !cur.res) { cur.res = 'zákrok'; cur.t1 = tick; }
  return r;
};

for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'CS' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); M = l.match; clearInterval(M.loop);
  for (const [id, p] of M.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  for (tick = 0; tick < 5 * 3600; tick++) {
    const sh = M.score.home, sa = M.score.away, pv = Math.hypot(M.puck.vx, M.puck.vy);
    stepMatch(M);
    if (!cur || cur.res) continue;
    if (M.score.home + M.score.away > sh + sa) { const t = M.score.home > sh ? 'home' : 'away'; cur.res = t === cur.team ? 'gól' : 'vlastní'; cur.t1 = tick; continue; }
    let car = null; for (const p of M.players.values()) if (p.hasPuck) car = p;
    if (car) { cur.res = car.team === cur.team ? 'zpět střelci/spoluhr.' : 'soupeř holí'; cur.catchV = pv; cur.catchDt = tick - cur.t0; cur.catchGoalie = 0; continue; }
    if (M.stoppage || M.setup) { cur.res = cur.cross ? 'mimo' : 'přerušeno'; continue; }
    if (cur.cross && tick - cur.cross.t > 12) { cur.res = cur.post ? 'tyčka' : 'mimo'; continue; }
    if (tick - cur.t0 > 240) cur.res = 'vyprchala';
  }
  if (cur && !cur.res) cur.res = 'konec';
  cur = null; lobbies.delete(l.id);
}

// ── Vyhodnocení ──
const N = SHOTS.length, pct = (a, b = N) => 100 * a / Math.max(1, b);
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const cnt = {}; for (const s of SHOTS) cnt[s.res] = (cnt[s.res] || 0) + 1;
for (const s of SHOTS) if (s.res === 'mimo' && s.cross && Math.abs(s.cross.y - GY) <= HALF && s.cross.z > BAR) s.res = 'nad břevnem';
const c2 = {}; for (const s of SHOTS) c2[s.res] = (c2[s.res] || 0) + 1;
const goals = c2['gól'] || 0, saves = c2['zákrok'] || 0, blocks = c2['blok tělem'] || 0, miss = (c2['mimo'] || 0) + (c2['nad břevnem'] || 0) + (c2['tyčka'] || 0);
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
console.log(`RÁNY ${N} (${SEEDS} zápasů 2v2 botů × 5 min) — výsledky:`);
for (const [k, v] of Object.entries(c2).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}  ${f(pct(v))} %`);
const spd = SHOTS.map(s => s.spd), ch = SHOTS.map(s => s.charge), mz = SHOTS.map(s => s.maxZ);
console.log(`\nSÍLA  nabití p10/p50/p90 ${f(q(ch, .1), 2)}/${f(q(ch, .5), 2)}/${f(q(ch, .9), 2)} · rychlost px/s ${f(q(spd, .1), 0)}/${f(q(spd, .5), 0)}/${f(q(spd, .9), 0)} (strop ${PUCK.maxShotSpeed}) · vrchol z px ${f(q(mz, .1))}/${f(q(mz, .5))}/${f(q(mz, .9))} (břevno ${BAR})`);
console.log(`  plné nabití (≥0,99) ${f(pct(SHOTS.filter(s => s.charge >= 0.99).length))} % · přesná rána ${f(pct(SHOTS.filter(s => s.perfect).length))} % · one-timer ${f(pct(SHOTS.filter(s => s.ot).length))} % · rychlost >260 (šmouha) ${f(pct(SHOTS.filter(s => s.spd > 260).length))} %`);
const dist = SHOTS.map(s => s.dist);
console.log(`VZDÁLENOST střel px p10/p50/p90 ${f(q(dist, .1), 0)}/${f(q(dist, .5), 0)}/${f(q(dist, .9), 0)} · úhel° p50/p90 ${f(q(SHOTS.map(s => s.ang), .5), 0)}/${f(q(SHOTS.map(s => s.ang), .9), 0)}`);
const crossed = SHOTS.filter(s => s.cross), fly = crossed.map(s => (s.cross.t - s.t0) * 1000 / 60);
const inMouth = crossed.filter(s => Math.abs(s.cross.y - GY) <= HALF);
const hi = inMouth.filter(s => s.cross.z > BAR / 2 && s.cross.z <= BAR).length, over = inMouth.filter(s => s.cross.z > BAR).length;
const aimPx = crossed.map(s => Math.abs(s.cross.y - s.ty));
console.log(`LET k brankové čáře ms p10/p50/p90 ${f(q(fly, .1), 0)}/${f(q(fly, .5), 0)}/${f(q(fly, .9), 0)} (n=${crossed.length}) · v ústí z>${BAR / 2}: ${f(pct(hi, inMouth.length))} % · nad břevnem ${f(pct(over, inMouth.length))} %`);
const deg = a => Math.abs(a) * 180 / Math.PI, md = k => f(q(SHOTS.map(s => deg(s[k])), .5), 2);
console.log(`MÍŘENÍ |y v čáře − cíl| px p50/p90 ${f(q(aimPx, .5))}/${f(q(aimPx, .9))} · chyba ° p50: celkem ${md('eTot')} = záměrná bota ${md('eAimErr')} + vyhlazení aim ${md('eAimLag')} + zpoždění hole ${md('eCarry')} + rozptyl ${md('eSpread')}`);
console.log(`  podíl zpoždění hole > 1° ${f(pct(SHOTS.filter(s => deg(s.eCarry) > 1).length))} % · p90 zpoždění hole ${f(q(SHOTS.map(s => deg(s.eCarry)), .9), 2)}°`);
// xG-like
const DB = [0, 80, 120, 160, 200, 1e9], AB = [0, 20, 40, 90];
console.log('\nxG gól/rány podle vzdálenosti (px) × úhlu (°):');
console.log('  vzdál.     ' + AB.slice(0, -1).map((a, i) => `${a}–${AB[i + 1]}`.padStart(12)).join('') + '      celkem');
const xgRow = [];
for (let i = 0; i < DB.length - 1; i++) {
  const row = SHOTS.filter(s => s.dist >= DB[i] && s.dist < DB[i + 1]);
  const cells = AB.slice(0, -1).map((a, j) => { const c = row.filter(s => s.ang >= a && s.ang < AB[j + 1]); return `${f(pct(c.filter(s => s.res === 'gól').length, c.length), 0)}%/${c.length}`.padStart(12); });
  const g = pct(row.filter(s => s.res === 'gól').length, row.length); if (row.length >= 10) xgRow.push(g);
  console.log(`  ${(DB[i] + '–' + (DB[i + 1] > 1e8 ? '∞' : DB[i + 1])).padEnd(10)} ${cells.join('')}   ${f(g, 1)}%/${row.length}`);
}
const ca = SHOTS.filter(s => s.res === 'soupeř holí');
console.log(`
SOUPEŘ HOLÍ ${ca.length}: rychlost puku při převzetí px/s p10/p50/p90 ${f(q(ca.map(s => s.catchV), .1), 0)}/${f(q(ca.map(s => s.catchV), .5), 0)}/${f(q(ca.map(s => s.catchV), .9), 0)} · do ${f(q(ca.map(s => s.catchDt * 1000 / 60), .5), 0)} ms po ráně (p50) · nad 300 px/s ${f(pct(ca.filter(s => s.catchV > 300).length, ca.length))} %`);
const ca0 = ca.filter(s => s.catchDt <= 1);
console.log(`  z toho SNĚDENO HNED (≤ 1 tik po ráně, puk neopustí čepel soupeře): ${ca0.length} = ${f(pct(ca0.length))} % všech ran · výstřelná rychlost p50 ${f(q(ca0.map(s => s.spd), .5), 0)} px/s (limit čistého převzetí 420)`);
const R = { sog_pct: pct(goals + saves), block_pct: pct(blocks + ca.filter(s => s.catchDt <= 1 || s.catchV > 300).length), miss_pct: pct(miss), aim_err_med_px: q(aimPx, .5), hi_half_pct: pct(hi, inMouth.length), overbar_pct: pct(over, inMouth.length),
  xg_monotonic: xgRow.every((v, i) => i === 0 || v <= xgRow[i - 1] + 1) ? 1 : 0, fly_ms_med: q(fly, .5), sh_pct: pct(goals, goals + saves) };
const RUB = { sog_pct: v => v >= 45, block_pct: v => v <= 25, miss_pct: v => v <= 30, aim_err_med_px: v => v <= 6, hi_half_pct: v => v >= 20 && v <= 60, overbar_pct: v => v <= 10, xg_monotonic: v => v === 1, fly_ms_med: v => v <= 450 };
const RT = { sog_pct: '≥ 45', block_pct: '≤ 25', miss_pct: '≤ 30', aim_err_med_px: '≤ 6', hi_half_pct: '20–60', overbar_pct: '≤ 10', xg_monotonic: '= 1', fly_ms_med: '≤ 450' };
console.log('\nRUBRIKA');
for (const [k, v] of Object.entries(R)) console.log(`${k in RUB ? (RUB[k](v) ? 'OK  ' : 'NE  ') : 'info'} ${k.padEnd(15)} ${f(v, 2).padStart(8)}${k in RT ? `  (${RT[k]})` : ''}`);
process.exit(0);
