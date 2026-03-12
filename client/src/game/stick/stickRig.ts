import { clamp, lerp, wrapToPi } from '../util/math';

export type StickMode =
  | 'idle'
  | 'carry'
  | 'prepare-shot'
  | 'pass'
  | 'reach'
  | 'recover';

export interface StickPose {
  bodyFacingAngle: number;
  desiredAimAngle: number;
  finalStickAngle: number;
  pivotX: number;
  pivotY: number;
  shaftEndX: number;
  shaftEndY: number;
  bladeBaseX: number;
  bladeBaseY: number;
  bladeTipX: number;
  bladeTipY: number;
  behindBody: boolean;
  reachCenterX: number;
  reachCenterY: number;
}

export type StickTargetState = {
  desiredAimAngle: number;
  targetStickAngle: number;
  targetRelativeAngle: number;
};

export const STICK_CONFIG = {
  pivotForwardOffset: 8,
  pivotSideOffset: 6.5,
  pivotBodyYOffset: 4,
  aimPivotDrift: 2.4,
  shaftLength: 28,
  bladeLength: 12,
  bladeBendAngle: 0.55,
  maxRelativeAimRad: 1.75,
  maxStickAngularSpeed: 11.2,
  sideBlendSpeed: 10.5,
  sideSwitchHysteresisRad: 0.18,
  behindBodyThreshold: 0,
  reachOffsetFromBlade: 4,
  shaftThickness: 4,
  bladeThickness: 5
} as const;

type StickModeProfile = {
  pivotDriftScale: number;
  shaftLengthScale: number;
  reachScale: number;
};

const STICK_MODE_PROFILES: Record<StickMode, StickModeProfile> = {
  idle: {
    pivotDriftScale: 0.72,
    shaftLengthScale: 0.98,
    reachScale: 0.92
  },
  carry: {
    pivotDriftScale: 1,
    shaftLengthScale: 1,
    reachScale: 1
  },
  'prepare-shot': {
    pivotDriftScale: 0.9,
    shaftLengthScale: 1.02,
    reachScale: 1.03
  },
  pass: {
    pivotDriftScale: 0.88,
    shaftLengthScale: 1,
    reachScale: 1.02
  },
  reach: {
    pivotDriftScale: 0.78,
    shaftLengthScale: 1.05,
    reachScale: 1.08
  },
  recover: {
    pivotDriftScale: 0.6,
    shaftLengthScale: 0.96,
    reachScale: 0.9
  }
};

export function resolveStickMode(bodyFacingAngle: number, desiredAimAngle: number): StickMode {
  const relativeAim = Math.abs(resolveStickTargetState(bodyFacingAngle, desiredAimAngle).targetRelativeAngle);
  return relativeAim < 0.22 ? 'idle' : 'carry';
}

export function resolveStickTargetState(bodyFacingAngle: number, desiredAimAngle: number): StickTargetState {
  const resolvedBodyFacing = wrapToPi(bodyFacingAngle);
  const resolvedDesiredAim = wrapToPi(desiredAimAngle);
  const unclampedRelativeAngle = shortestAngleDelta(resolvedBodyFacing, resolvedDesiredAim);
  const targetRelativeAngle = clamp(
    unclampedRelativeAngle,
    -STICK_CONFIG.maxRelativeAimRad,
    STICK_CONFIG.maxRelativeAimRad
  );

  return {
    desiredAimAngle: resolvedDesiredAim,
    targetStickAngle: wrapToPi(resolvedBodyFacing + targetRelativeAngle),
    targetRelativeAngle
  };
}

export function resolveStickSideBlend(relativeAngle: number) {
  const normalized = clamp(relativeAngle / Math.max(0.0001, STICK_CONFIG.maxRelativeAimRad), -1, 1);
  return Math.sin(normalized * (Math.PI / 2));
}

export function computeStickPose(input: {
  playerX: number;
  playerY: number;
  bodyFacingAngle: number;
  desiredAimAngle: number;
  finalStickAngle: number;
  sideBlend: number;
  preferredSide: -1 | 1;
  mode?: StickMode;
}): StickPose {
  const bodyFacingAngle = wrapToPi(input.bodyFacingAngle);
  const desiredAimAngle = wrapToPi(input.desiredAimAngle);
  const finalStickAngle = wrapToPi(input.finalStickAngle);
  const mode = input.mode ?? resolveStickMode(bodyFacingAngle, desiredAimAngle);
  const profile = STICK_MODE_PROFILES[mode];
  const bodyForward = unitFromAngle(bodyFacingAngle);
  const bodyRight = rightFromAngle(bodyFacingAngle);
  const stickDirection = unitFromAngle(finalStickAngle);
  const sideBlend = clamp(input.sideBlend, -1, 1);
  const basePivotX =
    input.playerX +
    bodyForward.x * STICK_CONFIG.pivotForwardOffset +
    bodyRight.x * STICK_CONFIG.pivotSideOffset * sideBlend;
  const basePivotY =
    input.playerY +
    bodyForward.y * STICK_CONFIG.pivotForwardOffset +
    bodyRight.y * STICK_CONFIG.pivotSideOffset * sideBlend +
    STICK_CONFIG.pivotBodyYOffset;
  const pivotDrift = STICK_CONFIG.aimPivotDrift * profile.pivotDriftScale * lerp(0.65, 1, Math.abs(sideBlend));
  const pivotX = basePivotX + stickDirection.x * pivotDrift;
  const pivotY = basePivotY + stickDirection.y * pivotDrift;
  const shaftLength = STICK_CONFIG.shaftLength * profile.shaftLengthScale;
  const shaftEndX = pivotX + stickDirection.x * shaftLength;
  const shaftEndY = pivotY + stickDirection.y * shaftLength;
  const bendSide = Math.abs(sideBlend) > 0.08 ? Math.sign(sideBlend) as -1 | 1 : input.preferredSide;
  const bendMagnitude = lerp(0.72, 1, Math.abs(sideBlend));
  const bladeAngle = wrapToPi(finalStickAngle + STICK_CONFIG.bladeBendAngle * bendSide * bendMagnitude);
  const bladeDirection = unitFromAngle(bladeAngle);
  const bladeBaseX = shaftEndX;
  const bladeBaseY = shaftEndY;
  const bladeTipX = bladeBaseX + bladeDirection.x * STICK_CONFIG.bladeLength;
  const bladeTipY = bladeBaseY + bladeDirection.y * STICK_CONFIG.bladeLength;
  const reachDistance = STICK_CONFIG.reachOffsetFromBlade * profile.reachScale;
  const reachCenterX = bladeTipX + bladeDirection.x * reachDistance;
  const reachCenterY = bladeTipY + bladeDirection.y * reachDistance;

  return {
    bodyFacingAngle,
    desiredAimAngle,
    finalStickAngle,
    pivotX,
    pivotY,
    shaftEndX,
    shaftEndY,
    bladeBaseX,
    bladeBaseY,
    bladeTipX,
    bladeTipY,
    behindBody: Math.sin(finalStickAngle) < STICK_CONFIG.behindBodyThreshold,
    reachCenterX,
    reachCenterY
  };
}

function shortestAngleDelta(from: number, to: number) {
  return wrapToPi(to - from);
}

function unitFromAngle(angle: number) {
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function rightFromAngle(angle: number) {
  return {
    x: -Math.sin(angle),
    y: Math.cos(angle)
  };
}
