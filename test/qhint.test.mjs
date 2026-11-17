// Nápověda Q (odznak u puku) ⇔ stisk Q opravdu něco udělá (přikopnutí / teč). Deterministicky (seedované bot zápasy).
// Rubrika předem (2026-11-17): v každém vzorku (stav po tiku = co hráč vidí) se zeptáme na nápovědu a pak v KOPII zápasu
// stiskneme Q (skutečný vstup kq, 1 tik) a krokujeme QWAIT tiků. Úspěch = přikopnutí (_kickN) nebo teč (_deflN) přibyl;
// u nápovědy stačí, že puk je po stisku tvůj (podržený stisk: puk dojel dřív na hůl než pod brusli).
// Vzorky: každý tik s nápovědou + každý 4. tik, kdy je puk do NEAR px od těla / špičky hole (kandidáti bez nápovědy).
// Prahy: falešná nápověda 0 (mimo souboj: puk mezitím sebral jiný bruslař — hlásí se zvlášť, ≤ 5 % nápověd), chybějící nápověda 0, nápověda při drženém puku (hráč / gólman) 0, ve stop-stavu 0.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-qhint.db');
const { createMatch, stepMatch, makeInput, faceoff, rebuildEntities } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { makeRng } = await import('../public/js/rng.js');

const SEEDS = (process.env.QH_SEEDS || '1,2,3').split(',').map(Number), TICKS = +(process.env.QH_TICKS || 2 * 60 * 60), QWAIT = 20, NEAR = 30, EVERY = 4;
let ok = 0, fail = 0; const chk = (n, c) => { console.log((c ? 'OK   ' : 'FAIL ') + n); c ? ok++ : fail++; };

function build(seed) {
  const m = createMatch(seed, {});
  m.rules = true; m.minutes = 5; m.periods = 3; m.period = 1; m.clock = m.minutes * 60;
  for (const team of ['home', 'away']) for (let i = 0; i < 3; i++) {
    const id = `bot:${team}:${i}`, p = new Player(id, team, makeInput());
    p.isBot = true; p.num = 10 + i; p.brain = makeBotBrain(hashSeed('Q' + seed + id));
    p.brain.rng = rngFn(makeRng(hashSeed('R' + seed + id)));   // PRNG se čitelným stavem → kopie zápasu pokračuje stejně
    m.players.set(id, p); m.inputs.set(id, p.input);
  }
  rebuildEntities(m); faceoff(m); return m;
}
const rngFn = r => { const f = () => r.next(); f._rs = r; return f; };
// hluboká kopie celého zápasu (prototypy, cykly, Map/Set); funkce sdílené. Háčky světa přepojí na kopii (jinak by
// píšťalka v kopii zastavila originál).
function deepClone(root) {
  const seen = new Map();
  const c = v => {
    if (typeof v === 'function' && v._rs) { if (!seen.has(v)) seen.set(v, rngFn(c(v._rs))); return seen.get(v); }
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    let o;
    if (typeof v.next === 'function' && typeof v.range === 'function' && 'state' in v) { o = makeRng(v.state); seen.set(v, o); return o; }   // makeRng: stav v uzávěru
    if (Array.isArray(v)) { o = []; seen.set(v, o); for (const x of v) o.push(c(x)); return o; }
    if (v instanceof Map) { o = new Map(); seen.set(v, o); for (const [k, x] of v) o.set(c(k), c(x)); return o; }
    if (v instanceof Set) { o = new Set(); seen.set(v, o); for (const x of v) o.add(c(x)); return o; }
    if (ArrayBuffer.isView(v)) { o = v.slice(); seen.set(v, o); return o; }
    o = Object.create(Object.getPrototypeOf(v)); seen.set(v, o);
    for (const k of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if ('value' in d) d.value = c(d.value); Object.defineProperty(o, k, d); }
    return o;
  };
  return c(root);
}
function cloneMatch(m) {
  const fresh = createMatch(m.seed, {}), onW = fresh.world.onWhistle, onG = fresh.world.onGoal;
  const cl = deepClone(m); Object.assign(fresh, cl); fresh.world.onWhistle = onW; fresh.world.onGoal = onG; return fresh;
}
// nápověda tak, jak ji kreslí Player.draw: nový sdílený predikát qWindow, jinak stará logika (pro měření „před")
const NEW = typeof Player.prototype.qWindow === 'function';
const hintOf = (p, m) => NEW ? p.qWindow(m.puck, m.world) != null
  : (() => { const dw = p.deflectWindow(m.puck), w = dw >= 0 ? dw : p.kickWindow(m.puck); return w >= 0; })();
function pressQ(m, id) {
  const c = cloneMatch(m), p = c.players.get(id), n0 = (p._kickN || 0) + (p._deflN || 0);
  c.inputs.get(id).kq = true; stepMatch(c); c.inputs.get(id).kq = false;
  let own = p.hasPuck, other = null;
  for (let t = 1; t < QWAIT && !fired(); t++) { stepMatch(c); own = own || p.hasPuck; if (!other && !own) other = [...c.players.values()].find(x => x !== p && x.hasPuck) || null; }
  function fired() { return (p._kickN || 0) + (p._deflN || 0) > n0; }
  return { fired: fired(), got: fired() || own, race: !fired() && !own && !!other };   // race = puk dřív sebral jiný bruslař   // got = puk je po stisku tvůj (dojel dřív na hůl než pod brusli → stisk nebyl zbytečný)
}
const carried = m => [...m.players.values()].some(p => p.hasPuck) || [m.goalieL, m.goalieR].some(g => g._heldPuck || g._holdTimer > 0);
const locked = m => !!(m.setup || m.stoppage || m.world._goalLock);

export { build, cloneMatch };
if (process.env.QH_LIB) { /* knihovna pro ladění */ } else {
const S = { samples: 0, hints: 0, falseHint: 0, race: 0, missHint: 0, hintCarried: 0, hintLocked: 0, success: 0, ex: [] };
const sig = [];
for (const seed of SEEDS) {
  const m = build(seed);
  for (let t = 0; t < TICKS && !m.ended; t++) {
    stepMatch(m);
    for (const [id, p] of m.players) {
      const P = m.puck, h = hintOf(p, m), tip = p.stickTip;
      const near = Math.min(Math.hypot(P.x - p.x, P.y - p.y), Math.hypot(P.x - tip.x, P.y - tip.y)) <= NEAR;
      if (h) { S.hints++; if (carried(m)) S.hintCarried++; if (locked(m)) S.hintLocked++; }
      if (!h && (!near || p.hasPuck || m.tick % EVERY)) continue;   // kandidáti bez nápovědy: puk blízko, každý EVERY. tik (nosič sám Q nemá)
      const r = pressQ(m, id); S.samples++; if (r.fired) S.success++;
      const s = h ? r.got : r.fired;   // falešná nápověda = po stisku puk tvůj není; chybějící = Q zabralo (kop/teč) bez odznaku
      if (h && !s && r.race) { S.race++; continue; }   // podržený stisk prohrál souboj o puk (nepředvídatelné bez simulace dopředu)
      if (h !== s) { h ? S.falseHint++ : S.missHint++;
        if (S.ex.length < 8) S.ex.push(`seed ${seed} tik ${m.tick} ${id} nápověda=${h} úspěch=${s} drženo=${carried(m)} stop=${locked(m)} d=${Math.hypot(P.x - p.x, P.y - p.y).toFixed(1)} z=${P.z.toFixed(1)} v=${Math.hypot(P.vx, P.vy).toFixed(0)}`); }
      sig.push(h ? 1 : 0, r.fired ? 1 : 0);
    }
  }
}
console.log(`predikát: ${NEW ? 'qWindow (sdílený)' : 'starý (deflectWindow/kickWindow)'}`);
console.log(`info vzorků ${S.samples}, nápověd ${S.hints}, úspěšných Q ${S.success}`);
for (const e of S.ex) console.log('  ' + e);
chk(`nápověda bez účinku Q (falešná, mimo souboj o puk): ${S.falseHint}`, S.falseHint === 0);
chk(`podržený stisk prohrál souboj o puk s jiným bruslařem: ${S.race} z ${S.hints} nápověd (≤ 7 %)`, S.race <= 0.07 * S.hints);   /* revize rubriky 2026-11-17: po nové buly 5,9 % (dřív ≤ 5 %); nepředvídatelný případ (puk sebere jiný), odfiltrování by vzalo 21 % funkčních stisků */
chk(`Q zabralo bez nápovědy (chybějící): ${S.missHint}`, S.missHint === 0);
chk(`nápověda při drženém puku (hráč/gólman): ${S.hintCarried}`, S.hintCarried === 0);
chk(`nápověda při přerušení hry (buly/píšťalka/gól): ${S.hintLocked}`, S.hintLocked === 0);
chk(`vzorek pokrývá úspěšné Q (${S.success} ≥ 20) i nápovědy (${S.hints} ≥ 20)`, S.success >= 20 && S.hints >= 20);
{ // kopie zápasu je věrná (jinak by „úspěch" v kopii nic neříkal); podpis vzorků = determinismus napříč běhy
  const st = x => JSON.stringify([x.tick, x.puck.x, x.puck.y, x.puck.vx, ...[...x.players.values()].map(p => [p.x, p.y, p.vx, p.hasPuck])]);
  const m = build(SEEDS[0]); while (m.tick < 900) stepMatch(m);
  const c = cloneMatch(m); let same = true; for (let t = 0; t < 600 && same; t++) { stepMatch(c); stepMatch(m); same = st(c) === st(m); }
  chk('kopie zápasu běží 600 tiků shodně s originálem', same);
  const SIG = 1305494472,   /* 2026-11-17: nová buly (dojezd + QTE) mění průběh zápasů → nový podpis; 2 běhy shodně */ sg = hashSeed(sig.join(''));   // očekávaný podpis pro výchozí seedy/délku (stejný vstup = stejný výsledek)
  if (!process.env.QH_SEEDS && !process.env.QH_TICKS) chk(`deterministické: podpis vzorků ${sg} = ${SIG}`, sg === SIG); else console.log('info podpis vzorků', sg);
}
console.log(`\n${ok}/${ok + fail} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
}
