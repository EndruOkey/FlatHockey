export type ShotInstance = {
  shotId: number;
  ownerId: string;
  startTick: number;
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  speed: number;
  spin: number;
  charge01: number;
  clipDurationSec: number;
  authoritative: boolean;
  vx: number;
  vy: number;
  radius: number;
};

export type OwnedPuckState = {
  kind: 'owned';
  ownerId: string;
  possessionId: number;
};

export type ReleasingPuckState = {
  kind: 'releasing';
  shot: ShotInstance;
};

export type PuckLooseStateV2 = {
  kind: 'loose';
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
};

export type PuckStateV2 = OwnedPuckState | ReleasingPuckState | PuckLooseStateV2;
