import { clamp, lerp, wrapToPi } from '../util/math';

export type Handedness = 'left' | 'right';
export type StickLayer = 'front' | 'behind';

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
  targetStickAngle: number;
  finalStickAngle: number;
  presentedStickAngle: number;
  handAnchorX: number;
  handAnchorY: number;
  pivotX: number;
  pivotY: number;
  shaftEndX: number;
  shaftEndY: number;
  bladeBaseX: number;
  bladeBaseY: number;
  bladeTipX: number;
  bladeTipY: number;
  currentLayer: StickLayer;
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
  handForwardOffset: 8.5,
  handSideOffset: 9,
  handBodyYOffset: 4.5,
  gripForwardOffset: 3.2,
  gripSideBias: 1.8,
  gripCrossOffset: 2.4,
  gripAimDrift: 1.3,
  bodyLayerSplitOffsetY: -6,
  maxUpperPresentationRad: 0.72,
  maxSidePresentationRad: 1.28,
  maxLowerPresentationRad: 1.62,
  maxStickLiftAboveChestPx: 6,
  presentationCeilingSideShiftPx: 3.5,
  shaftLength: 28,
  bladeLength: 12,
  bladeBendAngle: 0.55,
  maxRelativeAimRad: 1.75,
  maxStickAngularSpeed: 11.2,
  sideBlendSpeed: 6,
  sideSwitchHysteresisRad: 0.18,
  layerSwitchDeadZonePx: 3,
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

export function resolveHandednessSideSign(handedness: Handedness) {
  return handedness === 'right' ? 1 : -1;
}

export function resolveStickVisualY(
  input: Pick<StickPose, 'handAnchorY' | 'pivotY' | 'bladeBaseY' | 'bladeTipY'>
) {
  return (
    input.handAnchorY * 0.34 +
    input.pivotY * 0.28 +
    input.bladeBaseY * 0.22 +
    input.bladeTipY * 0.16
  );
}

export function resolveStickBodyLayerSplitY(playerY: number) {
  return playerY + STICK_CONFIG.bodyLayerSplitOffsetY;
}

export function computeStickPose(input: {
  playerX: number;
  playerY: number;
  bodyFacingAngle: number;
  desiredAimAngle: number;
  targetStickAngle?: number;
  finalStickAngle: number;
  sideBlend: number;
  handedness: Handedness;
  currentLayer?: StickLayer;
  preferredSide: -1 | 1;
  mode?: StickMode;
}): StickPose {
  const bodyFacingAngle = wrapToPi(input.bodyFacingAngle);
  const desiredAimAngle = wrapToPi(input.desiredAimAngle);
  const targetStickAngle = wrapToPi(input.targetStickAngle ?? input.finalStickAngle);
  const finalStickAngle = wrapToPi(input.finalStickAngle);
  const mode = input.mode ?? resolveStickMode(bodyFacingAngle, desiredAimAngle);
  const profile = STICK_MODE_PROFILES[mode];
  const bodyForward = unitFromAngle(bodyFacingAngle);
  const bodyRight = rightFromAngle(bodyFacingAngle);
  const sideBlend = clamp(input.sideBlend, -1, 1);
  const handednessSideSign = resolveHandednessSideSign(input.handedness);
  const presentationSideSign =
    Math.abs(sideBlend) > 0.08 ? (Math.sign(sideBlend) as -1 | 1) : input.preferredSide;
  const presentedStickAngle = resolvePresentedStickAngle({
    bodyForward,
    presentationSideSign,
    finalStickAngle
  });
  const stickDirection = unitFromAngle(presentedStickAngle);
  const handAnchorX =
    input.playerX +
    bodyForward.x * STICK_CONFIG.handForwardOffset +
    bodyRight.x * STICK_CONFIG.handSideOffset * handednessSideSign;
  const handAnchorY =
    input.playerY +
    bodyForward.y * STICK_CONFIG.handForwardOffset +
    bodyRight.y * STICK_CONFIG.handSideOffset * handednessSideSign +
    STICK_CONFIG.handBodyYOffset;
  const pivotSideOffset =
    STICK_CONFIG.gripSideBias * handednessSideSign +
    STICK_CONFIG.gripCrossOffset * sideBlend;
  const pivotForwardOffset =
    STICK_CONFIG.gripForwardOffset +
    STICK_CONFIG.gripAimDrift * profile.pivotDriftScale * lerp(0.72, 1, Math.abs(sideBlend));
  let pivotX =
    handAnchorX +
    stickDirection.x * pivotForwardOffset +
    bodyRight.x * pivotSideOffset;
  let pivotY =
    handAnchorY +
    stickDirection.y * pivotForwardOffset +
    bodyRight.y * pivotSideOffset;
  const shaftLength = STICK_CONFIG.shaftLength * profile.shaftLengthScale;
  let shaftEndX = pivotX + stickDirection.x * shaftLength;
  let shaftEndY = pivotY + stickDirection.y * shaftLength;
  const bendSide = Math.abs(sideBlend) > 0.08 ? Math.sign(sideBlend) as -1 | 1 : input.preferredSide;
  const bendMagnitude = lerp(0.72, 1, Math.abs(sideBlend));
  const bladeAngle = wrapToPi(presentedStickAngle + STICK_CONFIG.bladeBendAngle * bendSide * bendMagnitude);
  const bladeDirection = unitFromAngle(bladeAngle);
  let bladeBaseX = shaftEndX;
  let bladeBaseY = shaftEndY;
  let bladeTipX = bladeBaseX + bladeDirection.x * STICK_CONFIG.bladeLength;
  let bladeTipY = bladeBaseY + bladeDirection.y * STICK_CONFIG.bladeLength;
  const reachDistance = STICK_CONFIG.reachOffsetFromBlade * profile.reachScale;
  let reachCenterX = bladeTipX + bladeDirection.x * reachDistance;
  let reachCenterY = bladeTipY + bladeDirection.y * reachDistance;
  const presentationCeiling = resolveStickBodyLayerSplitY(input.playerY) - STICK_CONFIG.maxStickLiftAboveChestPx;
  const highestPresentationY = Math.min(
    pivotY,
    shaftEndY,
    resolveStickVisualY({ handAnchorY, pivotY, bladeBaseY, bladeTipY })
  );
  if (highestPresentationY < presentationCeiling) {
    const liftCompensation = presentationCeiling - highestPresentationY;
    const sideShift =
      STICK_CONFIG.presentationCeilingSideShiftPx *
      clamp(liftCompensation / STICK_CONFIG.maxStickLiftAboveChestPx, 0, 1.25);
    const carryXSign = presentationSideSign;

    pivotX += sideShift * carryXSign;
    pivotY += liftCompensation;
    shaftEndX += sideShift * carryXSign;
    shaftEndY += liftCompensation;
    bladeBaseX += sideShift * carryXSign;
    bladeBaseY += liftCompensation;
    bladeTipX += sideShift * carryXSign;
    bladeTipY += liftCompensation;
    reachCenterX += sideShift * carryXSign;
    reachCenterY += liftCompensation;
  }
  const resolvedLayer =
    input.currentLayer ??
    (resolveStickVisualY({ handAnchorY, pivotY, bladeBaseY, bladeTipY }) <
    resolveStickBodyLayerSplitY(input.playerY)
      ? 'behind'
      : 'front');

  return {
    bodyFacingAngle,
    desiredAimAngle,
    targetStickAngle,
    finalStickAngle,
    presentedStickAngle,
    handAnchorX,
    handAnchorY,
    pivotX,
    pivotY,
    shaftEndX,
    shaftEndY,
    bladeBaseX,
    bladeBaseY,
    bladeTipX,
    bladeTipY,
    currentLayer: resolvedLayer,
    behindBody: resolvedLayer === 'behind',
    reachCenterX,
    reachCenterY
  };
}

function resolvePresentedStickAngle(input: {
  bodyForward: { x: number; y: number };
  presentationSideSign: -1 | 1;
  finalStickAngle: number;
}) {
  const carryAxis = angleFromDirection({
    x: -input.bodyForward.y * input.presentationSideSign,
    y: input.bodyForward.x * input.presentationSideSign
  });
  const finalDirection = unitFromAngle(input.finalStickAngle);
  const upwardBias = clamp(-finalDirection.y, 0, 1);
  const downwardBias = clamp(finalDirection.y, 0, 1);
  const presentationLimit =
    upwardBias > downwardBias
      ? lerp(STICK_CONFIG.maxSidePresentationRad, STICK_CONFIG.maxUpperPresentationRad, upwardBias)
      : lerp(STICK_CONFIG.maxSidePresentationRad, STICK_CONFIG.maxLowerPresentationRad, downwardBias);
  const carryDelta = shortestAngleDelta(carryAxis, input.finalStickAngle);
  let presentedAngle = wrapToPi(carryAxis + clamp(carryDelta, -presentationLimit, presentationLimit));
  const presentedDirection = unitFromAngle(presentedAngle);
  const maxUpperLiftY = -Math.sin(STICK_CONFIG.maxUpperPresentationRad);
  if (presentedDirection.y < maxUpperLiftY) {
    const sideXSign = Math.abs(presentedDirection.x) > 0.001 ? Math.sign(presentedDirection.x) : input.presentationSideSign;
    const adjustedX = sideXSign * Math.max(Math.abs(presentedDirection.x), Math.cos(STICK_CONFIG.maxUpperPresentationRad));
    const adjustedY = Math.max(presentedDirection.y, maxUpperLiftY);
    presentedAngle = angleFromDirection(normalizeDirection(adjustedX, adjustedY));
  }
  return presentedAngle;
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

function angleFromDirection(direction: { x: number; y: number }) {
  return Math.atan2(direction.y, direction.x);
}

function normalizeDirection(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) {
    return { x: 1, y: 0 };
  }
  return {
    x: x / length,
    y: y / length
  };
}
