import { RINK } from './public/js/constants.js';

// Bot = obyčejný Player, jen vstupy (směr, míření, střela) mu generuje server místo klávesnice.
// Stejná fyzika i pravidla jako člověk. Náhoda je seedovaná → stejný zápas = stejné chování.

const THINK_EVERY = 6;            // rozhoduje 10× za s (reakce ~100 ms jako člověk)
const AIM_ERR     = 0.02;         // max chyba míření při střele (rad) — střela podél tyčky snese jen pár px
// Gólman kryje celou bránu proti pomalé střele → bot střílí silně (~0.7 s nápřah) těsně podél horní tyčky
const SHOT_HOLD   = [36, 48];     // ticky nápřahu (0.6–0.8 s → síla ~0.72–0.96, pod přetažením)
const SHOT_RANGE  = [130, 170];   // px od branky, odkud bot vystřelí
const QUICK_RANGE = 40;           // úplně zblízka rychlá střela (gólman je do ~28 px vypíchne)
const QUICK_HOLD  = 6;
const LANE        = 8;            // px nad středem — bot najíždí skoro středem, gólman tam stojí nejblíž ose
const SLOT_Y      = 48;           // střílí jen z úzkého slotu kolem osy (|y od středu| < SLOT_Y)
const COAST       = 0.35;         // s — kam bot dojede setrvačností za nápřahu (do slotu se počítá s tím)
const BRAKE_V     = 25;           // px/s — nad tuhle rychlostí bot za nápřahu brzdí
const CORNER_IN   = 2;            // px od horní tyčky, kam míří
const CREASE_OUT  = 140;          // px před brankou — kam se stáhne, když gólman drží puk
const PUCK_LEAD   = 0.25;         // s — jede tam, kam puk dojede, ne kde je
const AVOID_R     = 26;           // px — puk blíž než tohle k soupeři → najeď z druhé strany
const STANDOFF    = 12;           // px za puk (směrem od soupeře)
const LOOK        = 120;          // px — jak daleko dopředu hledá soupeře v cestě
const CLEAR       = 26;           // px — boční odstup od soupeře na dráze (poloměry 7+7 + rezerva)
const PRESS_R     = 34;           // px — soupeř takhle blízko = nátlak → pas
const PASS_MIN    = 50, PASS_MAX = 260, PASS_CD = 90;   // px / ticky pauzy mezi pasy
const PASS_FAR    = 150;          // px od branky: dál než to se vyplatí přihrát lepšímu
const SUP_AHEAD   = 80, SUP_BACK = 55, SUP_WIDE = 100;  // rozestavení podpory
const DIAG        = 0.38;         // práh pro diagonálu (8 směrů jako WASD)

// Malý seedovaný PRNG (mulberry32) — deterministický, bez Math.random
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const between = (rng, [lo, hi]) => lo + (hi - lo) * rng();

export function makeBotBrain(seed) {
  const rng = mulberry32(seed);
  return { rng, hold: 0, shotAim: 0, shotRange: between(rng, SHOT_RANGE) };
}

// Je p ze svého týmu nejblíž k puku? (ostatní hrají podporu, ať se neshluknou)
function isChaser(p, match) {
  const d = (o) => Math.hypot(o.x - match.puck.x, o.y - match.puck.y);
  const mine = d(p);
  for (const o of match.players.values())
    if (o !== p && o.team === p.team && d(o) < mine) return false;
  return true;
}

const clampX = (x, goalX, dir) => (dir > 0 ? Math.min(x, goalX - 90) : Math.max(x, goalX + 90));

// Je pas na nejbližšího spoluhráče (ten, kterého vybere server) dobrý nápad?
function wantPass(p, match, dir, goalX, goalY, dist) {
  let t = null, td = Infinity, pressed = false;
  for (const o of match.players.values()) {
    if (o === p) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (o.team === p.team) { if (d < td) { td = d; t = o; } }
    else if (d < PRESS_R) pressed = true;
  }
  if (!t || td < PASS_MIN || td > PASS_MAX) return false;
  // Cesta pasu nesmí vést přes soupeře
  const ux = (t.x - p.x) / td, uy = (t.y - p.y) / td;
  for (const o of match.players.values()) {
    if (o.team === p.team) continue;
    const rx = o.x - p.x, ry = o.y - p.y, al = rx * ux + ry * uy;
    if (al > 0 && al < td && Math.abs(rx * -uy + ry * ux) < 16) return false;
  }
  // Soupeř u příjemce → nepřihrávat
  for (const o of match.players.values()) if (o.team !== p.team && Math.hypot(o.x - t.x, o.y - t.y) < 24) return false;
  const tDist = Math.hypot(goalX - t.x, goalY - t.y);
  const better = tDist < dist - 30;            // příjemce je blíž k brance
  return pressed ? (better || tDist < dist + 40) : (better && dist > PASS_FAR);
}

function nearestOpp(p, match, x, y) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o.team === p.team) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function botThink(p, inp, match) {
  const b = p.brain;
  inp.rmb = false;                        // RMB = jen jednotikový impuls (pas); jinak by bez puku dělal crossCheck
  // Nápřah běží → drž LMB, puštěním (hrana) server vystřelí
  if (b.hold > 0) {
    b.hold--;
    // Za nápřahu brzdí (protisměr k rychlosti), ať nedojede do brankoviště / mimo slot
    inp.dx = Math.abs(p.vx) > BRAKE_V ? -Math.sign(p.vx) : 0;
    inp.dy = Math.abs(p.vy) > BRAKE_V ? -Math.sign(p.vy) : 0;
    inp.lmb = b.hold > 0 && p.hasPuck;
    // Míření dopočítávám každý tick z aktuální polohy (bot za nápřahu dojíždí) + pevná chyba střelce
    const tip = p.stickTip;               // puk vyletí z čepele, ne ze středu hráče → míří se z ní
    inp.aim = Math.atan2(b.shotY - tip.y, b.shotX - tip.x) + b.aimErr;
    if (!inp.lmb) b.hold = 0;
    return;
  }
  if (match.tick % THINK_EVERY) return;   // mezi rozhodnutími drží poslední vstup

  const puck = match.puck;
  const dir   = p.team === 'home' ? 1 : -1;               // home útočí vpravo
  const goalX = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft;
  const ownX  = dir > 0 ? RINK.goalLineLeft : RINK.goalLineRight;
  const goalY = RINK.goalY + RINK.goalH / 2;
  let tx, ty, ax, ay;

  const g = puck.x < RINK.centerX ? match.goalieL : match.goalieR;   // gólman u puku

  if (p.hasPuck && !b.hadPuck) b.lane = -1;   // nové držení → vyber stranu
  b.hadPuck = p.hasPuck;

  if (p.hasPuck) {
    const behind = (p.x - goalX) * dir > -4;               // za brankovou čarou → vyjeď do slotu
    tx = goalX - dir * (behind ? 90 : 110); ty = goalY + (behind ? 0 : b.lane * LANE);
    ax = goalX; ay = goalY;
    const dist = Math.hypot(goalX - p.x, goalY - p.y);
    if (b.passCd > 0) b.passCd -= THINK_EVERY;
    if (!(b.passCd > 0) && wantPass(p, match, dir, goalX, goalY, dist)) {
      inp.rmb = true; b.passCd = PASS_CD;      // server přihraje nejbližšímu spoluhráči (wantPass ho zná)
      inp.aim = Math.atan2(goalY - p.y, goalX - p.x);
      return;
    }
    if (!behind && dist < b.shotRange && Math.abs(p.y + p.vy * COAST - goalY) < SLOT_Y) {
      // Střela do rohu (viz níže)
      // Roh dál od gólmana (obě tyčky); při shodě (|odchylka| < 2 px) rozhodne seedovaný rng
      const off = g.y - goalY;
      const side = Math.abs(off) < 2 ? (b.rng() < 0.5 ? -1 : 1) : (off > 0 ? -1 : 1);
      const cy = goalY + side * (RINK.goalH / 2 - CORNER_IN);
      b.shotX = goalX; b.shotY = cy;
      b.aimErr = (b.rng() * 2 - 1) * AIM_ERR;
      b.shotAim = Math.atan2(cy - p.y, goalX - p.x) + b.aimErr;
      b.hold = dist < QUICK_RANGE ? QUICK_HOLD : Math.round(between(b.rng, SHOT_HOLD));
      b.shotRange = between(b.rng, SHOT_RANGE);
      inp.lmb = true;
      inp.aim = b.shotAim;
      inp.aimDist = 300;
      return;
    }
  } else if (g.isHolding) {
    // Gólman drží puk → neblokuj brankoviště, počkej před ním
    tx = g.netX + g.inX * CREASE_OUT; ty = goalY;
    ax = puck.x; ay = puck.y;
  } else if (isChaser(p, match)) {
    tx = puck.x + puck.vx * PUCK_LEAD; ty = puck.y + puck.vy * PUCK_LEAD;
    ax = puck.x; ay = puck.y;
    // Puk těsně u soupeře (buly, scrum): najeď na něj z opačné strany, ne skrz soupeřovo tělo
    // (každý kontakt = knockback 85 px/s → stojícího člověka to odhodí o stovky px)
    const o = nearestOpp(p, match, tx, ty);
    if (o) {
      const ox = tx - o.x, oy = ty - o.y, od = Math.hypot(ox, oy) || 1;
      if (od < AVOID_R) { tx += ox / od * STANDOFF; ty += oy / od * STANDOFF; }
    }
  } else {
    ax = puck.x; ay = puck.y;
    const mates = [];                          // spoluhráči bez puku, seřazení podle vzdálenosti k puku (shoda → id)
    let carrier = null;
    for (const o of match.players.values()) {
      if (o.team !== p.team) continue;
      if (o.hasPuck) carrier = o; else mates.push(o);
    }
    mates.sort((a, c) => (Math.hypot(a.x - puck.x, a.y - puck.y) - Math.hypot(c.x - puck.x, c.y - puck.y)) || (a.id < c.id ? -1 : 1));
    const rank = mates.indexOf(p);
    const side = puck.y < RINK.h / 2 ? 1 : -1;  // strana ledu OPAČNÁ k puku
    if (carrier) {
      // Náš hráč drží puk: nejbližší jde do útoku na opačné straně (volný pro pas), ostatní se drží za pukem
      if (rank === 0) {
        tx = clampX(puck.x + dir * SUP_AHEAD, goalX, dir); ty = RINK.h / 2 + side * SUP_WIDE;
      } else {
        tx = puck.x - dir * SUP_BACK * rank; ty = RINK.h / 2 - side * SUP_WIDE * 0.5;
      }
    } else {
      // Puk drží soupeř / je volný: každý jiný pás mezi pukem a vlastní brankou (ne všichni na jednom místě)
      const f = rank <= 0 ? 0.5 : 0.75;
      tx = puck.x + (ownX - puck.x) * f; ty = goalY + (puck.y - goalY) * (rank <= 0 ? 0.6 : 0.3) + (rank > 0 ? side * 30 : 0);
    }
  }

  // Obejdi soupeře ležícího na cestě (kontakt = knockback 85 px/s). Dívá se dopředu po přímce k cíli,
  // uhne na tu stranu, kde soupeř NENÍ; bez soupeře na dráze se cíl nemění.
  {
    const ux0 = tx - p.x, uy0 = ty - p.y, m0 = Math.hypot(ux0, uy0);
    if (m0 > 1) {
      const ux = ux0 / m0, uy = uy0 / m0, nx = -uy, ny = ux;
      let bestAlong = Infinity, bestLat = 0;
      for (const o of match.players.values()) {
        if (o.team === p.team) continue;
        const rx = o.x - p.x, ry = o.y - p.y;
        const along = rx * ux + ry * uy, lat = rx * nx + ry * ny;
        if (along > 0 && along < Math.min(m0 - 4, LOOK) && Math.abs(lat) < CLEAR && along < bestAlong) { bestAlong = along; bestLat = lat; }
      }
      if (bestAlong < Infinity) {
        const side = bestLat > 0.5 ? -1 : bestLat < -0.5 ? 1 : (p.y < RINK.h / 2 ? 1 : -1);
        tx = p.x + ux * bestAlong + nx * side * CLEAR * 1.6; ty = p.y + uy * bestAlong + ny * side * CLEAR * 1.6;
      }
    }
  }
  const mx = tx - p.x, my = ty - p.y, m = Math.hypot(mx, my);
  inp.dx = m > 6 && Math.abs(mx) / m > DIAG ? Math.sign(mx) : 0;
  inp.dy = m > 6 && Math.abs(my) / m > DIAG ? Math.sign(my) : 0;
  inp.lmb = false;
  inp.aim = Math.atan2(ay - p.y, ax - p.x);
  inp.aimDist = Math.max(40, Math.hypot(ax - p.x, ay - p.y));
}
