import type { MovementStepConfig } from '../sim/movementStep';
import { MOVEMENT_DEFAULTS } from './movement.defaults';

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
  stickOffsetX: MOVEMENT_DEFAULTS.stickOffsetX ?? 22,
  stickOffsetY: MOVEMENT_DEFAULTS.stickOffsetY ?? 0,
  stickLength: MOVEMENT_DEFAULTS.stickLength ?? 30,
  stickTipRadius: MOVEMENT_DEFAULTS.stickTipRadius ?? 12,
  stickVisualLag: MOVEMENT_DEFAULTS.stickVisualLag ?? 0.2,
  stickVisualLagMaxDeg: MOVEMENT_DEFAULTS.stickVisualLagMaxDeg ?? 18,

  puckRadius: MOVEMENT_DEFAULTS.puckRadius ?? 8,
  maxSpeed: MOVEMENT_DEFAULTS.puckMaxSpeed ?? 560,
  linearDamping: MOVEMENT_DEFAULTS.puckLinearDamping ?? 3.2,
  restitution: MOVEMENT_DEFAULTS.puckRestitution ?? 0.18,
  surfaceDrag: MOVEMENT_DEFAULTS.puckSurfaceDrag ?? 0.04,

  pickupRadius: MOVEMENT_DEFAULTS.puckPickupRadius ?? 22,
  pickupMaxPuckSpeed: MOVEMENT_DEFAULTS.puckPickupMaxSpeed ?? 220,
  pickupMaxRelativeSpeed: MOVEMENT_DEFAULTS.puckPickupMaxRelativeSpeed ?? 180,
  magnetRadius: MOVEMENT_DEFAULTS.puckMagnetRadius ?? 30,
  magnetStrength: MOVEMENT_DEFAULTS.puckMagnetStrength ?? 90,
  magnetMaxForce: MOVEMENT_DEFAULTS.puckMagnetMaxForce ?? 120,
  holdSpringK: MOVEMENT_DEFAULTS.puckHoldSpringK ?? 28,
  holdDampingC: MOVEMENT_DEFAULTS.puckHoldDampingC ?? 10,
  holdMaxError: MOVEMENT_DEFAULTS.puckHoldMaxError ?? 46,
  pickupCooldownMs: MOVEMENT_DEFAULTS.puckPickupCooldownMs ?? 280,

  shotBaseImpulse: MOVEMENT_DEFAULTS.puckShotBaseImpulse ?? 240,
  shotChargeRate: MOVEMENT_DEFAULTS.puckShotChargeRate ?? 1.8,
  shotChargeMult: MOVEMENT_DEFAULTS.puckShotChargeMult ?? 300,
  shotMaxImpulse: MOVEMENT_DEFAULTS.puckShotMaxImpulse ?? 620,
  shotMinHoldMs: MOVEMENT_DEFAULTS.puckShotMinHoldMs ?? 40,

  drawStickTarget: MOVEMENT_DEFAULTS.drawStickTarget ?? false,
  drawStickHitbox: MOVEMENT_DEFAULTS.drawStickHitbox ?? false,
  drawPickupRadius: MOVEMENT_DEFAULTS.puckDrawPickupRadius ?? false,
  drawMagnetRadius: MOVEMENT_DEFAULTS.puckDrawMagnetRadius ?? false,
  drawPuckState: MOVEMENT_DEFAULTS.puckDrawState ?? false,
  drawPuckVelocity: MOVEMENT_DEFAULTS.puckDrawVelocity ?? false
};

export function resolvePuckStickTuning(config: Partial<MovementStepConfig>): PuckStickTuning {
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

export function puckStickPatchToMovementPatch(patch: Partial<PuckStickTuning>): Partial<MovementStepConfig> {
  const out: Partial<MovementStepConfig> = {};
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
