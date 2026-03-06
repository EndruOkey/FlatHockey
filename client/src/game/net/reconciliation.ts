import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { wrapToPi } from '@flathockey/shared';
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
  predicted.angle = authoritative.angle;
  (predicted as any).moveAngle = (authoritative as any).moveAngle;
  (predicted as any).heading = (authoritative as any).heading ?? (authoritative as any).moveAngle;
  (predicted as any).inputAngle = (authoritative as any).inputAngle ?? (authoritative as any).moveAngle;
  (predicted as any).desiredDirX = (authoritative as any).desiredDirX ?? Math.cos((authoritative as any).inputAngle ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).desiredDirY = (authoritative as any).desiredDirY ?? Math.sin((authoritative as any).inputAngle ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).committedDirX = (authoritative as any).committedDirX ?? Math.cos((authoritative as any).heading ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).committedDirY = (authoritative as any).committedDirY ?? Math.sin((authoritative as any).heading ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).pendingDirX = (authoritative as any).pendingDirX ?? (predicted as any).committedDirX;
  (predicted as any).pendingDirY = (authoritative as any).pendingDirY ?? (predicted as any).committedDirY;
  (predicted as any).lastRawInputAngle = (authoritative as any).lastRawInputAngle ?? (authoritative as any).inputAngle ?? (authoritative as any).moveAngle;
  (predicted as any).antiFlipTimer = (authoritative as any).antiFlipTimer ?? 0;
  (predicted as any).baseBodyAngle = (authoritative as any).baseBodyAngle ?? (authoritative as any).angle;
  (predicted as any).bodyYawOffset = (authoritative as any).bodyYawOffset ?? 0;
  (predicted as any).bodyTargetAngle = (authoritative as any).bodyTargetAngle
    ?? (authoritative as any).baseBodyAngle
    ?? (authoritative as any).angle;
  (predicted as any).aimAngle = (authoritative as any).aimAngle;
  (predicted as any).aimAngleRaw = (authoritative as any).aimAngleRaw ?? (authoritative as any).aimAngle;
  (predicted as any).stickAngVel = 0;
  (predicted as any).stickLocalAngle = wrapToPi(
    ((authoritative as any).aimAngle ?? (authoritative as any).angle)
      - ((authoritative as any).baseBodyAngle ?? (authoritative as any).angle ?? 0)
  );

  for (const input of pendingInputs) {
    applyPredictedInput(predicted, input);
  }

  return pendingInputs;
}
