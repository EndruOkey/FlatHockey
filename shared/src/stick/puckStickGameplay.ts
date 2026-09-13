import { clampAimToBodyZone, STICK_GEOMETRY_CONFIG } from './stickGeometry';
import {
  computeMinimalStickPose,
  MINIMAL_STICK_CONFIG,
  type MinimalStickPose,
  type MinimalStickState
} from './minimalStickRig';

export type PuckGameplayPoseInput = {
  playerX: number;
  playerY: number;
  bodyAngle: number;
  aimAngle: number;
  playerRadius: number;
  handedness: 'left' | 'right';
  state?: Extract<MinimalStickState, 'carry' | 'charge' | 'release'>;
  chargeStartRelativeAngle?: number | null;
  charge01?: number;
  peakChargeAngle?: number;
  releaseProgress?: number;
  releaseCharge?: number;
};

export type PuckGameplayPose = {
  resolvedAim: number;
  pose: MinimalStickPose;
  contactX: number;
  contactY: number;
  bladeForwardX: number;
  bladeForwardY: number;
  bladeZoneRadius: number;
};

export function computePuckGameplayPose(input: PuckGameplayPoseInput): PuckGameplayPose {
  const resolvedAim = clampAimToBodyZone(
    input.bodyAngle,
    input.aimAngle,
    STICK_GEOMETRY_CONFIG.maxAimOffsetRad,
    input.bodyAngle
  );
  const state = input.state ?? 'carry';
  const pose = computeMinimalStickPose({
    playerX: input.playerX,
    playerY: input.playerY,
    bodyAngle: input.bodyAngle,
    aimAngle: resolvedAim,
    handedness: input.handedness,
    playerRadius: input.playerRadius,
    state,
    chargeStartAngle:
      state === 'charge' || state === 'release'
        ? (input.chargeStartRelativeAngle == null ? resolvedAim : input.bodyAngle + input.chargeStartRelativeAngle)
        : undefined,
    charge01: state === 'charge' ? (input.charge01 ?? 0) : 0,
    peakChargeAngle: state === 'release' ? input.peakChargeAngle : undefined,
    releaseProgress: state === 'release' ? input.releaseProgress : undefined,
    releaseCharge: state === 'release' ? input.releaseCharge : undefined
  });
  return {
    resolvedAim,
    pose,
    contactX: pose.bladeContactX,
    contactY: pose.bladeContactY,
    bladeForwardX: pose.bladeForwardX,
    bladeForwardY: pose.bladeForwardY,
    bladeZoneRadius: MINIMAL_STICK_CONFIG.bladeZoneRadius
  };
}
