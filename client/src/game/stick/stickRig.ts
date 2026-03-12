import { clamp, wrapToPi } from '../util/math';

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

export const STICK_CONFIG = {
  pivotForwardOffset: 10,
  pivotSideOffset: 7,
  aimPivotDrift: 3,
  shaftLength: 28,
  bladeLength: 12,
  bladeBendAngle: 0.55,
  maxRelativeAimRad: 1.75,
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
  const relativeAim = Math.abs(shortestAngleDelta(bodyFacingAngle, desiredAimAngle));
  return relativeAim < 0.2 ? 'idle' : 'carry';
}

export function computeStickPose(input: {
  playerX: number;
  playerY: number;
  bodyFacingAngle: number;
  desiredAimAngle: number;
  mode?: StickMode;
}): StickPose {
  const bodyFacingAngle = wrapToPi(input.bodyFacingAngle);
  const desiredAimAngle = wrapToPi(input.desiredAimAngle);
  const mode = input.mode ?? resolveStickMode(bodyFacingAngle, desiredAimAngle);
  const profile = STICK_MODE_PROFILES[mode];
  const relativeAim = shortestAngleDelta(bodyFacingAngle, desiredAimAngle);
  const clampedRelativeAim = clamp(relativeAim, -STICK_CONFIG.maxRelativeAimRad, STICK_CONFIG.maxRelativeAimRad);
  const finalStickAngle = wrapToPi(bodyFacingAngle + clampedRelativeAim);
  const bodyForward = unitFromAngle(bodyFacingAngle);
  const bodyRight = rightFromAngle(bodyFacingAngle);
  const desiredAimDir = unitFromAngle(desiredAimAngle);
  const stickDir = unitFromAngle(finalStickAngle);
  const basePivotX =
    input.playerX +
    bodyForward.x * STICK_CONFIG.pivotForwardOffset +
    bodyRight.x * STICK_CONFIG.pivotSideOffset;
  const basePivotY =
    input.playerY +
    bodyForward.y * STICK_CONFIG.pivotForwardOffset +
    bodyRight.y * STICK_CONFIG.pivotSideOffset;
  const pivotX = basePivotX + desiredAimDir.x * STICK_CONFIG.aimPivotDrift * profile.pivotDriftScale;
  const pivotY = basePivotY + desiredAimDir.y * STICK_CONFIG.aimPivotDrift * profile.pivotDriftScale;
  const shaftLength = STICK_CONFIG.shaftLength * profile.shaftLengthScale;
  const shaftEndX = pivotX + stickDir.x * shaftLength;
  const shaftEndY = pivotY + stickDir.y * shaftLength;
  const bladeBaseX = shaftEndX;
  const bladeBaseY = shaftEndY;
  const bladeBendSign = clampedRelativeAim === 0 ? 1 : Math.sign(clampedRelativeAim);
  const bladeAngle = wrapToPi(finalStickAngle + STICK_CONFIG.bladeBendAngle * bladeBendSign);
  const bladeDir = unitFromAngle(bladeAngle);
  const bladeTipX = bladeBaseX + bladeDir.x * STICK_CONFIG.bladeLength;
  const bladeTipY = bladeBaseY + bladeDir.y * STICK_CONFIG.bladeLength;
  const reachCenterX = bladeTipX + bladeDir.x * STICK_CONFIG.reachOffsetFromBlade * profile.reachScale;
  const reachCenterY = bladeTipY + bladeDir.y * STICK_CONFIG.reachOffsetFromBlade * profile.reachScale;

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
