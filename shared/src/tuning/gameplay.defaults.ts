import type { GameplayTuning } from './gameplayConfig.types';

export const GAMEPLAY_DEFAULTS: GameplayTuning = {
  aimEnabled: true,
  aimDeadzonePx: 32,
  hideSystemCursor: true,
  crosshairEnabled: true,
  crosshairSize: 16,
  crosshairThickness: 2,
  crosshairCenterGap: 4,

  stickOffsetX: 0,
  stickOffsetY: 0,
  stickLength: 0,
  stickTipRadius: 0,
  stickVisualLag: 0,
  stickVisualLagMaxDeg: 0,
  drawStickTarget: false,
  drawStickHitbox: false,

  puckRadius: 8,
  puckMaxSpeed: 560,
  puckLinearDamping: 3.2,
  puckRestitution: 0.18,
  puckSurfaceDrag: 0.04,

  puckPickupRadius: 22,
  puckPickupMaxSpeed: 220,
  puckPickupMaxRelativeSpeed: 180,
  puckMagnetRadius: 30,
  puckMagnetStrength: 90,
  puckMagnetMaxForce: 120,
  puckHoldSpringK: 28,
  puckHoldDampingC: 10,
  puckHoldMaxError: 46,
  puckPickupCooldownMs: 280,

  puckShotBaseImpulse: 240,
  puckShotChargeRate: 1.8,
  puckShotChargeMult: 300,
  puckShotMaxImpulse: 620,
  puckShotMinHoldMs: 40,
  puckDrawPickupRadius: false,
  puckDrawMagnetRadius: false,
  puckDrawState: false,
  puckDrawVelocity: false,

  __version: 1
};
