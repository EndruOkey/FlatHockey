import { wrapToPi } from './movementMath';
import type { MovementStepState } from './movementStep.types';

export function ensureMovementStateBase(state: MovementStepState) {
  if (!Number.isFinite(state.moveAngle)) {
    state.moveAngle = Math.hypot(state.vx, state.vy) > 0.01 ? Math.atan2(state.vy, state.vx) : 0;
  }
  if (!Number.isFinite(state.inputAngle)) {
    state.inputAngle = state.moveAngle;
  }
  if (!Number.isFinite(state.desiredDirX) || !Number.isFinite(state.desiredDirY)) {
    state.desiredDirX = Math.cos(state.moveAngle!);
    state.desiredDirY = Math.sin(state.moveAngle!);
  }
  if (!Number.isFinite(state.desiredHeadingAngle)) {
    state.desiredHeadingAngle = state.moveAngle;
  }
  if (!Number.isFinite(state.committedDirX) || !Number.isFinite(state.committedDirY)) {
    state.committedDirX = state.desiredDirX;
    state.committedDirY = state.desiredDirY;
  }
  if (!Number.isFinite(state.headingOmega)) {
    state.headingOmega = 0;
  }
  if (state.movementModelActive !== 'SKATE_STEERING' && state.movementModelActive !== 'DESIRED_HEADING_TRACTION') {
    state.movementModelActive = 'DESIRED_HEADING_TRACTION';
  }
  if (!Number.isFinite(state.distanceSinceCommit)) {
    state.distanceSinceCommit = 0;
  }
  if (!Number.isFinite(state.commitNoInputTimer)) {
    state.commitNoInputTimer = 0;
  }
  if (state.reverseDriveState !== 'NORMAL' && state.reverseDriveState !== 'TRANSITION_TO_REVERSE' && state.reverseDriveState !== 'REVERSE_READY') {
    state.reverseDriveState = 'NORMAL';
  }
  if (typeof state.reverseTransitionActive !== 'boolean') {
    state.reverseTransitionActive = false;
  }
  if (!Number.isFinite(state.reverseTransitionTimer)) {
    state.reverseTransitionTimer = 0;
  }
  if (!Number.isFinite(state.pendingDirX) || !Number.isFinite(state.pendingDirY)) {
    state.pendingDirX = state.desiredDirX;
    state.pendingDirY = state.desiredDirY;
    state.distanceSinceCommit = 0;
    state.commitNoInputTimer = 0;
  }
  if (!Number.isFinite(state.heading)) {
    state.heading = state.moveAngle;
  }
  if (!Number.isFinite(state.lastRawInputAngle)) {
    state.lastRawInputAngle = state.moveAngle;
  }
  if (!Number.isFinite(state.antiFlipTimer)) {
    state.antiFlipTimer = 0;
  }
  if (!Number.isFinite(state.directionCommitTimer)) {
    state.directionCommitTimer = 0;
  }
  if (!Number.isFinite(state.oppositeHoldTimer)) {
    state.oppositeHoldTimer = 0;
  }
  if (!Number.isFinite(state.carveLockTimer)) {
    state.carveLockTimer = 0;
  }
  if (!Number.isFinite(state.carveSwitchCooldownTimer)) {
    state.carveSwitchCooldownTimer = 0;
  }
  if (state.carveSide !== -1 && state.carveSide !== 0 && state.carveSide !== 1) {
    state.carveSide = 0;
  }
  if (state.movementPhase !== 'GLIDE' && state.movementPhase !== 'CARVE_LEFT' && state.movementPhase !== 'CARVE_RIGHT' && state.movementPhase !== 'BRAKE') {
    state.movementPhase = 'GLIDE';
  }
  if (!Number.isFinite(state.startCommitTimer)) {
    state.startCommitTimer = 0;
  }
  if (!Number.isFinite(state.startNoInputTimer)) {
    state.startNoInputTimer = 0;
  }
  if (!Number.isFinite(state.startupOppositeLockTimer)) {
    state.startupOppositeLockTimer = 0;
  }
  if (typeof state.startupLatchActive !== 'boolean') {
    state.startupLatchActive = false;
  }
  if (!Number.isFinite(state.startupReleaseTimer)) {
    state.startupReleaseTimer = 0;
  }
  if (!Number.isFinite(state.startDirX) || !Number.isFinite(state.startDirY)) {
    state.startDirX = state.desiredDirX;
    state.startDirY = state.desiredDirY;
  }
  if (!Number.isFinite(state.lastStableTravelAngle)) {
    state.lastStableTravelAngle = state.moveAngle;
  }
  if (!Number.isFinite(state.bodyAngle)) {
    state.bodyAngle = Number.isFinite(state.heading) ? state.heading! : state.moveAngle;
  }
  if (!Number.isFinite(state.baseBodyAngle)) {
    state.baseBodyAngle = state.bodyAngle!;
  }
  if (!Number.isFinite(state.bodyYawOffset)) {
    state.bodyYawOffset = wrapToPi(state.bodyAngle! - state.baseBodyAngle!);
  }
}
