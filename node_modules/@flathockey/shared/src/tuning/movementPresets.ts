import type { MovementStepConfig } from '../sim/movementStep';
import { MOVEMENT_DEFAULTS } from './movement.defaults';

// official "BestNow" tuning values as agreed, used by server defaults and client UI.
export const BestNow: MovementStepConfig = {
  accel: MOVEMENT_DEFAULTS.accel,
  maxSpeedNoPuck: MOVEMENT_DEFAULTS.maxSpeedNoPuck,
  maxSpeedWithPuck: MOVEMENT_DEFAULTS.maxSpeedWithPuck,
  dragMove: MOVEMENT_DEFAULTS.dragMove,
  dragIdle: MOVEMENT_DEFAULTS.dragIdle,
  lateralGrip: MOVEMENT_DEFAULTS.lateralGrip,
  gripCurve: MOVEMENT_DEFAULTS.gripCurve,
  reverseBrake: MOVEMENT_DEFAULTS.reverseBrake,
  brakeCurve: MOVEMENT_DEFAULTS.brakeCurve,
  overspeedDamping: MOVEMENT_DEFAULTS.overspeedDamping
};

// other default values required by movementStep (not tuned by DevMenu)
// we intentionally only export the tuned fields; the caller can merge with
// DEFAULTS defined in movementStep if needed.

export const PRESETS: Record<string, MovementStepConfig> = {
  BestNow,
  BestNow_2Regime: {
    // two-regime version of BestNow: responsive start/control at low speed, stable glide at high
    regimesEnabled: true,
    speedSplit: MOVEMENT_DEFAULTS.speedSplit,
    splitBlendWidth: MOVEMENT_DEFAULTS.splitBlendWidth,
    inputDeadzone: 0,
    inputExponent: 1,
    // low-speed (control) regime: 15-20% more responsive
    accel_lo: MOVEMENT_DEFAULTS.accel_lo,
    dragMove_lo: MOVEMENT_DEFAULTS.dragMove_lo,
    dragIdle_lo: MOVEMENT_DEFAULTS.dragIdle_lo,
    lateralGrip_lo: MOVEMENT_DEFAULTS.lateralGrip_lo,
    brakeCurve_lo: MOVEMENT_DEFAULTS.brakeCurve_lo,
    overspeedDamping_lo: 1,
    // high-speed (glide) regime: 15% less responsive, more inertia
    accel_hi: MOVEMENT_DEFAULTS.accel_hi,
    dragMove_hi: MOVEMENT_DEFAULTS.dragMove_hi,
    dragIdle_hi: MOVEMENT_DEFAULTS.dragIdle_hi,
    lateralGrip_hi: MOVEMENT_DEFAULTS.lateralGrip_hi,
    brakeCurve_hi: MOVEMENT_DEFAULTS.brakeCurve_hi,
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
