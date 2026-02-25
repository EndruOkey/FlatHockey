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
};

export type ClientMessage = InputMsg;
export type ServerMessage = WelcomeMsg | SnapshotMsg;
