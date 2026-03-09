export type InputMsg = {
  type: 'input';
  clientId: string;
  seq: number;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: 0 | 1;
  brake: 0 | 1;
  shoot?: 0 | 1;
  aimAngle?: number;
  aimAngleRaw?: number;
  aimDistance01?: number;
  bodyTurn?: number; // legacy/inactive
};

export type PlayerStateMsg = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // body facing (legacy alias)
  moveAngle: number;
  heading?: number;
  headingOmega?: number;
  desiredHeadingAngle?: number;
  movementModelActive?: 'DESIRED_HEADING_TRACTION';
  inputAngle?: number;
  desiredDirX?: number;
  desiredDirY?: number;
  committedDirX?: number;
  committedDirY?: number;
  distanceSinceCommit?: number;
  reverseDriveState?: 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';
  reverseTransitionActive?: boolean;
  reverseTransitionTimer?: number;
  pendingDirX?: number;
  pendingDirY?: number;
  directionCommitTimer?: number;
  oppositeHoldTimer?: number;
  carveLockTimer?: number;
  carveSwitchCooldownTimer?: number;
  carveSide?: -1 | 0 | 1;
  movementPhase?: 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' | 'BRAKE';
  startCommitTimer?: number;
  startupOppositeLockTimer?: number;
  startupLatchActive?: boolean;
  startupReleaseTimer?: number;
  startDirX?: number;
  startDirY?: number;
  lastStableTravelAngle?: number;
  lastRawInputAngle?: number;
  antiFlipTimer?: number;
  baseBodyAngle?: number;
  bodyTargetAngle?: number;
  bodyYawOffset?: number;
  aimAngleRaw?: number;
  aimAngle: number;
  chargeActive?: boolean;
  stunLeft?: number;
};

export type SnapshotMsg = {
  type: 'snapshot';
  tick?: number;
  serverTick: number;
  players: PlayerStateMsg[];
  ack: Record<string, number>;
  puck?: PuckStateMsg;
};

export type PuckStateMsg = {
  state: 'FREE' | 'HELD';
  ownerId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type WelcomeMsg = {
  type: 'welcome';
  clientId: string;
  roomId: string;
  serverTick: number;
  // when present the server is advertising its default tuning and whether
  // it will accept debug tuning updates from clients. the client may use
  // this information to keep the dev panel in sync and to disable the
  // "sync" toggle when not allowed.
  movementTuning?: Partial<import('../sim/movementStep').MovementStepConfig>;
  allowTuningSync?: boolean;
};

export type NetWelcomeMsg = {
  type: 'net:welcome';
  clientId: string;
  roomId: string;
  serverTick: number;
  movementTuning?: Partial<import('../sim/movementStep').MovementStepConfig>;
  allowTuningSync?: boolean;
};

export type JoinRejectMsg = {
  type: 'join:reject';
  reason: string;
};

export type DebugSetMovementTuningMsg = {
  type: 'debug:setMovementTuning';
  config: Partial<import('../sim/movementStep').MovementStepConfig>;
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

export type ClientMessage = InputMsg | DebugSetMovementTuningMsg | NetPingMsg | JoinMsg;
export type ServerMessage = WelcomeMsg | NetWelcomeMsg | JoinRejectMsg | SnapshotMsg | NetPongMsg;
