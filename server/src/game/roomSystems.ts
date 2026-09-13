import {
  advanceLoosePuck,
  clampAimToBodyZone,
  computeShotRelease,
  computePuckCombatPose,
  evaluatePickupGate,
  GAMEPLAY_DEFAULTS,
  MINIMAL_STICK_CONFIG,
  resolvePuckStickTuning,
  STICK_GEOMETRY_CONFIG,
  type GameplayConfig
} from '@flathockey/shared';
import type { Room } from './room';
import type { BodyCollisionDebugState, PlayerState, RoomPuckState } from './room.types';
import {
  computeChargedShotPose,
  computeOwnedPuckContact,
  createServerShotInstance,
  sampleServerReleasingPuck
} from './puck2/serverPuck2';

export type CrosscheckConfig = {
  windupSec: number;
  activeSec: number;
  recoverySec: number;
  forwardOffset: number;
  halfWidth: number;
  hitRadius: number;
  shoveSpeed: number;
  dummyShoveMultiplier: number;
  separationPadding: number;
  dummyAutoResetSec: number;
};

type CrosscheckImpact = {
  targetId: string;
  targetIsDummy: boolean;
  contactX: number;
  contactY: number;
  dirX: number;
  dirY: number;
  barDirX: number;
  barDirY: number;
  separationPx: number;
  stripped: boolean;
  separated: boolean;
};

export function resolveCrosscheckConfig(config: Partial<GameplayConfig>): CrosscheckConfig {
  return {
    windupSec: Math.max(0.01, config.crosscheckWindupSec ?? GAMEPLAY_DEFAULTS.crosscheckWindupSec ?? 0.08),
    activeSec: Math.max(0.01, config.crosscheckActiveSec ?? GAMEPLAY_DEFAULTS.crosscheckActiveSec ?? 0.1),
    recoverySec: Math.max(0.01, config.crosscheckRecoverySec ?? GAMEPLAY_DEFAULTS.crosscheckRecoverySec ?? 0.22),
    forwardOffset: Math.max(1, config.crosscheckForwardOffset ?? GAMEPLAY_DEFAULTS.crosscheckForwardOffset ?? 24),
    halfWidth: Math.max(1, config.crosscheckHalfWidth ?? GAMEPLAY_DEFAULTS.crosscheckHalfWidth ?? 18),
    hitRadius: Math.max(1, config.crosscheckHitRadius ?? GAMEPLAY_DEFAULTS.crosscheckHitRadius ?? 10),
    shoveSpeed: Math.max(1, config.crosscheckShoveSpeed ?? GAMEPLAY_DEFAULTS.crosscheckShoveSpeed ?? 86),
    dummyShoveMultiplier: Math.max(1, config.crosscheckDummyShoveMultiplier ?? GAMEPLAY_DEFAULTS.crosscheckDummyShoveMultiplier ?? 1.18),
    separationPadding: Math.max(0, config.crosscheckSeparationPadding ?? GAMEPLAY_DEFAULTS.crosscheckSeparationPadding ?? 4),
    dummyAutoResetSec: Math.max(0.2, config.dummyAutoResetSec ?? GAMEPLAY_DEFAULTS.dummyAutoResetSec ?? 1.25)
  };
}

export function createInitialPuckState(radius: number): RoomPuckState {
  return {
    kind: 'loose',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    radius,
    ownerId: null,
    possessionId: 0,
    shot: null,
    releaseSerial: 0,
    releaseOwnerId: null,
    releaseKind: 'reset'
  };
}

export function ensureTrainingDummy(room: Room) {
  const existing = findTrainingDummy(room);
  if (existing) return existing;

  const reference = [...room.players.values()].find((player) => !player.isTrainingDummy);
  if (!reference) return null;

  const dummyId = `${room.id}-dummy`;
  const dummyX = reference.x + 92;
  const dummyY = reference.y - 18;
  const dummy: PlayerState = {
    id: dummyId,
    name: 'DUMMY',
    isTrainingDummy: true,
    handedness: 'right',
    x: dummyX,
    y: dummyY,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    travelHeading: Math.PI,
    steeringHeading: Math.PI,
    inputHeading: Math.PI,
    intentBoostTimer: 0,
    lastIntentAngle: null,
    aimAngle: Math.PI,
    desiredHeading: Math.PI,
    locomotionState: 'idle',
    stopTimerSec: 0,
    stopRecoveryTimerSec: 0,
    stopBlend: 0,
    stopSide: 0,
    stopTravelHeading: Math.PI,
    prevStopInput: 0,
    angularVelocity: 0,
    lastProcessedSeq: 0,
    lastInputState: { moveX: 0, moveY: 0, aimAngle: Math.PI, shoot: 0, pass: 0, drop: 0, stop: 0 },
    inputBuffer: [],
    inputGapTicks: 0,
    bodyCollisionStaggerTimerSec: 0,
    bodyCollisionDebug: null,
    hasPuck: false,
    crosscheckPhase: 'idle',
    crosscheckTimerSec: 0,
    crosscheckConsumed: false,
    crosscheckResult: 'idle',
    crosscheckImpactTimerSec: 0,
    crosscheckImpactSerial: 0,
    crosscheckImpactContactX: 0,
    crosscheckImpactContactY: 0,
    crosscheckImpactDirX: 0,
    crosscheckImpactDirY: 0,
    crosscheckImpactBarDirX: 0,
    crosscheckImpactBarDirY: 0,
    crosscheckImpactMagnitude: 0,
    crosscheckImpactStripped: false,
    crosscheckImpactSeparated: false,
    crosscheckImpactTargetId: null,
    crosscheckImpactTargetIsDummy: false,
    puckPickupLockTimerSec: 0,
    shotChargeTimerSec: 0,
    shotChargeStartRelativeAngle: null,
    prevShootInput: 0,
    prevPassInput: 0,
    prevDropInput: 0,
    dummyResetTimerSec: 0
  };

  room.players.set(dummyId, dummy);
  room.puck.ownerId = null;
  room.puck.kind = 'loose';
  room.puck.shot = null;
  room.puck.x = 0;
  room.puck.y = 0;
  room.puck.vx = 0;
  room.puck.vy = 0;
  room.puck.releaseOwnerId = null;
  room.puck.releaseKind = 'reset';
  return dummy;
}

export function stepRoomGameplay(room: Room, dt: number, config: CrosscheckConfig) {
  ensureTrainingDummy(room);
  const puckTuning = resolvePuckStickTuning(room.gameplayConfig);

  for (const player of room.players.values()) {
    tickCrosscheckImpact(player, dt);
    tickBodyCollisionStagger(player, dt);
    tickBodyCollisionDebug(player, dt);
    tickPickupLock(player, dt);

    if (player.isTrainingDummy) {
      integratePassiveBodyMotion(player, dt);
      player.aimAngle = resolveDummyAimAngle(room, player);
      player.travelHeading = player.angle;
      player.desiredHeading = player.angle;
      player.crosscheckResult = 'idle';
      continue;
    }

    const passPressed = player.lastInputState.pass === 1;
    const passJustPressed = passPressed && player.prevPassInput === 0;
    player.prevPassInput = player.lastInputState.pass;
    player.prevDropInput = player.lastInputState.drop;
    if (passJustPressed && !player.hasPuck && player.crosscheckPhase === 'idle') {
      startCrosscheck(player, config);
      console.info(`[CROSSCHECK] start room=${room.id} player=${player.id}`);
    }
  }

  for (const player of room.players.values()) {
    tickCrosscheckPhase(room, player, dt, config);
  }

  resolvePlayerBodyCollisions(room);

  for (const player of room.players.values()) {
    if (player.isTrainingDummy) {
      applyPassiveBodyDamping(player, dt);
    }
  }

  for (const player of room.players.values()) {
    if (player.isTrainingDummy) continue;
    stepPlayerShot(room, player, dt, puckTuning);
  }

  if (room.puck.kind === 'loose' && !room.puck.ownerId) {
    tryPickupLoosePuck(room, puckTuning.pickupRadius, puckTuning.pickupMaxRelativeSpeed, puckTuning.pickupMaxPuckSpeed);
  }

  for (const player of room.players.values()) {
    if (!player.isTrainingDummy || player.hasPuck || player.dummyResetTimerSec <= 0) continue;
    player.dummyResetTimerSec = Math.max(0, player.dummyResetTimerSec - dt);
    if (player.dummyResetTimerSec <= 0 && !room.puck.ownerId) {
      assignPuckOwner(room, player);
      syncOwnedPuck(room, player);
      console.info(`[DUMMY] reset room=${room.id} player=${player.id}`);
    }
  }

  enforceSinglePuckOwner(room);

  const owner = room.puck.kind === 'owned' && room.puck.ownerId ? room.players.get(room.puck.ownerId) ?? null : null;
  if (owner && owner.hasPuck) {
    syncOwnedPuck(room, owner);
  } else if (room.puck.kind === 'releasing' && room.puck.shot) {
    const elapsedSec = Math.max(0, (room.serverTick - room.puck.shot.startTick) * dt);
    if (elapsedSec >= room.puck.shot.clipDurationSec) {
      room.puck.kind = 'loose';
      room.puck.shot = null;
      room.puck.x = room.puck.x;
      room.puck.y = room.puck.y;
      room.puck.vx = room.puck.vx;
      room.puck.vy = room.puck.vy;
      room.puck.spin = room.puck.spin;
    } else {
      const clip = sampleServerReleasingPuck(room.puck, elapsedSec);
      room.puck.x = clip.x;
      room.puck.y = clip.y;
    }
  } else {
    room.puck.kind = 'loose';
    room.puck.ownerId = null;
    const next = advanceLoosePuck(
      {
        x: room.puck.x,
        y: room.puck.y,
        vx: room.puck.vx,
        vy: room.puck.vy,
        angularVelocity: room.puck.spin
      },
      dt,
      puckTuning.linearDamping,
      puckTuning.surfaceDrag,
      puckTuning.maxSpeed,
      puckTuning.restitution
    );
    room.puck.x = next.x;
    room.puck.y = next.y;
    room.puck.vx = next.vx;
    room.puck.vy = next.vy;
    room.puck.spin = next.angularVelocity;
  }
}

function tryPickupLoosePuck(
  room: Room,
  pickupRadius: number,
  pickupMaxRelativeSpeed: number,
  pickupMaxPuckSpeed: number
) {
  const puckSpeed = Math.hypot(room.puck.vx, room.puck.vy);
  if (puckSpeed > pickupMaxPuckSpeed) return;

  let best: {
    player: PlayerState;
    quality: number;
    distance: number;
  } | null = null;

  for (const player of room.players.values()) {
    if (player.hasPuck || player.crosscheckPhase !== 'idle') continue;
    if ((player.puckPickupLockTimerSec ?? 0) > 0) continue;
    if (player.isTrainingDummy && player.dummyResetTimerSec > 0) continue;

    const pose = getPickupBladeZone(room, player);
    const evalResult = evaluatePickupGate(
      room.puck.x,
      room.puck.y,
      room.puck.vx,
      room.puck.vy,
      room.puck.spin,
      player.vx,
      player.vy,
      pose,
      room.puck.radius,
      pickupRadius,
      pickupMaxRelativeSpeed,
      !!player.isTrainingDummy
    );

    if (!evalResult) continue;

    const distance = Math.hypot(room.puck.x - pose.bladeContactX, room.puck.y - pose.bladeContactY);
    if (
      !best ||
      evalResult.quality > best.quality + 0.001 ||
      (Math.abs(evalResult.quality - best.quality) <= 0.001 && distance < best.distance)
    ) {
      best = { player, quality: evalResult.quality, distance };
    }
  }

  if (!best) return;

  assignPuckOwner(room, best.player);
  room.puck.vx = best.player.vx;
  room.puck.vy = best.player.vy;
  syncOwnedPuck(room, best.player);
}

function stepPlayerShot(room: Room, player: PlayerState, dt: number, puckTuning: ReturnType<typeof resolvePuckStickTuning>) {
  if (player.crosscheckPhase !== 'idle') {
    player.shotChargeTimerSec = 0;
    player.shotChargeStartRelativeAngle = null;
    player.prevShootInput = player.lastInputState.shoot ?? 0;
    return;
  }

  const shootPressed = player.lastInputState.shoot === 1;
  const shootJustReleased = !shootPressed && player.prevShootInput === 1;
  player.prevShootInput = shootPressed ? 1 : 0;

  if (!player.hasPuck || room.puck.ownerId !== player.id) {
    player.shotChargeTimerSec = 0;
    player.shotChargeStartRelativeAngle = null;
    return;
  }

  const dropPressed = player.lastInputState.drop === 1;
  const passCancels = player.lastInputState.pass === 1;
  if (dropPressed || passCancels) {
    player.shotChargeTimerSec = 0;
    player.shotChargeStartRelativeAngle = null;
    player.prevShootInput = 0;
    return;
  }

  if (shootPressed) {
    if (player.prevShootInput === 0) {
      const resolvedAim = clampAimToBodyZone(
        player.angle,
        player.aimAngle,
        STICK_GEOMETRY_CONFIG.maxAimOffsetRad,
        player.angle
      );
      player.shotChargeStartRelativeAngle = normalizeAngle(resolvedAim - player.angle);
    }
    player.shotChargeTimerSec = Math.min(1.5, player.shotChargeTimerSec + dt);
    return;
  }

  if (!shootJustReleased) {
    player.shotChargeTimerSec = 0;
    player.shotChargeStartRelativeAngle = null;
    return;
  }

  releaseChargedShot(room, player, puckTuning);
}

function resolveDummyAimAngle(room: Room, player: PlayerState) {
  if (player.hasPuck || room.puck.ownerId === player.id) {
    return player.angle;
  }
  if (player.dummyResetTimerSec > 0) {
    return player.angle;
  }
  const dx = room.puck.x - player.x;
  const dy = room.puck.y - player.y;
  if (Math.hypot(dx, dy) <= 0.001) {
    return player.angle;
  }
  return Math.atan2(dy, dx);
}

function releaseChargedShot(room: Room, player: PlayerState, puckTuning: ReturnType<typeof resolvePuckStickTuning>) {
  const minHoldSec = Math.max(0, puckTuning.shotMinHoldMs) / 1000;
  const chargeRate = Math.max(0.01, puckTuning.shotChargeRate);
  const fullChargeSec = Math.max(0.12, 1 / chargeRate);
  const heldSec = player.shotChargeTimerSec;
  const charge01 = Math.max(0, Math.min(1, heldSec / fullChargeSec));
  const chargeStartRelativeAngle = player.shotChargeStartRelativeAngle;
  player.shotChargeTimerSec = 0;
  player.shotChargeStartRelativeAngle = null;

  if (heldSec <= 0.001 || player.crosscheckPhase !== 'idle') return;

  const pose = computeShotPose(room, player, charge01, chargeStartRelativeAngle);
  const easedCharge01 = smoothstep01(charge01);
  const minImpulse = Math.max(70, puckTuning.shotBaseImpulse);
  const maxImpulse = Math.min(
    puckTuning.shotMaxImpulse,
    puckTuning.shotBaseImpulse + puckTuning.shotChargeMult
  );
  const holdGate = minHoldSec > 0 ? Math.max(0.18, Math.min(1, heldSec / minHoldSec)) : 1;
  const finalImpulse = lerp(minImpulse, maxImpulse, easedCharge01) * holdGate;

  player.hasPuck = false;
  applyPickupLock(player, puckTuning.pickupCooldownMs);
  const release = computeShotRelease(
    player.vx,
    player.vy,
    pose.dirX,
    pose.dirY,
    finalImpulse,
    0,
    puckTuning.maxSpeed,
    player.angularVelocity
  );

  room.puck.kind = 'releasing';
  room.puck.ownerId = null;
  room.puck.shot = createServerShotInstance({
    shotId: room.puck.releaseSerial + 1,
    ownerId: player.id,
    startTick: room.serverTick,
    startX: pose.originX,
    startY: pose.originY,
    dirX: pose.dirX,
    dirY: pose.dirY,
    vx: release.vx,
    vy: release.vy,
    speed: Math.hypot(release.vx, release.vy),
    spin: release.angularVelocity + easedCharge01 * 1.8,
    charge01,
    radius: room.puck.radius,
    clipDurationSec: 0.075
  });
  room.puck.x = pose.originX;
  room.puck.y = pose.originY;
  room.puck.vx = release.vx;
  room.puck.vy = release.vy;
  room.puck.spin = release.angularVelocity + easedCharge01 * 1.8;
  markPuckRelease(room, player.id, 'shot');
  room.queueServerMessage({
    type: 'shot:start',
    serverTick: room.serverTick,
    shot: room.puck.shot
  });
}

function computeShotPose(room: Room, player: PlayerState, charge01: number, chargeStartRelativeAngle: number | null) {
  const gameplayPose = computeChargedShotPose(player, room.playerRadius, charge01, chargeStartRelativeAngle);
  return {
    originX: gameplayPose.contactX,
    originY: gameplayPose.contactY,
    dirX: gameplayPose.forwardX,
    dirY: gameplayPose.forwardY
  };
}

function startCrosscheck(player: PlayerState, config: CrosscheckConfig) {
  player.crosscheckPhase = 'windup';
  player.crosscheckTimerSec = config.windupSec;
  player.crosscheckConsumed = false;
  player.crosscheckResult = 'idle';
}

function tickCrosscheckPhase(room: Room, player: PlayerState, dt: number, config: CrosscheckConfig) {
  if (player.crosscheckPhase === 'idle') return;

  player.crosscheckTimerSec = Math.max(0, player.crosscheckTimerSec - dt);

  if (player.crosscheckPhase === 'windup') {
    if (player.crosscheckTimerSec <= 0) {
      player.crosscheckPhase = 'active';
      player.crosscheckTimerSec = config.activeSec;
      console.info(`[CROSSCHECK] active room=${room.id} player=${player.id}`);
    }
    return;
  }

  if (player.crosscheckPhase === 'active') {
    if (!player.crosscheckConsumed) {
      const impact = tryConsumeCrosscheck(room, player, config);
      if (impact) {
        player.crosscheckConsumed = true;
        player.crosscheckResult = 'hit';
        player.crosscheckPhase = 'recovery';
        player.crosscheckTimerSec = config.recoverySec;
        applyCrosscheckImpact(player, impact);
        console.info(
          `[CROSSCHECK] hit room=${room.id} player=${player.id} target=${impact.targetId} separated=${impact.separated ? 1 : 0} stripped=${impact.stripped ? 1 : 0}`
        );
        return;
      }
    }

    if (player.crosscheckTimerSec <= 0) {
      player.crosscheckResult = 'miss';
      player.crosscheckPhase = 'recovery';
      player.crosscheckTimerSec = config.recoverySec;
      console.info(`[CROSSCHECK] miss room=${room.id} player=${player.id}`);
    }
    return;
  }

  if (player.crosscheckPhase === 'recovery' && player.crosscheckTimerSec <= 0) {
    player.crosscheckPhase = 'idle';
    player.crosscheckTimerSec = 0;
    player.crosscheckConsumed = false;
    player.crosscheckResult = 'idle';
  }
}

function tryConsumeCrosscheck(room: Room, attacker: PlayerState, config: CrosscheckConfig) {
  const pose = computePuckCombatPose({
    playerX: attacker.x,
    playerY: attacker.y,
    bodyAngle: attacker.angle,
    aimAngle: attacker.angle,
    playerRadius: room.playerRadius,
    handedness: attacker.handedness,
    state: 'crosscheck'
  });
  let bestTarget: {
    player: PlayerState;
    point: { x: number; y: number; distance: number };
  } | null = null;

  for (const target of room.players.values()) {
    if (target.id === attacker.id) continue;

    const targetPoint = getCrosscheckTargetPoint(room, target, pose);
    const dist = targetPoint.distance;

    if (dist > config.hitRadius) continue;
    if (!bestTarget || dist < bestTarget.point.distance) {
      bestTarget = { player: target, point: targetPoint };
    }
  }

  if (!bestTarget) return null;

  const target = bestTarget.player;
  const targetPoint = bestTarget.point;
  const contactNormal = resolveImpactDirection(attacker, target);
  const barDir = {
    x: Math.cos(attacker.angle),
    y: Math.sin(attacker.angle)
  };
  const contact = closestPointOnSegment(
    targetPoint.x,
    targetPoint.y,
    pose.bladeBaseX,
    pose.bladeBaseY,
    pose.bladeTipX,
    pose.bladeTipY
  );
  const contactResolve = resolveCrosscheckBarContact(attacker, target, room.playerRadius, config, contactNormal, barDir);

  let stripped = false;
  if (target.hasPuck) {
    target.hasPuck = false;
    applyPickupLock(target, resolvePuckStickTuning(room.gameplayConfig).pickupCooldownMs);
    stripped = true;
    if (target.isTrainingDummy) {
      target.dummyResetTimerSec = config.dummyAutoResetSec;
    }
    room.puck.ownerId = null;
    room.puck.x = targetPoint.x;
    room.puck.y = targetPoint.y;
    room.puck.vx = barDir.x * 110;
    room.puck.vy = barDir.y * 110;
    markPuckRelease(room, attacker.id, 'strip');
  }

  return {
    targetId: target.id,
    targetIsDummy: !!target.isTrainingDummy,
    contactX: contact.x,
    contactY: contact.y,
    dirX: contactNormal.x,
    dirY: contactNormal.y,
    barDirX: barDir.x,
    barDirY: barDir.y,
    separationPx: contactResolve.separationPx,
    stripped,
    separated: contactResolve.separated
  };
}

function getCarryPoint(room: Room, player: PlayerState) {
  const pose = computeOwnedPuckContact(player, room.playerRadius);
  return { x: pose.contactX, y: pose.contactY };
}

function getPickupBladeZone(room: Room, player: PlayerState) {
  const pose = computeOwnedPuckContact(player, room.playerRadius);
  return {
    bladeContactX: pose.contactX,
    bladeContactY: pose.contactY,
    bladeForwardX: pose.forwardX,
    bladeForwardY: pose.forwardY,
    bladeZoneRadius: MINIMAL_STICK_CONFIG.bladeZoneRadius
  };
}

function getUnifiedStickPose(
  room: Room,
  player: PlayerState,
  state: 'carry' | 'charge' = 'carry',
  chargePose01 = 0,
  chargeStartRelativeAngle: number | null = null
) {
  return computePuckCombatPose({
    playerX: player.x,
    playerY: player.y,
    bodyAngle: player.angle,
    aimAngle: player.aimAngle,
    handedness: player.handedness,
    playerRadius: room.playerRadius,
    state,
    chargeStartRelativeAngle: state === 'charge' ? chargeStartRelativeAngle : undefined,
    charge01: state === 'charge' ? chargePose01 : 0
  });
}

function getCarrierControlPoint(room: Room, player: PlayerState) {
  const forwardX = Math.cos(player.angle);
  const forwardY = Math.sin(player.angle);
  return {
    x: player.x + forwardX * room.playerRadius * 0.55,
    y: player.y + forwardY * room.playerRadius * 0.55
  };
}

function getCrosscheckTargetPoint(
  room: Room,
  player: PlayerState,
  crosscheckPose: ReturnType<typeof computePuckCombatPose>
) {
  const puckPoint = player.hasPuck
    ? room.puck.ownerId === player.id
      ? { x: room.puck.x, y: room.puck.y }
      : getCarryPoint(room, player)
    : null;
  const controlPoint = getCarrierControlPoint(room, player);

  const puckDist = puckPoint
    ? pointToSegmentDistance(
        puckPoint.x,
        puckPoint.y,
        crosscheckPose.bladeBaseX,
        crosscheckPose.bladeBaseY,
        crosscheckPose.bladeTipX,
        crosscheckPose.bladeTipY
      )
    : Number.POSITIVE_INFINITY;
  const controlDist = pointToSegmentDistance(
    controlPoint.x,
    controlPoint.y,
    crosscheckPose.bladeBaseX,
    crosscheckPose.bladeBaseY,
    crosscheckPose.bladeTipX,
    crosscheckPose.bladeTipY
  );

  if (player.isTrainingDummy || controlDist < puckDist) {
    return { x: controlPoint.x, y: controlPoint.y, distance: controlDist };
  }

  return puckPoint
    ? { x: puckPoint.x, y: puckPoint.y, distance: puckDist }
    : { x: controlPoint.x, y: controlPoint.y, distance: controlDist };
}

function syncOwnedPuck(room: Room, owner: PlayerState) {
  const point = getCarryPoint(room, owner);
  room.puck.kind = 'owned';
  room.puck.shot = null;
  room.puck.x = point.x;
  room.puck.y = point.y;
  room.puck.vx = owner.vx;
  room.puck.vy = owner.vy;
}

function tickCrosscheckImpact(player: PlayerState, dt: number) {
  if (player.crosscheckImpactTimerSec <= 0) return;
  player.crosscheckImpactTimerSec = Math.max(0, player.crosscheckImpactTimerSec - dt);
  if (player.crosscheckImpactTimerSec > 0) return;
  player.crosscheckImpactMagnitude = 0;
  player.crosscheckImpactStripped = false;
  player.crosscheckImpactSeparated = false;
  player.crosscheckImpactTargetId = null;
  player.crosscheckImpactTargetIsDummy = false;
  player.crosscheckImpactBarDirX = 0;
  player.crosscheckImpactBarDirY = 0;
}

function tickBodyCollisionStagger(player: PlayerState, dt: number) {
  if (player.bodyCollisionStaggerTimerSec <= 0) return;
  player.bodyCollisionStaggerTimerSec = Math.max(0, player.bodyCollisionStaggerTimerSec - dt);
}

function tickBodyCollisionDebug(player: PlayerState, dt: number) {
  if (!player.bodyCollisionDebug) return;
  player.bodyCollisionDebug.timerSec = Math.max(0, player.bodyCollisionDebug.timerSec - dt);
  if (player.bodyCollisionDebug.timerSec <= 0) {
    player.bodyCollisionDebug = null;
  }
}

function tickPickupLock(player: PlayerState, dt: number) {
  if ((player.puckPickupLockTimerSec ?? 0) <= 0) return;
  player.puckPickupLockTimerSec = Math.max(0, player.puckPickupLockTimerSec - dt);
}

function applyCrosscheckImpact(player: PlayerState, impact: CrosscheckImpact) {
  player.crosscheckImpactTimerSec = 0.18;
  player.crosscheckImpactSerial += 1;
  player.crosscheckImpactContactX = impact.contactX;
  player.crosscheckImpactContactY = impact.contactY;
  player.crosscheckImpactDirX = impact.dirX;
  player.crosscheckImpactDirY = impact.dirY;
  player.crosscheckImpactBarDirX = impact.barDirX;
  player.crosscheckImpactBarDirY = impact.barDirY;
  player.crosscheckImpactMagnitude = impact.separationPx;
  player.crosscheckImpactStripped = impact.stripped;
  player.crosscheckImpactSeparated = impact.separated;
  player.crosscheckImpactTargetId = impact.targetId;
  player.crosscheckImpactTargetIsDummy = impact.targetIsDummy;
}

function resolveImpactDirection(attacker: PlayerState, target: PlayerState) {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const length = Math.hypot(dx, dy);
  if (length > 0.0001) {
    return { x: dx / length, y: dy / length };
  }
  return {
    x: Math.cos(attacker.angle),
    y: Math.sin(attacker.angle)
  };
}

function resolveCrosscheckBarContact(
  attacker: PlayerState,
  target: PlayerState,
  playerRadius: number,
  config: CrosscheckConfig,
  contactNormal: { x: number; y: number },
  barDir: { x: number; y: number }
) {
  const microGap = Math.max(1.5, config.separationPadding + (target.isTrainingDummy ? 1.5 : 0));
  const minDistance = playerRadius * 2 + microGap;
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const distance = Math.hypot(dx, dy);
  const overlapPush = Math.max(0, minDistance - distance);
  const microHelper = Math.min(1.25, Math.max(0.4, config.shoveSpeed * 0.01));
  const dummyBias = target.isTrainingDummy ? Math.max(1, config.dummyShoveMultiplier) : 1;
  const baselinePush = ((target.isTrainingDummy ? 1.2 : 0.8) + microHelper) * dummyBias;
  const separationPx = overlapPush > 0 ? overlapPush : baselinePush;
  target.x += contactNormal.x * separationPx * 0.82;
  target.y += contactNormal.y * separationPx * 0.82;
  attacker.x -= contactNormal.x * separationPx * 0.18;
  attacker.y -= contactNormal.y * separationPx * 0.18;

  const intoBar = Math.max(0, -(target.vx * barDir.x + target.vy * barDir.y));
  if (intoBar > 0) {
    target.vx += barDir.x * intoBar;
    target.vy += barDir.y * intoBar;
  }

  const attackerIntoTarget = Math.max(0, attacker.vx * barDir.x + attacker.vy * barDir.y);
  if (attackerIntoTarget > 0) {
    attacker.vx -= barDir.x * attackerIntoTarget * 0.35;
    attacker.vy -= barDir.y * attackerIntoTarget * 0.35;
  }

  return {
    separated: overlapPush > 0 || baselinePush > 0,
    separationPx
  };
}

function findTrainingDummy(room: Room) {
  return [...room.players.values()].find((player) => player.isTrainingDummy) ?? null;
}

function applyPickupLock(player: PlayerState, pickupCooldownMs: number) {
  const cooldownSec = Math.max(0, pickupCooldownMs) / 1000;
  if (cooldownSec <= 0) return;
  player.puckPickupLockTimerSec = Math.max(player.puckPickupLockTimerSec ?? 0, cooldownSec);
}

function assignPuckOwner(room: Room, owner: PlayerState | null) {
  for (const player of room.players.values()) {
    player.hasPuck = owner ? player.id === owner.id : false;
  }
  room.puck.ownerId = owner?.id ?? null;
  if (owner) {
    room.puck.kind = 'owned';
    room.puck.shot = null;
    room.puck.possessionId += 1;
    room.puck.releaseOwnerId = null;
  } else if (room.puck.kind === 'owned') {
    room.puck.kind = 'loose';
  }
}

function enforceSinglePuckOwner(room: Room) {
  const owner = room.puck.ownerId ? room.players.get(room.puck.ownerId) ?? null : null;
  if (!owner) {
    for (const player of room.players.values()) {
      player.hasPuck = false;
    }
    room.puck.ownerId = null;
    return;
  }

  for (const player of room.players.values()) {
    player.hasPuck = player.id === owner.id;
  }
}

function markPuckRelease(room: Room, ownerId: string | null, kind: 'shot' | 'strip' | 'reset') {
  room.puck.releaseSerial += 1;
  room.puck.releaseOwnerId = ownerId;
  room.puck.releaseKind = kind;
}

function integratePassiveBodyMotion(player: PlayerState, dt: number) {
  player.x += player.vx * dt;
  player.y += player.vy * dt;
}

function applyPassiveBodyDamping(player: PlayerState, dt: number) {
  const damping = Math.exp(-4.75 * Math.max(0, dt));
  player.vx *= damping;
  player.vy *= damping;
  let zeroed = false;
  if (Math.hypot(player.vx, player.vy) <= 1.2) {
    player.vx = 0;
    player.vy = 0;
    zeroed = true;
  }
  if (player.bodyCollisionDebug) {
    player.bodyCollisionDebug.postDampingVx = player.vx;
    player.bodyCollisionDebug.postDampingVy = player.vy;
    player.bodyCollisionDebug.zeroed = zeroed;
  }
}

function resolvePlayerBodyCollisions(room: Room) {
  const players = [...room.players.values()];
  if (players.length < 2) return;

  const minDistance = room.playerRadius * 2;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < players.length; i += 1) {
      const a = players[i];
      for (let j = i + 1; j < players.length; j += 1) {
        const b = players[j];
        resolveBodyPairCollision(a, b, minDistance);
      }
    }
  }
}

function resolveBodyPairCollision(a: PlayerState, b: PlayerState, minDistance: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= minDistance) return;

  const normal = distance > 0.0001
    ? { x: dx / distance, y: dy / distance }
    : { x: 1, y: 0 };
  const overlap = minDistance - distance;
  const relativeNormalSpeed = (b.vx - a.vx) * normal.x + (b.vy - a.vy) * normal.y;
  const impactSpeed = Math.max(0, -relativeNormalSpeed);
  const clearance = Math.min(3.2, 0.8 + impactSpeed * 0.02);
  const solveDistance = minDistance + clearance;
  const solvePush = Math.max(0, solveDistance - distance);
  const preA = { vx: a.vx, vy: a.vy };
  const preB = { vx: b.vx, vy: b.vy };

  const aWeight = 0.5;
  const bWeight = 0.5;

  a.x -= normal.x * solvePush * aWeight;
  a.y -= normal.y * solvePush * aWeight;
  b.x += normal.x * solvePush * bWeight;
  b.y += normal.y * solvePush * bWeight;

  const responseA = applyCollisionResponse(a, normal.x, normal.y, -1, overlap, impactSpeed);
  const responseB = applyCollisionResponse(b, normal.x, normal.y, 1, overlap, impactSpeed);
  recordBodyCollisionDebug(a, b, preA, preB, responseA);
  recordBodyCollisionDebug(b, a, preB, preA, responseB);

  const staggerSec = Math.min(0.16, 0.05 + impactSpeed / 420);
  if (staggerSec > 0.051) {
    a.bodyCollisionStaggerTimerSec = Math.max(a.bodyCollisionStaggerTimerSec, staggerSec);
    b.bodyCollisionStaggerTimerSec = Math.max(b.bodyCollisionStaggerTimerSec, staggerSec);
  }
}

function applyCollisionResponse(
  player: PlayerState,
  nx: number,
  ny: number,
  outwardSign: 1 | -1,
  overlap: number,
  impactSpeed: number
) {
  const normalSpeed = player.vx * nx + player.vy * ny;
  const inward = Math.max(0, -normalSpeed * outwardSign);
  if (inward > 0) {
    player.vx += nx * inward * outwardSign;
    player.vy += ny * inward * outwardSign;
  }

  const tangentX = -ny;
  const tangentY = nx;
  const tangentSpeed = player.vx * tangentX + player.vy * tangentY;
  player.vx -= tangentX * tangentSpeed * 0.04;
  player.vy -= tangentY * tangentSpeed * 0.04;

  const reboundFloor = Math.min(6, overlap * 1.1);
  const reboundFromImpact = impactSpeed * 0.32;
  const reboundSpeed = Math.min(36, reboundFloor + reboundFromImpact);
  player.vx += nx * reboundSpeed * outwardSign;
  player.vy += ny * reboundSpeed * outwardSign;

  return {
    removedInward: inward,
    reboundSpeed
  };
}

function recordBodyCollisionDebug(
  player: PlayerState,
  other: PlayerState,
  pre: { vx: number; vy: number },
  otherPre: { vx: number; vy: number },
  selfResponse: { removedInward: number; reboundSpeed: number }
) {
  player.bodyCollisionDebug = {
    timerSec: 0.18,
    otherId: other.id,
    otherIsDummy: !!other.isTrainingDummy,
    preVx: pre.vx,
    preVy: pre.vy,
    otherPreVx: otherPre.vx,
    otherPreVy: otherPre.vy,
    removedInward: selfResponse.removedInward,
    reboundSpeed: selfResponse.reboundSpeed,
    postVx: player.vx,
    postVy: player.vy,
    otherPostVx: other.vx,
    otherPostVy: other.vy,
    postDampingVx: player.vx,
    postDampingVy: player.vy,
    otherPostDampingVx: other.vx,
    otherPostDampingVy: other.vy,
    zeroed: false,
    otherZeroed: false
  };
  if (other.bodyCollisionDebug) {
    other.bodyCollisionDebug.otherPostDampingVx = player.vx;
    other.bodyCollisionDebug.otherPostDampingVy = player.vy;
    other.bodyCollisionDebug.otherZeroed = false;
  }
  if (!player.isTrainingDummy) {
    player.bodyCollisionDebug.zeroed = false;
  }
  if (!other.isTrainingDummy) {
    player.bodyCollisionDebug.otherZeroed = false;
  }
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const closest = closestPointOnSegment(px, py, ax, ay, bx, by);
  return Math.hypot(px - closest.x, py - closest.y);
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 0.0001) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / abLenSq));
  return {
    x: ax + abx * t,
    y: ay + aby * t
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function normalizeAngle(angle: number) {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}
