import type { MovementStepConfig } from '../sim/movementStep';

export type MovementTuning = MovementStepConfig & {
  __version?: number;
};

export const MOVEMENT_DEFAULTS: MovementTuning = {
  // Heading traction movement.
  forwardAccel: 1400,
  maxForwardSpeed: 340,
  maxReverseSpeed: 0,
  turnRate: 4.2,
  turnAccel: 18.0,
  brakeTurnMult: 1.8,
  brakeDecel: 380,
  coastDecel: 90,
  forwardDrag: 1.2,
  lateralDrag: 8.0,
  brakeLateralDrag: 9,
  reverseGateSpeed: 45,
  reverseAccelMul: 0.35,
  standstillSpeedEpsilon: 6,
  ...({
    headingModeEnabled: true,
    maxTurnRateLowSpeed: 4.5,
    maxTurnRateHighSpeed: 3.2,
    lateralDamping: 6.0,
    brakeDrag: 18,
    dragIdle: 3.5,
    dragMove: 1.2
  } as Partial<MovementTuning>),

  // Max speed aliases used by server/client HUD helpers.
  maxSpeed: 340,
  maxSpeedNoPuck: 340,
  maxSpeedWithPuck: 340,
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
  ...({
    stickUseSpring: false,
    stickUseTauSmoothing: true,
    stickTauMs: 120,
    stickTauMsBehind: 260,
    stickTauMinAlpha: 0.02
  } as Partial<MovementTuning>),

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
