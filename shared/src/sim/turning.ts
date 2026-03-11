import type { MovementAxis } from './movementTypes';

const TWO_PI = Math.PI * 2;
const DIAGONAL_ROTATION_MULTIPLIER = 0.95;
const DIAGONAL_TRACTION_MULTIPLIER = 0.93;
const HIGH_SPEED_TRACTION_MULTIPLIER = 0.48;
const STOP_TRACTION_MULTIPLIER = 1.3;
const BACKWARDS_TRACTION_MULTIPLIER = 0.88;

export type BodyTurnInput = {
  currentHeading: number;
  desiredHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  diagonal: boolean;
  rotationSpeed: number;
  lowSpeedRotationSpeed: number;
  rotationMultiplier?: number;
};

export type BodyTurnResult = {
  heading: number;
  desiredHeading: number;
  angularVelocity: number;
  remainingAngle: number;
  turnRate: number;
  appliedDelta: number;
};

export type TravelSteeringInput = {
  currentTravelHeading: number;
  targetHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  traction: number;
  diagonal: boolean;
  backwardsActive: boolean;
  stopActive: boolean;
  turnPenalty: number;
};

export type TravelSteeringResult = {
  travelHeading: number;
  steeringDelta: number;
  steeringRate: number;
  mismatch: number;
  turnPenaltyMultiplier: number;
  carveFactor: number;
};

export function computeDesiredHeading(moveX: MovementAxis, moveY: MovementAxis, fallbackHeading: number) {
  const length = Math.hypot(moveX, moveY);
  if (length <= 0) return wrapAngle(fallbackHeading);
  return Math.atan2(moveY / length, moveX / length);
}

export function computeBodyTurn(input: BodyTurnInput): BodyTurnResult {
  const desiredHeading = wrapAngle(input.desiredHeading);
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  let turnRate = lerp(input.lowSpeedRotationSpeed, input.rotationSpeed, speedRatio);

  if (input.diagonal) {
    turnRate *= DIAGONAL_ROTATION_MULTIPLIER;
  }
  turnRate *= Math.max(0.1, input.rotationMultiplier ?? 1);

  const delta = shortestAngleDelta(input.currentHeading, desiredHeading);
  const maxStep = Math.max(0, turnRate * Math.max(0, input.dt));
  const appliedDelta = clamp(delta, -maxStep, maxStep);
  const heading = wrapAngle(input.currentHeading + appliedDelta);

  return {
    heading,
    desiredHeading,
    angularVelocity: input.dt > 0 ? appliedDelta / input.dt : 0,
    remainingAngle: shortestAngleDelta(heading, desiredHeading),
    turnRate,
    appliedDelta
  };
}

export function computeTravelSteering(input: TravelSteeringInput): TravelSteeringResult {
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  let steeringRate = input.traction * lerp(1.35, HIGH_SPEED_TRACTION_MULTIPLIER, speedRatio);

  if (input.diagonal) {
    steeringRate *= DIAGONAL_TRACTION_MULTIPLIER;
  }
  if (input.backwardsActive) {
    steeringRate *= BACKWARDS_TRACTION_MULTIPLIER;
  }
  if (input.stopActive) {
    steeringRate *= STOP_TRACTION_MULTIPLIER;
  }

  const delta = shortestAngleDelta(input.currentTravelHeading, input.targetHeading);
  const mismatch = Math.abs(delta);
  const maxStep = Math.max(0, steeringRate * Math.max(0, input.dt));
  const steeringDelta = clamp(delta, -maxStep, maxStep);
  const travelHeading = wrapAngle(input.currentTravelHeading + steeringDelta);
  const normalizedMismatch = clamp(mismatch / Math.PI, 0, 1);

  return {
    travelHeading,
    steeringDelta,
    steeringRate,
    mismatch,
    turnPenaltyMultiplier: clamp(1 - input.turnPenalty * Math.pow(normalizedMismatch, 1.05), 0.25, 1),
    carveFactor: clamp(
      (Math.abs(steeringDelta) / Math.max(maxStep, 0.0001)) * speedRatio * Math.max(0, 1 - normalizedMismatch * 1.4),
      0,
      1
    )
  };
}

export function shortestAngleDelta(currentHeading: number, targetHeading: number) {
  return wrapAngle(targetHeading - currentHeading);
}

export function wrapAngle(angle: number) {
  let value = angle;
  while (value <= -Math.PI) value += TWO_PI;
  while (value > Math.PI) value -= TWO_PI;
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
