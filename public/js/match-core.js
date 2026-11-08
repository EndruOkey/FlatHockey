// Sdílené herní jádro (autoritativní, deterministické) — běží STEJNĚ na serveru i v prohlížeči.
// Server ho krokuje v setInterval smyčce a efekty (píšťalka/gól/konec) posílá sítí; klient ho
// v lokálním režimu (zápas s boty) krokuje přímo každý frame → žádná síť = plynule + nulová latence.
// Veškerá náhoda je seedovaná (World rng, bot brain), žádný Math.random ani wall-clock v logice kroku.
//
// Efekty, které nejsou čistá simulace (síť/DB/UI), jdou přes match.hooks:
//   whistle(rule, lineX)  · goal(result, scoringTeam)  · period(period)  · gameover()
// Server je naplní io.emit + statistikami; klient lokální obsluhou. Když hook chybí, jen se přeskočí.
import { RINK, PUCK, TEMPO } from './constants.js';
import { lerpAngle, clamp } from './utils.js';
import { World } from './world.js';
import { Player } from './entities/Player.js';
import { Puck } from './entities/Puck.js';
import { Goalie } from './entities/Goalie.js';
import { Rink } from './entities/Rink.js';
import { botThink } from './bot.js';

const CHARGE_RATE = 1.2;       // pomalejší nápřah → slap shot je cítit jako wind-up (méně twitchy)
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const ms2ticks = ms => Math.round(ms * TICK_HZ / 1000);   // herní časovače v ticích, ne ve wall-clocku (determinismus)

// ── Vstupy ───────────────────────────────────────────────────────────────
export function makeInput() {
  return {
    dx: 0, dy: 0, lmb: false, rmb: false, mmb: false,
    aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false,
    _p: { lmb: false, rmb: false, mmb: false }, // předchozí stav pro hrany
  };
}
const dir1 = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
export function applyClientInput(inp, msg) {
  if (!msg || typeof msg !== 'object') return;
  inp.dx = dir1(msg.dx); inp.dy = dir1(msg.dy);
  inp.keys.Space = !!msg.space;
  inp.lmb = !!msg.lmb; inp.rmb = !!msg.rmb; inp.mmb = !!msg.mmb;
  if (Number.isFinite(msg.aim))     inp.aim     = msg.aim;
  if (Number.isFinite(msg.aimDist)) inp.aimDist = clamp(msg.aimDist, 0, 4000);
}
export function computeEdges(inp) {
  inp.lmbJustPressed  = inp.lmb && !inp._p.lmb;
  inp.lmbJustReleased = !inp.lmb && inp._p.lmb;
  inp.rmbJustPressed  = inp.rmb && !inp._p.rmb;
  inp.mmbJustPressed  = inp.mmb && !inp._p.mmb;
  inp._p.lmb = inp.lmb; inp._p.rmb = inp.rmb; inp._p.mmb = inp.mmb;
}

// ── Akce hráče (charge/střela/přihrávka/aim) ───────────────────────────────
function _updateAim(p, rawAim, dt) {
  const d = p.aimDist ?? 100;
  const rate = clamp(d / 35, 0.12, 1) * 28;
  p.aimAngle = lerpAngle(p.aimAngle, rawAim, Math.min(1, rate * dt));
}
const LEAD_K = (typeof process !== 'undefined' && process.env && process.env.FH_LEADK) ? Number(process.env.FH_LEADK) : 0.7;   // změřeno scripts/pass_test.mjs: 0.7 → 92 % převzatých (dřív 46 %)
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

  if (inp.lmbJustPressed) { p._chargeCancelled = false; p._oneTimer = !p.hasPuck; }
  if (!inp.lmb) p._chargeBlocked = false;

  if (inp.rmb && !p.hasPuck && p.charge > 0) {
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._oneTimer = false;
  }

  if (inp.lmb && !p._chargeBlocked && !(inp.rmb && !p.hasPuck)) {
    if (!p._chargeDecaying) {
      const cap = (p.hasPuck && !p._oneTimer) ? 1 : 0.95;
      p.charge = Math.min(cap, p.charge + CHARGE_RATE * dt);
      if (p.charge >= 1 && p.hasPuck && !p._oneTimer) { p._chargeDecaying = true; p.overcharged = true; }
    } else if (p.hasPuck) {
      p.charge = Math.max(0, p.charge - CHARGE_RATE * 1.8 * dt);
      if (p.charge <= 0) { p.shoot(match.puck, 0.12); p.charge = 0; p._chargeDecaying = false; p.overcharged = false; }
    } else { p._chargeDecaying = false; p.overcharged = false; }
  }

  const rmbCancelledCharge = inp.rmbJustPressed && p.hasPuck && p.charge > 0;
  if (inp.lmbJustReleased && !rmbCancelledCharge) {
    if (p.hasPuck && !p._chargeCancelled) p.shoot(match.puck, p.charge);
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeCancelled = false; p._oneTimer = false;
  }

  if (inp.rmbJustPressed && p.hasPuck) {
    if (p.charge > 0.08) { p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeBlocked = true; p._chargeCancelled = true; }
    else {
      let tgt = null;
      if (p.isBot && p._passTarget) {
        const cand = match.players.get(p._passTarget);
        if (cand && cand !== p && cand.team === p.team) tgt = cand;
      } else if (!p.isBot) {
        tgt = pickHumanPass(p, match);
      }
      if (!tgt) tgt = nearestTeammate(p, match);
      p._passTarget = null;
      if (tgt) {
        p.charge = 0;
        const tip = p.stickTip;
        const dist = Math.hypot(tgt.x - tip.x, tgt.y - tip.y);
        const sp = clamp(Math.sqrt(2 * PUCK.decel * dist) + 110, 210, PUCK.maxPassSpeed);
        p.pass(match.puck, leadAim(tip, tgt, sp), sp);
      }
    }
  }

  if (inp.mmbJustPressed && !p.hasPuck) p.passReq = 0.9;
}

export function rebuildEntities(match) {
  match.world.entities = [match.rink, ...match.players.values(), match.goalieL, match.goalieR, match.puck];
}

// ── Vhazování ──────────────────────────────────────────────────────────────
const FO_X = 248, FO_Y = 114;   // buly body v pásmech (stejné jako kreslí Rink.js)
export function faceoffAt(match, fx, fy) {
  for (const g of [match.goalieL, match.goalieR]) if (g) { g._holdTimer = 0; g._heldPuck = null; g._froze = false; }
  const home = [], away = [];
  for (const p of match.players.values()) (p.team === 'home' ? home : away).push(p);
  const SPOTS = [
    [16,   0],   // centr — na buly bodě
    [26, -54],   // křídlo
    [26,  54],   // křídlo
    [86, -34],   // obránce
    [86,  34],   // obránce
  ];
  const place = (arr, dir) => {   // dir: home = +1 (útočí vpravo), away = -1
    arr.forEach((p, i) => {
      const spot = SPOTS[Math.min(i, SPOTS.length - 1)];
      const back = spot[0] + (i >= SPOTS.length ? (i - SPOTS.length + 1) * 26 : 0);
      p.x = fx - dir * back;
      p.y = RINK.h / 2 + (fy - RINK.h / 2) * 0 + spot[1];
      p.vx = p.vy = 0; p.hasPuck = false; p.charge = 0;
      p._chargeDecaying = false; p._oneTimer = false;
      const fa = Math.atan2(fy - p.y, fx - p.x);   // čelem k buly bodu
      p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = fa;
    });
  };
  place(home, 1);
  place(away, -1);
  match.puck.reset();
  match.puck.x = fx; match.puck.y = fy; match.puck.prevX = fx; match.puck.prevY = fy;
  match.lastTouch = null; match.touchX = fx;
  match.icing = null; match.offside = null; match._goalAt = 0; match.stoppage = false; match._whistleAt = 0;
  match.setup = true;
  match.faceoffUntil = match.tick + ms2ticks(900);
  match.world._goalLock = true;
}
export function faceoff(match) { faceoffAt(match, RINK.centerX, RINK.h / 2); }

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
    if (match.tick >= match.faceoffUntil) { match.setup = false; match.world._goalLock = false; }
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
    if (sp < 45 || match.tick - match.offside.t > ms2ticks(2000)) {
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

  match.world.update(DT * TEMPO);   // fyzika v herním tempu; časomíra běží reálně

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
  if (match.rules && !match.stoppage && !match.world._goalLock && !match.ended) checkRules(match);
}
