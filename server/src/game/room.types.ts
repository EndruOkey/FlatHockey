import type { LocomotionState } from '@flathockey/shared';

export type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  shoot: 0 | 1;
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
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  prevShoot: boolean;
  shotCharge: number;
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
  aimAngle: 0,
  stop: 0
};
