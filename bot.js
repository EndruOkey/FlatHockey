import { RINK } from './public/js/constants.js';

// Bot = obyčejný Player, jen vstupy (směr, míření, střela) mu generuje server místo klávesnice.
// Stejná fyzika i pravidla jako člověk. Náhoda je seedovaná → stejný zápas = stejné chování.

const THINK_EVERY = 6;            // rozhoduje 10× za s (reakce ~100 ms jako člověk)
const AIM_ERR     = 0.02;         // max chyba míření při střele (rad) — střela podél tyčky snese jen pár px
// Gólman kryje celou bránu proti pomalé střele → bot střílí silně (~0.7 s nápřah) těsně podél horní tyčky
const SHOT_HOLD   = [18, 46];     // ticky nápřahu — širší rozsah: mix přízemních ran (nízké rohy) i tvrdých zvednutých (horní roh), ať bot neskončí jen na roofu proti chytřejšímu gólmanovi
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
const LEAD_MAX     = 0.7;          // s — strop předstihu při pronásledování
const PLAYER_V     = 180;          // px/s — rychlost bruslaře (PLAYER.speed)
const AVOID_R     = 26;           // px — puk blíž než tohle k soupeři → najeď z druhé strany
const REACH       = 13;           // px — dosah čepele před tělem při aimDist 40
const PICK_NEAR   = 45;           // px — od téhle vzdálenosti k puku bot zastaví tělo tak, aby čepel dosáhla
const NET_CLEAR   = 50;           // px — za brankou: dokud je |y od středu| menší, jede se bokem ze sítě
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

// Soupeř drží puk staženě u těla (kurzor < TUCK px) → čepelí se k němu dostaneš jen z blízka; boti sami drží puk s aimDist ≥ 40
const TUCK = 40;
const tucked = (o) => o.hasPuck && (o.aimDist ?? 99) < TUCK;

const clampX = (x, goalX, dir) => (dir > 0 ? Math.min(x, goalX - 90) : Math.max(x, goalX + 90));

// Vyber NEJLEPŠÍHO spoluhráče na přihrávku (ne jen nejbližšího): volný, s čistou dráhou,
// posunutý dopředu k brance. Vrací hráče, nebo null. Simuluje souhru — rozehrávku na volného.
const PASS_LANE   = 16;   // px — poloviční šířka koridoru přihrávky (soupeř uvnitř = zablokováno)
const RECV_OPEN   = 26;   // px — soupeř blíž než tohle k příjemci = není volný
const OPEN_CAP    = 90;   // px — nad tolik už „volnost" příjemce dál neodměňujeme
function pickPass(p, match, dir, goalX, goalY, dist) {
  let pressed = false;
  for (const o of match.players.values())
    if (o.team !== p.team && Math.hypot(o.x - p.x, o.y - p.y) < PRESS_R) { pressed = true; break; }

  let best = null, bestScore = -Infinity, bestDist = 0;
  for (const t of match.players.values()) {
    if (t === p || t.team !== p.team) continue;
    const td = Math.hypot(t.x - p.x, t.y - p.y);
    if (td < PASS_MIN || td > PASS_MAX) continue;
    const ux = (t.x - p.x) / td, uy = (t.y - p.y) / td;
    // Dráha přihrávky nesmí vést přes soupeře; zároveň změř, jak je příjemce volný
    let blocked = false, openR = Infinity;
    for (const o of match.players.values()) {
      if (o.team === p.team) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const al = rx * ux + ry * uy, lat = rx * -uy + ry * ux;
      if (al > 0 && al < td && Math.abs(lat) < PASS_LANE) { blocked = true; break; }
      const dor = Math.hypot(o.x - t.x, o.y - t.y);
      if (dor < openR) openR = dor;
    }
    if (blocked || openR < RECV_OPEN) continue;         // dráha blokovaná / příjemce pokrytý
    const tDist = Math.hypot(goalX - t.x, goalY - t.y);
    const advance = dist - tDist;                        // o kolik je příjemce blíž k brance
    const score = advance + Math.min(openR, OPEN_CAP) * 0.5;
    if (score > bestScore) { bestScore = score; best = t; bestDist = tDist; }
  }
  if (!best) return null;
  const better = bestDist < dist - 20;                   // příjemce je blíž k brance
  // Pod tlakem odehraj na kohokoli rozumného; jinak jen když to posune hru dopředu
  if (pressed) return (better || bestScore > 0) ? best : null;
  return (better && (dist > PASS_FAR || bestScore > 70)) ? best : null;
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
    const mate = (b.passCd > 0) ? null : pickPass(p, match, dir, goalX, goalY, dist);
    if (mate) {
      inp.rmb = true; b.passCd = PASS_CD; p._passTarget = mate.id;   // server přihraje právě tomuto spoluhráči
      inp.aim = Math.atan2(mate.y - p.y, mate.x - p.x);
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
    // Předstih = doba, za kterou bot k puku dojede (max LEAD_MAX), ne pevných 0.25 s — jinak jen ocasí nosiče
    // po kružnici (naměřeno: 65 px za ním, puk držel 98.8 % času) místo aby mu přeťal dráhu
    const lead = Math.min(LEAD_MAX, Math.max(PUCK_LEAD, Math.hypot(puck.x - p.x, puck.y - p.y) / PLAYER_V));
    tx = puck.x + puck.vx * lead; ty = puck.y + puck.vy * lead;
    ax = puck.x; ay = puck.y;
    // Puk těsně u soupeře (buly, scrum): najeď na něj z opačné strany, ne skrz soupeřovo tělo
    // (každý kontakt = knockback 85 px/s → stojícího člověka to odhodí o stovky px)
    const o = nearestOpp(p, match, tx, ty);
    if (o && !tucked(o)) {          // nosiče se staženým pukem (kurzor u těla) NEobjíždí — jde se o puk bojovat, jinak ho jen ocasí
      const ox = tx - o.x, oy = ty - o.y, od = Math.hypot(ox, oy) || 1;
      if (od < AVOID_R) { tx += ox / od * STANDOFF; ty += oy / od * STANDOFF; }
    }
    // Blízko puku se zastav tam, kde čepel (~REACH před tělem) dosáhne na puk; střed těla na puk by čepel
    // posunul za něj a bot by puk donekonečna obíhal (puk ležel 100+ s, bot kolem něj kroužil)
    const pdx = tx - p.x, pdy = ty - p.y, pd = Math.hypot(pdx, pdy);
    if (pd > REACH && pd < PICK_NEAR) { const k = (pd - REACH) / pd; tx = p.x + pdx * k; ty = p.y + pdy * k; }
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
      // ── OBRANA: puk drží soupeř / je volný. Rank 0 (nejblíž puku) tlačí na puk, ostatní
      //    si rozeberou soupeře OSOBNĚ (goal-side marking), ať to vypadá jako hra s lidmi. ──
      const oppCarrier = [...match.players.values()].find(o => o.team !== p.team && o.hasPuck) || null;
      if (rank === 0) {
        // Druhý na puku: tlač na nosiče/puk z vlastní strany (goal-side), ať ho zatlačí od branky
        const lead = Math.min(LEAD_MAX, Math.max(PUCK_LEAD, Math.hypot(puck.x - p.x, puck.y - p.y) / PLAYER_V));
        tx = puck.x + puck.vx * lead + dir * -6; ty = puck.y + puck.vy * lead;
      } else {
        // Nejnebezpečnější soupeři (bez nosiče — toho řeší chaser) = nejblíž naší brance; rozeber je
        const threats = [...match.players.values()]
          .filter(o => o.team !== p.team && o !== oppCarrier)
          .sort((a, c) => (Math.hypot(a.x - ownX, a.y - goalY) - Math.hypot(c.x - ownX, c.y - goalY)) || (a.id < c.id ? -1 : 1));
        const mark = threats[rank - 1] || threats[threats.length - 1] || null;
        if (mark) {
          // Postav se mezi soupeře a vlastní branku (goal-side), blíž k soupeři → bere pas i nájezd
          tx = mark.x + (ownX - mark.x) * 0.25; ty = mark.y + (goalY - mark.y) * 0.25;
          ax = mark.x; ay = mark.y;                 // čelem k bráněnému hráči
        } else {
          // Nikoho k bránění → stáhni se před vlastní branku (slot)
          tx = ownX + dir * CREASE_OUT; ty = goalY + side * 24;
        }
      }
    }
  }

  // Za kteroukoli brankovou čarou, v šířce sítě: nejdřív vyjeď bokem ze sítě (rovně by narazil do sítě/brankáře
  // a zůstal na místě navždy — naměřeno: bot s pukem i bez něj tam stál 100+ s)
  if ((p.x < RINK.goalLineLeft + 4 || p.x > RINK.goalLineRight - 4) && Math.abs(p.y - goalY) < NET_CLEAR) {
    tx = p.x; ty = goalY + (p.y >= goalY ? 1 : -1) * (NET_CLEAR + 25);
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
        if (!p.hasPuck && tucked(o)) continue;   // nosič se staženým pukem není překážka, ale cíl
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
