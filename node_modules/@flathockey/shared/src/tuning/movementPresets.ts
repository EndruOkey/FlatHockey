import type { MovementStepConfig } from '../sim/movementStep';

// official "BestNow" tuning values as agreed, used by server defaults and client UI.
export const BestNow: MovementStepConfig = {
  accel: 1681.36,
  maxSpeedNoPuck: 342.5,
  maxSpeedWithPuck: 342.5,
  dragMove: 2.75,
  dragIdle: 0.96909,
  lateralGrip: 1.13636,
  gripCurve: 0,
  reverseBrake: 0,
  brakeCurve: 0.7545,
  overspeedDamping: 1
};

// other default values required by movementStep (not tuned by DevMenu)
// we intentionally only export the tuned fields; the caller can merge with
// DEFAULTS defined in movementStep if needed.

export const PRESETS: Record<string, MovementStepConfig> = {
  BestNow,
  BestNow_2Regime: {
    // two-regime version of BestNow: responsive start/control at low speed, stable glide at high
    regimesEnabled: true,
    speedSplit: 0.40,
    splitBlendWidth: 0.12,
    inputDeadzone: 0,
    inputExponent: 1,
    // low-speed (control) regime: 15-20% more responsive
    accel_lo: 1932.57,
    dragMove_lo: 3.025,
    dragIdle_lo: 0.96909,
    lateralGrip_lo: 1.36363,
    brakeCurve_lo: 0.7922,
    overspeedDamping_lo: 1,
    // high-speed (glide) regime: 15% less responsive, more inertia
    accel_hi: 1429.156,
    dragMove_hi: 2.3375,
    dragIdle_hi: 0.920636,
    lateralGrip_hi: 0.9659,
    brakeCurve_hi: 0.71678,
    overspeedDamping_hi: 1
  },
  IceReadable: {
    // keep base BestNow movement but add gentle steering/drift
    steeringEnabled: true,
    steerStrength: 6,
    brakeDecel: 28,
    turnAssist: 0.12,
    driftAssist: 0.5
  },
  ArcadeSnap: {
    steeringEnabled: true,
    steerStrength: 14,
    brakeDecel: 60,
    turnAssist: 0.3,
    driftAssist: 0.1
  },
  PureIce: {
    steeringEnabled: true,
    steerStrength: 2,
    brakeDecel: 8,
    turnAssist: 0.02,
    driftAssist: 0.05
  }
};
