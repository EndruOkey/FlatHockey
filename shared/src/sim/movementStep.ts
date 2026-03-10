import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { wrapToPi } from './movementMath';
import { applyHeadingTractionStep } from './movementHeadingTractionStep';
import type { MovementStepConfig, MovementStepInput, MovementStepState, ReverseState } from './movementStep.types';

export type { MovementStepConfig, MovementStepInput, MovementStepState, ReverseState } from './movementStep.types';
export { wrapToPi } from './movementMath';

export const DEFAULTS: MovementStepConfig = { ...MOVEMENT_DEFAULTS };

function ensureState(state: MovementStepState) {
  state.x           = Number.isFinite(state.x)           ? state.x           : 0;
  state.y           = Number.isFinite(state.y)           ? state.y           : 0;
  state.vx          = Number.isFinite(state.vx)          ? state.vx          : 0;
  state.vy          = Number.isFinite(state.vy)          ? state.vy          : 0;
  state.heading     = Number.isFinite(state.heading)     ? wrapToPi(state.heading) : 0;
  state.headingOmega = Number.isFinite(state.headingOmega) ? state.headingOmega : 0;
  state.moveAngle   = Number.isFinite(state.moveAngle)   ? wrapToPi(state.moveAngle) : state.heading;
  state.speed       = Number.isFinite(state.speed)       ? Math.max(0, state.speed) : Math.hypot(state.vx, state.vy);
  state.aimAngle    = Number.isFinite(state.aimAngle)    ? wrapToPi(state.aimAngle) : state.heading;
  state.stamina     = Number.isFinite(state.stamina)     ? state.stamina     : 1;
  state.reverseState = state.reverseState === 'REVERSING' ? 'REVERSING' : 'FORWARD';
}

export function applyMovementStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig = {}
) {
  ensureState(state);
  const mergedConfig: MovementStepConfig = { ...DEFAULTS, ...config };
  applyHeadingTractionStep(state, input, dt, mergedConfig);
}
