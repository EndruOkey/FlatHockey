import { shortestAngleDelta, wrapAngle } from './turning';

export type ForwardHeadingTargetInput = {
  hasMovement: boolean;
  currentHeading: number;
  desiredTravelHeading: number;
};

export type ForwardHeadingTarget = {
  desiredBodyHeading: number;
};

export type ForwardTravelAlignmentInput = {
  bodyHeading: number;
  travelHeading: number;
  speed: number;
  maxSpeed: number;
};

export type ForwardTravelAlignment = {
  travelHeading: number;
  mismatch: number;
};

export function resolveForwardHeadingTarget(input: ForwardHeadingTargetInput): ForwardHeadingTarget {
  if (!input.hasMovement) {
    return {
      desiredBodyHeading: wrapAngle(input.currentHeading)
    };
  }

  return {
    desiredBodyHeading: wrapAngle(input.desiredTravelHeading)
  };
}

export function resolveForwardTravelAlignment(input: ForwardTravelAlignmentInput): ForwardTravelAlignment {
  const speedRatio = clamp(input.speed / Math.max(1, input.maxSpeed), 0, 1);
  const maxMismatch = lerp(Math.PI * 0.4, Math.PI * 0.495, Math.pow(speedRatio, 0.9));
  const rawDelta = shortestAngleDelta(input.bodyHeading, input.travelHeading);
  const clampedDelta = clamp(rawDelta, -maxMismatch, maxMismatch);

  return {
    travelHeading: wrapAngle(input.bodyHeading + clampedDelta),
    mismatch: Math.abs(clampedDelta)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
