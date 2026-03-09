import type { PlayerStateMsg } from '@flathockey/shared';

export type PredictedPlayerState = PlayerStateMsg & {
  stamina?: number;
};
