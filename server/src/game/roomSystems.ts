import { DEFAULT_RINK_BOUNDS } from '@flathockey/shared/sim/playerMovement';
import { resolvePuckStickTuning } from '@flathockey/shared/tuning/puckStickTuning';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type Vec2 = { x: number; y: number };

function stickTarget(player: any): Vec2 {
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
  const puckStick = resolvePuckStickTuning(room.gameplayConfig);
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

      const target = stickTarget(owner);
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
        const t = stickTarget(player);
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

    if (room.puck.x < DEFAULT_RINK_BOUNDS.left) {
      room.puck.x = DEFAULT_RINK_BOUNDS.left;
      room.puck.vx = Math.abs(room.puck.vx) * restitution;
    } else if (room.puck.x > DEFAULT_RINK_BOUNDS.right) {
      room.puck.x = DEFAULT_RINK_BOUNDS.right;
      room.puck.vx = -Math.abs(room.puck.vx) * restitution;
    }
    if (room.puck.y < DEFAULT_RINK_BOUNDS.top) {
      room.puck.y = DEFAULT_RINK_BOUNDS.top;
      room.puck.vy = Math.abs(room.puck.vy) * restitution;
    } else if (room.puck.y > DEFAULT_RINK_BOUNDS.bottom) {
      room.puck.y = DEFAULT_RINK_BOUNDS.bottom;
      room.puck.vy = -Math.abs(room.puck.vy) * restitution;
    }

    if (room.puck.pickupCooldownMs <= 0) {
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const player of room.players.values()) {
        const t = stickTarget(player);
        const d = Math.hypot(room.puck.x - t.x, room.puck.y - t.y);
        const relativeSpeed = Math.hypot(room.puck.vx - (player.vx ?? 0), room.puck.vy - (player.vy ?? 0));
        const canCapture = speed <= pickupMaxSpeed && relativeSpeed <= pickupMaxRelativeSpeed;
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
