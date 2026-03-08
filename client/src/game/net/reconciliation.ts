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
  (predicted as any).headingOmega = (authoritative as any).headingOmega ?? 0;
  (predicted as any).desiredHeadingAngle = (authoritative as any).desiredHeadingAngle ?? (authoritative as any).heading ?? (authoritative as any).moveAngle;
  (predicted as any).movementModelActive = (authoritative as any).movementModelActive ?? 'DESIRED_HEADING_TRACTION';
  (predicted as any).inputAngle = (authoritative as any).inputAngle ?? (authoritative as any).moveAngle;
  (predicted as any).desiredDirX = (authoritative as any).desiredDirX ?? Math.cos((authoritative as any).inputAngle ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).desiredDirY = (authoritative as any).desiredDirY ?? Math.sin((authoritative as any).inputAngle ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).committedDirX = (authoritative as any).committedDirX ?? Math.cos((authoritative as any).heading ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).committedDirY = (authoritative as any).committedDirY ?? Math.sin((authoritative as any).heading ?? (authoritative as any).moveAngle ?? 0);
  (predicted as any).distanceSinceCommit = (authoritative as any).distanceSinceCommit ?? 0;
  (predicted as any).reverseDriveState = (authoritative as any).reverseDriveState ?? 'NORMAL';
  (predicted as any).reverseTransitionActive = !!(authoritative as any).reverseTransitionActive;
  (predicted as any).reverseTransitionTimer = (authoritative as any).reverseTransitionTimer ?? 0;
  (predicted as any).pendingDirX = (authoritative as any).pendingDirX ?? (predicted as any).committedDirX;
  (predicted as any).pendingDirY = (authoritative as any).pendingDirY ?? (predicted as any).committedDirY;
  (predicted as any).directionCommitTimer = (authoritative as any).directionCommitTimer ?? 0;
  (predicted as any).oppositeHoldTimer = (authoritative as any).oppositeHoldTimer ?? 0;
  (predicted as any).carveLockTimer = (authoritative as any).carveLockTimer ?? 0;
  (predicted as any).carveSwitchCooldownTimer = (authoritative as any).carveSwitchCooldownTimer ?? 0;
  (predicted as any).carveSide = (authoritative as any).carveSide ?? 0;
  (predicted as any).movementPhase = (authoritative as any).movementPhase ?? 'GLIDE';
  (predicted as any).startCommitTimer = (authoritative as any).startCommitTimer ?? 0;
  (predicted as any).startNoInputTimer = (authoritative as any).startNoInputTimer ?? 0;
  (predicted as any).startupOppositeLockTimer = (authoritative as any).startupOppositeLockTimer ?? 0;
  (predicted as any).startupLatchActive = !!(authoritative as any).startupLatchActive;
  (predicted as any).startupReleaseTimer = (authoritative as any).startupReleaseTimer ?? 0;
  (predicted as any).startDirX = (authoritative as any).startDirX ?? (predicted as any).desiredDirX ?? 1;
  (predicted as any).startDirY = (authoritative as any).startDirY ?? (predicted as any).desiredDirY ?? 0;
  (predicted as any).lastStableTravelAngle = (authoritative as any).lastStableTravelAngle ?? (authoritative as any).moveAngle ?? 0;
  (predicted as any).lastRawInputAngle = (authoritative as any).lastRawInputAngle ?? (authoritative as any).inputAngle ?? (authoritative as any).moveAngle;
  (predicted as any).antiFlipTimer = (authoritative as any).antiFlipTimer ?? 0;
  (predicted as any).baseBodyAngle = (authoritative as any).baseBodyAngle ?? (authoritative as any).angle;
  (predicted as any).bodyYawOffset = (authoritative as any).bodyYawOffset ?? 0;
  (predicted as any).bodyTargetAngle = (authoritative as any).bodyTargetAngle
    ?? (authoritative as any).baseBodyAngle
    ?? (authoritative as any).angle;
  (predicted as any).aimAngle = (authoritative as any).aimAngle;
  (predicted as any).aimAngleRaw = (authoritative as any).aimAngleRaw ?? (authoritative as any).aimAngle;
  (predicted as any).chargeActive = !!(authoritative as any).chargeActive;
  (predicted as any).stunLeft = Number((authoritative as any).stunLeft ?? 0);
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
