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

  // Left/right walls — goal opening lets puck through
  const inGoal = puck.y > RINK.goalY && puck.y < RINK.goalY + RINK.goalH;

  if (puck.x < PUCK.radius) {
    if (inGoal) {
      if (puck.x < -60) { resetPuck(puck); return 'goal-away'; }
    } else {
      puck.x = PUCK.radius;
      puck.vx = Math.abs(puck.vx) * PUCK.bounce;
    }
  }

  if (puck.x > RINK.w - PUCK.radius) {
    if (inGoal) {
      if (puck.x > RINK.w + 60) { resetPuck(puck); return 'goal-home'; }
    } else {
      puck.x = RINK.w - PUCK.radius;
      puck.vx = -Math.abs(puck.vx) * PUCK.bounce;
    }
  }

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

function resetPuck(puck) {
  puck.x = RINK.centerX;
  puck.y = RINK.h / 2;
  puck.vx = 0;
  puck.vy = 0;
  puck.ownerId = null;
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
