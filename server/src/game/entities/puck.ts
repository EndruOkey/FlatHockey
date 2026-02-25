import Matter from 'matter-js';

export type ServerPuck = {
  body: Matter.Body;
  lastTouchPlayerId: string | null;
  carrierPlayerId: string | null;
};
