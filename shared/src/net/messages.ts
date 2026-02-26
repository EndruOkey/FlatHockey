export type InputMsg = {
  type: 'input';
  clientId: string;
  seq: number;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: 0 | 1;
  brake: 0 | 1;
  aimAngle?: number;
};

export type PlayerStateMsg = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
};

export type SnapshotMsg = {
  type: 'snapshot';
  serverTick: number;
  players: PlayerStateMsg[];
  ack: Record<string, number>;
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

export type DebugSetMovementTuningMsg = {
  type: 'debug:setMovementTuning';
  config: Partial<import('../sim/movementStep').MovementStepConfig>;
};

export type ClientMessage = InputMsg | DebugSetMovementTuningMsg;
export type ServerMessage = WelcomeMsg | SnapshotMsg;
