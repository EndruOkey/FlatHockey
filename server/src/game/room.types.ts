import type { LocomotionState, StickState } from '@flathockey/shared';

export type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  shoot: 0 | 1;
  pass: 0 | 1;
  drop: 0 | 1;
  poke: 0 | 1;
  aimAngle: number;
  stop: 0 | 1;
};

export type BufferedInput = {
  seq: number;
  state: InputState;
};

export type PlayerState = {
  id: string;
  name: string;
  handedness: 'left' | 'right';
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  steeringHeading?: number;
  inputHeading?: number;
  intentBoostTimer: number;
  lastIntentAngle: number | null;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  prevShoot: boolean;
  prevPass: boolean;
  prevDrop: boolean;
  prevPoke: boolean;
  shotCharge: number;
  oneTimerGraceMsRemaining: number;
  stickState: StickState;
  stickTimer: number;
  angularVelocity: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
  inputGapTicks: number;
};

export type PuckState = {
  state: 'FREE' | 'HELD';
  ownerId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pickupCooldownMs: number;
};

export const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  shoot: 0,
  pass: 0,
  drop: 0,
  poke: 0,
  aimAngle: 0,
  stop: 0
};
