import { RINK } from './public/js/constants.js';

// Bot = obyčejný Player, jen vstupy (směr, míření, střela) mu generuje server místo klávesnice.
// Stejná fyzika i pravidla jako člověk. Náhoda je seedovaná → stejný zápas = stejné chování.

const THINK_EVERY = 6;            // rozhoduje 10× za s (reakce ~100 ms jako člověk)
const AIM_ERR     = 0.02;         // max chyba míření při střele (rad) — střela podél tyčky snese jen pár px
// Gólman kryje celou bránu proti pomalé střele → bot střílí silně (~0.7 s nápřah) těsně podél horní tyčky
const SHOT_HOLD   = [36, 48];     // ticky nápřahu (0.6–0.8 s → síla ~0.72–0.96, pod přetažením)
const SHOT_RANGE  = [110, 150];   // px od branky, odkud bot vystřelí
const QUICK_RANGE = 40;           // úplně zblízka rychlá střela (gólman je do ~28 px vypíchne)
const QUICK_HOLD  = 6;
const LANE        = 8;            // px nad středem — bot najíždí skoro středem, gólman tam stojí nejblíž ose
const SLOT_Y      = 26;           // střílí jen z úzkého slotu kolem osy (|y od středu| < SLOT_Y)
const COAST       = 0.35;         // s — kam bot dojede setrvačností za nápřahu (do slotu se počítá s tím)
const BRAKE_V     = 25;           // px/s — nad tuhle rychlostí bot za nápřahu brzdí
const CORNER_IN   = 2;            // px od horní tyčky, kam míří
const CREASE_OUT  = 140;          // px před brankou — kam se stáhne, když gólman drží puk
const PUCK_LEAD   = 0.25;         // s — jede tam, kam puk dojede, ne kde je
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

export function botThink(p, inp, match) {
  const b = p.brain;
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
  } else {
    // Podpora: mezi pukem a vlastní brankou
    tx = (puck.x + ownX) / 2; ty = (puck.y + goalY) / 2;
    ax = puck.x; ay = puck.y;
  }

  const mx = tx - p.x, my = ty - p.y, m = Math.hypot(mx, my);
  inp.dx = m > 6 && Math.abs(mx) / m > DIAG ? Math.sign(mx) : 0;
  inp.dy = m > 6 && Math.abs(my) / m > DIAG ? Math.sign(my) : 0;
  inp.lmb = false;
  inp.aim = Math.atan2(ay - p.y, ax - p.x);
  inp.aimDist = Math.max(40, Math.hypot(ax - p.x, ay - p.y));
}
