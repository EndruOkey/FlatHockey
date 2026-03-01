import Matter from 'matter-js';
import type { TeamId } from '@flathockey/shared/types/entity';
import type { C2SInput } from '@flathockey/shared/net/messages';

export type ServerPlayer = {
  id: string;
  name: string;
  team: TeamId;
  body: Matter.Body;
  aimAngle: number;
  stamina: number;
  joinTick: number;
  puckTouchScore: number;
  lastTouchTick: number;
  hasPuckInfluence: boolean;
  latestInput: C2SInput;
  inputQueue: C2SInput[];
  ackSeq: number;
  chargingSinceTick: number | null;
  defenseCooldownUntilTick: number;
};
