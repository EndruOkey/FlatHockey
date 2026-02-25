export type MovementTuning = {
  maxSpeed: number;
  accel: number;
  sprintAccel: number;
  drag: number;
  brakeDrag: number;
  turnLowSpeed: number;
  turnHighSpeed: number;
  diagonalNormalize: boolean;
  inputSmoothing: number;
  renderSmoothing: number;
};

const LOCAL_KEY = 'movementTuning_v1';

export * from '../tuning/movementTuning';
export { default } from '../tuning/movementTuning';
