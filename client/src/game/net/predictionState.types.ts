import type { PlayerStateMsg } from '@flathockey/shared';

export type PredictedPlayerState = PlayerStateMsg & {
  steeringHeading?: number;
  inputHeading?: number;
};
