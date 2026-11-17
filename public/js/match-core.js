// Sdílené herní jádro (autoritativní, deterministické) — běží STEJNĚ na serveru i v prohlížeči.
// Server ho krokuje v setInterval smyčce a efekty (píšťalka/gól/konec) posílá sítí; klient ho
// v lokálním režimu (zápas s boty) krokuje přímo každý frame → žádná síť = plynule + nulová latence.
// Veškerá náhoda je seedovaná (World rng, bot brain), žádný Math.random ani wall-clock v logice kroku.
//
// Efekty, které nejsou čistá simulace (síť/DB/UI), jdou přes match.hooks:
//   whistle(rule, lineX)  · goal(result, scoringTeam)  · period(period)  · gameover()
// Server je naplní io.emit + statistikami; klient lokální obsluhou. Když hook chybí, jen se přeskočí.
import { RINK, PUCK, TEMPO, passSpeedFor, sizeOf } from './constants.js';
import { lerpAngle, clamp } from './utils.js';
import { World } from './world.js';
import { Player } from './entities/Player.js';
import { Puck } from './entities/Puck.js';
import { Goalie } from './entities/Goalie.js';
import { Rink } from './entities/Rink.js';
import { botThink } from './bot.js';
import { makeRng } from './rng.js';

const PERFECT_WIN = 0.3;      // s — okno přesné rány po plném nabití (pak puk ujede)
const CHARGE_RATE = 1.2;       // pomalejší nápřah → slap shot je cítit jako wind-up (méně twitchy)
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const ms2ticks = ms => Math.round(ms * TICK_HZ / 1000);   // herní časovače v ticích, ne ve wall-clocku (determinismus)

// ── Vstupy ───────────────────────────────────────────────────────────────
export function makeInput() {
  return {
    dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq: false,
    aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false, kqJustPressed: false,
    _p: { lmb: false, rmb: false, mmb: false, kq: false }, // předchozí stav pro hrany
  };
}
const dir1 = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
// analog = true jen lokální offline hra (ovládání B2 posílá plynulý směr); server dál kvantuje na 8 směrů.
export function applyClientInput(inp, msg, analog = false) {
  if (!msg || typeof msg !== 'object') return;
  const l = Math.hypot(+msg.dx || 0, +msg.dy || 0);
  if (analog && msg.an && Number.isFinite(l) && l > 0.01) { inp.dx = msg.dx / Math.max(1, l); inp.dy = msg.dy / Math.max(1, l); }
  else { inp.dx = dir1(msg.dx); inp.dy = dir1(msg.dy); }
  inp.keys.Space = !!msg.space;
  inp.lmb = !!msg.lmb; inp.rmb = !!msg.rmb; inp.mmb = !!msg.mmb; inp.kq = !!msg.kq;   // kq = Q: přikopnutí puku do jízdy
  if (Number.isFinite(msg.aim))     inp.aim     = msg.aim;
  if (Number.isFinite(msg.aimDist)) inp.aimDist = clamp(msg.aimDist, 0, 4000);
  if (Number.isInteger(msg.sq)) inp._sq = msg.sq;   // pořadí vstupu → klient reconciluje přesně (ne odhadem)
}
export function computeEdges(inp) {
  inp.lmbJustPressed  = inp.lmb && !inp._p.lmb;
  inp.lmbJustReleased = !inp.lmb && inp._p.lmb;
  inp.rmbJustPressed  = inp.rmb && !inp._p.rmb;
  inp.mmbJustPressed  = inp.mmb && !inp._p.mmb;
  inp.kqJustPressed   = !!inp.kq && !inp._p.kq;
  inp._p.lmb = inp.lmb; inp._p.rmb = inp.rmb; inp._p.mmb = inp.mmb; inp._p.kq = !!inp.kq;
}

// ── Akce hráče (charge/střela/přihrávka/aim) ───────────────────────────────
function _updateAim(p, rawAim, dt) {
  const d = p.aimDist ?? 100;
  const rate = clamp(d / 35, 0.12, 1) * 28;
  p.aimAngle = lerpAngle(p.aimAngle, rawAim, Math.min(1, rate * dt));
}
const LEAD_K = (typeof process !== 'undefined' && process.env && process.env.FH_LEADK) ? Number(process.env.FH_LEADK) : 0.78;  // 0.78: pas dorazí do stride (scripts/pass_stride.mjs: offset −13→−6 px, míň „za tebe") a převzetí drží ~92 % (pass_test). 0.7 házelo za příjemce.
function leadAim(from, target, speed) {
  const tip = target;   // míří na střed těla příjemce (změřeno: čepel dávala jen 25–33 %)
  const a = PUCK.decel;
  let tx = tip.x, ty = tip.y;
  for (let i = 0; i < 3; i++) {
    const d = Math.hypot(tx - from.x, ty - from.y) || 1;
    const disc = speed * speed - 2 * a * d;
    const t = disc > 0 ? (speed - Math.sqrt(disc)) / a : speed / a;   // doba letu se zpomalením
    tx = tip.x + (target.vx || 0) * t * LEAD_K; ty = tip.y + (target.vy || 0) * t * LEAD_K;
  }
  return Math.atan2(ty - from.y, tx - from.x);
}
function pickHumanPass(p, match) {
  let best = null, bestScore = -Infinity, reqBest = null, reqD = Infinity;
  for (const o of match.players.values()) {
    if (o === p || o.team !== p.team) continue;
    const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
    if ((o.passReq || 0) > 0 && d < reqD) { reqD = d; reqBest = o; }
    const ang = Math.atan2(dy, dx);
    const diff = Math.abs(((ang - (p.aimAngle || 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);  // 0..π
    const score = -diff * 2 - d / 400;   // po směru kurzoru a blíž = lepší
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return reqBest || best;
}
function nearestTeammate(p, match) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o === p || o.team !== p.team) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
export function playerActions(p, inp, dt, match) {
  p.aimDist = inp.aimDist;
  _updateAim(p, inp.aim, dt);
  if (p.isDown) { p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._oneTimer = false; p._rmbHold = 0; return; }   // rozplácnutý: žádná akce

  if (inp.lmbJustPressed) { p._chargeCancelled = false; p._oneTimer = !p.hasPuck; }
  if (!inp.lmb) p._chargeBlocked = false;

  if (inp.rmb && !p.hasPuck && p.charge > 0) {
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._oneTimer = false;
  }

  if (inp.lmb && !p._chargeBlocked && !(inp.rmb && !p.hasPuck)) {
    if (!p._chargeDecaying) {
      const cap = (p.hasPuck && !p._oneTimer) ? 1 : 0.95;
      p.charge = Math.min(cap, p.charge + CHARGE_RATE * sizeOf(p).charge * dt);   // velikost: rychlost nápřahu
      if (p.charge >= 1 && p.hasPuck && !p._oneTimer) { p._chargeDecaying = true; p.overcharged = true; p._perfT = 0; }
    } else if (p.hasPuck) {
      // PLNÉ NABITÍ (2026-11-09): okno PERFECT_WIN s na PŘESNOU ránu (bez rozptylu). Propásneš → puk z čepele
      // ujede (ztráta), žádná slabá rána sama od sebe. charge zůstává 1 → klient pozná okno ze snapshotu (ch).
      p._perfT = (p._perfT || 0) + dt;
      if (p._perfT > PERFECT_WIN) { p.loseBlade(match.puck); p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeBlocked = true; }
    } else { p._chargeDecaying = false; p.overcharged = false; }
  }

  const rmbCancelledCharge = inp.rmbJustPressed && p.hasPuck && p.charge > 0;
  if (inp.lmbJustReleased && !rmbCancelledCharge) {
    if (p.hasPuck && !p._chargeCancelled) p.shoot(match.puck, p.charge, !!p.overcharged);   // overcharged = v okně přesné rány
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeCancelled = false; p._oneTimer = false;
  }

  // PŘIHRÁVKA (2026-11-09): ŤUKNUTÍ RMB (< SAUCER_HOLD s) = rychlý pas po ledě; PODRŽENÍ = nadzvednutý pas
  // přes hole (puk letí vzduchem → nejde zachytit ani obrat, je pomalejší). Pas odejde při PUŠTĚNÍ RMB.
  // Bot přihrává hned po ledě (jednotikový impuls) — beze změny balancu.
  if (inp.rmbJustPressed && p.hasPuck) {
    if (p.charge > 0.08) { p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeBlocked = true; p._chargeCancelled = true; }
    else if (p.isBot) doPass(p, match, false);
    else p._rmbHold = 1e-6;
  }
  if (p._rmbHold > 0) {
    if (!p.hasPuck || p.charge > 0.08) p._rmbHold = 0;
    else if (inp.rmb) p._rmbHold += dt;
    else { const saucer = p._rmbHold >= SAUCER_HOLD; p._rmbHold = 0; doPass(p, match, saucer); }
  }

  if (inp.mmbJustPressed && !p.hasPuck) p.passReq = 0.9;
  if (inp.kqJustPressed) p.trySkateKick(match.puck, match.world);   // Q: přikopnutí / zpracování puku bruslí do jízdy
}

// Nadzvednutý pas: pomalejší, dopadne ~SAUCER_LAND dráhy před příjemce a dojede mu na hůl.
export const SAUCER_HOLD = 0.15, SAUCER_SPEED = 270, SAUCER_LAND = 0.85, SAUCER_MIN = 60;
function doPass(p, match, saucer) {
  let tgt = null;
  if (p.isBot && p._passTarget) {
    const cand = match.players.get(p._passTarget);
    if (cand && cand !== p && cand.team === p.team) tgt = cand;
  } else if (!p.isBot) {
    tgt = pickHumanPass(p, match);
  }
  if (!tgt) tgt = nearestTeammate(p, match);
  p._passTarget = null;
  if (!tgt) return;
  p.charge = 0;
  const tip = p.stickTip;
  const dist = Math.hypot(tgt.x - tip.x, tgt.y - tip.y);
  if (saucer && dist >= SAUCER_MIN) {
    const sp = SAUCER_SPEED, ang = leadAim(tip, tgt, sp);
    p.pass(match.puck, ang, sp);
    const t = SAUCER_LAND * dist / sp;                              // doba letu do dopadu (ve vzduchu skoro bez tření)
    match.puck.vz = Math.min(150, PUCK.gravity * t / 2);           // vrchol ≤ ~19 px (pod břevnem)
    match.puck.z = 2;                                               // hned ve vzduchu (isAirborne > 1.5)
    match.puck._saucer = true;
  } else {
    const sp = passSpeedFor(dist);
    p.pass(match.puck, leadAim(tip, tgt, sp), sp);
  }
  if (typeof process === 'undefined' || process.env.FH_NOADDR !== '1') { match.puck._passTo = tgt.id; match.puck._passT = 1.2 + (saucer ? 0.5 : 0); }   // adresát má větší zónu převzetí
}

export function rebuildEntities(match) {
  match.world.entities = [match.rink, ...match.players.values(), match.goalieL, match.goalieR, match.puck];
}

// ── Vhazování (buly) ───────────────────────────────────────────────────────
// 2026-11-17 (Ondřej: „hráči na buly musí dojet, chvilka prodleva, rozehry random, rozestavění hapruje"):
// FÁZE match.fo.ph:  0 DOJEZD (sim vede hráče na místa, max FO.skate; kdo nedojel → přesun)
//                    1 PŘÍPRAVA (stojí, kruh u bodu)  2 VHAZOVÁNÍ (kruh se smršťuje k okamžiku dropu)
//                    3 PO DROPU (čeká na první platný stisk LMB centrů, max FO.win; nikdo → volný puk jako dřív)  4 hotovo
// Centr = člověk, je-li v týmu (jinak bot). Platí jen PRVNÍ stisk centra od fáze 1: před dropem = předčasně → prohrál
// (spam se tak sám vyřadí), po dropu vyhrává nejdřívější. Boti reagují seedovaně FO.botMin..botMax po dropu.
// Vše v ticích + world.rng → deterministické; match.setup a _goalLock drží po celou dobu (klient nepredikuje).
const FO_X = 248, FO_Y = 114;   // buly body v pásmech (stejné jako kreslí Rink.js)
export const FO = { skate: ms2ticks(1500), ready: ms2ticks(500), dropMin: ms2ticks(400), dropMax: ms2ticks(700),
                    win: ms2ticks(1000), botMin: ms2ticks(180), botMax: ms2ticks(320), arrive: 6, vmax: 520, vmin: 90, gain: 6 };
const FO_SPOTS = [
  [16,   0],   // centr — na buly bodě
  [26, -54],   // křídlo
  [26,  54],   // křídlo
  [86, -34],   // obránce
  [86,  34],   // obránce
];
// Cíl mimo mantinel a mimo klec branky (rozšířený box kolem brankové čáry)
function foClamp(x, y) {
  x = clamp(x, 16, RINK.w - 16); y = clamp(y, 24, RINK.h - 24);
  const gy1 = RINK.goalY - 16, gy2 = RINK.goalY + RINK.goalH + 16;
  if (y > gy1 && y < gy2) {
    if (x < RINK.goalLineLeft + 24) x = RINK.goalLineLeft + 24;
    if (x > RINK.goalLineRight - 24) x = RINK.goalLineRight - 24;
  }
  return { x, y };
}
// Rozestavění: centr (člověk > bot), ostatní hladově na nejbližší volné místo (stabilní pořadí → deterministické)
function foPlan(match) {
  const fo = match.fo, fx = fo.x, fy = fo.y;
  fo.plan = new Map(); fo.c = { home: null, away: null };
  for (const team of ['home', 'away']) {
    const dir = team === 'home' ? 1 : -1;
    const arr = [...match.players.values()].filter(p => p.team === team);
    if (!arr.length) continue;
    const center = arr.find(p => !p.isBot) || arr[0];
    fo.c[team] = center.id;
    const spots = arr.map((_, i) => {
      const s = FO_SPOTS[Math.min(i, FO_SPOTS.length - 1)];
      const back = s[0] + (i >= FO_SPOTS.length ? (i - FO_SPOTS.length + 1) * 26 : 0);
      const side = i >= FO_SPOTS.length ? ((i % 2) ? 1 : -1) : 1;
      return foClamp(fx - dir * back, fy + s[1] * side);
    });
    fo.plan.set(center.id, spots[0]);
    const rest = arr.filter(p => p !== center);
    for (let si = 1; si < spots.length; si++) {
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => { const d = Math.hypot(p.x - spots[si].x, p.y - spots[si].y); if (d < bd) { bd = d; bi = i; } });
      fo.plan.set(rest[bi].id, spots[si]); rest.splice(bi, 1);
    }
  }
  fo.n = match.players.size;
}
function foFace(p, fo, k) {
  const fa = Math.atan2(fo.y - p.y, fo.x - p.x);
  p.bodyAngle = lerpAngle(p.bodyAngle ?? fa, fa, k); p.aimAngle = p.carryAngle = p.bodyAngle;
  if (k >= 1) p.skateAngle = fa;
}
function foSnapAll(match) {
  for (const p of match.players.values()) { const s = match.fo.plan.get(p.id); if (s) { p.x = s.x; p.y = s.y; } p.vx = p.vy = 0; foFace(p, match.fo, 1); }
}
// Vlastní seedovaná náhoda buly (seed zápasu × tick) → nesahá do world.rng, buly nemění průběh zbytku simulace
const foRng = match => makeRng(((match.seed >>> 0) ^ Math.imul(match.tick + 1, 0x9E3779B1)) >>> 0);
function foStartReady(match) {
  const fo = match.fo, rng = foRng(match);
  fo.ph = 1; fo.t1 = match.tick;
  fo.drop = match.tick + FO.ready + Math.round(FO.dropMin + (FO.dropMax - FO.dropMin) * rng.next());
  fo.press = { home: null, away: null };   // tick prvního stisku centra (od fáze 1); < drop = předčasně
  fo.bot = {};
  for (const team of ['home', 'away']) fo.bot[team] = Math.round(FO.botMin + (FO.botMax - FO.botMin) * rng.next());
}
export function faceoffAt(match, fx, fy) {
  for (const g of [match.goalieL, match.goalieR]) if (g) { g._holdTimer = 0; g._heldPuck = null; g._froze = false; g._waits = 0; }
  for (const p of match.players.values()) {
    p.hasPuck = false; p.charge = 0; p._chargeDecaying = false; p._oneTimer = false; p.overcharged = false; p._rmbHold = 0;
  }
  match.puck.reset();
  const pk = match.puck;
  pk.x = fx; pk.y = fy; pk.prevX = fx; pk.prevY = fy; pk.vx = pk.vy = 0; pk.faceoffTimer = 0;
  pk._passTo = null; pk._carrier = null;
  match.lastTouch = null; match.touchX = fx;
  match.icing = null; match.offside = null; match._goalAt = 0; match.stoppage = false; match._whistleAt = 0;
  match.setup = true;
  match.fo = { x: fx, y: fy, ph: 0, t0: match.tick, plan: null, c: null, n: 0, drop: 0, press: null, bot: null, win: null };
  foPlan(match);
  if (match.tick === 0) { foSnapAll(match); foStartReady(match); }   // start zápasu: hráči ještě nikde nestojí
  match.faceoffUntil = match.tick + FO.skate + FO.ready + FO.dropMax + FO.win;   // horní mez (kompat)
  match.world._goalLock = true;
}
export function faceoff(match) { faceoffAt(match, RINK.centerX, RINK.h / 2); }

// Jeden tick buly. Vrací true, dokud se nehraje (stepMatch pak skončí).
function stepFaceoff(match) {
  const fo = match.fo, t = match.tick;
  // Hlídání sestavy: přišel/odešel hráč nebo zmizel centr / v týmu s botem-centrem se objevil člověk → nové rozestavění a dojezd
  let changed = fo.n !== match.players.size;
  if (!changed) for (const p of match.players.values()) if (!fo.plan.has(p.id)) { changed = true; break; }
  if (!changed) for (const team of ['home', 'away']) {
    const c = fo.c[team] && match.players.get(fo.c[team]);
    if (fo.c[team] && !c) changed = true;
    else if (c && c.isBot && [...match.players.values()].some(p => p.team === team && !p.isBot)) changed = true;
  }
  if (changed) { foPlan(match); fo.ph = 0; fo.t0 = t; fo.press = null; }

  // Hrany vstupu lidí (stisk LMB) — boti vstup nemají, jejich reakce je seedovaná
  for (const [id, p] of match.players) {
    const inp = match.inputs.get(id);
    if (!inp || p.isBot) continue;
    if (inp._stamp && Date.now() - inp._stamp > 300) { inp.dx = 0; inp.dy = 0; inp.lmb = false; inp.rmb = false; inp.mmb = false; }
    computeEdges(inp);
    if (fo.ph >= 1 && fo.press && inp.lmbJustPressed) for (const team of ['home', 'away']) if (fo.c[team] === id && fo.press[team] == null) fo.press[team] = t;
  }

  if (fo.ph === 0) {   // DOJEZD
    const left = Math.max(1, fo.t0 + FO.skate - t);
    let all = true;
    for (const p of match.players.values()) {
      const s = fo.plan.get(p.id); if (!s) continue;
      const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy);
      if (d <= FO.arrive) { p.x = s.x; p.y = s.y; p.vx = p.vy = 0; foFace(p, fo, Math.min(1, 12 * DT)); continue; }
      all = false;
      const v = clamp(Math.max(d * FO.gain, d / (left * DT)), FO.vmin, FO.vmax);
      const step = Math.min(d, v * DT);
      p.vx = dx / d * v; p.vy = dy / d * v;
      p.x += dx / d * step; p.y += dy / d * step;
      const ma = Math.atan2(dy, dx); p.skateAngle = ma;
      p.bodyAngle = lerpAngle(p.bodyAngle ?? ma, d > 40 ? ma : Math.atan2(fo.y - p.y, fo.x - p.x), Math.min(1, 10 * DT));
      p.aimAngle = p.carryAngle = p.bodyAngle;
    }
    if (all || t - fo.t0 >= FO.skate) { foSnapAll(match); foStartReady(match); }
    return true;
  }
  for (const p of match.players.values()) foFace(p, fo, Math.min(1, 12 * DT));
  if (fo.ph === 1 && t >= fo.drop - FO.dropMin) fo.ph = 2;   // kruh se smršťuje posledních dropMin ticků
  if (fo.ph === 2 && t >= fo.drop) fo.ph = 3;
  if (fo.ph < 3) return true;

  // PO DROPU: nejdřívější platný stisk (≥ drop) vyhrává; boti = drop + reakce
  const valid = {};
  for (const team of ['home', 'away']) {
    const c = match.players.get(fo.c[team]); if (!c) continue;
    if (c.isBot) { if (t >= fo.drop + fo.bot[team]) valid[team] = fo.drop + fo.bot[team]; }
    else if (fo.press[team] != null && fo.press[team] >= fo.drop) valid[team] = fo.press[team];
  }
  let win = null;
  if (valid.home != null && valid.away != null) win = valid.home < valid.away ? 'home' : valid.away < valid.home ? 'away' : (foRng(match).next() < 0.5 ? 'home' : 'away');
  else if (valid.home != null) win = 'home'; else if (valid.away != null) win = 'away';
  if (win) { foWin(match, win); return false; }
  if (t - fo.drop >= FO.win) { foEnd(match, null); return false; }   // nikdo platně nestiskl → volný puk (závod jako dřív)
  return true;
}
function foEnd(match, win) {
  match.fo.win = win; match.fo.ph = 4; match.fo.end = match.tick;
  match.setup = false; match.world._goalLock = false;
}
// Výhra buly: puk jde dozadu ke spoluhráči (nejdál za bodem = obránce), mírnou rychlostí; 1 hráč v týmu → jen kousek za centra
function foWin(match, team) {
  const fo = match.fo, dir = team === 'home' ? 1 : -1, pk = match.puck;
  const center = match.players.get(fo.c[team]);
  let tgt = null, bk = -Infinity;
  for (const p of match.players.values()) if (p.team === team && p !== center) { const b = (fo.x - p.x) * dir; if (b > bk) { bk = b; tgt = p; } }
  const tx = tgt ? tgt.x : fo.x - dir * 40, ty = tgt ? tgt.y : fo.y;
  const d = Math.hypot(tx - pk.x, ty - pk.y) || 1;
  const sp = tgt ? clamp(passSpeedFor(d) * 0.8, 140, 300) : 90;
  pk.vx = (tx - pk.x) / d * sp; pk.vy = (ty - pk.y) / d * sp;
  if (tgt) { pk._passTo = tgt.id; pk._passT = 1.2; if (center) center._shootCooldown = Math.max(center._shootCooldown || 0, 0.3); }
  const loser = match.players.get(fo.c[team === 'home' ? 'away' : 'home']);
  if (loser) loser._shootCooldown = Math.max(loser._shootCooldown || 0, 0.3);   // poražený centr puk hned „nesní"
  match.lastTouch = team; match.touchX = fo.x;
  foEnd(match, team);
}
// Stav buly pro klienta (snapshot / offline render):
// [fáze, ticků do dropu, délka smršťování (ticky), centr home, centr away, předčasně bitmask (1 home, 2 away), vítěz, x, y]
export function faceoffState(match) {
  const fo = match.fo; if (!fo) return null;
  if (fo.ph === 4 && match.tick - fo.end > ms2ticks(700)) return null;
  const pr = fo.press || {};
  const early = (pr.home != null && pr.home < fo.drop ? 1 : 0) | (pr.away != null && pr.away < fo.drop ? 2 : 0);
  return [fo.ph, fo.ph >= 1 ? fo.drop - match.tick : 0, FO.dropMin, fo.c ? fo.c.home : null, fo.c ? fo.c.away : null, early, fo.win, Math.round(fo.x), Math.round(fo.y)];
}

// ── Pravidla: icing + offside ──────────────────────────────────────────────
function anyInZone(match, team, pred) {
  for (const p of match.players.values()) if (p.team === team && pred(p)) return true;
  return false;
}
function callStoppage(match, rule, lineX, fx, fy) {
  match.stoppage = true;
  match._whistleAt = match.tick;
  match._faceoff = { x: fx, y: fy };
  match.world._goalLock = true;              // zmraz interakce (jako u gólu)
  match.puck.vx = match.puck.vy = 0;
  match.hooks.whistle?.(rule, lineX);
}
function checkRules(match) {
  const pk = match.puck, px = pk.x, ppx = pk.prevX ?? pk.x, cx = RINK.centerX;
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  const inMouthY = pk.y > gy1 && pk.y < gy2;
  const dotY = pk.y < RINK.h / 2 ? 114 : RINK.h - 114;

  if (match.lastTouch === 'home' && ppx < RINK.blueLineRight && px >= RINK.blueLineRight &&
      anyInZone(match, 'home', p => p.x > RINK.blueLineRight + 8)) {
    match.offside = { side: 'home', lineX: RINK.blueLineRight, fx: RINK.blueLineRight - 30, fy: dotY, t: match.tick };
    match.world._goalLock = true; return;
  }
  if (match.lastTouch === 'away' && ppx > RINK.blueLineLeft && px <= RINK.blueLineLeft &&
      anyInZone(match, 'away', p => p.x < RINK.blueLineLeft - 8)) {
    match.offside = { side: 'away', lineX: RINK.blueLineLeft, fx: RINK.blueLineLeft + 30, fy: dotY, t: match.tick };
    match.world._goalLock = true; return;
  }

  if (match.lastTouch === 'home' && match.touchX < cx && ppx < RINK.goalLineRight && px >= RINK.goalLineRight && !inMouthY) {
    match.icing = { side: 'home', lineX: RINK.goalLineRight, fx: 248, fy: dotY, t: match.tick };
    match.world._goalLock = true; return;     // buly v obr. pásmu home (vlevo)
  }
  if (match.lastTouch === 'away' && match.touchX > cx && ppx > RINK.goalLineLeft && px <= RINK.goalLineLeft && !inMouthY) {
    match.icing = { side: 'away', lineX: RINK.goalLineLeft, fx: RINK.w - 248, fy: dotY, t: match.tick };
    match.world._goalLock = true; return;     // buly v obr. pásmu away (vpravo)
  }
}
// Předběžné varování (pulsující čára). Bitmask: 1=offside pravá, 2=offside levá, 4=icing pravá, 8=icing levá
export function pendingFlags(match) {
  if (!match.rules || match.stoppage) return 0;
  const cx = RINK.centerX, pk = match.puck;
  let f = 0;
  if (match.offside) {
    f |= (match.offside.side === 'home' ? 1 : 2);
  } else if (!match.world._goalLock) {
    if (pk.x <= RINK.blueLineRight && anyInZone(match, 'home', p => p.x > RINK.blueLineRight + 4)) f |= 1;
    if (pk.x >= RINK.blueLineLeft  && anyInZone(match, 'away', p => p.x < RINK.blueLineLeft - 4))  f |= 2;
  }
  if (match.icing) {
    f |= (match.icing.side === 'home' ? 4 : 8);
  } else if (!match.world._goalLock) {
    if (match.lastTouch === 'home' && match.touchX < cx && pk.x > cx && pk.vx > 30 && pk.x < RINK.goalLineRight) f |= 4;
    if (match.lastTouch === 'away' && match.touchX > cx && pk.x < cx && pk.vx < -30 && pk.x > RINK.goalLineLeft) f |= 8;
  }
  return f;
}

// ── Tvorba zápasu ────────────────────────────────────────────────────────────
// hooks: { whistle(rule,lineX), goal(result,scoringTeam), period(p), gameover() } — vše volitelné.
export function createMatch(seed, hooks = {}) {
  const rink = new Rink();
  const puck = new Puck();
  const goalieL = new Goalie('left');
  const goalieR = new Goalie('right');
  const world = new World([rink, goalieL, goalieR, puck], seed);
  world.authoritative = true;
  const match = {
    seed, world, rink, puck, goalieL, goalieR, hooks,
    players: new Map(),   // id -> Player
    inputs:  new Map(),   // id -> input obj
    score: { home: 0, away: 0 },
    tick: 0, _goalAt: 0, loop: null,
  };
  world.allowFreeze = true;   // gólman smí pod tlakem podržet puk (buly v pásmu)
  world.onWhistle = ({ reason, team }) => {
    if (match.ended || match.stoppage || match.offside || match.icing || match.setup) return;
    if (reason === 'freeze') {
      const fx = team === 'home' ? FO_X : RINK.w - FO_X;
      const fy = match.puck.y < RINK.h / 2 ? FO_Y : RINK.h - FO_Y;
      callStoppage(match, 'freeze', null, fx, fy);
      return;
    }
    callStoppage(match, reason, null, RINK.centerX, RINK.h / 2);
  };
  world.onGoal = (result) => {
    if (match.offside || match.icing) return;
    if (match.ended) return;   // po konci zápasu se góly nepočítají
    const scoringTeam = result === 'goal-home' ? 'home' : 'away';
    if (result === 'goal-away') match.score.away++; else match.score.home++;
    match._goalAt = match.tick;
    match.hooks.goal?.(result, scoringTeam);   // střelec/asistence/plus-minus + UI řeší hook (server/klient)
  };
  return match;
}

// ── Herní krok (1 tick) ───────────────────────────────────────────────────────
export function stepMatch(match) {
  match.tick++;

  if (match.world._goalLock && match._goalAt && match.tick - match._goalAt >= ms2ticks(1200)) {
    match._goalAt = 0;
    faceoff(match);
  }
  if (match.stoppage && match.tick - match._whistleAt >= ms2ticks(1300)) {
    match.stoppage = false;
    faceoffAt(match, match._faceoff.x, match._faceoff.y);
  }
  if (match.setup) {
    if (match.fo) { if (stepFaceoff(match)) return; }   // dojezd → příprava → vhazování (QTE)
    else if (match.tick >= match.faceoffUntil) { match.setup = false; match.world._goalLock = false; }
    else return;   // zmrazeno
  }
  if (match.icing && !match.stoppage) {
    const sp = Math.hypot(match.puck.vx, match.puck.vy);
    if (sp < 45 || match.tick - match.icing.t > ms2ticks(2600)) {
      const ic = match.icing; match.icing = null;
      callStoppage(match, 'icing', ic.lineX, ic.fx, ic.fy);
    }
  }
  if (match.offside && !match.stoppage) {
    const sp = Math.hypot(match.puck.vx, match.puck.vy);
    if (sp < 45 || match.tick - match.offside.t > ms2ticks(600)) {
      const off = match.offside; match.offside = null;
      callStoppage(match, 'offside', off.lineX, off.fx, off.fy);
    }
  }

  // Časomíra — běží, když se nehraje oslava gólu a zápas neskončil
  if (!match.ended && !match.world._goalLock) {
    match.clock -= DT;
    if (match.clock <= 0) {
      if (match.period < match.periods) {
        match.period++;
        match.clock = match.minutes * 60;
        faceoff(match);
        match.hooks.period?.(match.period);
      } else {
        match.clock = 0;
        match.ended = true;
        match.hooks.gameover?.();
      }
    }
  }

  // Akce hráčů z jejich vstupů (autoritativně)
  for (const [id, p] of match.players) {
    const inp = match.inputs.get(id);
    if (!inp) continue;
    if (p.isBot) botThink(p, inp, match);
    else if (inp._stamp && Date.now() - inp._stamp > 300) { inp.dx = 0; inp.dy = 0; inp.lmb = false; inp.rmb = false; inp.mmb = false; }
    computeEdges(inp);
    if (!match.world._goalLock) playerActions(p, inp, DT * TEMPO, match);
  }

  const _pv0spd = Math.hypot(match.puck.vx, match.puck.vy), _pv0vx = match.puck.vx;

  const _sc0 = match.score.home + match.score.away, _h0 = match.score.home;
  match.world.update(DT * TEMPO);   // fyzika v herním tempu; časomíra běží reálně
  // Puk přes mantinel u střídaček (Puck._out) → píšťalka + buly uprostřed (platí i bez pravidel, jinak by puk zmizel)
  if (match.puck._out) { match.puck._out = false; if (!match.stoppage && !match.ended) callStoppage(match, 'out', null, RINK.centerX, RINK.h / 2); }

  // SAVE = polní hráč zastaví tvrdou ránu mířící k VLASTNÍ brance
  {
    let saveSid = null;
    if (match.puck._blockBy) { saveSid = match.puck._blockBy; match.puck._blockBy = null; match.puck._blockTeam = null; }
    let curSid = null, curTeam = null;
    for (const [sid, p] of match.players) if (p.hasPuck) { curSid = sid; curTeam = p.team; break; }
    if (!saveSid && curSid && curSid !== match._carrierPrev) {
      const ownGoalDir = curTeam === 'home' ? -1 : 1;
      if (_pv0spd > 200 && Math.sign(_pv0vx) === ownGoalDir) saveSid = curSid;
    }
    match._carrierPrev = curSid;
    if (saveSid && !saveSid.startsWith('bot:') && !match.ended && match.tick - (match._lastSaveTick || -99) > 20) {
      match._lastSaveTick = match.tick;
      if (!match._blocks) match._blocks = new Map();
      match._blocks.set(saveSid, (match._blocks.get(saveSid) || 0) + 1);
    }
  }

  // Poslední dotek (tým + hráč + origin pro icing)
  for (const [sid, p] of match.players) if (p.hasPuck) {
    if (match._lastTouchSid !== sid) {
      match._prevTouchSid  = match._lastTouchSid;
      match._prevTouchTeam = match.lastTouch;
    }
    match.lastTouch = p.team; match.touchX = match.puck.x; match._lastTouchSid = sid;
  }
  _detectFx(match, match.score.home + match.score.away !== _sc0 ? (match.score.home !== _h0 ? 'home' : 'away') : null);
  if (match.rules && !match.stoppage && !match.world._goalLock && !match.ended) checkRules(match);
}

// HLÁŠKY (2026-11-09): kombo přihrávek, ONE-TIMER, PŘESNĚ, FINTA, CLONA → match._fx (jen pozorování, simulaci nemění).
// Server je pošle ve snapshotu (fx), offline klient je čte přímo. Kombo = po sobě jdoucí převzetí v týmu bez ztráty;
// střela řetěz uzavře (počet pasů si nese do případného gólu: KOMBO GÓL od 3 pasů).
export function _detectFx(match, goalTeam) {
  const fx = match._fx || (match._fx = []);
  const push = e => { fx.push(e); if (fx.length > 24) fx.shift(); };
  const live = !match.setup && !match.stoppage && !match.world._goalLock;
  let car = null; for (const p of match.players.values()) if (p.hasPuck) { car = p; break; }
  const sh = match.puck._shot;
  if (sh && sh !== match._lastShot) {
    match._lastShot = sh;
    sh.combo = match._chain && match._chain.team === sh.team ? match._chain.n : 0;
    if (sh.pf) push({ k: 'perfect', id: sh.id, team: sh.team });
    if (sh.ot) push({ k: 'onetimer', id: sh.id, team: sh.team });
    match._chain = { team: sh.team, n: 0, sid: sh.id };
  }
  if (car && live) {
    const c = match._chain;
    if (!c || c.team !== car.team) match._chain = { team: car.team, n: 0, sid: car.id };
    else if (c.sid !== car.id) { c.n++; c.sid = car.id; if (c.n >= 2) push({ k: 'combo', n: c.n, id: car.id, team: car.team }); }
  }
  for (const g of [match.goalieL, match.goalieR]) if (g._fakeEv) { g._fakeEv = false; if (car) push({ k: 'fake', id: car.id, team: car.team }); }
  if (goalTeam) {
    const s = match._lastShot, g = goalTeam === 'home' ? match.goalieR : match.goalieL;
    if (s && s.team === goalTeam) {
      if (s.combo >= 3) push({ k: 'combogoal', n: s.combo, id: s.id, team: goalTeam });
      if ((g._screen || 0) > 0.3 && !((g._fakeT || 0) > 0)) push({ k: 'screen', id: s.id, team: goalTeam });   // clona hráčem, ne doznívající finta
    }
    match._chain = null;
  } else if (!live) match._chain = null;
}
