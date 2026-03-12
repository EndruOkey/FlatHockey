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
  desiredTravelHeading: number;
  travelHeading: number;
  speed: number;
  maxSpeed: number;
  smallCorrection: number;
  turnCommitment: number;
  activeCarve: number;
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
  const correctionTighten = lerp(1, 0.82, input.smallCorrection);
  const carveWiden = lerp(1, 1.1, clamp(input.turnCommitment * 0.45 + input.activeCarve * 0.6, 0, 1));
  const maxMismatch = lerp(Math.PI * 0.425, Math.PI * 0.54, Math.pow(speedRatio, 0.8)) * correctionTighten * carveWiden;
  const rawDelta = shortestAngleDelta(input.bodyHeading, input.travelHeading);
  const desiredDelta = shortestAngleDelta(input.bodyHeading, input.desiredTravelHeading);
  const softenedDelta = resolveNonExpansiveMismatch(rawDelta, maxMismatch);
  const coherentDelta = resolveWrongSideRecovery(softenedDelta, desiredDelta, speedRatio);

  return {
    travelHeading: wrapAngle(input.bodyHeading + coherentDelta),
    mismatch: Math.abs(coherentDelta)
  };
}

function resolveNonExpansiveMismatch(delta: number, maxMismatch: number) {
  const softened = maxMismatch * Math.tanh(delta / Math.max(0.0001, maxMismatch));
  return Math.sign(softened) * Math.min(Math.abs(delta), Math.abs(softened));
}

function resolveWrongSideRecovery(travelDelta: number, desiredDelta: number, speedRatio: number) {
  if (travelDelta === 0 || desiredDelta === 0) return travelDelta;
  if (Math.sign(travelDelta) === Math.sign(desiredDelta)) return travelDelta;

  const oppositeSideGap = Math.abs(travelDelta) + Math.abs(desiredDelta);
  const incoherence = clamp((oppositeSideGap - Math.PI * 0.18) / (Math.PI * 0.38), 0, 1);
  const recovery = incoherence * lerp(0.18, 0.82, speedRatio);
  return travelDelta * lerp(1, 0.18, recovery);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
