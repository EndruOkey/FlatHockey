import { resolvePlayerMovementConfig, stepPlayerMovement, type InputMsg } from '@flathockey/shared';
import type { PredictedPlayerState } from './predictionState.types';
import { getTuning } from '../tuning/gameplayConfig';

export type { PredictedPlayerState } from './predictionState.types';

export const CLIENT_FIXED_DT = 1 / 60;

let aimInputRateLimited = false;

export function setAimInputRateLimited(flag: boolean) {
  aimInputRateLimited = !!flag;
}

export function getAimInputRateLimited() {
  return aimInputRateLimited;
}

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  stepPlayerMovement(state, input, dt, resolvePlayerMovementConfig(getTuning()));
}
