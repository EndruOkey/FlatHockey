import { STICK_GEOMETRY_CONFIG } from './stickGeometry';

// Minimal Stick Rig - Phase A
//
// Phase A: standalone new rig. Server/client migration to use this is Phase B/C.
// canonicalStickRig.ts is NOT modified here - both coexist during migration.
//
// Design intent:
//   One stickAngle drives all geometry. Three states (carry/charge/release) each compute
//   stickAngle differently, then derive all world-space points from it deterministically.
//   No body-local intermediate; all coordinates are world-space from the start.
//
// Puck attach equivalence:
//   bladeContactX/Y (this file) == carryAnchorX/Y (canonicalStickRig.ts / projectStickRigToWorld).
//   Phase B migration in roomSystems.ts should:
//     1. Replace stickPose() with computeMinimalStickPose().
//     2. Replace stickPose().carryAnchorX/Y with pose.bladeContactX/Y in hardAttachPuck().
//     3. Replace stickPose().bladeForwardX/Y with pose.bladeForwardX/Y in evaluatePickupGate().

export type MinimalStickState = 'carry' | 'charge' | 'release' | 'crosscheck';

export type MinimalStickPose = {
  state: MinimalStickState;
  pivotX: number; pivotY: number;
  stickAngle: number;
  charge01: number;
  // Derived world-space points
  shaftEndX: number; shaftEndY: number;
  bladeBaseX: number; bladeBaseY: number;
  bladeTipX: number; bladeTipY: number;
  bladeContactX: number; bladeContactY: number;
  bladeForwardX: number; bladeForwardY: number;
  bottomHandX: number; bottomHandY: number;
  // For renderer compat (Phase C: stickRenderer.ts migration)
  topHandX: number; topHandY: number;
  debugConstraint?: MinimalStickConstraintDebug;
};

export type MinimalStickConstraintDebug = {
  bodyAngle: number;
  aimAngle: number;
  delta: number;
  clampedDelta: number;
  finalAngle: number;
  side: 'LEFT' | 'RIGHT' | 'CENTER';
  sideSwitchThreshold: number;
  clampOn: boolean;
  coneLeftAngle: number;
  coneRightAngle: number;
};

export type MinimalStickInput = {
  playerX: number;
  playerY: number;
  bodyAngle: number;
  aimAngle: number;
  chargeStartAngle?: number;
  playerRadius: number;
  handedness?: 'left' | 'right';
  state?: MinimalStickState;
  charge01?: number;
  peakChargeAngle?: number;
  releaseProgress?: number;
  releaseCharge?: number;
  enableDebugConstraint?: boolean;
  maxRelativeStickAngle?: number;
  sideSwitchThreshold?: number;
  crosscheckForwardOffset?: number;
  crosscheckHalfWidth?: number;
};

export const MINIMAL_STICK_CONFIG = {
  bladeContactT: 0.55,
  chargeOffsetFactor: 0.28,
  pivotFwdFactor: 0.45,
  pivotSideFactor: 0.78,
  bottomHandGripRatio: 0.38,
  releaseDurationSec: 0.08,
  bladeZoneRadius: 10,
  crosscheckForwardOffset: 24,
  crosscheckHalfWidth: 18,
} as const;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngle(angle: number): number {
  let out = angle;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function mapShotChargeToStickPose(charge01: number): number {
  const t = Math.max(0, Math.min(1, charge01));
  return 1 - Math.pow(1 - t, 3);
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * Math.max(0, Math.min(1, t));
}

export function computeMinimalStickPose(input: MinimalStickInput): MinimalStickPose {
  const { playerX, playerY, bodyAngle, aimAngle, playerRadius } = input;
  const state = input.state ?? 'carry';
  const charge01 = Math.max(0, Math.min(1, input.charge01 ?? 0));
  const handSign = input.handedness === 'left' ? -1 : 1;
  const cfg = MINIMAL_STICK_CONFIG;

  const bfwdX = Math.cos(bodyAngle);
  const bfwdY = Math.sin(bodyAngle);
  const brightX = -bfwdY;
  const brightY = bfwdX;

  const pivotFwd = playerRadius * cfg.pivotFwdFactor;
  const pivotSide = state === 'crosscheck'
    ? 0
    : playerRadius * cfg.pivotSideFactor * handSign;

  const pivotX = playerX + pivotFwd * bfwdX + pivotSide * brightX;
  const pivotY = playerY + pivotFwd * bfwdY + pivotSide * brightY;

  const chargeOffset = -Math.PI * cfg.chargeOffsetFactor * handSign;

  let stickAngle: number;
  switch (state) {
    case 'carry':
      stickAngle = aimAngle;
      break;
    case 'charge':
      stickAngle = (input.chargeStartAngle ?? aimAngle) + chargeOffset * charge01;
      break;
    case 'release': {
      const rc = Math.max(0, Math.min(1, input.releaseCharge ?? 1));
      const peakAngle = input.peakChargeAngle ?? (aimAngle + chargeOffset * rc);
      const t = Math.max(0, Math.min(1, input.releaseProgress ?? 0));
      const overshootAngle = peakAngle - chargeOffset * 1.5 * rc;

      if (t <= 0.4) {
        const t1 = t / 0.4;
        const te = 1 - (1 - t1) * (1 - t1);
        stickAngle = lerp(peakAngle, overshootAngle, te);
      } else {
        const t2 = (t - 0.4) / 0.6;
        const te = 1 - (1 - t2) * (1 - t2);
        stickAngle = lerp(overshootAngle, aimAngle, te);
      }
      break;
    }
    case 'crosscheck':
      stickAngle = bodyAngle + Math.PI * 0.5 * handSign;
      break;
    default:
      stickAngle = aimAngle;
  }

  const shaftDirX = Math.cos(stickAngle);
  const shaftDirY = Math.sin(stickAngle);

  let bladeBaseX: number;
  let bladeBaseY: number;
  let bladeTipX: number;
  let bladeTipY: number;
  let shaftEndX: number;
  let shaftEndY: number;
  let topHandX: number;
  let topHandY: number;

  if (state === 'crosscheck') {
    const crosscheckForwardOffset = input.crosscheckForwardOffset ?? cfg.crosscheckForwardOffset;
    const crosscheckHalfWidth = input.crosscheckHalfWidth ?? cfg.crosscheckHalfWidth;
    const crosscheckCenterX = playerX + bfwdX * crosscheckForwardOffset;
    const crosscheckCenterY = playerY + bfwdY * crosscheckForwardOffset;
    bladeBaseX = crosscheckCenterX - brightX * crosscheckHalfWidth;
    bladeBaseY = crosscheckCenterY - brightY * crosscheckHalfWidth;
    bladeTipX = crosscheckCenterX + brightX * crosscheckHalfWidth;
    bladeTipY = crosscheckCenterY + brightY * crosscheckHalfWidth;
    shaftEndX = lerp(bladeBaseX, bladeTipX, 0.5);
    shaftEndY = lerp(bladeBaseY, bladeTipY, 0.5);
    topHandX = bladeBaseX;
    topHandY = bladeBaseY;
  } else {
    const shaftLength = playerRadius * STICK_GEOMETRY_CONFIG.shaftLengthFactor;
    const bladeHalfLength = playerRadius * STICK_GEOMETRY_CONFIG.bladeHalfLengthFactor;
    const shaftDirX = Math.cos(stickAngle);
    const shaftDirY = Math.sin(stickAngle);
    const vx = pivotX - playerX;
    const vy = pivotY - playerY;
    const vDotAim = vx * shaftDirX + vy * shaftDirY;
    const tExit = -2 * vDotAim;
    if (tExit > 0) {
      const t = tExit + STICK_GEOMETRY_CONFIG.shaftClearance;
      topHandX = pivotX + shaftDirX * t;
      topHandY = pivotY + shaftDirY * t;
    } else {
      topHandX = pivotX;
      topHandY = pivotY;
    }
    shaftEndX = topHandX + shaftDirX * shaftLength;
    shaftEndY = topHandY + shaftDirY * shaftLength;
    const bladeAngle = stickAngle + (Math.PI / 2 - STICK_GEOMETRY_CONFIG.bladeOffsetFromPerpRad) * handSign;
    const bladeDirX = Math.cos(bladeAngle);
    const bladeDirY = Math.sin(bladeAngle);
    bladeBaseX = shaftEndX - bladeDirX * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeHeelFraction;
    bladeBaseY = shaftEndY - bladeDirY * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeHeelFraction;
    bladeTipX = shaftEndX + bladeDirX * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeToeAFraction;
    bladeTipY = shaftEndY + bladeDirY * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeToeAFraction;

    if (state === 'charge' || state === 'release') {
      const releaseT = Math.max(0, Math.min(1, input.releaseProgress ?? 0));
      const releaseCharge = Math.max(0, Math.min(1, input.releaseCharge ?? charge01));
      const tuckSource = state === 'charge' ? charge01 : releaseCharge;
      const tuckT = smoothstep01(tuckSource) * (state === 'release' ? (1 - releaseT) : 1);
      const shaftLength = playerRadius * STICK_GEOMETRY_CONFIG.shaftLengthFactor * 0.94;
      const bladeHalfLength = playerRadius * STICK_GEOMETRY_CONFIG.bladeHalfLengthFactor;
      const tuckedAngle = bodyAngle - Math.PI * 0.44 * handSign;
      const visualChargeAngle = lerpAngle(stickAngle, tuckedAngle, tuckT);
      const chargeDirX = Math.cos(visualChargeAngle);
      const chargeDirY = Math.sin(visualChargeAngle);
      const chargeTopHandX = lerp(topHandX, pivotX, tuckT);
      const chargeTopHandY = lerp(topHandY, pivotY, tuckT);
      const chargeShaftEndX = chargeTopHandX + chargeDirX * shaftLength;
      const chargeShaftEndY = chargeTopHandY + chargeDirY * shaftLength;
      const chargeBladeAngle = visualChargeAngle + (Math.PI / 2 - STICK_GEOMETRY_CONFIG.bladeOffsetFromPerpRad) * handSign;
      const chargeBladeDirX = Math.cos(chargeBladeAngle);
      const chargeBladeDirY = Math.sin(chargeBladeAngle);

      if (tuckT > 0.0001) {
        stickAngle = visualChargeAngle;
        topHandX = chargeTopHandX;
        topHandY = chargeTopHandY;
        shaftEndX = chargeShaftEndX;
        shaftEndY = chargeShaftEndY;
        bladeBaseX = chargeShaftEndX - chargeBladeDirX * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeHeelFraction;
        bladeBaseY = chargeShaftEndY - chargeBladeDirY * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeHeelFraction;
        bladeTipX = chargeShaftEndX + chargeBladeDirX * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeToeAFraction;
        bladeTipY = chargeShaftEndY + chargeBladeDirY * bladeHalfLength * STICK_GEOMETRY_CONFIG.bladeToeAFraction;
      }
    }
  }

  const bladeContactT = state === 'crosscheck' ? 0.5 : cfg.bladeContactT;
  const bladeContactX = lerp(bladeBaseX, bladeTipX, bladeContactT);
  const bladeContactY = lerp(bladeBaseY, bladeTipY, bladeContactT);

  const bladeForwardX = state === 'crosscheck' ? bfwdX : shaftDirX;
  const bladeForwardY = state === 'crosscheck' ? bfwdY : shaftDirY;

  const bottomHandX = state === 'crosscheck'
    ? lerp(bladeBaseX, bladeTipX, 0.5)
    : topHandX + (bladeBaseX - topHandX) * cfg.bottomHandGripRatio;
  const bottomHandY = state === 'crosscheck'
    ? lerp(bladeBaseY, bladeTipY, 0.5)
    : topHandY + (bladeBaseY - topHandY) * cfg.bottomHandGripRatio;

  const debugConstraint = input.enableDebugConstraint
    ? buildConstraintDebug(input)
    : undefined;

  return {
    state,
    pivotX, pivotY,
    stickAngle,
    charge01,
    shaftEndX, shaftEndY,
    bladeBaseX, bladeBaseY,
    bladeTipX, bladeTipY,
    bladeContactX, bladeContactY,
    bladeForwardX, bladeForwardY,
    bottomHandX, bottomHandY,
    topHandX,
    topHandY,
    debugConstraint,
  };
}

function buildConstraintDebug(input: MinimalStickInput): MinimalStickConstraintDebug {
  const maxRelativeStickAngle = Math.max(0.001, input.maxRelativeStickAngle ?? Math.PI * 0.5);
  const delta = normalizeAngle(input.aimAngle - input.bodyAngle);
  const clampedDelta = Math.max(-maxRelativeStickAngle, Math.min(maxRelativeStickAngle, delta));
  const finalAngle = input.bodyAngle + clampedDelta;

  return {
    bodyAngle: input.bodyAngle,
    aimAngle: input.aimAngle,
    delta,
    clampedDelta,
    finalAngle,
    side: clampedDelta > 0.0001 ? 'RIGHT' : clampedDelta < -0.0001 ? 'LEFT' : 'CENTER',
    sideSwitchThreshold: Math.max(0, input.sideSwitchThreshold ?? 0),
    clampOn: Math.abs(delta - clampedDelta) > 0.0001,
    coneLeftAngle: input.bodyAngle - maxRelativeStickAngle,
    coneRightAngle: input.bodyAngle + maxRelativeStickAngle,
  };
}
