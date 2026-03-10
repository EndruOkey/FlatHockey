import type { InputMsg } from '@flathockey/shared';
import type { PredictedPlayerState } from './predictionState.types';

export type { PredictedPlayerState } from './predictionState.types';

export const CLIENT_FIXED_DT = 1 / 60;

let aimInputRateLimited = false;

export function setAimInputRateLimited(flag: boolean) {
  aimInputRateLimited = !!flag;
}

export function getAimInputRateLimited() {
  return aimInputRateLimited;
}

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, _dt = CLIENT_FIXED_DT) {
  if (!Number.isFinite(input.aimAngle)) return;
  state.aimAngle = input.aimAngle;
  state.angle = input.aimAngle;
}
