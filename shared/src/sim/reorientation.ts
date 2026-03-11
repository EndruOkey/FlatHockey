import { shortestAngleDelta, wrapAngle } from './turning';

const BACKWARDS_HYSTERESIS_RAD = (14 * Math.PI) / 180;

export type BackwardsResolutionInput = {
  hasMovement: boolean;
  manualOverride: boolean;
  wasBackwards: boolean;
  bodyHeading: number;
  desiredTravelHeading: number;
  backwardsAngle: number;
};

export type BackwardsResolution = {
  active: boolean;
  desiredBodyHeading: number;
  mismatchAngle: number;
};

export function resolveBackwardsSkating(input: BackwardsResolutionInput): BackwardsResolution {
  if (!input.hasMovement) {
    return {
      active: input.wasBackwards,
      desiredBodyHeading: wrapAngle(input.bodyHeading),
      mismatchAngle: 0
    };
  }

  const mismatchAngle = Math.abs(shortestAngleDelta(input.bodyHeading, input.desiredTravelHeading));
  const enterAngle = input.backwardsAngle;
  const exitAngle = Math.max(Math.PI * 0.45, enterAngle - BACKWARDS_HYSTERESIS_RAD);
  const active = input.manualOverride || mismatchAngle >= (input.wasBackwards ? exitAngle : enterAngle);

  return {
    active,
    desiredBodyHeading: wrapAngle(input.desiredTravelHeading + (active ? Math.PI : 0)),
    mismatchAngle
  };
}
