import { DEFAULT_RINK_BOUNDS } from '@flathockey/shared/sim/playerMovement';
import { computeSemiPhysicalStickPose, SEMI_PHYSICAL_STICK_CONFIG } from '@flathockey/shared';
import { resolvePuckStickTuning } from '@flathockey/shared/tuning/puckStickTuning';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type Vec2 = { x: number; y: number };

type PickupCandidate = {
  playerId: string;
  priority: number;
  distance: number;
  target: Vec2;
  pose: ReturnType<typeof computeSemiPhysicalStickPose>;
};

function stickPose(room: any, player: any, overrideState?: any) {
  const playerRadius = Math.max(12, Number(room.gameplayConfig.playerRadius ?? 18));
  return computeSemiPhysicalStickPose({
    playerX: player.x,
    playerY: player.y,
    bodyAngle: player.angle,
    aimAngle: player.aimAngle,
    playerRadius,
    state: overrideState ?? player.stickState,
    shotCharge: player.shotCharge,
    stateTimerSec: player.stickTimer,
    angularVelocity: player.angularVelocity
  });
}

function releasePuck(room: any, player: any, pose: ReturnType<typeof computeSemiPhysicalStickPose>, impulse: number, cooldownMs: number) {
  room.puck.state = 'FREE';
  room.puck.ownerId = null;
  room.puck.x = pose.bladeCenterX;
  room.puck.y = pose.bladeCenterY;
  room.puck.vx = (player.vx ?? 0) * 0.35 + pose.bladeForwardX * impulse;
  room.puck.vy = (player.vy ?? 0) * 0.35 + pose.bladeForwardY * impulse;
  room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, cooldownMs);
}

function dropPuckAtBlade(room: any, player: any, pose: ReturnType<typeof computeSemiPhysicalStickPose>, cooldownMs: number) {
  room.puck.state = 'FREE';
  room.puck.ownerId = null;
  room.puck.x = pose.bladeCenterX;
  room.puck.y = pose.bladeCenterY;
  room.puck.vx = (player.vx ?? 0) * 0.35;
  room.puck.vy = (player.vy ?? 0) * 0.35;
  room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, cooldownMs);
}

function evaluateCaptureCandidate(
  puckX: number,
  puckY: number,
  pose: ReturnType<typeof computeSemiPhysicalStickPose>,
  pickupRadius: number,
  assistRadius: number,
  puckRadius: number
) {
  const bladeRadius = Math.min(pickupRadius, pose.bladeZoneRadius) + puckRadius;
  const bladeDist = Math.hypot(puckX - pose.bladeCenterX, puckY - pose.bladeCenterY);
  if (bladeDist <= bladeRadius) {
    return {
      priority: 0,
      distance: bladeDist,
      target: { x: pose.bladeCenterX, y: pose.bladeCenterY }
    };
  }

  const cappedAssistRadius = Math.min(assistRadius, pose.assistZoneRadius) + puckRadius;
  const assistDist = Math.hypot(puckX - pose.assistX, puckY - pose.assistY);
  if (assistDist <= cappedAssistRadius) {
    return {
      priority: 1,
      distance: assistDist,
      target: { x: pose.assistX, y: pose.assistY }
    };
  }

  const bodyRadius = Math.min(pickupRadius * 0.72, pose.bodyZoneRadius) + puckRadius;
  const bodyDist = Math.hypot(puckX - pose.bodyX, puckY - pose.bodyY);
  if (bodyDist <= bodyRadius) {
    return {
      priority: 2,
      distance: bodyDist,
      target: { x: pose.bodyX, y: pose.bodyY }
    };
  }

  return null;
}

function tryResolveFreePoke(room: any, pokeImpulse: number, puckRadius: number) {
  let bestPlayer: any = null;
  let bestPose: ReturnType<typeof computeSemiPhysicalStickPose> | null = null;
  let bestDist = Infinity;

  for (const player of room.players.values()) {
    if (player.stickState !== 'poke') continue;
    const pose = stickPose(room, player);
    const dist = Math.hypot(room.puck.x - pose.bladeCenterX, room.puck.y - pose.bladeCenterY);
    if (dist <= pose.bladeZoneRadius + puckRadius && dist < bestDist) {
      bestDist = dist;
      bestPlayer = player;
      bestPose = pose;
    }
  }

  if (!bestPlayer || !bestPose) return false;

  room.puck.vx = (bestPlayer.vx ?? 0) * 0.25 + bestPose.bladeForwardX * pokeImpulse;
  room.puck.vy = (bestPlayer.vy ?? 0) * 0.25 + bestPose.bladeForwardY * pokeImpulse;
  room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, 140);
  bestPlayer.stickState = 'release';
  bestPlayer.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.pokeRecoverySec;
  return true;
}

function tryResolveHeldPoke(room: any, owner: any, pokeImpulse: number, puckRadius: number) {
  let bestPlayer: any = null;
  let bestPose: ReturnType<typeof computeSemiPhysicalStickPose> | null = null;
  let bestDist = Infinity;

  for (const player of room.players.values()) {
    if (player.id === owner.id || player.stickState !== 'poke') continue;
    const pose = stickPose(room, player);
    const dist = Math.hypot(room.puck.x - pose.bladeCenterX, room.puck.y - pose.bladeCenterY);
    if (dist <= pose.bladeZoneRadius + puckRadius && dist < bestDist) {
      bestDist = dist;
      bestPlayer = player;
      bestPose = pose;
    }
  }

  if (!bestPlayer || !bestPose) return false;

  dropPuckFrom(room, owner.id);
  room.puck.x = bestPose.bladeCenterX;
  room.puck.y = bestPose.bladeCenterY;
  room.puck.vx = (bestPlayer.vx ?? 0) * 0.25 + bestPose.bladeForwardX * pokeImpulse;
  room.puck.vy = (bestPlayer.vy ?? 0) * 0.25 + bestPose.bladeForwardY * pokeImpulse;
  room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, 140);
  owner.shotCharge = 0;
  bestPlayer.stickState = 'release';
  bestPlayer.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.pokeRecoverySec;
  return true;
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
  const assistRadius = Math.min(puckStick.magnetRadius, SEMI_PHYSICAL_STICK_CONFIG.assistZoneRadius);
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
  const passImpulse = clamp(
    Math.max(SEMI_PHYSICAL_STICK_CONFIG.passImpulse, shotBaseImpulse * 0.78),
    0,
    shotMaxImpulse * 0.82
  );
  const pokeImpulse = SEMI_PHYSICAL_STICK_CONFIG.pokeImpulse;
  const maxSpeed = puckStick.maxSpeed;
  const linearDamping = puckStick.linearDamping;
  const restitution = puckStick.restitution;
  const surfaceDrag = puckStick.surfaceDrag;
  const puckRadius = puckStick.puckRadius;

  room.puck.pickupCooldownMs = Math.max(0, room.puck.pickupCooldownMs - dt * 1000);
  for (const player of room.players.values()) {
    player.stickTimer = Math.max(0, player.stickTimer - dt);
    const hasPuck = room.puck.state === 'HELD' && room.puck.ownerId === player.id;
    const justPressedPoke = !!player.lastInputState.poke && !player.prevPoke;
    if (!hasPuck && justPressedPoke && player.stickState !== 'poke' && player.stickTimer <= 0) {
      player.stickState = 'poke';
      player.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.pokeDurationSec;
    }
  }

  if (room.puck.state === 'HELD' && room.puck.ownerId) {
    const owner = room.players.get(room.puck.ownerId);
    if (!owner) {
      room.puck.state = 'FREE';
      room.puck.ownerId = null;
    } else {
      const shooting = !!owner.lastInputState.shoot;
      const passing = !!owner.lastInputState.pass;
      const dropping = !!owner.lastInputState.drop;
      const justPressedShoot = shooting && !owner.prevShoot;
      const justReleasedShoot = !shooting && owner.prevShoot;
      const justPressedPass = passing && !owner.prevPass;
      const justPressedDrop = dropping && !owner.prevDrop;

      if (justPressedShoot) owner.shotCharge = 0;
      if (shooting) owner.shotCharge = clamp(owner.shotCharge + shotChargeRate * dt, 0, 1);

      if (justPressedDrop) {
        const dropPose = stickPose(room, owner, shooting ? 'charge' : 'control');
        dropPuckAtBlade(room, owner, dropPose, Math.max(100, pickupCooldownMs * 0.7));
        owner.stickState = 'release';
        owner.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.releaseDurationSec;
        owner.shotCharge = 0;
      } else if (justPressedPass) {
        owner.stickState = 'pass';
        owner.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.passDurationSec;
        const passPose = stickPose(room, owner, 'pass');
        releasePuck(room, owner, passPose, passImpulse, Math.max(80, pickupCooldownMs * 0.8));
        owner.shotCharge = 0;
      } else {
        owner.stickState = shooting
          ? 'charge'
          : Math.abs(owner.angularVelocity) > SEMI_PHYSICAL_STICK_CONFIG.turningPenaltyAngularSpeed
            ? 'turning'
            : 'control';
        const targetPose = stickPose(room, owner);
        const stability = targetPose.controlStability;
        const springK = holdSpringK * clamp(0.72 + stability * 0.28, 0.72, 1);
        const dampingC = holdDampingC * clamp(0.78 + stability * 0.22, 0.78, 1);
        const dx = targetPose.bladeCenterX - room.puck.x;
        const dy = targetPose.bladeCenterY - room.puck.y;
        const fx = dx * springK - room.puck.vx * dampingC;
        const fy = dy * springK - room.puck.vy * dampingC;
        room.puck.vx += fx * dt;
        room.puck.vy += fy * dt;
        room.puck.x += room.puck.vx * dt;
        room.puck.y += room.puck.vy * dt;

        const err = Math.hypot(dx, dy);
        if (err > holdMaxError * clamp(1.15 + (1 - stability) * 0.35, 1.15, 1.5)) {
          room.puck.state = 'FREE';
          room.puck.ownerId = null;
          room.puck.pickupCooldownMs = Math.max(room.puck.pickupCooldownMs, 80);
          owner.shotCharge = 0;
        } else if (!tryResolveHeldPoke(room, owner, pokeImpulse, puckRadius) && justReleasedShoot) {
          if (owner.shotCharge * 1000 >= shotMinHoldMs) {
            const shotPose = stickPose(room, owner, 'charge');
            const impulse = clamp(shotBaseImpulse + owner.shotCharge * shotChargeMult, 0, shotMaxImpulse);
            releasePuck(room, owner, shotPose, impulse, pickupCooldownMs);
            owner.stickState = 'release';
            owner.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.releaseDurationSec;
          }
          owner.shotCharge = 0;
        }
      }
    }
  }

  if (room.puck.state === 'FREE') {
    tryResolveFreePoke(room, pokeImpulse, puckRadius);

    if (room.puck.pickupCooldownMs <= 0 && assistRadius > 0 && magnetStrength > 0) {
      let bestTarget: Vec2 | null = null;
      let bestDist = Infinity;
      for (const player of room.players.values()) {
        if (player.stickState === 'poke') continue;
        const pose = stickPose(room, player);
        const bladeDist = Math.hypot(room.puck.x - pose.bladeCenterX, room.puck.y - pose.bladeCenterY);
        const assistDist = Math.hypot(room.puck.x - pose.assistX, room.puck.y - pose.assistY);
        if (bladeDist < Math.min(pickupRadius, pose.bladeZoneRadius) && bladeDist < bestDist) {
          bestDist = bladeDist;
          bestTarget = { x: pose.bladeCenterX, y: pose.bladeCenterY };
        } else if (assistDist < assistRadius && assistDist < bestDist) {
          bestDist = assistDist;
          bestTarget = { x: pose.assistX, y: pose.assistY };
        }
      }
      if (bestTarget) {
        const dx = bestTarget.x - room.puck.x;
        const dy = bestTarget.y - room.puck.y;
        const dist = Math.max(0.0001, Math.hypot(dx, dy));
        const falloff = 1 - clamp(dist / assistRadius, 0, 1);
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
      const bestCandidate = (() => {
        let best: PickupCandidate | null = null;
        for (const player of room.players.values()) {
          if (player.stickState === 'poke') continue;
          const relativeSpeed = Math.hypot(room.puck.vx - (player.vx ?? 0), room.puck.vy - (player.vy ?? 0));
          const canCapture = speed <= pickupMaxSpeed && relativeSpeed <= pickupMaxRelativeSpeed;
          if (!canCapture) continue;
          const pose = stickPose(room, player);
          const candidate = evaluateCaptureCandidate(room.puck.x, room.puck.y, pose, pickupRadius, assistRadius, puckRadius);
          if (!candidate) continue;
          if (
            !best ||
            candidate.priority < best.priority ||
            (candidate.priority === best.priority && candidate.distance < best.distance)
          ) {
            best = {
              playerId: player.id,
              priority: candidate.priority,
              distance: candidate.distance,
              target: candidate.target,
              pose
            };
          }
        }
        return best;
      })();

      if (bestCandidate) {
        room.puck.state = 'HELD';
        room.puck.ownerId = bestCandidate.playerId;
        room.puck.x = bestCandidate.pose.bladeCenterX;
        room.puck.y = bestCandidate.pose.bladeCenterY;
        room.puck.vx = 0;
        room.puck.vy = 0;
        const owner = room.players.get(bestCandidate.playerId);
        if (owner) {
          owner.shotCharge = 0;
          owner.prevShoot = !!owner.lastInputState.shoot;
          owner.prevPass = !!owner.lastInputState.pass;
          owner.prevDrop = !!owner.lastInputState.drop;
          owner.stickState = 'control';
          owner.stickTimer = 0;
        }
      }
    }
  }

  for (const player of room.players.values()) {
    const hasPuck = room.puck.state === 'HELD' && room.puck.ownerId === player.id;
    if (!hasPuck) {
      if (player.stickState === 'poke' && player.stickTimer <= 0) {
        player.stickState = 'release';
        player.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.pokeRecoverySec;
      } else if (player.stickState === 'pass' && player.stickTimer <= 0) {
        player.stickState = 'release';
        player.stickTimer = SEMI_PHYSICAL_STICK_CONFIG.releaseDurationSec;
      } else if (player.stickState === 'release' && player.stickTimer <= 0) {
        player.stickState = 'neutral';
      } else if (player.stickState !== 'poke' && player.stickState !== 'pass' && player.stickState !== 'release') {
        player.stickState = 'neutral';
      }
      if (player.stickState !== 'charge') {
        player.shotCharge = 0;
      }
    }

    player.prevShoot = !!player.lastInputState.shoot;
    player.prevPass = !!player.lastInputState.pass;
    player.prevDrop = !!player.lastInputState.drop;
    player.prevPoke = !!player.lastInputState.poke;
  }
}
