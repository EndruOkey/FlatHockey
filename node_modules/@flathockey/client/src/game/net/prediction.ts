import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { getTuning, usedTuning } from '../debug/movementTuning';

export let lastTelemetry: Record<string, any> = {};

export type PredictedPlayerState = PlayerStateMsg;
export const CLIENT_FIXED_DT = 1 / 60;

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  const tuning = getTuning();
  const MAX_SPEED = tuning.maxSpeed;
  const ACCEL = tuning.accel;
  const SPRINT_ACCEL = tuning.sprintAccel;
  const DRAG_MOVE = tuning.dragMove ?? 0.9;
  const DRAG_IDLE = tuning.dragIdle ?? 0.995;
  const LATERAL_GRIP = tuning.lateralGrip ?? 4.0;
  const REVERSE_BRAKE = tuning.reverseBrake ?? 6.0;
  const TURN_ASSIST = tuning.turnAssist ?? 0.0;
  const MIN_SPEED_FOR_GRIP = tuning.minSpeedForGrip ?? 6;

  // publish what movement code actually used (debug)
  try {
    usedTuning.accel = ACCEL;
    usedTuning.sprintAccel = SPRINT_ACCEL;
    usedTuning.dragMove = DRAG_MOVE;
    usedTuning.dragIdle = DRAG_IDLE;
    usedTuning.lateralGrip = LATERAL_GRIP;
    usedTuning.reverseBrake = REVERSE_BRAKE;
    usedTuning.maxSpeed = MAX_SPEED;
  } catch {}

  // read current velocity
  let vx = state.vx;
  let vy = state.vy;

  // wish direction
  let wishX = input.moveX;
  let wishY = input.moveY;
  const wishLen = Math.hypot(wishX, wishY);
  if (wishLen > 0) { wishX /= wishLen; wishY /= wishLen; }

  // project velocity onto wishDir when present (A1 grip)
  let forwardSpeed = 0;
  let lateralSpeed = 0;
  let gripApplied = 0;
  let brakeApplied = 0;

  if (wishLen > 0) {
    const vDot = vx * wishX + vy * wishY; // forward component scalar
    forwardSpeed = vDot;
    let forwardVx = wishX * vDot;
    let forwardVy = wishY * vDot;
    let latVx = vx - forwardVx;
    let latVy = vy - forwardVy;
    lateralSpeed = Math.hypot(latVx, latVy);

    // lateral grip: damp lateral component gradually
    const gripFactor = Math.max(0, 1 - LATERAL_GRIP * dt);
    latVx *= gripFactor;
    latVy *= gripFactor;
    gripApplied = 1 - gripFactor;

    // forward accel
    const accelVal = input.sprint ? SPRINT_ACCEL : ACCEL;
    const addFx = wishX * accelVal * dt;
    const addFy = wishY * accelVal * dt;

    // reverse brake: if forward component is opposite (vDot < 0)
    if (vDot < 0) {
      const brakeFactor = Math.max(0, 1 - REVERSE_BRAKE * dt);
      forwardVx *= brakeFactor;
      forwardVy *= brakeFactor;
      brakeApplied = 1 - brakeFactor;
    }

    // recompute velocity
    vx = forwardVx + addFx + latVx;
    vy = forwardVy + addFy + latVy;

    // optional turn assist: slightly nudge velocity direction toward wishDir at low speed
    const speed = Math.hypot(vx, vy);
    if (TURN_ASSIST > 0 && speed > 0 && speed < (MIN_SPEED_FOR_GRIP * 2)) {
      const velNx = vx / speed;
      const velNy = vy / speed;
      const mix = Math.min(1, TURN_ASSIST * dt);
      const nx = velNx * (1 - mix) + wishX * mix;
      const ny = velNy * (1 - mix) + wishY * mix;
      const nn = Math.hypot(nx, ny) || 1;
      vx = (nx / nn) * speed;
      vy = (ny / nn) * speed;
    }

    // apply move drag
    vx *= Math.max(0, 1 - DRAG_MOVE * dt);
    vy *= Math.max(0, 1 - DRAG_MOVE * dt);
  } else {
    // no input: apply idle drag
    vx *= Math.max(0, 1 - DRAG_IDLE * dt);
    vy *= Math.max(0, 1 - DRAG_IDLE * dt);
  }

  // clamp to max speed
  let speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    const k = MAX_SPEED / speed;
    vx *= k;
    vy *= k;
    speed = MAX_SPEED;
  }

  // write back
  state.vx = vx;
  state.vy = vy;
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  if (typeof input.aimAngle === 'number' && Number.isFinite(input.aimAngle)) {
    state.angle = input.aimAngle;
  } else if (speed > 0.5) {
    state.angle = Math.atan2(state.vy, state.vx);
  }

  const driftAngle = wishLen > 0 && speed > 0 ? Math.abs(Math.atan2(vy, vx) - Math.atan2(wishY, wishX)) : 0;

  const telemetry = {
    currentSpeed: speed,
    speedRatio: speed / MAX_SPEED,
    lateralSpeed,
    forwardSpeed,
    driftAngle,
    gripApplied,
    brakeApplied
  };

  // publish last telemetry for UI
  try { lastTelemetry = telemetry; } catch {}

  return telemetry;
}
