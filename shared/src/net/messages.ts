export type InputMsg = {
  type: 'input';
  clientId: string;
  seq: number;
  shoot?: 0 | 1;
  aimAngle?: number;
};

export type PlayerStateMsg = {
  id: string;
  x: number;
  y: number;
  angle: number;
  aimAngle: number;
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
};

export type NetWelcomeMsg = {
  type: 'net:welcome';
  clientId: string;
  roomId: string;
  serverTick: number;
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
export type ServerMessage = WelcomeMsg | NetWelcomeMsg | JoinRejectMsg | SnapshotMsg | NetPongMsg;
