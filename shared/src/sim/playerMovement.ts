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
const LOW_SPEED_ACCEL_BURST_THRESHOLD_RATIO = 0.42;
const LOW_SPEED_ACCEL_BURST_MULTIPLIER = 1.5;
const ACTIVE_INPUT_DRAG_MULTIPLIER = 0.6;
const LOW_SPEED_REORIENTATION_MULTIPLIER = 1.8;
const LATERAL_CORRECTION_BOOST = 1.2;
const INTENT_BOOST_DURATION = 0.12;
const INTENT_BOOST_DIRECTION_CHANGE_THRESHOLD = (40 * Math.PI) / 180;
const INTENT_BOOST_LOW_SPEED_THRESHOLD_RATIO = 0.35;
const INTENT_BOOST_ACCEL_STRENGTH = 0.35;
const INTENT_BOOST_STEERING_STRENGTH = 0.25;

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
  const activeInputDragMultiplier = hasMovement ? ACTIVE_INPUT_DRAG_MULTIPLIER : 1;
  const rawDesiredHeading = hasMovement
    ? computeDesiredHeading(moveX, moveY, currentTravelHeading)
    : currentTravelHeading;
  const intentBoost = updateIntentBoostState({
    state,
    hasMovement,
    rawDesiredHeading,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed,
    dt
  });
  const turnContext = resolveTurnContext({
    hasMovement,
    currentHeading,
    currentTravelHeading,
    desiredHeading: rawDesiredHeading,
    rawDesiredHeading,
    previousInputHeading,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed
  });
  const steeringHeading = hasMovement
    ? advanceSteeringTarget({
        steeringHeading: previousSteeringHeading,
        rawDesiredHeading,
        speed: currentSpeed,
        maxSpeed: config.moveSpeed,
        dt,
        inputHold: turnContext.inputHold,
        smallCorrection: turnContext.smallCorrection,
        responseMultiplier: intentBoost.steeringMultiplier
      })
    : currentHeading;
  const resolvedTurnContext = resolveTurnContext({
    hasMovement,
    currentHeading,
    currentTravelHeading,
    desiredHeading: steeringHeading,
    rawDesiredHeading,
    previousInputHeading,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed
  });
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
    smallCorrection: resolvedTurnContext.smallCorrection,
    turnMagnitude: resolvedTurnContext.turnMagnitude,
    inputHold: resolvedTurnContext.inputHold,
    turnDevelopment: resolvedTurnContext.turnDevelopment,
    rotationSpeed: config.rotationSpeed,
    lowSpeedRotationSpeed: config.lowSpeedRotationSpeed,
    rotationMultiplier: stop.rotationMultiplier * computeLowSpeedTurnMultiplier(currentSpeed, config.moveSpeed)
  });
  const steering = computeTravelSteering({
    currentTravelHeading,
    targetHeading: bodyTurn.heading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    dt,
    smallCorrection: resolvedTurnContext.smallCorrection,
    turnMagnitude: resolvedTurnContext.turnMagnitude,
    turnCommitment: resolvedTurnContext.turnCommitment,
    activeCarve: resolvedTurnContext.activeCarve,
    traction: config.traction * stop.tractionMultiplier * intentBoost.steeringMultiplier,
    stopActive: stopRequested.stopRequested,
    turnPenalty: config.turnPenalty
  });
  const forwardAlignment = resolveForwardTravelAlignment({
    bodyHeading: bodyTurn.heading,
    desiredTravelHeading: steeringHeading,
    travelHeading: steering.travelHeading,
    speed: currentSpeed,
    maxSpeed: config.moveSpeed,
    smallCorrection: resolvedTurnContext.smallCorrection,
    turnCommitment: resolvedTurnContext.turnCommitment,
    activeCarve: resolvedTurnContext.activeCarve
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
  const accelerationResponse = resolveAccelerationResponse({
    speed: currentSpeed,
    moveSpeed: config.moveSpeed,
    turnContext: resolvedTurnContext
  });
  const driveScale = clamp(
    Math.min(driveFactor, bodyDriveFactor, intentFlipDriveFactor) + accelerationResponse.driveScaleLift,
    0,
    1
  );
  const targetSpeed = resolveTargetSpeed(hasMovement, config) * driveScale;
  const acceleration =
    config.acceleration *
    lerp(0.28, 1.02, driveScale) *
    (1 + accelerationResponse.accelerationBoost) *
    computeAccelerationBurstMultiplier(currentSpeed, config.moveSpeed, hasMovement, stopRequested.stopRequested) *
    intentBoost.accelerationMultiplier;
  const carveBonus = computeCarveBonus(
    steering,
    bodyTurn,
    forwardAlignment.mismatch,
    resolvedTurnContext,
    currentSpeed,
    config
  );
  const driveTargetSpeed =
    targetSpeed * lerp(0.78, 1, responsePenalty) * (1 + carveBonus + accelerationResponse.driveTargetBoost);
  const driveDeceleration =
    (config.passiveDeceleration + config.moveSpeed * (1 - responsePenalty) * 0.05) *
    lerp(1, 0.84, resolvedTurnContext.activeCarve) *
    activeInputDragMultiplier;
  const driveHeading = resolveDriveHeading({
    bodyHeading: bodyTurn.heading,
    steeringHeading,
    alignmentHeading: forwardAlignment.travelHeading,
    speed: currentSpeed,
    moveSpeed: config.moveSpeed,
    turnContext: resolvedTurnContext
  });
  const drivenVelocity = stopRequested.stopRequested
    ? setVelocityMagnitude(state.vx, state.vy, stop.speed, currentTravelHeading)
    : !hasMovement
      ? dampVelocityMagnitude(state.vx, state.vy, config.passiveDeceleration * Math.max(0, dt))
      : applyDirectionalDrive({
          vx: state.vx,
          vy: state.vy,
          driveHeading,
          targetSpeed: driveTargetSpeed,
          acceleration,
          deceleration: driveDeceleration,
          pickupBoost: accelerationResponse.entryPickup,
          dt
        });
  const drivenSpeed = Math.hypot(drivenVelocity.x, drivenVelocity.y);
  const drivenTravelHeading = drivenSpeed > SMALL_SPEED_EPSILON ? Math.atan2(drivenVelocity.y, drivenVelocity.x) : currentTravelHeading;
  const drivenBodyTravelMismatch = Math.abs(shortestAngleDelta(drivenTravelHeading, bodyTurn.heading));
  const lateralDecay = stopRequested.stopRequested
    ? config.stopDeceleration * 0.82
    : computeLateralDecay({
        speed: drivenSpeed,
        moveSpeed: config.moveSpeed,
        passiveDeceleration: config.passiveDeceleration,
        responsePenalty,
        alignmentMismatch: forwardAlignment.mismatch,
        travelAlignmentError: Math.abs(shortestAngleDelta(drivenTravelHeading, forwardAlignment.travelHeading)),
        bodyTravelMismatch: drivenBodyTravelMismatch,
        turnContext: resolvedTurnContext
      }) * computeLateralCorrectionBoost(drivenTravelHeading, steeringHeading, drivenSpeed, config.moveSpeed);
  const alignedVelocity = stopRequested.stopRequested || !hasMovement
    ? drivenVelocity
    : dampVelocityLateralComponent(drivenVelocity.x, drivenVelocity.y, forwardAlignment.travelHeading, lateralDecay, dt);
  const turnDrag = stopRequested.stopRequested
    ? 0
    : config.moveSpeed *
        (1 - responsePenalty) *
        Math.max(0, dt) *
        0.01 *
        activeInputDragMultiplier *
        lerp(1, 0.88, accelerationResponse.turnDragRelief) *
        lerp(1, 0.84, resolvedTurnContext.activeCarve);
  const draggedVelocity = turnDrag > 0 ? dampVelocityMagnitude(alignedVelocity.x, alignedVelocity.y, turnDrag) : alignedVelocity;
  const speedCap =
    stopRequested.stopRequested || !hasMovement
      ? null
      : Math.max(currentSpeed, config.moveSpeed * (1 + carveBonus * 0.7));
  const cappedVelocity = speedCap === null ? draggedVelocity : clampVelocityMagnitude(draggedVelocity.x, draggedVelocity.y, speedCap);
  let nextVelocityX = cappedVelocity.x;
  let nextVelocityY = cappedVelocity.y;
  let nextSpeed = Math.hypot(nextVelocityX, nextVelocityY);

  if (nextSpeed <= SMALL_SPEED_EPSILON) {
    nextSpeed = 0;
    nextVelocityX = 0;
    nextVelocityY = 0;
  }

  const nextTravelHeading = nextSpeed > 0 ? Math.atan2(nextVelocityY, nextVelocityX) : wrapAngle(currentTravelHeading);

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
  turnContext: TurnContext,
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
  const phaseBoost = lerp(0.92, 1.22, turnContext.activeCarve) * lerp(0.96, 1.08, turnContext.turnMagnitude);
  return clamp(
    config.carveResponse * steering.carveFactor * bodyTurnRatio * speedRatio * driftWindow * bodySettle * phaseBoost,
    0,
    MAX_CARVE_BONUS
  );
}

function resolveAccelerationResponse(input: {
  speed: number;
  moveSpeed: number;
  turnContext: TurnContext;
}) {
  const lowSpeedPickup = clamp(1 - input.speed / (Math.max(1, input.moveSpeed) * 0.44), 0, 1);
  const redirectEntry = input.turnContext.turnCommitment * clamp(1 - input.turnContext.turnDevelopment / 0.58, 0, 1);
  const redirectPickup = redirectEntry * lerp(0.3, 1, clamp(input.speed / (Math.max(1, input.moveSpeed) * 0.22), 0, 1));

  return {
    entryPickup: clamp(lowSpeedPickup * 0.85 + redirectPickup, 0, 1),
    driveScaleLift: lowSpeedPickup * 0.035 + redirectPickup * 0.06,
    accelerationBoost: lowSpeedPickup * 0.16 + redirectPickup * 0.14,
    driveTargetBoost: lowSpeedPickup * 0.035 + redirectPickup * 0.05,
    turnDragRelief: lowSpeedPickup * 0.04 + redirectPickup * 0.12
  };
}

function updateIntentBoostState(input: {
  state: PlayerMovementState;
  hasMovement: boolean;
  rawDesiredHeading: number;
  speed: number;
  moveSpeed: number;
  dt: number;
}) {
  const decayedTimer = Math.max(0, input.state.intentBoostTimer - Math.max(0, input.dt));
  const previousIntentAngle = Number.isFinite(input.state.lastIntentAngle)
    ? wrapAngle(input.state.lastIntentAngle as number)
    : null;
  const lowSpeedThreshold = Math.max(1, input.moveSpeed) * INTENT_BOOST_LOW_SPEED_THRESHOLD_RATIO;
  const freshMoveStart = input.hasMovement && previousIntentAngle === null && input.speed <= lowSpeedThreshold;
  const directionChange =
    input.hasMovement &&
    previousIntentAngle !== null &&
    Math.abs(shortestAngleDelta(previousIntentAngle, input.rawDesiredHeading)) >= INTENT_BOOST_DIRECTION_CHANGE_THRESHOLD;
  const nextTimer = freshMoveStart || directionChange ? INTENT_BOOST_DURATION : decayedTimer;
  input.state.intentBoostTimer = nextTimer;
  input.state.lastIntentAngle = input.hasMovement ? wrapAngle(input.rawDesiredHeading) : null;

  if (!input.hasMovement || nextTimer <= 0) {
    return {
      accelerationMultiplier: 1,
      steeringMultiplier: 1
    };
  }

  const lowSpeedFactor = 1 - clamp(input.speed / Math.max(1, input.moveSpeed), 0, 1);
  const windowFactor = clamp(nextTimer / INTENT_BOOST_DURATION, 0, 1);
  const boostFactor = lowSpeedFactor * windowFactor;

  return {
    accelerationMultiplier: 1 + INTENT_BOOST_ACCEL_STRENGTH * boostFactor,
    steeringMultiplier: 1 + INTENT_BOOST_STEERING_STRENGTH * boostFactor
  };
}

function computeAccelerationBurstMultiplier(
  speed: number,
  moveSpeed: number,
  hasMovement: boolean,
  stopActive: boolean
) {
  if (!hasMovement || stopActive) return 1;
  const thresholdSpeed = Math.max(1, moveSpeed) * LOW_SPEED_ACCEL_BURST_THRESHOLD_RATIO;
  const burstRead = clamp(1 - speed / thresholdSpeed, 0, 1);
  return lerp(1, LOW_SPEED_ACCEL_BURST_MULTIPLIER, burstRead);
}

function computeLowSpeedTurnMultiplier(speed: number, moveSpeed: number) {
  const speedRatio = clamp(speed / Math.max(1, moveSpeed), 0, 1);
  return lerp(LOW_SPEED_REORIENTATION_MULTIPLIER, 1, speedRatio);
}

function computeLateralCorrectionBoost(
  currentTravelHeading: number,
  desiredTravelHeading: number,
  speed: number,
  moveSpeed: number
) {
  const mismatch = Math.abs(shortestAngleDelta(currentTravelHeading, desiredTravelHeading));
  const mismatchRatio = clamp(mismatch / (Math.PI * 0.5), 0, 1);
  const speedRatio = clamp(speed / Math.max(1, moveSpeed), 0, 1);
  return lerp(1, LATERAL_CORRECTION_BOOST, mismatchRatio * lerp(1, 0.6, speedRatio));
}

function resolveDriveHeading(input: {
  bodyHeading: number;
  steeringHeading: number;
  alignmentHeading: number;
  speed: number;
  moveSpeed: number;
  turnContext: TurnContext;
}) {
  const speedRatio = clamp(input.speed / Math.max(1, input.moveSpeed), 0, 1);
  const steeringLead =
    clamp(0.06 + input.turnContext.smallCorrection * 0.14 + input.turnContext.turnCommitment * 0.12, 0.04, 0.26) *
    lerp(1.08, 0.82, speedRatio);
  const bodyLeadHeading = wrapAngle(
    input.bodyHeading + shortestAngleDelta(input.bodyHeading, input.steeringHeading) * steeringLead
  );
  const alignmentBlend = clamp(
    lerp(0.74, 0.5, speedRatio) + input.turnContext.smallCorrection * 0.12 - input.turnContext.activeCarve * 0.16,
    0.34,
    0.84
  );
  return wrapAngle(
    input.alignmentHeading + shortestAngleDelta(input.alignmentHeading, bodyLeadHeading) * alignmentBlend
  );
}

function applyDirectionalDrive(input: {
  vx: number;
  vy: number;
  driveHeading: number;
  targetSpeed: number;
  acceleration: number;
  deceleration: number;
  pickupBoost: number;
  dt: number;
}) {
  const driveX = Math.cos(input.driveHeading);
  const driveY = Math.sin(input.driveHeading);
  const forwardSpeed = input.vx * driveX + input.vy * driveY;
  const launchWindow = clamp(1 - Math.max(0, forwardSpeed) / Math.max(1, input.targetSpeed * 0.58), 0, 1);
  const pickupAccelerationBoost = 1 + input.pickupBoost * lerp(0.08, 0.24, launchWindow);
  const nextForwardSpeed = approachSpeed(
    forwardSpeed,
    input.targetSpeed,
    input.acceleration * pickupAccelerationBoost * (forwardSpeed < 0 ? 1.12 : 1),
    input.deceleration * (forwardSpeed < 0 ? 1.22 : 1),
    input.dt
  );
  const forwardDelta = nextForwardSpeed - forwardSpeed;

  return {
    x: input.vx + driveX * forwardDelta,
    y: input.vy + driveY * forwardDelta
  };
}

function computeLateralDecay(input: {
  speed: number;
  moveSpeed: number;
  passiveDeceleration: number;
  responsePenalty: number;
  alignmentMismatch: number;
  travelAlignmentError: number;
  bodyTravelMismatch: number;
  turnContext: TurnContext;
}) {
  const speedRatio = clamp(input.speed / Math.max(1, input.moveSpeed), 0, 1);
  const responseTurn = clamp((1 - input.responsePenalty) / 0.28, 0, 1);
  const coherenceError = clamp(
    Math.max(input.alignmentMismatch, input.travelAlignmentError) / (Math.PI * 0.36),
    0,
    1
  );
  const bodyRecovery = clamp((input.bodyTravelMismatch - Math.PI * 0.24) / (Math.PI * 0.18), 0, 1);
  const baseDecay = (input.passiveDeceleration + input.moveSpeed * 0.28) * lerp(1.24, 0.7, speedRatio);
  const smallCorrectionTighten = lerp(1, 1.28, input.turnContext.smallCorrection);
  const committedCarry = lerp(1, 0.78, input.turnContext.turnCommitment);
  const activeCarveCarry = lerp(1, 0.62, input.turnContext.activeCarve);
  const redirectCarry = lerp(1, 0.9, responseTurn);
  const coherenceRecovery = lerp(
    1,
    2.9,
    Math.max(coherenceError * lerp(1, 0.72, input.turnContext.activeCarve), bodyRecovery)
  );

  return baseDecay * smallCorrectionTighten * committedCarry * activeCarveCarry * redirectCarry * coherenceRecovery;
}

function dampVelocityLateralComponent(vx: number, vy: number, heading: number, decay: number, dt: number) {
  const forwardX = Math.cos(heading);
  const forwardY = Math.sin(heading);
  const lateralX = -forwardY;
  const lateralY = forwardX;
  const forwardSpeed = vx * forwardX + vy * forwardY;
  const lateralSpeed = vx * lateralX + vy * lateralY;
  const nextLateralSpeed = moveTowards(lateralSpeed, 0, Math.max(0, decay) * Math.max(0, dt));

  return {
    x: forwardX * forwardSpeed + lateralX * nextLateralSpeed,
    y: forwardY * forwardSpeed + lateralY * nextLateralSpeed
  };
}

function dampVelocityMagnitude(vx: number, vy: number, amount: number) {
  const speed = Math.hypot(vx, vy);
  if (speed <= 0 || amount <= 0) {
    return { x: vx, y: vy };
  }

  const nextSpeed = Math.max(0, speed - amount);
  return setVelocityMagnitude(vx, vy, nextSpeed, Math.atan2(vy, vx));
}

function setVelocityMagnitude(vx: number, vy: number, magnitude: number, fallbackHeading: number) {
  const speed = Math.hypot(vx, vy);
  if (magnitude <= 0) {
    return { x: 0, y: 0 };
  }
  if (speed <= 0) {
    return {
      x: Math.cos(fallbackHeading) * magnitude,
      y: Math.sin(fallbackHeading) * magnitude
    };
  }

  const scale = magnitude / speed;
  return {
    x: vx * scale,
    y: vy * scale
  };
}

function clampVelocityMagnitude(vx: number, vy: number, maxMagnitude: number) {
  const speed = Math.hypot(vx, vy);
  if (speed <= maxMagnitude) {
    return { x: vx, y: vy };
  }
  return setVelocityMagnitude(vx, vy, maxMagnitude, Math.atan2(vy, vx));
}

type TurnContext = {
  turnMagnitude: number;
  inputHold: number;
  turnCommitment: number;
  turnDevelopment: number;
  activeCarve: number;
  smallCorrection: number;
};

function resolveTurnContext(input: {
  hasMovement: boolean;
  currentHeading: number;
  currentTravelHeading: number;
  desiredHeading: number;
  rawDesiredHeading: number;
  previousInputHeading: number;
  speed: number;
  moveSpeed: number;
}): TurnContext {
  if (!input.hasMovement) {
    return {
      turnMagnitude: 0,
      inputHold: 0,
      turnCommitment: 0,
      turnDevelopment: 0,
      activeCarve: 0,
      smallCorrection: 0
    };
  }

  const desiredDelta = Math.abs(shortestAngleDelta(input.currentTravelHeading, input.desiredHeading));
  const bodyLag = Math.abs(shortestAngleDelta(input.currentHeading, input.desiredHeading));
  const travelLag = Math.abs(shortestAngleDelta(input.currentHeading, input.currentTravelHeading));
  const inputChange = Math.abs(shortestAngleDelta(input.previousInputHeading, input.rawDesiredHeading));
  const inputHold = clamp(1 - inputChange / (Math.PI * 0.2), 0, 1);
  const turnMagnitude = clamp(desiredDelta / (Math.PI * 0.55), 0, 1);
  const turnDevelopment = desiredDelta > 0.0001 ? clamp(1 - bodyLag / desiredDelta, 0, 1) : 0;
  const carveRead = clamp(travelLag / (Math.PI * 0.3), 0, 1) * clamp(input.speed / Math.max(1, input.moveSpeed), 0, 1);
  const turnCommitment = inputHold * turnMagnitude;

  return {
    turnMagnitude,
    inputHold,
    turnCommitment,
    turnDevelopment,
    activeCarve: turnCommitment * turnDevelopment * carveRead,
    smallCorrection: clamp(1 - desiredDelta / (Math.PI * 0.12), 0, 1)
  };
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

function moveTowards(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(target, current + maxDelta);
  }
  return Math.max(target, current - maxDelta);
}
