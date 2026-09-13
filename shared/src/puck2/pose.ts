import { computeMinimalStickPose, type MinimalStickState } from '../stick/minimalStickRig';
import { clampAimToBodyZone, STICK_GEOMETRY_CONFIG } from '../stick/stickGeometry';

export type PuckCombatPoseInput = {
  playerX: number;
  playerY: number;
  bodyAngle: number;
  aimAngle: number;
  playerRadius: number;
  handedness: 'left' | 'right';
  state?: Extract<MinimalStickState, 'carry' | 'charge' | 'release' | 'crosscheck'>;
  charge01?: number;
  chargeStartRelativeAngle?: number | null;
  peakChargeAngle?: number;
  releaseProgress?: number;
  releaseCharge?: number;
  crosscheckForwardOffset?: number;
  crosscheckHalfWidth?: number;
};

export type PuckCombatPose = {
  contactX: number;
  contactY: number;
  forwardX: number;
  forwardY: number;
  bladeBaseX: number;
  bladeBaseY: number;
  bladeTipX: number;
  bladeTipY: number;
  bodyAngleResolved: number;
  stickAngleResolved: number;
  visualSide: 'forehand' | 'backhand';
  pickupAngle: number;
};

export function computePuckCombatPose(input: PuckCombatPoseInput): PuckCombatPose {
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
    playerRadius: input.playerRadius,
    handedness: input.handedness,
    state,
    charge01: state === 'charge' ? (input.charge01 ?? 0) : 0,
    chargeStartAngle:
      state === 'charge' || state === 'release'
        ? (input.chargeStartRelativeAngle == null ? resolvedAim : input.bodyAngle + input.chargeStartRelativeAngle)
        : undefined,
    peakChargeAngle: state === 'release' ? input.peakChargeAngle : undefined,
    releaseProgress: state === 'release' ? input.releaseProgress : undefined,
    releaseCharge: state === 'release' ? input.releaseCharge : undefined,
    crosscheckForwardOffset: input.crosscheckForwardOffset,
    crosscheckHalfWidth: input.crosscheckHalfWidth
  });
  return {
    contactX: pose.bladeContactX,
    contactY: pose.bladeContactY,
    forwardX: pose.bladeForwardX,
    forwardY: pose.bladeForwardY,
    bladeBaseX: pose.bladeBaseX,
    bladeBaseY: pose.bladeBaseY,
    bladeTipX: pose.bladeTipX,
    bladeTipY: pose.bladeTipY,
    bodyAngleResolved: input.bodyAngle,
    stickAngleResolved: pose.stickAngle,
    visualSide: resolvedAim >= input.bodyAngle ? 'forehand' : 'backhand',
    pickupAngle: Math.atan2(pose.bladeForwardY, pose.bladeForwardX)
  };
}
