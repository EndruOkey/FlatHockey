import type { ReverseState } from '@flathockey/shared/sim/movementStep';

export type InputState = {
  throttle: -1 | 0 | 1;
  steer: -1 | 0 | 1;
  heading?: number;
  brake: 0 | 1;
  shoot: 0 | 1;
  aimAngle: number;
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
  speed: number;
  heading: number;
  headingOmega: number;
  moveAngle: number;
  angle: number;
  aimAngle: number;
  stamina: number;
  reverseState: ReverseState;
  prevShoot: boolean;
  shotCharge: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
  inputGapTicks: number;
  chargeActive: boolean;
  hitCooldownLeft: number;
  stunLeft: number;
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
  throttle: 0,
  steer: 0,
  brake: 0,
  shoot: 0,
  aimAngle: 0
};
