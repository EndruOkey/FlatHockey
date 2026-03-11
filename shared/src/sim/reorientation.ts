import { computeTurn, shortestAngleDelta } from './turning';

const REORIENTATION_EXIT_ANGLE = 0.16;

export type ReorientationInput = {
  active: boolean;
  requested: boolean;
  hasMovement: boolean;
  currentHeading: number;
  desiredHeading: number;
  speed: number;
  maxSpeed: number;
  dt: number;
  diagonal: boolean;
  turnRate: number;
};

export type ReorientationComputation = {
  active: boolean;
  heading: number;
  desiredHeading: number;
  remainingAngle: number;
  allowDrive: boolean;
  angularVelocity: number;
};

export function applyReorientation(input: ReorientationInput): ReorientationComputation {
  const wantsReorientation = input.hasMovement && (input.requested || input.active);
  if (!wantsReorientation) {
    return {
      active: false,
      heading: input.currentHeading,
      desiredHeading: input.desiredHeading,
      remainingAngle: Math.abs(shortestAngleDelta(input.currentHeading, input.desiredHeading)),
      allowDrive: true,
      angularVelocity: 0
    };
  }

  const turn = computeTurn({
    currentHeading: input.currentHeading,
    desiredHeading: input.desiredHeading,
    speed: input.speed,
    maxSpeed: input.maxSpeed,
    dt: input.dt,
    diagonal: input.diagonal,
    turnRateMin: input.turnRate,
    turnRateMax: input.turnRate,
    lowSpeedPivotTurnRate: input.turnRate
  });

  const remainingAngle = Math.abs(shortestAngleDelta(turn.heading, input.desiredHeading));
  const active = remainingAngle > REORIENTATION_EXIT_ANGLE;

  return {
    active,
    heading: turn.heading,
    desiredHeading: input.desiredHeading,
    remainingAngle,
    allowDrive: !active,
    angularVelocity: turn.angularVelocity
  };
}
