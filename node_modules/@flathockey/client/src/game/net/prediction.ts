import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';
import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';
import { getTuning, usedTuning } from '../debug/movementTuning';

export let lastTelemetry: Record<string, any> = {};

export type PredictedPlayerState = PlayerStateMsg & {
  stamina?: number;
  heading?: number;
};

export const CLIENT_FIXED_DT = 1 / 60;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  const tuning = getTuning();
  const config: MovementStepConfig = { ...tuning };

  // Keep alias and canonical max-speed fields aligned.
  if (typeof tuning.maxSpeed === 'number') {
    config.maxSpeed = tuning.maxSpeed;
    config.maxSpeedNoPuck = tuning.maxSpeed;
    config.maxSpeedWithPuck = tuning.maxSpeed;
  }

  const prevVx = state.vx;
  const prevVy = state.vy;
  const prevSpeed = Math.hypot(prevVx, prevVy);

  const simState: MovementStepState = {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    stamina: state.stamina ?? 1,
    aimAngle: state.angle,
    heading: state.heading
  };

  applyMovementStep(
    simState,
    {
      moveX: input.moveX,
      moveY: input.moveY,
      aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : state.angle,
      buttons: {
        sprint: !!input.sprint,
        brake: !!input.brake
      }
    },
    dt,
    config
  );

  state.x = simState.x;
  state.y = simState.y;
  state.vx = simState.vx;
  state.vy = simState.vy;
  state.stamina = simState.stamina;
  state.heading = simState.heading;
  state.angle = simState.aimAngle;

  const speed = Math.hypot(state.vx, state.vy);
  const maxSpeed = (config.maxSpeed ?? config.maxSpeedNoPuck ?? 1);
  const wishLen = Math.hypot(input.moveX, input.moveY);
  const wishX = wishLen > 0 ? input.moveX / wishLen : 0;
  const wishY = wishLen > 0 ? input.moveY / wishLen : 0;
  const forwardSpeed = wishLen > 0 ? (state.vx * wishX + state.vy * wishY) : 0;
  const lateralSpeed = wishLen > 0
    ? Math.hypot(state.vx - wishX * forwardSpeed, state.vy - wishY * forwardSpeed)
    : 0;

  const beforeDir = prevSpeed > 0 ? Math.atan2(prevVy, prevVx) : 0;
  const afterDir = speed > 0 ? Math.atan2(state.vy, state.vx) : beforeDir;
  let driftAngle = Math.abs(afterDir - (wishLen > 0 ? Math.atan2(wishY, wishX) : afterDir));
  if (driftAngle > Math.PI) driftAngle = Math.PI * 2 - driftAngle;

  let blendT = 0;
  if (tuning.regimesEnabled) {
    const split = tuning.speedSplit ?? MOVEMENT_DEFAULTS.speedSplit ?? 0.55;
    const width = Math.max(0.0001, tuning.splitBlendWidth ?? 0.12);
    blendT = smoothstep(split - width * 0.5, split + width * 0.5, maxSpeed > 0 ? speed / maxSpeed : 0);
  }

  const telemetry = {
    currentSpeed: speed,
    speedRatio: maxSpeed > 0 ? speed / maxSpeed : 0,
    lateralSpeed,
    forwardSpeed,
    driftAngle,
    gripApplied: Math.max(0, 1 - (tuning.lateralDamping ?? MOVEMENT_DEFAULTS.lateralDamping ?? 0.98) * dt),
    brakeApplied: input.brake ? Math.max(0, prevSpeed - speed) / Math.max(prevSpeed, 1) : 0,
    blendT
  };

  try {
    usedTuning.accel = config.accel;
    usedTuning.dragMove = config.dragMove;
    usedTuning.dragIdle = config.dragIdle;
    usedTuning.brakeDrag = config.brakeDrag;
    usedTuning.maxSpeed = config.maxSpeed;
    usedTuning.headingModeEnabled = config.headingModeEnabled;
    usedTuning.maxTurnRateLowSpeed = config.maxTurnRateLowSpeed;
    usedTuning.maxTurnRateHighSpeed = config.maxTurnRateHighSpeed;
    usedTuning.lateralDamping = config.lateralDamping;
    usedTuning.regimesEnabled = config.regimesEnabled;
    usedTuning.speedSplit = config.speedSplit;
    usedTuning.splitBlendWidth = config.splitBlendWidth;
  } catch {}

  try {
    lastTelemetry = telemetry;
  } catch {}

  return telemetry;
}

