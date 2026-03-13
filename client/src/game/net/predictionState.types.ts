import type { PlayerStateMsg } from '@flathockey/shared';

export type PredictedPlayerState = PlayerStateMsg & {
  steeringHeading?: number;
  inputHeading?: number;
  intentBoostTimer: number;
  lastIntentAngle: number | null;
  stickTimer?: number;
  shotCharge?: number;
};
