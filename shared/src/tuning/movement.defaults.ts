import type { MovementStepConfig } from '../sim/movementStep';

export type MovementTuning = MovementStepConfig & {
  __version?: number;
};

export const MOVEMENT_DEFAULTS: MovementTuning = {
  // Heading traction movement.
  forwardAccel: 1681.36,
  maxForwardSpeed: 342.5,
  maxReverseSpeed: 120,
  turnRate: 7.2,
  turnAccel: 32,
  brakeTurnMult: 1.8,
  brakeDecel: 950,
  coastDecel: 260,
  forwardDrag: 1.45,
  lateralDrag: 7.2,
  brakeLateralDrag: 12,
  reverseGateSpeed: 45,
  reverseAccelMul: 0.35,
  standstillSpeedEpsilon: 8,

  // Max speed aliases used by server/client HUD helpers.
  maxSpeed: 342.5,
  maxSpeedNoPuck: 342.5,
  maxSpeedWithPuck: 342.5,
  staminaRegen: 0.23,

  // Aim + crosshair.
  aimEnabled: true,
  aimDeadzonePx: 32,
  hideSystemCursor: true,
  crosshairEnabled: true,
  crosshairSize: 16,
  crosshairThickness: 2,
  crosshairCenterGap: 4,

  // Visual preferences.
  handedness: 'R',
  visualLeanEnabled: false,
  visualLeanMaxPx: 0,
  visualLeanTauMs: 120,
  visualLeanDampingRatio: 1,
  visualLeanMaxAngleDeg: 45,

  // Stick values (kept for puck helpers; stick render is disabled).
  stickOffsetX: 0,
  stickOffsetY: 0,
  stickLength: 0,
  stickTipRadius: 0,
  stickVisualLag: 0,
  stickVisualLagMaxDeg: 0,
  drawStickTarget: false,
  drawStickHitbox: false,

  // Puck core.
  puckRadius: 8,
  puckMaxSpeed: 560,
  puckLinearDamping: 3.2,
  puckRestitution: 0.18,
  puckSurfaceDrag: 0.04,

  // Puck pickup / hold.
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

  // Shot.
  puckShotBaseImpulse: 240,
  puckShotChargeRate: 1.8,
  puckShotChargeMult: 300,
  puckShotMaxImpulse: 620,
  puckShotMinHoldMs: 40,
  puckDrawPickupRadius: false,
  puckDrawMagnetRadius: false,
  puckDrawState: false,
  puckDrawVelocity: false,

  // Contacts / stun.
  minHitSpeed: 290,
  hitForce: 420,
  hitCooldownTime: 0.35,
  boardStunMinSpeed: 280,
  boardStunDuration: 0.55,
  postHitSpeedRetention: 0.38,

  __version: 1
};
