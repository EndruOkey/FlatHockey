export type InputMsg = {
  type: 'input';
  clientId: string;
  seq: number;
  throttle: -1 | 0 | 1;
  steer: -1 | 0 | 1;
  brake: 0 | 1;
  shoot?: 0 | 1;
  aimAngle?: number;
  _heading?: number;
};

export type PlayerStateMsg = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  heading: number;
  headingOmega: number;
  angle: number; // visual body facing
  moveAngle: number;
  reverseState: import('../sim/movementStep').ReverseState;
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