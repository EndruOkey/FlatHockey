import type { MovementAxis } from './movementTypes';

const TWO_PI = Math.PI * 2;
const HIGH_SPEED_TRACTION_MULTIPLIER = 0.135;
const LOW_SPEED_TRACTION_MULTIPLIER = 0.635;
const STOP_TRACTION_MULTIPLIER = 1.18;

export type BodyTurnInput = {
  currentHeading: number;
  desiredHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  smallCorrection: number;
  turnMagnitude: number;
  inputHold: number;
  turnDevelopment: number;
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
  smallCorrection: number;
  turnMagnitude: number;
  turnCommitment: number;
  activeCarve: number;
  traction: number;
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

export function advanceSteeringTarget(input: {
  steeringHeading: number;
  rawDesiredHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  inputHold: number;
  smallCorrection: number;
}) {
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  let slewRate = lerp(9.2, 6.2, speedRatio);

  const delta = shortestAngleDelta(input.steeringHeading, input.rawDesiredHeading);
  const mismatchRatio = clamp(Math.abs(delta) / (Math.PI * 0.42), 0, 1);
  const subtleBoost = input.smallCorrection * lerp(0.16, 0.05, speedRatio);
  const holdBoost = input.inputHold * mismatchRatio * 0.08;
  slewRate *= lerp(1, 1.18, mismatchRatio) * (1 + subtleBoost + holdBoost);
  const maxStep = Math.max(0, slewRate * Math.max(0, input.dt));
  return wrapAngle(input.steeringHeading + clamp(delta, -maxStep, maxStep));
}

export function computeBodyTurn(input: BodyTurnInput): BodyTurnResult {
  const desiredHeading = wrapAngle(input.desiredHeading);
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  let turnRate = lerp(input.lowSpeedRotationSpeed, input.rotationSpeed, speedRatio);
  turnRate *= Math.max(0.1, input.rotationMultiplier ?? 1);

  const delta = shortestAngleDelta(input.currentHeading, desiredHeading);
  const mismatchRatio = clamp(Math.abs(delta) / (Math.PI * 0.5), 0, 1);
  const subtleCorrectionBoost = input.smallCorrection * lerp(0.16, 0.05, speedRatio);
  const committedRedirectBoost = input.turnMagnitude * input.inputHold * lerp(0.08, 0.12, speedRatio);
  const phaseBoost = input.turnMagnitude * input.turnDevelopment * input.inputHold * lerp(0.02, 0.06, speedRatio);
  const contextualBoost = 1 + subtleCorrectionBoost + committedRedirectBoost + phaseBoost;
  turnRate *= lerp(1, contextualBoost, mismatchRatio);
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
  let steeringRate = input.traction * lerp(LOW_SPEED_TRACTION_MULTIPLIER, HIGH_SPEED_TRACTION_MULTIPLIER, speedRatio);
  const subtleCorrectionBoost = input.smallCorrection * lerp(0.24, 0.08, speedRatio);
  const committedCarry = input.turnCommitment * input.turnMagnitude * lerp(0.03, 0.11, speedRatio);
  const carveCarry = input.activeCarve * lerp(0.04, 0.22, speedRatio);
  steeringRate *= clamp(1 + subtleCorrectionBoost - committedCarry - carveCarry, 0.58, 1.28);
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
    turnPenaltyMultiplier: clamp(1 - input.turnPenalty * Math.pow(normalizedMismatch, 1.55), 0.74, 1),
    carveFactor: clamp(
      (Math.abs(steeringDelta) / Math.max(maxStep, 0.0001)) *
        speedRatio *
        Math.max(0, 1 - normalizedMismatch * 0.75) *
        lerp(1, 1.18, input.activeCarve),
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
