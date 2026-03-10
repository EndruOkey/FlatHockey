export type GameplayConfig = {
  aimEnabled?: boolean;
  aimDeadzonePx?: number;
  hideSystemCursor?: boolean;
  crosshairEnabled?: boolean;
  crosshairSize?: number;
  crosshairThickness?: number;
  crosshairCenterGap?: number;

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
};

export type GameplayTuning = GameplayConfig & {
  __version?: number;
};
