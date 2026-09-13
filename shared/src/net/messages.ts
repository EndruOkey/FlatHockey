import type { RuntimeEnvironment, ServerFeature } from './protocol';
import type { HockeyStopSide, LocomotionState } from '../sim/movementTypes';
import type { ShotInstance } from '../puck2/types';

export type InputMsg = {
  type: 'input';
  clientId: string;
  seq: number;
  moveX?: -1 | 0 | 1;
  moveY?: -1 | 0 | 1;
  aimAngle?: number;
  shoot?: 0 | 1;
  pass?: 0 | 1;
  drop?: 0 | 1;
  stop?: 0 | 1;
};

export type BodyCollisionDebugMsg = {
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

export type PlayerStateMsg = {
  id: string;
  name?: string;
  handedness: 'left' | 'right';
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  intentBoostTimer?: number;
  lastIntentAngle?: number | null;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  stopBlend: number;
  stopSide: HockeyStopSide;
  bodyCollisionStaggerTimerSec?: number;
  bodyCollisionDebug?: BodyCollisionDebugMsg | null;
  hasPuck?: boolean;
  isTrainingDummy?: boolean;
  crosscheckPhase?: 'idle' | 'windup' | 'active' | 'recovery';
  crosscheckTimerSec?: number;
  crosscheckConsumed?: boolean;
  crosscheckResult?: 'idle' | 'hit' | 'miss';
  crosscheckImpactTimerSec?: number;
  crosscheckImpactSerial?: number;
  crosscheckImpactContactX?: number;
  crosscheckImpactContactY?: number;
  crosscheckImpactDirX?: number;
  crosscheckImpactDirY?: number;
  crosscheckImpactBarDirX?: number;
  crosscheckImpactBarDirY?: number;
  crosscheckImpactMagnitude?: number;
  crosscheckImpactStripped?: boolean;
  crosscheckImpactSeparated?: boolean;
  crosscheckImpactTargetId?: string | null;
  crosscheckImpactTargetIsDummy?: boolean;
  dummyResetTimerSec?: number;
};

export type SnapshotMsg = {
  type: 'snapshot';
  tick?: number;
  serverTick: number;
  players: PlayerStateMsg[];
  ack: Record<string, number>;
  puck?: PuckStateMsg | null;
};

export type PuckStateMsg = {
  state?: string;
  kind?: 'owned' | 'releasing' | 'loose';
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  spin?: number;
  radius?: number;
  ownerId?: string | null;
  releaseSerial?: number;
  releaseOwnerId?: string | null;
  releaseKind?: 'shot' | 'strip' | 'reset';
  shotId?: number | null;
  possessionId?: number;
};

export type ShotStartMsg = {
  type: 'shot:start';
  serverTick: number;
  shot: ShotInstance;
};

export type PuckReleasedMsg = {
  type: 'puck:released';
  serverTick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  radius: number;
  releaseSerial: number;
  releaseOwnerId: string | null;
  releaseKind: 'shot' | 'strip' | 'reset';
};

export type WelcomeMsg = {
  type: 'welcome';
  proto: number;
  clientId: string;
  roomId: string;
  serverTick: number;
  serverBuild?: string;
  runtime: RuntimeEnvironment;
  features: ServerFeature[];
};

export type NetWelcomeMsg = {
  type: 'net:welcome';
  proto: number;
  clientId: string;
  roomId: string;
  serverTick: number;
  serverBuild?: string;
  runtime: RuntimeEnvironment;
  features: ServerFeature[];
};

export type JoinOkMsg = {
  type: 'join:ok';
  room: string;
  tickRate: number;
  snapshotRate: number;
  proto: number;
  serverBuild?: string;
  runtime: RuntimeEnvironment;
  features: ServerFeature[];
};

export type JoinRejectMsg = {
  type: 'join:reject';
  reason: string;
};

export type JoinMsg = {
  type: 'join';
  room: string;
  name?: string;
};

export type NetPingMsg = {
  type: 'net:ping';
  nonce: number;
};

export type NetPongMsg = {
  type: 'net:pong';
  nonce: number;
};

export type ClientMessage = InputMsg | NetPingMsg | JoinMsg;
export type ServerMessage = WelcomeMsg | NetWelcomeMsg | JoinRejectMsg | JoinOkMsg | SnapshotMsg | NetPongMsg | ShotStartMsg | PuckReleasedMsg;
