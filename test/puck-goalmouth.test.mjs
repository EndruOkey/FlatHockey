// Test puku u ústí branky (nesený puk): node test/puck-goalmouth.test.mjs  (exit 1 = selhání)
// Pravidla: A) žádný gól nesením  B) puk se u ústí nezasekne  C) obejetí za sítí drží puk
//           D) volný puk střelou skóruje  E) tělo hráče v kleci -> puk se odhodí bez gólu
import { RINK } from '../public/js/constants.js';
import { World } from '../public/js/world.js';
import { Rink } from '../public/js/entities/Rink.js';
import { Puck } from '../public/js/entities/Puck.js';
import { Goalie } from '../public/js/entities/Goalie.js';
import { Player } from '../public/js/entities/Player.js';

// seedovaná náhoda (mulberry32) → deterministické
let _s = 12345;
Math.random = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const DT = 1 / 60;
const GY1 = RINK.goalY, GY2 = RINK.goalY + RINK.goalH, YC = (GY1 + GY2) / 2, D = RINK.goalDepth;
const lineOf = s => (s > 0 ? RINK.goalLineRight : RINK.goalLineLeft);
const mx = (s, x) => (s > 0 ? x : RINK.w - x);          // zrcadlení x pro levou branku
const results = [];
const check = (ok, name) => { results.push([ok, name]); console.log((ok ? 'OK   ' : 'FAIL ') + name); };

function makeInput() {
  return { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false,
    _p: { lmb: false, rmb: false, mmb: false } };
}

// svět jako createMatch v server.js; goalies=false → bez brankářů
function build(goalies = true) {
  const puck = new Puck();
  const ents = [new Rink()];
  if (goalies) ents.push(new Goalie('left'), new Goalie('right'));
  ents.push(puck);
  const world = new World(ents);
  world.authoritative = true;
  const p = new Player('t', 'away', makeInput());
  ents.push(p);
  return { world, puck, p };
}

// s = +1 pravá branka, -1 levá. Hráč v (u,y) kde u = hloubka do branky od čáry (záporné = před čárou)
function carrier(s, u, y, goalies = true) {
  const m = build(goalies);
  m.p.x = lineOf(s) + s * u; m.p.y = y;
  m.p.aim = s > 0 ? 0 : Math.PI; m.p.skateAngle = m.p.bodyAngle = m.p.carryAngle = m.p._stickDisp = m.p.aim;
  m.p.hasPuck = true;
  m.puck.x = m.p.x; m.puck.y = m.p.y; m.puck.prevX = m.puck.x; m.puck.prevY = m.puck.y;
  m.goal = null; m.violations = []; m.dropped = false;
  return m;
}

function step(m, inputFn, ticks, onTick) {
  // Během simulace náhoda = 0.999: hráč nikdy „nesklouzne" puk (anti-helikoptéra v Player.js) → test měří jen geometrii
  const rnd = m.world.rng; m.world.rng = { next: () => 0.999, range: (lo, hi) => lo + (hi - lo) * 0.999 };
  try { _step(m, inputFn, ticks, onTick); } finally { m.world.rng = rnd; }
}
function _step(m, inputFn, ticks, onTick) {
  for (let i = 0; i < ticks; i++) {
    inputFn?.(m.p.input, i);
    m.world.update(DT);
    if (m.puck.goalScored && !m.goal) m.goal = m.puck.goalScored;
    if (!m.p.hasPuck) m.dropped = true;
    onTick?.(i);
  }
}

// puk nesený hráčem: smí být uvnitř klece / za čárou mezi tyčkami?
function carriedInCage(m, s) {
  if (!m.p.hasPuck) return false;
  const u = s * (m.puck.x - lineOf(s));
  return m.puck.y > GY1 && m.puck.y < GY2 && u > 0 && u < D && s * (m.p.x - lineOf(s)) <= D;
}

for (const s of [+1, -1]) {
  const side = s > 0 ? 'pravá' : 'levá';

  // A) nesení rovně do ústí, různé y a rychlosti (rychlost = zpožděný start dx)
  for (const dy of [0, -16, 16, -21, 21]) {
    for (const dist of [60, 25]) {
      const m = carrier(s, -dist, YC + dy);
      let bad = false;
      step(m, inp => { inp.dx = s; inp.dy = 0; inp.aim = s > 0 ? 0 : Math.PI; inp.aimDist = 100; }, 240,
        () => { if (carriedInCage(m, s)) bad = true; });
      check(!bad, `A ${side} nesený puk nikdy uvnitř klece (y${dy >= 0 ? '+' : ''}${dy}, start ${dist}px před čárou)`);
      check(!m.goal, `A ${side} žádný gól nesením (y${dy >= 0 ? '+' : ''}${dy}, start ${dist}px)`);
    }
  }

  // A) nesení podél brankové čáry před ústím (hráč jede po čáře nahoru→dolů)
  {
    const m = carrier(s, -14, GY1 - 40, false);
    let bad = false;
    step(m, inp => { inp.dx = 0; inp.dy = 1; inp.aim = s > 0 ? 0 : Math.PI; }, 150, () => { if (carriedInCage(m, s)) bad = true; });
    check(!bad && !m.goal, `A ${side} jízda podél brankové čáry: puk nevjede do klece, žádný gól`);
    check(m.p.hasPuck, `C ${side} jízda podél čáry: hráč si puk drží`);
  }

  // C) obejetí za sítí (shora dolů za zadní stěnou)
  {
    const m = carrier(s, D + 22, GY1 - 25, false);
    step(m, inp => { inp.dx = 0; inp.dy = 1; inp.aim = s > 0 ? 0 : Math.PI; }, 130);
    check(m.p.hasPuck && !m.goal, `C ${side} obejetí za sítí: puk drží, žádný gól`);
    check(m.p.y > GY2 + 5, `C ${side} obejetí za sítí: hráč projel (y=${m.p.y.toFixed(0)})`);
  }
  // C) obejetí zespodu nahoru + dotek zadní stěny
  {
    const m = carrier(s, D + 22, GY2 + 25, false);
    step(m, inp => { inp.dx = -s * 0.2; inp.dy = -1; inp.aim = s > 0 ? 0 : Math.PI; }, 130);
    check(m.p.hasPuck && !m.goal, `C ${side} obejetí za sítí zdola nahoru: puk drží, žádný gól (has=${m.p.hasPuck} goal=${m.goal} p=${m.p.x.toFixed(0)},${m.p.y.toFixed(0)})`);
  }

  // B) zastav na okraji ústí a otoč se pryč: puk jde s hráčem a nezasekne se
  {
    const m = carrier(s, -30, YC, false);
    let velOk = true;   // tolerance 15 px/s = zpoždění o jeden tik (puk se hýbe před hráčem)
    step(m, inp => { inp.dx = s; inp.aim = s > 0 ? 0 : Math.PI; }, 120, () => { if (m.p.hasPuck && Math.hypot(m.puck.vx - m.p.vx, m.puck.vy - m.p.vy) > 15) velOk = false; });
    const held = m.p.hasPuck;
    step(m, inp => { inp.dx = 0; inp.dy = 0; }, 30);
    check(velOk, `B ${side} puk u ústí nemá nulovanou rychlost (v puku = v hráče)`);
    const u0 = s * (m.puck.x - lineOf(s));
    step(m, inp => { inp.dx = -s; inp.dy = 0; inp.aim = s > 0 ? Math.PI : 0; inp.aimDist = 100; }, 90);
    const u1 = s * (m.puck.x - lineOf(s));
    check(held && m.p.hasPuck && u1 < u0 - 20 && Math.hypot(m.puck.x - m.p.x, m.puck.y - m.p.y) < 40 && !m.goal,
      `B ${side} po otočení pryč puk následuje hráče (u ${u0.toFixed(0)} -> ${u1.toFixed(0)})`);
  }

  // E) tělo hráče v kleci: puk se odhodí a nesmí z toho být gól
  {
    const m = carrier(s, -10, YC, false);
    step(m, inp => { inp.dx = s; inp.aim = s > 0 ? 0 : Math.PI; }, 200);
    check(!m.goal, `E ${side} hráč vjede do klece: bez gólu (puk ${m.p.hasPuck ? 'držen' : 'odhozen'})`);
    const stillCarriedIn = m.p.hasPuck && carriedInCage(m, s);
    check(!stillCarriedIn, `E ${side} puk nikdy nezůstane nesený v kleci`);
  }

  // D) střela volného puku musí skórovat (bez brankářů; blízko tyček i střed)
  for (const dy of [0, -15, 15]) {
    const m = build(false);
    m.puck.x = lineOf(s) - s * 80; m.puck.y = YC + dy * 1.0; m.puck.prevX = m.puck.x; m.puck.prevY = m.puck.y;
    m.puck.vx = s * 450; m.puck.vy = 0;
    m.p.x = RINK.centerX; m.p.y = 20;
    step(m, null, 90);
    check(m.goal === (s > 0 ? 'goal-home' : 'goal-away'), `D ${side} volný puk střelou skóruje (y${dy >= 0 ? '+' : ''}${dy})`);
  }
}

const failed = results.filter(r => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
