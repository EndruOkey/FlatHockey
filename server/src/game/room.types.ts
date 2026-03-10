export type InputState = {
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
  angle: number;
  aimAngle: number;
  stamina: number;
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
  shoot: 0,
  aimAngle: 0
};
