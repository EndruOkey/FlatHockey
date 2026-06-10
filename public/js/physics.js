import { RINK, PLAYER, PUCK } from './constants.js';

export function makePlayer(id, team) {
  const x = team === 'home' ? 400 : 1400;
  return { id, team, x, y: RINK.h / 2, vx: 0, vy: 0, bodyAngle: 0, aimAngle: 0, hasPuck: false, charge: 0 };
}

export function makePuck() {
  return { x: RINK.centerX, y: RINK.h / 2, vx: 0, vy: 0, ownerId: null };
}

export function tickPlayer(p, input, dt) {
  const len = Math.hypot(input.dx, input.dy);
  const targetVx = len > 0 ? (input.dx / len) * PLAYER.speed : 0;
  const targetVy = len > 0 ? (input.dy / len) * PLAYER.speed : 0;
  const rate = len > 0 ? PLAYER.accel : PLAYER.decel;

  p.vx = approach(p.vx, targetVx, rate * dt);
  p.vy = approach(p.vy, targetVy, rate * dt);

  p.x = clamp(p.x + p.vx * dt, PLAYER.radius, RINK.w - PLAYER.radius);
  p.y = clamp(p.y + p.vy * dt, PLAYER.radius, RINK.h - PLAYER.radius);

  const spd = Math.hypot(p.vx, p.vy);
  if (spd > 30) p.bodyAngle = lerpAngle(p.bodyAngle, Math.atan2(p.vy, p.vx), 10 * dt);
}

export function tickPuck(puck, players, dt) {
  const owner = players.find(p => p.hasPuck);

  if (owner) {
    const tip = getStickTip(owner);
    puck.x = tip.x;
    puck.y = tip.y;
    puck.vx = owner.vx;
    puck.vy = owner.vy;
    puck.ownerId = owner.id;
    return null;
  }

  puck.ownerId = null;

  const spd = Math.hypot(puck.vx, puck.vy);
  if (spd > 0) {
    const newSpd = Math.max(0, spd - PUCK.decel * dt);
    puck.vx = puck.vx / spd * newSpd;
    puck.vy = puck.vy / spd * newSpd;
  }

  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;

  // Top/bottom walls
  if (puck.y < PUCK.radius) { puck.y = PUCK.radius; puck.vy = Math.abs(puck.vy) * PUCK.bounce; }
  if (puck.y > RINK.h - PUCK.radius) { puck.y = RINK.h - PUCK.radius; puck.vy = -Math.abs(puck.vy) * PUCK.bounce; }

  // Goal scoring — puk musí proletět čárou ZEVNITŘ hřiště (zkontrolovat směr)
  const inGoal = puck.y > RINK.goalY && puck.y < RINK.goalY + RINK.goalH;
  if (inGoal && puck.x < RINK.goalLineLeft  && puck.vx < 0) { resetPuck(puck); return 'goal-away'; }
  if (inGoal && puck.x > RINK.goalLineRight && puck.vx > 0) { resetPuck(puck); return 'goal-home'; }

  // Board bouncing
  if (puck.x < PUCK.radius) { puck.x = PUCK.radius; puck.vx = Math.abs(puck.vx) * PUCK.bounce; }
  if (puck.x > RINK.w - PUCK.radius) { puck.x = RINK.w - PUCK.radius; puck.vx = -Math.abs(puck.vx) * PUCK.bounce; }

  // Pickup check for all players
  for (const p of players) {
    if (tryPickup(p, puck)) break;
  }

  return null;
}

export function shoot(player, puck, charge) {
  player.hasPuck = false;
  const spd = PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * charge;
  const tip = getStickTip(player);
  puck.x = tip.x;
  puck.y = tip.y;
  puck.vx = Math.cos(player.aimAngle) * spd;
  puck.vy = Math.sin(player.aimAngle) * spd;
}

export function pass(player, puck) {
  player.hasPuck = false;
  const spd = PUCK.passSpeed;
  const tip = getStickTip(player);
  puck.x = tip.x;
  puck.y = tip.y;
  puck.vx = Math.cos(player.aimAngle) * spd;
  puck.vy = Math.sin(player.aimAngle) * spd;
}

export function getStickTip(player) {
  return {
    x: player.x + Math.cos(player.aimAngle) * PLAYER.stickLen,
    y: player.y + Math.sin(player.aimAngle) * PLAYER.stickLen,
  };
}

function tryPickup(player, puck) {
  const dx = puck.x - player.x;
  const dy = puck.y - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist > PLAYER.pickupRadius) return false;

  const puckAngle = Math.atan2(dy, dx);
  if (Math.abs(angleDiff(puckAngle, player.aimAngle)) > PLAYER.pickupHalfAngle) return false;

  const relSpd = Math.hypot(puck.vx - player.vx, puck.vy - player.vy);
  if (relSpd > PLAYER.pickupMaxRelSpeed) return false;

  player.hasPuck = true;
  return true;
}

export function makeGoalie() {
  return {
    x: RINK.goalLineRight,
    y: RINK.goalY + RINK.goalH / 2,
    radius: 26,
    speed: 230,
  };
}

export function tickGoalie(goalie, puck, dt) {
  const minY = RINK.goalY + goalie.radius;
  const maxY = RINK.goalY + RINK.goalH - goalie.radius;
  const target = clamp(puck.y, minY, maxY);
  const diff = target - goalie.y;
  goalie.y += Math.sign(diff) * Math.min(Math.abs(diff), goalie.speed * dt);
}

export function puckHitsGoalie(puck, goalie) {
  const dx = puck.x - goalie.x;
  const dy = puck.y - goalie.y;
  const dist = Math.hypot(dx, dy);
  const minDist = PUCK.radius + goalie.radius;
  if (dist >= minDist || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  puck.x = goalie.x + nx * (minDist + 1);
  puck.y = goalie.y + ny * (minDist + 1);
  const dot = puck.vx * nx + puck.vy * ny;
  if (dot < 0) {
    puck.vx = (puck.vx - 2 * dot * nx) * PUCK.bounce;
    puck.vy = (puck.vy - 2 * dot * ny) * PUCK.bounce;
  }
  return true;
}

function resetPuck(puck) {
  puck.x = RINK.centerX;
  puck.y = RINK.h / 2;
  const kickAngle = Math.random() * Math.PI * 2;
  puck.vx = Math.cos(kickAngle) * 22;
  puck.vy = Math.sin(kickAngle) * 22;
  puck.vz = 0;
  puck.z  = 0;
  puck.ownerId = null;
  puck.faceoffTimer = 0.7;
}

function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  if (cur > target) return Math.max(cur - step, target);
  return cur;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * Math.min(1, t);
}

function angleDiff(a, b) {
  let d = ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return d;
}
