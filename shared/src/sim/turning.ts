import type { MovementAxis } from './movementTypes';

const DIAGONAL_TURN_RATE_MULTIPLIER = 0.92;
const LOW_SPEED_PIVOT_SPEED_RATIO = 0.18;
const TWO_PI = Math.PI * 2;

export type TurnInput = {
  currentHeading: number;
  desiredHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  diagonal: boolean;
  turnRateMin: number;
  turnRateMax: number;
  lowSpeedPivotTurnRate: number;
};

export type TurnComputation = {
  heading: number;
  desiredHeading: number;
  angularVelocity: number;
  remainingAngle: number;
  turnRate: number;
};

export function computeDesiredHeading(moveX: MovementAxis, moveY: MovementAxis, fallbackHeading: number) {
  const length = Math.hypot(moveX, moveY);
  if (length <= 0) return wrapAngle(fallbackHeading);
  return Math.atan2(moveY / length, moveX / length);
}

export function computeTurn(input: TurnInput): TurnComputation {
  const desiredHeading = wrapAngle(input.desiredHeading);
  const turnRate = resolveTurnRate(input);
  const delta = shortestAngleDelta(input.currentHeading, desiredHeading);
  const maxStep = Math.max(0, turnRate * Math.max(0, input.dt));
  const appliedDelta = clamp(delta, -maxStep, maxStep);
  const heading = wrapAngle(input.currentHeading + appliedDelta);
  const remainingAngle = shortestAngleDelta(heading, desiredHeading);

  return {
    heading,
    desiredHeading,
    angularVelocity: input.dt > 0 ? appliedDelta / input.dt : 0,
    remainingAngle,
    turnRate
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

function resolveTurnRate(input: TurnInput) {
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  let turnRate = lerp(input.turnRateMax, input.turnRateMin, speedRatio);

  if (speedRatio <= LOW_SPEED_PIVOT_SPEED_RATIO) {
    turnRate = Math.min(turnRate, input.lowSpeedPivotTurnRate);
  }

  if (input.diagonal) {
    turnRate *= DIAGONAL_TURN_RATE_MULTIPLIER;
  }

  return Math.max(0.1, turnRate);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
