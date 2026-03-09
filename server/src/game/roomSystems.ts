import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';
import { resolvePuckStickTuning } from '@flathockey/shared/tuning/puckStickTuning';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const RINK = {
  left: -560,
  right: 560,
  top: -320,
  bottom: 320
};

type Vec2 = { x: number; y: number };

export function stickTarget(room: any, player: any): Vec2 {
  // Stick removed: gameplay anchor is player center.
  return {
    x: player.x,
    y: player.y
  };
}

export function dropPuckFrom(room: any, playerId: string | null) {
  if (!playerId) return;
  if (room.puck.state !== 'HELD' || room.puck.ownerId !== playerId) return;
  room.puck.state = 'FREE';
  room.puck.ownerId = null;
  room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, 180);
}

export function updatePuck(room: any, dt: number) {
  const puckStick = resolvePuckStickTuning(room.movementTuning);
  const pickupRadius = puckStick.pickupRadius;
  const pickupMaxSpeed = puckStick.pickupMaxPuckSpeed;
  const pickupMaxRelativeSpeed = puckStick.pickupMaxRelativeSpeed;
  const magnetRadius = puckStick.magnetRadius;
  const magnetStrength = puckStick.magnetStrength;
  const magnetMaxForce = puckStick.magnetMaxForce;
  const holdSpringK = puckStick.holdSpringK;
  const holdDampingC = puckStick.holdDampingC;
  const holdMaxError = puckStick.holdMaxError;
  const pickupCooldownMs = puckStick.pickupCooldownMs;
  const shotBaseImpulse = puckStick.shotBaseImpulse;
  const shotChargeRate = puckStick.shotChargeRate;
  const shotChargeMult = puckStick.shotChargeMult;
  const shotMaxImpulse = puckStick.shotMaxImpulse;
  const shotMinHoldMs = puckStick.shotMinHoldMs;
  const maxSpeed = puckStick.maxSpeed;
  const linearDamping = puckStick.linearDamping;
  const restitution = puckStick.restitution;
  const surfaceDrag = puckStick.surfaceDrag;

  room.puck.pickupCooldownMs = Math.max(0, room.puck.pickupCooldownMs - dt * 1000);

  if (room.puck.state === 'HELD' && room.puck.ownerId) {
    const owner = room.players.get(room.puck.ownerId);
    if (!owner) {
      room.puck.state = 'FREE';
      room.puck.ownerId = null;
    } else {
      const shooting = !!owner.lastInputState.shoot;
      const justPressedShoot = shooting && !owner.prevShoot;
      const justReleasedShoot = !shooting && owner.prevShoot;

      if (justPressedShoot) owner.shotCharge = 0;
      if (shooting) owner.shotCharge = clamp(owner.shotCharge + shotChargeRate * dt, 0, 1);

      const target = stickTarget(room, owner);
      const dx = target.x - room.puck.x;
      const dy = target.y - room.puck.y;
      const fx = dx * holdSpringK - room.puck.vx * holdDampingC;
      const fy = dy * holdSpringK - room.puck.vy * holdDampingC;
      room.puck.vx += fx * dt;
      room.puck.vy += fy * dt;
      room.puck.x += room.puck.vx * dt;
      room.puck.y += room.puck.vy * dt;

      const err = Math.hypot(dx, dy);
      if (err > holdMaxError) {
        room.puck.state = 'FREE';
        room.puck.ownerId = null;
        room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, 80);
      }

      if (justReleasedShoot && owner.shotCharge * 1000 >= shotMinHoldMs) {
        const ang = owner.aimAngle;
        const impulse = clamp(shotBaseImpulse + owner.shotCharge * shotChargeMult, 0, shotMaxImpulse);
        room.puck.vx += Math.cos(ang) * impulse;
        room.puck.vy += Math.sin(ang) * impulse;
        room.puck.state = 'FREE';
        room.puck.ownerId = null;
        room.puck.pickupCooldownMs = pickupCooldownMs;
        owner.shotCharge = 0;
      }

      owner.prevShoot = shooting;
    }
  }

  if (room.puck.state === 'FREE') {
    if (room.puck.pickupCooldownMs <= 0 && magnetRadius > 0 && magnetStrength > 0) {
      let bestTarget: Vec2 | null = null;
      let bestDist = Infinity;
      for (const player of room.players.values()) {
        const t = stickTarget(room, player);
        const d = Math.hypot(room.puck.x - t.x, room.puck.y - t.y);
        if (d < magnetRadius && d < bestDist) {
          bestDist = d;
          bestTarget = t;
        }
      }
      if (bestTarget) {
        const dx = bestTarget.x - room.puck.x;
        const dy = bestTarget.y - room.puck.y;
        const dist = Math.max(0.0001, Math.hypot(dx, dy));
        const falloff = 1 - clamp(dist / magnetRadius, 0, 1);
        const force = Math.min(magnetMaxForce, magnetStrength * falloff);
        room.puck.vx += (dx / dist) * force * dt;
        room.puck.vy += (dy / dist) * force * dt;
      }
    }

    const damp = Math.exp(-linearDamping * dt);
    room.puck.vx *= damp;
    room.puck.vy *= damp;
    room.puck.vx *= 1 - clamp(surfaceDrag, 0, 0.95) * dt * 60;
    room.puck.vy *= 1 - clamp(surfaceDrag, 0, 0.95) * dt * 60;

    const speed = Math.hypot(room.puck.vx, room.puck.vy);
    if (speed > maxSpeed) {
      const k = maxSpeed / Math.max(1, speed);
      room.puck.vx *= k;
      room.puck.vy *= k;
    }

    room.puck.x += room.puck.vx * dt;
    room.puck.y += room.puck.vy * dt;

    if (room.puck.x < RINK.left) {
      room.puck.x = RINK.left;
      room.puck.vx = Math.abs(room.puck.vx) * restitution;
    } else if (room.puck.x > RINK.right) {
      room.puck.x = RINK.right;
      room.puck.vx = -Math.abs(room.puck.vx) * restitution;
    }
    if (room.puck.y < RINK.top) {
      room.puck.y = RINK.top;
      room.puck.vy = Math.abs(room.puck.vy) * restitution;
    } else if (room.puck.y > RINK.bottom) {
      room.puck.y = RINK.bottom;
      room.puck.vy = -Math.abs(room.puck.vy) * restitution;
    }

    if (room.puck.pickupCooldownMs <= 0) {
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const player of room.players.values()) {
        const t = stickTarget(room, player);
        const d = Math.hypot(room.puck.x - t.x, room.puck.y - t.y);
        const relSpeed = Math.hypot(room.puck.vx - player.vx, room.puck.vy - player.vy);
        const canCapture = relSpeed <= pickupMaxRelativeSpeed || speed <= pickupMaxSpeed;
        if (d < pickupRadius && canCapture && d < bestDist) {
          bestDist = d;
          bestId = player.id;
        }
      }
      if (bestId) {
        room.puck.state = 'HELD';
        room.puck.ownerId = bestId;
        const owner = room.players.get(bestId);
        if (owner) {
          owner.shotCharge = 0;
          owner.prevShoot = !!owner.lastInputState.shoot;
        }
      }
    }
  }
}

export function resolvePlayerContacts(room: any) {
  const players = [...room.players.values()];
  if (players.length < 2) return;

  const playerRadius = 18;
  const bumpForce = 110;
  const minHitSpeed = Number(room.movementTuning.minHitSpeed ?? MOVEMENT_DEFAULTS.minHitSpeed ?? 290);
  const hitForce = Number(room.movementTuning.hitForce ?? MOVEMENT_DEFAULTS.hitForce ?? 420);
  const hitCooldownTime = Number(room.movementTuning.hitCooldownTime ?? MOVEMENT_DEFAULTS.hitCooldownTime ?? 0.35);
  const postHitSpeedRetention = clamp(
    Number(room.movementTuning.postHitSpeedRetention ?? MOVEMENT_DEFAULTS.postHitSpeedRetention ?? 0.38),
    0,
    1
  );

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = playerRadius * 2;
      if (dist > minDist) continue;
      const safeDist = Math.max(dist, 0.0001);
      const nx = dx / safeDist;
      const ny = dy / safeDist;
      const overlap = minDist - safeDist;
      if (overlap > 0) {
        const push = overlap * 0.5;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }

      const relVx = a.vx - b.vx;
      const relVy = a.vy - b.vy;
      const closingSpeed = Math.abs(relVx * nx + relVy * ny);

      const aCanHit = a.chargeActive && a.hitCooldownLeft <= 0 && a.stunLeft <= 0;
      const bCanHit = b.chargeActive && b.hitCooldownLeft <= 0 && b.stunLeft <= 0;
      const shouldHit = closingSpeed >= minHitSpeed && (aCanHit || bCanHit);
      if (!shouldHit) {
        a.vx -= nx * bumpForce;
        a.vy -= ny * bumpForce;
        b.vx += nx * bumpForce;
        b.vy += ny * bumpForce;
        continue;
      }

      if (aCanHit && bCanHit) {
        a.vx -= nx * hitForce * 0.8;
        a.vy -= ny * hitForce * 0.8;
        b.vx += nx * hitForce * 0.8;
        b.vy += ny * hitForce * 0.8;
        a.hitCooldownLeft = hitCooldownTime;
        b.hitCooldownLeft = hitCooldownTime;
        dropPuckFrom(room, a.id);
        dropPuckFrom(room, b.id);
        continue;
      }

      const attacker = aCanHit ? a : b;
      const target = aCanHit ? b : a;
      const dir = aCanHit ? 1 : -1;
      target.vx += nx * hitForce * dir;
      target.vy += ny * hitForce * dir;
      attacker.vx *= postHitSpeedRetention;
      attacker.vy *= postHitSpeedRetention;
      attacker.hitCooldownLeft = hitCooldownTime;
      dropPuckFrom(room, target.id);
    }
  }
}

export function resolveBoardHits(room: any) {
  const playerRadius = 18;
  const boardStunMinSpeed = Number(room.movementTuning.boardStunMinSpeed ?? MOVEMENT_DEFAULTS.boardStunMinSpeed ?? 280);
  const boardStunDuration = Number(room.movementTuning.boardStunDuration ?? MOVEMENT_DEFAULTS.boardStunDuration ?? 0.55);

  for (const p of room.players.values()) {
    const preImpactSpeed = Math.hypot(p.vx, p.vy);
    let hitBoard = false;
    if (p.x < RINK.left + playerRadius) {
      p.x = RINK.left + playerRadius;
      p.vx = Math.abs(p.vx) * 0.18;
      hitBoard = true;
    } else if (p.x > RINK.right - playerRadius) {
      p.x = RINK.right - playerRadius;
      p.vx = -Math.abs(p.vx) * 0.18;
      hitBoard = true;
    }
    if (p.y < RINK.top + playerRadius) {
      p.y = RINK.top + playerRadius;
      p.vy = Math.abs(p.vy) * 0.18;
      hitBoard = true;
    } else if (p.y > RINK.bottom - playerRadius) {
      p.y = RINK.bottom - playerRadius;
      p.vy = -Math.abs(p.vy) * 0.18;
      hitBoard = true;
    }
    if (!hitBoard) continue;

    if (p.chargeActive && preImpactSpeed >= boardStunMinSpeed) {
      p.stunLeft = Math.max(p.stunLeft, boardStunDuration);
      p.chargeActive = false;
      p.vx *= 0.35;
      p.vy *= 0.35;
      if (room.puck.state === 'HELD' && room.puck.ownerId === p.id) {
        dropPuckFrom(room, p.id);
      }
    }
  }
}
