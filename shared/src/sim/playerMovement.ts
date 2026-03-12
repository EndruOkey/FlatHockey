import { GAMEPLAY_DEFAULTS } from '../tuning/gameplay.defaults';
import type { GameplayConfig } from '../tuning/gameplayConfig.types';
import { applyHockeyStop, shouldTriggerHockeyStop } from './hockeyStop';
import { resolveForwardHeadingTarget, resolveForwardTravelAlignment } from './reorientation';
import { advanceSteeringTarget, computeBodyTurn, computeDesiredHeading, computeTravelSteering, shortestAngleDelta, wrapAngle } from './turning';
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

const MAX_CARVE_BONUS = 0.092;
const SMALL_SPEED_EPSILON = 5;

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
  const legacyRotationSpeed = config.playerTurnRateMin ?? GAMEPLAY_DEFAULTS.playerTurnRateMin ?? 2.35;
  const legacyLowSpeedRotation = config.playerTurnRateMax ?? GAMEPLAY_DEFAULTS.playerTurnRateMax ?? 5.25;

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
    traction: Math.max(0.1, config.playerTraction ?? GAMEPLAY_DEFAULTS.playerTraction ?? 8.5),
    rotationSpeed: Math.max(0.1, config.playerRotationSpeed ?? GAMEPLAY_DEFAULTS.playerRotationSpeed ?? legacyRotationSpeed),
    lowSpeedRotationSpeed: Math.max(
      0.1,
      config.playerLowSpeedRotationSpeed ?? GAMEPLAY_DEFAULTS.playerLowSpeedRotationSpeed ?? legacyLowSpeedRotation
    ),
    turnPenalty: clamp(config.playerTurnPenalty ?? GAMEPLAY_DEFAULTS.playerTurnPenalty ?? 0.8, 0, 2),
    carveResponse: clamp(
      config.playerCarveResponse ?? GAMEPLAY_DEFAULTS.playerCarveResponse ?? config.playerEdgeBoostAmount ?? 0.03,
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
  const currentSpeed = Math.hypot(state.vx, state.vy);
  const currentHeading = resolveHeading(state.angle, 0);
  const previousDesiredHeading = resolveHeading(state.desiredHeading, currentHeading);
  const previousSteeringHeading = resolveHeading(state.steeringHeading, previousDesiredHeading);
  const previousInputHeading = resolveHeading(state.inputHeading, previousDesiredHeading);
  const currentTravelHeading = resolveTravelHeading(state, currentSpeed, currentHeading);
  const rawDesiredHeading = hasMovement
    ? computeDesiredHeading(moveX, moveY, currentTravelHeading)
    : currentTravelHeading;
  const steeringHeading = hasMovement
    ? advanceSteeringTarget({
        steeringHeading: previousSteeringHeading,
        rawDesiredHeading,
        speed: currentSpeed,
        maxSpeed: config.moveSpeed,
        dt
      })
    : currentHeading;
  const stopRequested = shouldTriggerHockeyStop(isPressed(input.stop));
  const stop = applyHockeyStop(currentSpeed, dt, config.stopDeceleration, stopRequested.stopRequested);
  const headingTarget = resolveForwardHeadingTarget({
    hasMovement,
    currentHeading,
    desiredTravelHeading: steeringHeading
  });
  const bodyTurn = computeBodyTurn({
    currentHeading,
    desiredHeading: headingTarget.desiredBodyHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    rotationSpeed: config.rotationSpeed,
    lowSpeedRotationSpeed: config.lowSpeedRotationSpeed,
    rotationMultiplier: stop.rotationMultiplier
  });
  const steering = computeTravelSteering({
    currentTravelHeading,
    targetHeading: bodyTurn.heading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    traction: config.traction * stop.tractionMultiplier,
    stopActive: stopRequested.stopRequested,
    turnPenalty: config.turnPenalty
  });
  const forwardAlignment = resolveForwardTravelAlignment({
    bodyHeading: bodyTurn.heading,
    desiredTravelHeading: steeringHeading,
    travelHeading: steering.travelHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed
  });
  const responsePenalty = Math.min(
    steering.turnPenaltyMultiplier,
    computeIntentPenalty(
      currentTravelHeading,
      steeringHeading,
      hasMovement,
      stopRequested.stopRequested,
      currentSpeed,
      config.moveSpeed
    ),
    computeForwardAlignmentPenalty(forwardAlignment.mismatch)
  );

  const driveFactor = computeDriveFactor({
    hasMovement,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed,
    currentTravelHeading,
    desiredTravelHeading: steeringHeading,
    bodyHeading: bodyTurn.heading,
    stopActive: stopRequested.stopRequested
  });
  const bodyDriveFactor = computeBodyDriveFactor(bodyTurn.remainingAngle, currentSpeed, config.moveSpeed);
  const intentFlipDriveFactor = computeIntentFlipDriveFactor(
    previousInputHeading,
    rawDesiredHeading,
    hasMovement,
    currentSpeed,
    config.moveSpeed
  );
  const driveScale = Math.min(driveFactor, bodyDriveFactor, intentFlipDriveFactor);
  const targetSpeed = resolveTargetSpeed(hasMovement, config) * driveScale;
  const acceleration = config.acceleration * lerp(0.26, 1, driveScale);
  const baseSpeed = stopRequested.stopRequested
    ? stop.speed
    : approachSpeed(
        currentSpeed,
        targetSpeed * lerp(0.78, 1, responsePenalty) * (1 + computeCarveBonus(steering, bodyTurn, forwardAlignment.mismatch, currentSpeed, config)),
        acceleration,
        config.passiveDeceleration + config.moveSpeed * (1 - responsePenalty) * 0.05,
        dt
      );
  const turnDrag = stopRequested.stopRequested
    ? 0
    : config.moveSpeed * (1 - responsePenalty) * Math.max(0, dt) * 0.018;
  let nextSpeed = Math.max(0, baseSpeed - turnDrag);

  if (!hasMovement && !stopRequested.stopRequested) {
    nextSpeed = Math.max(0, currentSpeed - config.passiveDeceleration * Math.max(0, dt));
  }

  if (nextSpeed <= SMALL_SPEED_EPSILON) {
    nextSpeed = 0;
  }

  const nextTravelHeading = nextSpeed > 0 ? wrapAngle(forwardAlignment.travelHeading) : wrapAngle(currentTravelHeading);
  let nextVelocityX = Math.cos(nextTravelHeading) * nextSpeed;
  let nextVelocityY = Math.sin(nextTravelHeading) * nextSpeed;

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
  state.angle = wrapAngle(bodyTurn.heading);
  state.travelHeading = nextTravelHeading;
  state.steeringHeading = hasMovement ? wrapAngle(steeringHeading) : currentHeading;
  state.inputHeading = hasMovement ? wrapAngle(rawDesiredHeading) : currentHeading;
  state.desiredHeading = wrapAngle(steeringHeading);
  state.locomotionState = resolveLocomotionState({
    hasMovement,
    speed: nextSpeed,
    stopActive: stop.active || stopRequested.stopRequested
  });

  return {
    x: state.x,
    y: state.y,
    moveX,
    moveY,
    vx: state.vx,
    vy: state.vy,
    speed: nextSpeed,
    heading: state.angle,
    desiredHeading: state.desiredHeading,
    travelHeading: state.travelHeading,
    locomotionState: state.locomotionState,
    stopActive: state.locomotionState === 'stopping'
  };
}

export function getPlayerMovementDebugState(
  state: PlayerMovementState,
  step?: Pick<
    PlayerMovementStepResult,
    'vx' | 'vy' | 'speed' | 'heading' | 'desiredHeading' | 'travelHeading' | 'locomotionState' | 'stopActive'
  >
): PlayerMovementDebugState {
  const velocityX = step?.vx ?? state.vx;
  const velocityY = step?.vy ?? state.vy;
  const heading = resolveHeading(step?.heading, resolveHeading(state.angle, 0));
  const desiredHeading = resolveHeading(step?.desiredHeading, resolveHeading(state.desiredHeading, heading));
  const travelHeading = resolveHeading(
    step?.travelHeading,
    resolveTravelHeading(state, step?.speed ?? Math.hypot(velocityX, velocityY), heading)
  );
  const locomotionState = step?.locomotionState ?? state.locomotionState;

  return {
    speed: step?.speed ?? Math.hypot(velocityX, velocityY),
    velocityX,
    velocityY,
    heading,
    desiredHeading,
    travelHeading,
    locomotionState,
    stopActive: step?.stopActive ?? locomotionState === 'stopping'
  };
}

function resolveLocomotionState(input: {
  hasMovement: boolean;
  speed: number;
  stopActive: boolean;
}): LocomotionState {
  if (input.speed <= SMALL_SPEED_EPSILON) return 'idle';
  if (input.stopActive) return 'stopping';
  if (!input.hasMovement) return 'gliding';
  return 'skating';
}

function resolveHeading(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? wrapAngle(value as number) : fallback;
}

function resolveTravelHeading(state: PlayerMovementState, speed: number, fallback: number) {
  if (Number.isFinite(state.travelHeading)) {
    return wrapAngle(state.travelHeading);
  }
  if (speed > SMALL_SPEED_EPSILON) {
    return Math.atan2(state.vy, state.vx);
  }
  return fallback;
}

function resolveTargetSpeed(hasMovement: boolean, config: ResolvedPlayerMovementConfig) {
  if (!hasMovement) return 0;
  return config.moveSpeed;
}

function computeDriveFactor(input: {
  hasMovement: boolean;
  speed: number;
  moveSpeed: number;
  currentTravelHeading: number;
  desiredTravelHeading: number;
  bodyHeading: number;
  stopActive: boolean;
}) {
  if (!input.hasMovement || input.stopActive) return 0;
  const speedRatio = clamp(input.speed / Math.max(1, input.moveSpeed), 0, 1);
  const intentMismatch = Math.abs(shortestAngleDelta(input.currentTravelHeading, input.desiredTravelHeading));
  const bodyMismatch = Math.abs(shortestAngleDelta(input.currentTravelHeading, input.bodyHeading));
  const combinedMismatch = Math.max(intentMismatch, bodyMismatch * 0.82);
  const normalized = clamp(combinedMismatch / Math.PI, 0, 1);
  const easing = lerp(1.7, 1.1, speedRatio);
  const strength = lerp(0.92, 0.42, speedRatio);
  const floor = lerp(0.02, 0.48, speedRatio);
  return clamp(1 - strength * Math.pow(normalized, easing), floor, 1);
}

function computeBodyDriveFactor(remainingAngle: number, speed: number, moveSpeed: number) {
  const speedRatio = clamp(speed / Math.max(1, moveSpeed), 0, 1);
  const normalized = clamp(Math.abs(remainingAngle) / Math.PI, 0, 1);
  const easing = lerp(1.6, 1.05, speedRatio);
  const strength = lerp(0.88, 0.32, speedRatio);
  const floor = lerp(0.04, 0.62, speedRatio);
  return clamp(1 - strength * Math.pow(normalized, easing), floor, 1);
}

function computeIntentFlipDriveFactor(
  previousDesiredHeading: number,
  desiredTravelHeading: number,
  hasMovement: boolean,
  speed: number,
  moveSpeed: number
) {
  if (!hasMovement) return 1;
  const speedRatio = clamp(speed / Math.max(1, moveSpeed), 0, 1);
  const mismatch = Math.abs(shortestAngleDelta(previousDesiredHeading, desiredTravelHeading));
  const normalized = clamp(mismatch / Math.PI, 0, 1);
  const strength = lerp(0.9, 0.2, speedRatio);
  const floor = lerp(0.08, 0.72, speedRatio);
  return clamp(1 - strength * Math.pow(normalized, 1.2), floor, 1);
}

function computeIntentPenalty(
  currentTravelHeading: number,
  desiredTravelHeading: number,
  hasMovement: boolean,
  stopActive: boolean,
  speed: number,
  moveSpeed: number
) {
  if (!hasMovement || stopActive) return 1;
  const mismatch = Math.abs(shortestAngleDelta(currentTravelHeading, desiredTravelHeading));
  const speedRatio = clamp(speed / Math.max(1, moveSpeed), 0, 1);
  const normalized = clamp(mismatch / Math.PI, 0, 1);
  const strength = lerp(0.7, 0.28, speedRatio);
  const floor = lerp(0.38, 0.7, speedRatio);
  return clamp(1 - strength * Math.pow(normalized, 1.45), floor, 1);
}

function computeForwardAlignmentPenalty(mismatch: number) {
  const normalized = clamp(mismatch / (Math.PI * 0.5), 0, 1);
  return clamp(1 - 0.17 * Math.pow(normalized, 1.1), 0.82, 1);
}

function approachSpeed(current: number, target: number, acceleration: number, deceleration: number, dt: number) {
  if (dt <= 0) return current;
  if (current < target) {
    return Math.min(target, current + Math.max(0, acceleration) * dt);
  }
  return Math.max(target, current - Math.max(0, deceleration) * dt);
}

function computeCarveBonus(
  steering: ReturnType<typeof computeTravelSteering>,
  bodyTurn: ReturnType<typeof computeBodyTurn>,
  alignmentMismatch: number,
  speed: number,
  config: ResolvedPlayerMovementConfig
) {
  const speedRatio = clamp(speed / Math.max(1, config.moveSpeed), 0, 1);
  const bodyTurnRatio = clamp(
    Math.abs(bodyTurn.appliedDelta) / Math.max(bodyTurn.turnRate * (1 / 60), 0.0001),
    0,
    1
  );
  const driftWindow = clamp(alignmentMismatch / (Math.PI * 0.1), 0, 1) * clamp(1 - alignmentMismatch / (Math.PI * 0.68), 0, 1);
  const bodySettle = clamp(1 - Math.abs(bodyTurn.remainingAngle) / (Math.PI * 0.92), 0, 1);
  return clamp(
    config.carveResponse * steering.carveFactor * bodyTurnRatio * speedRatio * driftWindow * bodySettle,
    0,
    MAX_CARVE_BONUS
  );
}

function isPressed(value: number | undefined) {
  return !!value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
