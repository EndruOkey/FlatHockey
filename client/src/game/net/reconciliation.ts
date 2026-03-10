import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { applyPredictedInput } from './prediction';

export function reconcilePrediction(
  predicted: PlayerStateMsg,
  authoritative: PlayerStateMsg,
  ackSeq: number,
  pendingInputs: InputMsg[]
) {
  while (pendingInputs.length > 0 && pendingInputs[0].seq <= ackSeq) {
    pendingInputs.shift();
  }

  predicted.x = authoritative.x;
  predicted.y = authoritative.y;
  predicted.angle = authoritative.angle;
  predicted.aimAngle = authoritative.aimAngle;

  for (const input of pendingInputs) {
    applyPredictedInput(predicted, input);
  }

  return pendingInputs;
}
