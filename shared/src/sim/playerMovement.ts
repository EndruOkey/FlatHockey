import { GAMEPLAY_DEFAULTS } from '../tuning/gameplay.defaults';
import type { GameplayConfig } from '../tuning/gameplayConfig.types';
import { applyHockeyStop, shouldTriggerHockeyStop } from './hockeyStop';
import { applyReorientation } from './reorientation';
import { computeDesiredHeading, computeTurn, wrapAngle } from './turning';
import type {
  LocomotionState,
  MovementAxis,
  PlayerMovementDebugState,
  PlayerMovementInput,
  PlayerMovementState,
  PlayerMovementStepResult,
  ResolvedPlayerMovementConfig,
  RinkBounds
} from './movementTypes';

const REVERSE_STOP_DOT_THRESHOLD = -0.55;
const REVERSE_STOP_SPEED_FACTOR = 0.35;
const MAX_EDGE_SPEED_BONUS = 0.08;
const STOP_TURN_RATE_BONUS = 0.65;
const SMALL_SPEED_EPSILON = 4;

export const DEFAULT_RINK_BOUNDS: RinkBounds = {
  left: -560,
  right: 560,
  top: -320,
  bottom: 320
};

export function sanitizeMovementAxis(value: number | undefined): MovementAxis {
  if (!Number.isFinite(value)) return 0;
  if ((value as number) > 0) return 1;
  if ((value as number) < 0) return -1;
  return 0;
}

export function resolvePlayerMovementConfig(config: Partial<GameplayConfig>): ResolvedPlayerMovementConfig {
  return {
    moveSpeed: Math.max(0, config.playerMoveSpeed ?? GAMEPLAY_DEFAULTS.playerMoveSpeed ?? 220),
    playerRadius: Math.max(0, config.playerRadius ?? GAMEPLAY_DEFAULTS.playerRadius ?? 18),
    acceleration: Math.max(1, config.playerAcceleration ?? GAMEPLAY_DEFAULTS.playerAcceleration ?? 720),
    passiveDeceleration: Math.max(
      1,
      config.playerPassiveDeceleration ?? GAMEPLAY_DEFAULTS.playerPassiveDeceleration ?? 320
    ),
    stopDeceleration: Math.max(
      1,
      config.playerStopDeceleration ?? GAMEPLAY_DEFAULTS.playerStopDeceleration ?? 980
    ),
    turnRateMin: Math.max(0.1, config.playerTurnRateMin ?? GAMEPLAY_DEFAULTS.playerTurnRateMin ?? 2.35),
    turnRateMax: Math.max(
      0.1,
      config.playerTurnRateMax ?? GAMEPLAY_DEFAULTS.playerTurnRateMax ?? 5.25
    ),
    lowSpeedPivotTurnRate: Math.max(
      0.1,
      config.playerLowSpeedPivotTurnRate ?? GAMEPLAY_DEFAULTS.playerLowSpeedPivotTurnRate ?? 4.2
    ),
    reorientationTurnRate: Math.max(
      0.1,
      config.playerReorientationTurnRate ?? GAMEPLAY_DEFAULTS.playerReorientationTurnRate ?? 7.4
    ),
    edgeBoostAmount: clamp(
      config.playerEdgeBoostAmount ?? GAMEPLAY_DEFAULTS.playerEdgeBoostAmount ?? 0.02,
      0,
      0.25
    ),
    rinkBounds: DEFAULT_RINK_BOUNDS
  };
}

export function clampPlayerPosition(x: number, y: number, config: ResolvedPlayerMovementConfig) {
  const radius = Math.max(0, config.playerRadius);
  const bounds = config.rinkBounds;
  return {
    x: clamp(x, bounds.left + radius, bounds.right - radius),
    y: clamp(y, bounds.top + radius, bounds.bottom - radius)
  };
}

export function stepPlayerMovement<T extends PlayerMovementState>(
  state: T,
  input: PlayerMovementInput,
  dt: number,
  config: ResolvedPlayerMovementConfig
): PlayerMovementStepResult {
  if (Number.isFinite(input.aimAngle)) {
    state.aimAngle = input.aimAngle as number;
  }

  const moveX = sanitizeMovementAxis(input.moveX);
  const moveY = sanitizeMovementAxis(input.moveY);
  const moveLength = Math.hypot(moveX, moveY);
  const hasMovement = moveLength > 0;
  const diagonal = moveX !== 0 && moveY !== 0;
  const dirX = hasMovement ? moveX / moveLength : 0;
  const dirY = hasMovement ? moveY / moveLength : 0;

  const currentHeading = resolveHeading(
    state.angle,
    resolveHeading(state.desiredHeading, resolveVelocityHeading(state.vx, state.vy))
  );
  const currentSpeed = Math.hypot(state.vx, state.vy);
  const locomotionHeading = hasMovement
    ? computeDesiredHeading(moveX, moveY, resolveHeading(state.desiredHeading, currentHeading))
    : resolveHeading(state.desiredHeading, currentHeading);
  const explicitStop = isPressed(input.stop);
  const reorientationRequested = isPressed(input.reorient);
  const reverseStopSpeedThreshold = Math.max(40, config.moveSpeed * REVERSE_STOP_SPEED_FACTOR);
  const stopDecision = shouldTriggerHockeyStop({
    explicitStop,
    velocityX: state.vx,
    velocityY: state.vy,
    speed: currentSpeed,
    moveDirX: dirX,
    moveDirY: dirY,
    reverseDotThreshold: REVERSE_STOP_DOT_THRESHOLD,
    reverseSpeedThreshold: reverseStopSpeedThreshold
  });

  let nextHeading = currentHeading;
  let nextVelocityX = state.vx;
  let nextVelocityY = state.vy;
  let nextDesiredHeading = locomotionHeading;
  let locomotionState: LocomotionState = state.locomotionState;
  let stopActive = false;
  let reorientationActive = false;
  let angularVelocity = 0;

  const reorientation = applyReorientation({
    active: state.locomotionState === 'reorienting',
    requested: reorientationRequested,
    hasMovement,
    currentHeading,
    desiredHeading: locomotionHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    diagonal,
    turnRate: config.reorientationTurnRate
  });

  if (hasMovement && (reorientationRequested || reorientation.active)) {
    reorientationActive = reorientation.active;
    nextHeading = reorientation.heading;
    nextDesiredHeading = reorientation.desiredHeading;
    angularVelocity = reorientation.angularVelocity;

    const stopping = applyHockeyStop(nextVelocityX, nextVelocityY, dt, config.stopDeceleration, true);
    nextVelocityX = stopping.velocityX;
    nextVelocityY = stopping.velocityY;

    if (reorientation.allowDrive) {
      const edgeBoost = computeEdgeBoost(angularVelocity, stopping.speed, config);
      const drive = approachVector(
        nextVelocityX,
        nextVelocityY,
        Math.cos(nextHeading) * config.moveSpeed * (1 + edgeBoost),
        Math.sin(nextHeading) * config.moveSpeed * (1 + edgeBoost),
        config.acceleration * Math.max(0, dt)
      );
      nextVelocityX = drive.x;
      nextVelocityY = drive.y;
      locomotionState = 'driving';
      reorientationActive = false;
    } else {
      locomotionState = 'reorienting';
    }
  } else if (stopDecision.stopRequested) {
    const stopTurnRate = Math.max(config.turnRateMax + STOP_TURN_RATE_BONUS, config.reorientationTurnRate - 0.2);
    const turn = computeTurn({
      currentHeading,
      desiredHeading: hasMovement ? locomotionHeading : currentHeading,
      speed: currentSpeed,
      maxSpeed: config.moveSpeed,
      dt,
      diagonal,
      turnRateMin: stopTurnRate,
      turnRateMax: stopTurnRate,
      lowSpeedPivotTurnRate: stopTurnRate
    });
    nextHeading = turn.heading;
    nextDesiredHeading = turn.desiredHeading;
    angularVelocity = turn.angularVelocity;

    const stopping = applyHockeyStop(nextVelocityX, nextVelocityY, dt, config.stopDeceleration, true);
    nextVelocityX = stopping.velocityX;
    nextVelocityY = stopping.velocityY;
    stopActive = stopping.active || stopDecision.explicitStop || stopDecision.reverseIntent;
    locomotionState = stopActive ? 'stopping' : hasMovement ? 'driving' : 'idle';
  } else if (hasMovement) {
    const turn = computeTurn({
      currentHeading,
      desiredHeading: locomotionHeading,
      speed: currentSpeed,
      maxSpeed: config.moveSpeed,
      dt,
      diagonal,
      turnRateMin: config.turnRateMin,
      turnRateMax: config.turnRateMax,
      lowSpeedPivotTurnRate: config.lowSpeedPivotTurnRate
    });
    nextHeading = turn.heading;
    nextDesiredHeading = turn.desiredHeading;
    angularVelocity = turn.angularVelocity;

    const edgeBoost = computeEdgeBoost(angularVelocity, currentSpeed, config);
    const targetSpeed = config.moveSpeed * (1 + edgeBoost);
    const drive = approachVector(
      nextVelocityX,
      nextVelocityY,
      Math.cos(nextHeading) * targetSpeed,
      Math.sin(nextHeading) * targetSpeed,
      config.acceleration * Math.max(0, dt)
    );
    nextVelocityX = drive.x;
    nextVelocityY = drive.y;
    locomotionState = 'driving';
  } else {
    const glide = approachVector(
      nextVelocityX,
      nextVelocityY,
      0,
      0,
      config.passiveDeceleration * Math.max(0, dt)
    );
    nextVelocityX = glide.x;
    nextVelocityY = glide.y;
    locomotionState = Math.hypot(nextVelocityX, nextVelocityY) > SMALL_SPEED_EPSILON ? 'gliding' : 'idle';
  }

  const cappedVelocity = capVelocity(
    nextVelocityX,
    nextVelocityY,
    config.moveSpeed * (1 + Math.min(MAX_EDGE_SPEED_BONUS, config.edgeBoostAmount + 0.03))
  );
  nextVelocityX = cappedVelocity.x;
  nextVelocityY = cappedVelocity.y;

  if (Math.hypot(nextVelocityX, nextVelocityY) <= SMALL_SPEED_EPSILON) {
    nextVelocityX = 0;
    nextVelocityY = 0;
    if (locomotionState === 'gliding') {
      locomotionState = hasMovement ? 'driving' : 'idle';
    }
    if (locomotionState === 'stopping' && !stopActive) {
      locomotionState = hasMovement ? 'driving' : 'idle';
    }
  }

  if (dt > 0) {
    const unclampedX = state.x + nextVelocityX * dt;
    const unclampedY = state.y + nextVelocityY * dt;
    const clamped = clampPlayerPosition(unclampedX, unclampedY, config);
    if (clamped.x !== unclampedX) nextVelocityX = 0;
    if (clamped.y !== unclampedY) nextVelocityY = 0;
    state.x = clamped.x;
    state.y = clamped.y;
  }

  state.vx = nextVelocityX;
  state.vy = nextVelocityY;
  state.angle = wrapAngle(nextHeading);
  state.desiredHeading = wrapAngle(nextDesiredHeading);
  state.locomotionState = locomotionState;

  const speed = Math.hypot(state.vx, state.vy);
  if (speed <= SMALL_SPEED_EPSILON && locomotionState === 'driving' && !hasMovement) {
    state.locomotionState = 'idle';
  }

  return {
    x: state.x,
    y: state.y,
    moveX,
    moveY,
    vx: state.vx,
    vy: state.vy,
    speed,
    heading: state.angle,
    desiredHeading: state.desiredHeading,
    locomotionState: state.locomotionState,
    stopActive: state.locomotionState === 'stopping' || stopActive,
    reorientationActive: state.locomotionState === 'reorienting' || reorientationActive
  };
}

export function getPlayerMovementDebugState(
  state: PlayerMovementState,
  step?: Pick<
    PlayerMovementStepResult,
    'vx' | 'vy' | 'speed' | 'heading' | 'desiredHeading' | 'locomotionState' | 'stopActive' | 'reorientationActive'
  >
): PlayerMovementDebugState {
  const velocityX = step?.vx ?? state.vx;
  const velocityY = step?.vy ?? state.vy;
  const heading = resolveHeading(step?.heading, resolveHeading(state.angle, 0));
  const desiredHeading = resolveHeading(step?.desiredHeading, resolveHeading(state.desiredHeading, heading));
  const locomotionState = step?.locomotionState ?? state.locomotionState;

  return {
    speed: step?.speed ?? Math.hypot(velocityX, velocityY),
    velocityX,
    velocityY,
    heading,
    desiredHeading,
    locomotionState,
    stopActive: step?.stopActive ?? locomotionState === 'stopping',
    reorientationActive: step?.reorientationActive ?? locomotionState === 'reorienting'
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveHeading(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function resolveVelocityHeading(vx: number, vy: number) {
  if (Math.hypot(vx, vy) <= SMALL_SPEED_EPSILON) return 0;
  return Math.atan2(vy, vx);
}

function isPressed(value: number | undefined) {
  return !!value;
}

function computeEdgeBoost(
  angularVelocity: number,
  speed: number,
  config: ResolvedPlayerMovementConfig
) {
  const normalizedTurn = clamp(
    Math.abs(angularVelocity) / Math.max(config.turnRateMax, config.reorientationTurnRate, 0.001),
    0,
    1
  );
  const normalizedSpeed = clamp(speed / Math.max(1, config.moveSpeed), 0, 1);
  return clamp(config.edgeBoostAmount * normalizedTurn * normalizedSpeed, 0, MAX_EDGE_SPEED_BONUS);
}

function approachVector(
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  maxDelta: number
) {
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxDelta || distance === 0) {
    return { x: targetX, y: targetY };
  }

  const scale = maxDelta / distance;
  return {
    x: currentX + dx * scale,
    y: currentY + dy * scale
  };
}

function capVelocity(vx: number, vy: number, maxSpeed: number) {
  const speed = Math.hypot(vx, vy);
  if (speed <= maxSpeed || speed === 0) {
    return { x: vx, y: vy };
  }

  const scale = maxSpeed / speed;
  return {
    x: vx * scale,
    y: vy * scale
  };
}
