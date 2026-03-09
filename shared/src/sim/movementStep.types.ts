export type ReverseState = 'FORWARD' | 'REVERSING';

export type MovementStepState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  headingOmega: number;
  moveAngle: number;
  speed: number;
  aimAngle: number;
  stamina: number;
  reverseState: ReverseState;
};

export type MovementStepInput = {
  throttle: -1 | 0 | 1;
  steer: -1 | 0 | 1;
  _heading?: number;
  brake: boolean;
  shoot?: boolean;
  aimAngle?: number;
};

export type MovementStepConfig = {
  hasPuck?: boolean;

  // Core heading-traction movement.
  forwardAccel?: number;
  maxForwardSpeed?: number;
  maxReverseSpeed?: number;
  turnRate?: number;
  turnAccel?: number;
  brakeTurnMult?: number;
  brakeDecel?: number;
  coastDecel?: number;
  forwardDrag?: number;
  lateralDrag?: number;
  brakeLateralDrag?: number;
  reverseGateSpeed?: number;
  reverseAccelMul?: number;
  standstillSpeedEpsilon?: number;

  // Aliases used outside pure movement.
  maxSpeed?: number;
  maxSpeedNoPuck?: number;
  maxSpeedWithPuck?: number;
  staminaRegen?: number;

  // Aim + crosshair.
  aimEnabled?: boolean;
  aimDeadzonePx?: number;
  hideSystemCursor?: boolean;
  crosshairEnabled?: boolean;
  crosshairSize?: number;
  crosshairThickness?: number;
  crosshairCenterGap?: number;

  // Player visuals.
  handedness?: 'L' | 'R';
  visualLeanEnabled?: boolean;
  visualLeanMaxPx?: number;
  visualLeanTauMs?: number;
  visualLeanDampingRatio?: number;
  visualLeanMaxAngleDeg?: number;

  // Puck + stick tuning (still used by room systems/render).
  stickOffsetX?: number;
  stickOffsetY?: number;
  stickLength?: number;
  stickTipRadius?: number;
  stickVisualLag?: number;
  stickVisualLagMaxDeg?: number;
  drawStickTarget?: boolean;
  drawStickHitbox?: boolean;

  puckRadius?: number;
  puckMaxSpeed?: number;
  puckLinearDamping?: number;
  puckRestitution?: number;
  puckSurfaceDrag?: number;
  puckPickupRadius?: number;
  puckPickupMaxSpeed?: number;
  puckPickupMaxRelativeSpeed?: number;
  puckMagnetRadius?: number;
  puckMagnetStrength?: number;
  puckMagnetMaxForce?: number;
  puckHoldSpringK?: number;
  puckHoldDampingC?: number;
  puckHoldMaxError?: number;
  puckPickupCooldownMs?: number;
  puckShotBaseImpulse?: number;
  puckShotChargeRate?: number;
  puckShotChargeMult?: number;
  puckShotMaxImpulse?: number;
  puckShotMinHoldMs?: number;
  puckDrawPickupRadius?: boolean;
  puckDrawMagnetRadius?: boolean;
  puckDrawState?: boolean;
  puckDrawVelocity?: boolean;

  // Contacts / stun.
  minHitSpeed?: number;
  hitForce?: number;
  hitCooldownTime?: number;
  boardStunMinSpeed?: number;
  boardStunDuration?: number;
  postHitSpeedRetention?: number;
};
