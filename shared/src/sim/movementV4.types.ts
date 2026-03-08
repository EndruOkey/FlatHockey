import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep';

export type MovementV4Result = {
  desiredMoveAngle: number;
  turnIntentAngle: number;
  turnResistance: number;
  chargeActive: boolean;
};

export type MovementV4Args = {
  state: MovementStepState;
  input: MovementStepInput;
  dt: number;
  config: MovementStepConfig;
  hasPuck: boolean;
  mouseDrivesMove: boolean;
  inputAimRaw: number;
  rawInputX: number;
  rawInputY: number;
  prevMoveAngle: number;
};

export function phaseFromSide(side: -1 | 0 | 1): 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' {
  if (side < 0) return 'CARVE_LEFT';
  if (side > 0) return 'CARVE_RIGHT';
  return 'GLIDE';
}
