export type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  movementModel?: 'skateSteering' | 'desiredHeadingTraction';
  sprint: 0 | 1;
  brake: 0 | 1;
  shoot: 0 | 1;
  aimAngleRaw: number;
  aimDistance01: number;
  bodyTurn: number;
};

export type BufferedInput = {
  seq: number;
  state: InputState;
};

export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  moveAngle: number;
  headingOmega: number;
  desiredHeadingAngle: number;
  movementModelActive: 'LEGACY' | 'V3' | 'V4' | 'SKATE_STEERING' | 'DESIRED_HEADING_TRACTION';
  inputAngle: number;
  desiredDirX: number;
  desiredDirY: number;
  committedDirX: number;
  committedDirY: number;
  distanceSinceCommit: number;
  reverseDriveState: 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';
  commitNoInputTimer: number;
  reverseTransitionActive: boolean;
  reverseTransitionTimer: number;
  pendingDirX: number;
  pendingDirY: number;
  directionCommitTimer: number;
  oppositeHoldTimer: number;
  carveLockTimer: number;
  carveSwitchCooldownTimer: number;
  carveSide: -1 | 0 | 1;
  movementPhase: 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' | 'BRAKE';
  startCommitTimer: number;
  startNoInputTimer: number;
  startupOppositeLockTimer: number;
  startupLatchActive: boolean;
  startupReleaseTimer: number;
  startDirX: number;
  startDirY: number;
  lastStableTravelAngle: number;
  lastRawInputAngle: number;
  antiFlipTimer: number;
  baseBodyAngle: number;
  bodyYawOffset: number;
  bodyTargetAngle: number;
  aimAngleRaw: number;
  aimAngle: number;
  stickAngVel?: number;
  stickLocalAngle?: number;
  stamina: number;
  heading?: number;
  prevHasInput?: boolean;
  brakeAssistLeft?: number;
  startLinearActive?: boolean;
  stickSide?: -1 | 1;
  prevShoot: boolean;
  shotCharge: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
  inputGapTicks: number;
  chargeActive: boolean;
  hitCooldownLeft: number;
  stunLeft: number;
};

export type PuckState = {
  state: 'FREE' | 'HELD';
  ownerId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pickupCooldownMs: number;
};

export const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  movementModel: 'desiredHeadingTraction',
  sprint: 0,
  brake: 0,
  shoot: 0,
  aimAngleRaw: 0,
  aimDistance01: 1,
  bodyTurn: 0
};
