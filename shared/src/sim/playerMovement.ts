import { GAMEPLAY_DEFAULTS } from '../tuning/gameplay.defaults';
import type { GameplayConfig } from '../tuning/gameplayConfig.types';
import { applyHockeyStop, shouldTriggerHockeyStop } from './hockeyStop';
import { resolveBackwardsSkating } from './reorientation';
import { computeBodyTurn, computeDesiredHeading, computeTravelSteering, shortestAngleDelta, wrapAngle } from './turning';
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

const MAX_CARVE_BONUS = 0.04;
const SMALL_SPEED_EPSILON = 6;

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
    backwardsAngle: degToRad(clamp(config.playerBackwardsAngleDeg ?? GAMEPLAY_DEFAULTS.playerBackwardsAngleDeg ?? 120, 90, 175)),
    backwardsRotationMultiplier: clamp(
      config.playerBackwardsRotationMultiplier ?? GAMEPLAY_DEFAULTS.playerBackwardsRotationMultiplier ?? 0.6,
      0.2,
      1.4
    ),
    backwardsAccelerationMultiplier: clamp(
      config.playerBackwardsAccelerationMultiplier ?? GAMEPLAY_DEFAULTS.playerBackwardsAccelerationMultiplier ?? 0.7,
      0.2,
      1.4
    ),
    backwardsSpeedMultiplier: clamp(
      config.playerBackwardsSpeedMultiplier ?? GAMEPLAY_DEFAULTS.playerBackwardsSpeedMultiplier ?? 0.85,
      0.2,
      1.2
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
  const currentSpeed = Math.hypot(state.vx, state.vy);
  const currentHeading = resolveHeading(state.angle, 0);
  const currentTravelHeading = resolveTravelHeading(state, currentSpeed, currentHeading);
  const desiredTravelHeading = hasMovement
    ? computeDesiredHeading(moveX, moveY, currentTravelHeading)
    : currentTravelHeading;
  const stopRequested = shouldTriggerHockeyStop(isPressed(input.stop));
  const stop = applyHockeyStop(currentSpeed, dt, config.stopDeceleration, stopRequested.stopRequested);
  const backwardsState = resolveBackwardsSkating({
    hasMovement,
    manualOverride: isPressed(input.backwards),
    wasBackwards: !!state.backwards,
    bodyHeading: currentHeading,
    desiredTravelHeading,
    backwardsAngle: config.backwardsAngle
  });
  const bodyTurn = computeBodyTurn({
    currentHeading,
    desiredHeading: hasMovement ? backwardsState.desiredBodyHeading : currentHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    diagonal,
    rotationSpeed: config.rotationSpeed,
    lowSpeedRotationSpeed: config.lowSpeedRotationSpeed,
    rotationMultiplier: (backwardsState.active ? config.backwardsRotationMultiplier : 1) * stop.rotationMultiplier
  });
  const travelTargetHeading = backwardsState.active ? wrapAngle(bodyTurn.heading + Math.PI) : bodyTurn.heading;
  const steering = computeTravelSteering({
    currentTravelHeading,
    targetHeading: travelTargetHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    traction: config.traction * stop.tractionMultiplier,
    diagonal,
    backwardsActive: backwardsState.active,
    stopActive: stopRequested.stopRequested,
    turnPenalty: config.turnPenalty
  });
  const responsePenalty = Math.min(
    steering.turnPenaltyMultiplier,
    computeIntentPenalty(currentTravelHeading, desiredTravelHeading, hasMovement, stopRequested.stopRequested)
  );

  const driveFactor = computeDriveFactor({
    hasMovement,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed,
    desiredTravelHeading,
    travelTargetHeading,
    stopActive: stopRequested.stopRequested
  });
  const targetSpeed = resolveTargetSpeed(hasMovement, backwardsState.active, config) * driveFactor;
  const acceleration = config.acceleration * (backwardsState.active ? config.backwardsAccelerationMultiplier : 1);
  const baseSpeed = stopRequested.stopRequested
    ? stop.speed
    : approachSpeed(
        currentSpeed,
        targetSpeed * responsePenalty * (1 + computeCarveBonus(steering, bodyTurn, currentSpeed, config)),
        acceleration,
        config.passiveDeceleration + config.moveSpeed * (1 - responsePenalty) * 0.9,
        dt
      );
  const turnDrag = stopRequested.stopRequested
    ? 0
    : config.moveSpeed * (1 - responsePenalty) * Math.max(0, dt) * 1.05;
  let nextSpeed = Math.max(0, baseSpeed - turnDrag);

  if (!hasMovement && !stopRequested.stopRequested) {
    nextSpeed = Math.max(0, currentSpeed - config.passiveDeceleration * Math.max(0, dt));
  }

  if (nextSpeed <= SMALL_SPEED_EPSILON) {
    nextSpeed = 0;
  }

  let nextVelocityX = Math.cos(steering.travelHeading) * nextSpeed;
  let nextVelocityY = Math.sin(steering.travelHeading) * nextSpeed;

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
  state.travelHeading = nextSpeed > 0 ? wrapAngle(steering.travelHeading) : wrapAngle(state.travelHeading);
  state.desiredHeading = wrapAngle(bodyTurn.desiredHeading);
  state.backwards = backwardsState.active && (hasMovement || nextSpeed > SMALL_SPEED_EPSILON);
  state.locomotionState = resolveLocomotionState({
    hasMovement,
    speed: nextSpeed,
    stopActive: stop.active || stopRequested.stopRequested,
    backwardsActive: state.backwards
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
    stopActive: state.locomotionState === 'stopping',
    backwardsActive: state.backwards
  };
}

export function getPlayerMovementDebugState(
  state: PlayerMovementState,
  step?: Pick<
    PlayerMovementStepResult,
    'vx' | 'vy' | 'speed' | 'heading' | 'desiredHeading' | 'travelHeading' | 'locomotionState' | 'stopActive' | 'backwardsActive'
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
    stopActive: step?.stopActive ?? locomotionState === 'stopping',
    backwardsActive: step?.backwardsActive ?? state.backwards
  };
}

function resolveLocomotionState(input: {
  hasMovement: boolean;
  speed: number;
  stopActive: boolean;
  backwardsActive: boolean;
}): LocomotionState {
  if (input.speed <= SMALL_SPEED_EPSILON) return 'idle';
  if (input.stopActive) return 'stopping';
  if (!input.hasMovement) return 'gliding';
  if (input.backwardsActive) return 'backwards';
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

function resolveTargetSpeed(hasMovement: boolean, backwardsActive: boolean, config: ResolvedPlayerMovementConfig) {
  if (!hasMovement) return 0;
  return config.moveSpeed * (backwardsActive ? config.backwardsSpeedMultiplier : 1);
}

function computeDriveFactor(input: {
  hasMovement: boolean;
  speed: number;
  moveSpeed: number;
  desiredTravelHeading: number;
  travelTargetHeading: number;
  stopActive: boolean;
}) {
  if (!input.hasMovement || input.stopActive) return 0;
  const mismatch = Math.abs(shortestAngleDelta(input.travelTargetHeading, input.desiredTravelHeading));
  const speedRatio = clamp(input.speed / Math.max(1, input.moveSpeed * 0.35), 0, 1);
  const alignment = clamp(1 - mismatch / Math.PI, 0, 1);
  const exponent = lerp(1.9, 1.25, speedRatio);
  return clamp(Math.pow(alignment, exponent), 0.03, 1);
}

function computeIntentPenalty(
  currentTravelHeading: number,
  desiredTravelHeading: number,
  hasMovement: boolean,
  stopActive: boolean
) {
  if (!hasMovement || stopActive) return 1;
  const mismatch = Math.abs(shortestAngleDelta(currentTravelHeading, desiredTravelHeading));
  const normalized = clamp(mismatch / Math.PI, 0, 1);
  return clamp(1 - 0.85 * Math.pow(normalized, 1.15), 0.15, 1);
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
  speed: number,
  config: ResolvedPlayerMovementConfig
) {
  const speedRatio = clamp(speed / Math.max(1, config.moveSpeed), 0, 1);
  const bodyTurnRatio = clamp(
    Math.abs(bodyTurn.appliedDelta) / Math.max(bodyTurn.turnRate * (1 / 60), 0.0001),
    0,
    1
  );
  const mismatchWindow = clamp(1 - steering.mismatch / (Math.PI * 0.45), 0, 1);
  const bodySettle = clamp(1 - Math.abs(bodyTurn.remainingAngle) / (Math.PI * 0.35), 0, 1);
  return clamp(
    config.carveResponse * steering.carveFactor * bodyTurnRatio * speedRatio * mismatchWindow * bodySettle,
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

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}
