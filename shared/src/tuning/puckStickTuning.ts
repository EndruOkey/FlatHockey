import type { GameplayConfig } from './gameplayConfig.types';
import { GAMEPLAY_DEFAULTS } from './gameplay.defaults';

export type PuckStickTuning = {
  stickOffsetX: number;
  stickOffsetY: number;
  stickLength: number;
  stickTipRadius: number;
  stickVisualLag: number;
  stickVisualLagMaxDeg: number;

  puckRadius: number;
  maxSpeed: number;
  linearDamping: number;
  restitution: number;
  surfaceDrag: number;

  pickupRadius: number;
  pickupMaxPuckSpeed: number;
  pickupMaxRelativeSpeed: number;
  magnetRadius: number;
  magnetStrength: number;
  magnetMaxForce: number;
  holdSpringK: number;
  holdDampingC: number;
  holdMaxError: number;
  pickupCooldownMs: number;

  shotBaseImpulse: number;
  shotChargeRate: number;
  shotChargeMult: number;
  shotMaxImpulse: number;
  shotMinHoldMs: number;

  drawStickTarget: boolean;
  drawStickHitbox: boolean;
  drawPickupRadius: boolean;
  drawMagnetRadius: boolean;
  drawPuckState: boolean;
  drawPuckVelocity: boolean;
};

export const PUCK_STICK_DEFAULTS: PuckStickTuning = {
  stickOffsetX: GAMEPLAY_DEFAULTS.stickOffsetX ?? 22,
  stickOffsetY: GAMEPLAY_DEFAULTS.stickOffsetY ?? 0,
  stickLength: GAMEPLAY_DEFAULTS.stickLength ?? 30,
  stickTipRadius: GAMEPLAY_DEFAULTS.stickTipRadius ?? 12,
  stickVisualLag: GAMEPLAY_DEFAULTS.stickVisualLag ?? 0.2,
  stickVisualLagMaxDeg: GAMEPLAY_DEFAULTS.stickVisualLagMaxDeg ?? 18,

  puckRadius: GAMEPLAY_DEFAULTS.puckRadius ?? 8,
  maxSpeed: GAMEPLAY_DEFAULTS.puckMaxSpeed ?? 560,
  linearDamping: GAMEPLAY_DEFAULTS.puckLinearDamping ?? 3.2,
  restitution: GAMEPLAY_DEFAULTS.puckRestitution ?? 0.18,
  surfaceDrag: GAMEPLAY_DEFAULTS.puckSurfaceDrag ?? 0.04,

  pickupRadius: GAMEPLAY_DEFAULTS.puckPickupRadius ?? 22,
  pickupMaxPuckSpeed: GAMEPLAY_DEFAULTS.puckPickupMaxSpeed ?? 220,
  pickupMaxRelativeSpeed: GAMEPLAY_DEFAULTS.puckPickupMaxRelativeSpeed ?? 180,
  magnetRadius: GAMEPLAY_DEFAULTS.puckMagnetRadius ?? 30,
  magnetStrength: GAMEPLAY_DEFAULTS.puckMagnetStrength ?? 90,
  magnetMaxForce: GAMEPLAY_DEFAULTS.puckMagnetMaxForce ?? 120,
  holdSpringK: GAMEPLAY_DEFAULTS.puckHoldSpringK ?? 28,
  holdDampingC: GAMEPLAY_DEFAULTS.puckHoldDampingC ?? 10,
  holdMaxError: GAMEPLAY_DEFAULTS.puckHoldMaxError ?? 46,
  pickupCooldownMs: GAMEPLAY_DEFAULTS.puckPickupCooldownMs ?? 280,

  shotBaseImpulse: GAMEPLAY_DEFAULTS.puckShotBaseImpulse ?? 240,
  shotChargeRate: GAMEPLAY_DEFAULTS.puckShotChargeRate ?? 1.8,
  shotChargeMult: GAMEPLAY_DEFAULTS.puckShotChargeMult ?? 300,
  shotMaxImpulse: GAMEPLAY_DEFAULTS.puckShotMaxImpulse ?? 620,
  shotMinHoldMs: GAMEPLAY_DEFAULTS.puckShotMinHoldMs ?? 40,

  drawStickTarget: GAMEPLAY_DEFAULTS.drawStickTarget ?? false,
  drawStickHitbox: GAMEPLAY_DEFAULTS.drawStickHitbox ?? false,
  drawPickupRadius: GAMEPLAY_DEFAULTS.puckDrawPickupRadius ?? false,
  drawMagnetRadius: GAMEPLAY_DEFAULTS.puckDrawMagnetRadius ?? false,
  drawPuckState: GAMEPLAY_DEFAULTS.puckDrawState ?? false,
  drawPuckVelocity: GAMEPLAY_DEFAULTS.puckDrawVelocity ?? false
};

export function resolvePuckStickTuning(config: Partial<GameplayConfig>): PuckStickTuning {
  return {
    stickOffsetX: config.stickOffsetX ?? PUCK_STICK_DEFAULTS.stickOffsetX,
    stickOffsetY: config.stickOffsetY ?? PUCK_STICK_DEFAULTS.stickOffsetY,
    stickLength: config.stickLength ?? PUCK_STICK_DEFAULTS.stickLength,
    stickTipRadius: config.stickTipRadius ?? PUCK_STICK_DEFAULTS.stickTipRadius,
    stickVisualLag: config.stickVisualLag ?? PUCK_STICK_DEFAULTS.stickVisualLag,
    stickVisualLagMaxDeg: config.stickVisualLagMaxDeg ?? PUCK_STICK_DEFAULTS.stickVisualLagMaxDeg,

    puckRadius: config.puckRadius ?? PUCK_STICK_DEFAULTS.puckRadius,
    maxSpeed: config.puckMaxSpeed ?? PUCK_STICK_DEFAULTS.maxSpeed,
    linearDamping: config.puckLinearDamping ?? PUCK_STICK_DEFAULTS.linearDamping,
    restitution: config.puckRestitution ?? PUCK_STICK_DEFAULTS.restitution,
    surfaceDrag: config.puckSurfaceDrag ?? PUCK_STICK_DEFAULTS.surfaceDrag,

    pickupRadius: config.puckPickupRadius ?? PUCK_STICK_DEFAULTS.pickupRadius,
    pickupMaxPuckSpeed: config.puckPickupMaxSpeed ?? PUCK_STICK_DEFAULTS.pickupMaxPuckSpeed,
    pickupMaxRelativeSpeed: config.puckPickupMaxRelativeSpeed ?? PUCK_STICK_DEFAULTS.pickupMaxRelativeSpeed,
    magnetRadius: config.puckMagnetRadius ?? PUCK_STICK_DEFAULTS.magnetRadius,
    magnetStrength: config.puckMagnetStrength ?? PUCK_STICK_DEFAULTS.magnetStrength,
    magnetMaxForce: config.puckMagnetMaxForce ?? PUCK_STICK_DEFAULTS.magnetMaxForce,
    holdSpringK: config.puckHoldSpringK ?? PUCK_STICK_DEFAULTS.holdSpringK,
    holdDampingC: config.puckHoldDampingC ?? PUCK_STICK_DEFAULTS.holdDampingC,
    holdMaxError: config.puckHoldMaxError ?? PUCK_STICK_DEFAULTS.holdMaxError,
    pickupCooldownMs: config.puckPickupCooldownMs ?? PUCK_STICK_DEFAULTS.pickupCooldownMs,

    shotBaseImpulse: config.puckShotBaseImpulse ?? PUCK_STICK_DEFAULTS.shotBaseImpulse,
    shotChargeRate: config.puckShotChargeRate ?? PUCK_STICK_DEFAULTS.shotChargeRate,
    shotChargeMult: config.puckShotChargeMult ?? PUCK_STICK_DEFAULTS.shotChargeMult,
    shotMaxImpulse: config.puckShotMaxImpulse ?? PUCK_STICK_DEFAULTS.shotMaxImpulse,
    shotMinHoldMs: config.puckShotMinHoldMs ?? PUCK_STICK_DEFAULTS.shotMinHoldMs,

    drawStickTarget: config.drawStickTarget ?? PUCK_STICK_DEFAULTS.drawStickTarget,
    drawStickHitbox: config.drawStickHitbox ?? PUCK_STICK_DEFAULTS.drawStickHitbox,
    drawPickupRadius: config.puckDrawPickupRadius ?? PUCK_STICK_DEFAULTS.drawPickupRadius,
    drawMagnetRadius: config.puckDrawMagnetRadius ?? PUCK_STICK_DEFAULTS.drawMagnetRadius,
    drawPuckState: config.puckDrawState ?? PUCK_STICK_DEFAULTS.drawPuckState,
    drawPuckVelocity: config.puckDrawVelocity ?? PUCK_STICK_DEFAULTS.drawPuckVelocity
  };
}

export function puckStickPatchToGameplayPatch(patch: Partial<PuckStickTuning>): Partial<GameplayConfig> {
  const out: Partial<GameplayConfig> = {};
  if (patch.stickOffsetX !== undefined) out.stickOffsetX = patch.stickOffsetX;
  if (patch.stickOffsetY !== undefined) out.stickOffsetY = patch.stickOffsetY;
  if (patch.stickLength !== undefined) out.stickLength = patch.stickLength;
  if (patch.stickTipRadius !== undefined) out.stickTipRadius = patch.stickTipRadius;
  if (patch.stickVisualLag !== undefined) out.stickVisualLag = patch.stickVisualLag;
  if (patch.stickVisualLagMaxDeg !== undefined) out.stickVisualLagMaxDeg = patch.stickVisualLagMaxDeg;

  if (patch.puckRadius !== undefined) out.puckRadius = patch.puckRadius;
  if (patch.maxSpeed !== undefined) out.puckMaxSpeed = patch.maxSpeed;
  if (patch.linearDamping !== undefined) out.puckLinearDamping = patch.linearDamping;
  if (patch.restitution !== undefined) out.puckRestitution = patch.restitution;
  if (patch.surfaceDrag !== undefined) out.puckSurfaceDrag = patch.surfaceDrag;

  if (patch.pickupRadius !== undefined) out.puckPickupRadius = patch.pickupRadius;
  if (patch.pickupMaxPuckSpeed !== undefined) out.puckPickupMaxSpeed = patch.pickupMaxPuckSpeed;
  if (patch.pickupMaxRelativeSpeed !== undefined) out.puckPickupMaxRelativeSpeed = patch.pickupMaxRelativeSpeed;
  if (patch.magnetRadius !== undefined) out.puckMagnetRadius = patch.magnetRadius;
  if (patch.magnetStrength !== undefined) out.puckMagnetStrength = patch.magnetStrength;
  if (patch.magnetMaxForce !== undefined) out.puckMagnetMaxForce = patch.magnetMaxForce;
  if (patch.holdSpringK !== undefined) out.puckHoldSpringK = patch.holdSpringK;
  if (patch.holdDampingC !== undefined) out.puckHoldDampingC = patch.holdDampingC;
  if (patch.holdMaxError !== undefined) out.puckHoldMaxError = patch.holdMaxError;
  if (patch.pickupCooldownMs !== undefined) out.puckPickupCooldownMs = patch.pickupCooldownMs;

  if (patch.shotBaseImpulse !== undefined) out.puckShotBaseImpulse = patch.shotBaseImpulse;
  if (patch.shotChargeRate !== undefined) out.puckShotChargeRate = patch.shotChargeRate;
  if (patch.shotChargeMult !== undefined) out.puckShotChargeMult = patch.shotChargeMult;
  if (patch.shotMaxImpulse !== undefined) out.puckShotMaxImpulse = patch.shotMaxImpulse;
  if (patch.shotMinHoldMs !== undefined) out.puckShotMinHoldMs = patch.shotMinHoldMs;

  if (patch.drawStickTarget !== undefined) out.drawStickTarget = patch.drawStickTarget;
  if (patch.drawStickHitbox !== undefined) out.drawStickHitbox = patch.drawStickHitbox;
  if (patch.drawPickupRadius !== undefined) out.puckDrawPickupRadius = patch.drawPickupRadius;
  if (patch.drawMagnetRadius !== undefined) out.puckDrawMagnetRadius = patch.drawMagnetRadius;
  if (patch.drawPuckState !== undefined) out.puckDrawState = patch.drawPuckState;
  if (patch.drawPuckVelocity !== undefined) out.puckDrawVelocity = patch.drawPuckVelocity;
  return out;
}
