import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { clamp, lerpAngle, wrapToPi } from './movementMath';
import { applyHeadingTractionStep } from './movementHeadingTractionStep';
import type { MovementStepConfig, MovementStepInput, MovementStepState, ReverseState } from './movementStep.types';

export type { MovementStepConfig, MovementStepInput, MovementStepState, ReverseState } from './movementStep.types';
export { wrapToPi } from './movementMath';

export const DEFAULTS: MovementStepConfig = { ...MOVEMENT_DEFAULTS };

type StickTauCompatConfig = {
  stickUseSpring?: boolean;
  stickUseTauSmoothing?: boolean;
  stickTauMs?: number;
  stickTauMsBehind?: number;
  stickTauMinAlpha?: number;
};

type StickTauCompatState = {
  stickAngle?: number;
  stickTargetAngle?: number;
  stickAngVel?: number;
};

function ensureState(state: MovementStepState) {
  state.x = Number.isFinite(state.x) ? state.x : 0;
  state.y = Number.isFinite(state.y) ? state.y : 0;
  state.vx = Number.isFinite(state.vx) ? state.vx : 0;
  state.vy = Number.isFinite(state.vy) ? state.vy : 0;
  state.heading = Number.isFinite(state.heading) ? wrapToPi(state.heading) : 0;
  state.headingOmega = Number.isFinite(state.headingOmega) ? state.headingOmega : 0;
  state.moveAngle = Number.isFinite(state.moveAngle) ? wrapToPi(state.moveAngle) : state.heading;
  state.speed = Number.isFinite(state.speed) ? Math.max(0, state.speed) : Math.hypot(state.vx, state.vy);
  state.aimAngle = Number.isFinite(state.aimAngle) ? wrapToPi(state.aimAngle) : state.heading;
  state.stamina = Number.isFinite(state.stamina) ? state.stamina : 1;
  state.reverseState = state.reverseState === 'REVERSING' ? 'REVERSING' : 'FORWARD';
}

function applyStickTauCompat(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig
) {
  const compatConfig = config as MovementStepConfig & StickTauCompatConfig;
  const tauModeActive = !!compatConfig.stickUseTauSmoothing;
  if (!tauModeActive) return;

  const stickState = state as MovementStepState & StickTauCompatState;
  // Tau path must not inherit spring angular momentum.
  if (Number.isFinite(stickState.stickAngVel)) {
    stickState.stickAngVel = 0;
  }

  const currentAngle = Number.isFinite(stickState.stickAngle) ? stickState.stickAngle : undefined;
  const targetAngle = Number.isFinite(input.aimAngle)
    ? wrapToPi(input.aimAngle as number)
    : (Number.isFinite(stickState.stickTargetAngle) ? wrapToPi(stickState.stickTargetAngle as number) : undefined);
  if (currentAngle === undefined || targetAngle === undefined) return;

  const deltaToBody = Math.abs(wrapToPi(targetAngle - state.heading));
  const behindBody = deltaToBody > Math.PI * 0.5;
  const tauMs = Math.max(
    1,
    behindBody
      ? (compatConfig.stickTauMsBehind ?? 260)
      : (compatConfig.stickTauMs ?? 120)
  );
  const alphaRaw = 1 - Math.exp(-Math.max(0.0001, dt) * 1000 / tauMs);
  const minAlpha = clamp(compatConfig.stickTauMinAlpha ?? 0.02, 0, 1);
  const alpha = clamp(alphaRaw, minAlpha, 1);
  stickState.stickAngle = lerpAngle(currentAngle, targetAngle, alpha);
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
  applyStickTauCompat(state, input, dt, mergedConfig);
}
