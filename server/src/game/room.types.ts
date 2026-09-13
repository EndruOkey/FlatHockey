import type { HockeyStopSide, LocomotionState } from '@flathockey/shared';
import type { ShotInstance } from '@flathockey/shared';

export type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  aimAngle: number;
  shoot: 0 | 1;
  pass: 0 | 1;
  drop: 0 | 1;
  stop: 0 | 1;
};

export type BufferedInput = {
  seq: number;
  state: InputState;
};

export type BodyCollisionDebugState = {
  timerSec: number;
  otherId: string | null;
  otherIsDummy: boolean;
  preVx: number;
  preVy: number;
  otherPreVx: number;
  otherPreVy: number;
  removedInward: number;
  reboundSpeed: number;
  postVx: number;
  postVy: number;
  otherPostVx: number;
  otherPostVy: number;
  postDampingVx: number;
  postDampingVy: number;
  otherPostDampingVx: number;
  otherPostDampingVy: number;
  zeroed: boolean;
  otherZeroed: boolean;
};

export type PlayerState = {
  id: string;
  name: string;
  isTrainingDummy?: boolean;
  handedness: 'left' | 'right';
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  steeringHeading?: number;
  inputHeading?: number;
  intentBoostTimer: number;
  lastIntentAngle: number | null;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  stopTimerSec: number;
  stopRecoveryTimerSec: number;
  stopCooldownSec?: number;
  prevStopInput?: number;
  stopBlend: number;
  stopSide: HockeyStopSide;
  stopTravelHeading: number;
  angularVelocity: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
  inputGapTicks: number;
  bodyCollisionStaggerTimerSec: number;
  bodyCollisionDebug: BodyCollisionDebugState | null;
  hasPuck: boolean;
  crosscheckPhase: 'idle' | 'windup' | 'active' | 'recovery';
  crosscheckTimerSec: number;
  crosscheckConsumed: boolean;
  crosscheckResult: 'idle' | 'hit' | 'miss';
  crosscheckImpactTimerSec: number;
  crosscheckImpactSerial: number;
  crosscheckImpactContactX: number;
  crosscheckImpactContactY: number;
  crosscheckImpactDirX: number;
  crosscheckImpactDirY: number;
  crosscheckImpactBarDirX: number;
  crosscheckImpactBarDirY: number;
  crosscheckImpactMagnitude: number;
  crosscheckImpactStripped: boolean;
  crosscheckImpactSeparated: boolean;
  crosscheckImpactTargetId: string | null;
  crosscheckImpactTargetIsDummy: boolean;
  puckPickupLockTimerSec: number;
  shotChargeTimerSec: number;
  shotChargeStartRelativeAngle: number | null;
  prevShootInput: number;
  prevPassInput: number;
  prevDropInput: number;
  dummyResetTimerSec: number;
};

export type RoomPuckState = {
  kind: 'owned' | 'releasing' | 'loose';
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  radius: number;
  ownerId: string | null;
  possessionId: number;
  shot: ShotInstance | null;
  releaseSerial: number;
  releaseOwnerId: string | null;
  releaseKind: 'shot' | 'strip' | 'reset';
};

export const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  shoot: 0,
  pass: 0,
  drop: 0,
  stop: 0
};
