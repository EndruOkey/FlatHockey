export type TeamId = 'A' | 'B';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerSnapshot {
  id: string;
  team: TeamId;
  pos: Vec2;
  vel: Vec2;
  rot: number;
  stamina: number;
}

export interface PuckSnapshot {
  pos: Vec2;
  vel: Vec2;
}
