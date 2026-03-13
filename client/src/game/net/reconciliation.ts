import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { applyPredictedInput } from './prediction';
import type { PredictedPlayerState } from './predictionState.types';

export function reconcilePrediction(
  predicted: PredictedPlayerState,
  authoritative: PlayerStateMsg,
  ackSeq: number,
  pendingInputs: InputMsg[]
) {
  while (pendingInputs.length > 0 && pendingInputs[0].seq <= ackSeq) {
    pendingInputs.shift();
  }

  predicted.x = authoritative.x;
  predicted.y = authoritative.y;
  predicted.vx = authoritative.vx;
  predicted.vy = authoritative.vy;
  predicted.angle = authoritative.angle;
  predicted.travelHeading = authoritative.travelHeading;
  predicted.steeringHeading = authoritative.desiredHeading;
  predicted.intentBoostTimer =
    typeof authoritative.intentBoostTimer === 'number' && Number.isFinite(authoritative.intentBoostTimer)
      ? authoritative.intentBoostTimer
      : 0;
  predicted.lastIntentAngle =
    typeof authoritative.lastIntentAngle === 'number' && Number.isFinite(authoritative.lastIntentAngle)
      ? authoritative.lastIntentAngle
      : null;
  predicted.aimAngle = authoritative.aimAngle;
  predicted.desiredHeading = authoritative.desiredHeading;
  predicted.locomotionState = authoritative.locomotionState;
  predicted.stickState = authoritative.stickState;
  predicted.stickTimer = authoritative.stickTimer;
  predicted.shotCharge = authoritative.shotCharge;

  for (const input of pendingInputs) {
    applyPredictedInput(predicted, input);
  }

  return pendingInputs;
}
