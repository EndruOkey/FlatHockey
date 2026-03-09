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
  predicted.vx = authoritative.vx;
  predicted.vy = authoritative.vy;
  predicted.speed = authoritative.speed;
  predicted.heading = authoritative.heading;
  predicted.headingOmega = authoritative.headingOmega;
  predicted.angle = authoritative.angle;
  predicted.moveAngle = authoritative.moveAngle;
  predicted.reverseState = authoritative.reverseState;
  predicted.aimAngle = authoritative.aimAngle;
  predicted.chargeActive = authoritative.chargeActive;
  predicted.stunLeft = authoritative.stunLeft;

  for (const input of pendingInputs) {
    applyPredictedInput(predicted, input);
  }

  return pendingInputs;
}
