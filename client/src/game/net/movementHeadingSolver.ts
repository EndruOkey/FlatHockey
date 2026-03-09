import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';

export type HeadingMovementInput = {
  throttle: -1 | 0 | 1;
  steer: -1 | 0 | 1;
  brake: 0 | 1 | boolean;
  shoot?: 0 | 1 | boolean;
  aimAngle?: number;
};

export function applyHeadingMovementStep(
  state: MovementStepState,
  input: HeadingMovementInput,
  dt: number,
  config: MovementStepConfig
) {
  applyMovementStep(
    state,
    {
      throttle: input.throttle,
      steer: input.steer,
      brake: !!input.brake,
      shoot: !!input.shoot,
      aimAngle: input.aimAngle
    },
    dt,
    config
  );
}
