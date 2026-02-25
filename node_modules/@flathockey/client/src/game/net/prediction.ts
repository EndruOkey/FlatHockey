import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';

export type PredictedPlayerState = PlayerStateMsg;
export const CLIENT_FIXED_DT = 1 / 60;

const ACCEL = 1900;
const SPRINT_ACCEL = 2500;
const BRAKE_DRAG = 7.5;
const DRAG = 3.2;
const MAX_SPEED = 560;

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  let dirX = input.moveX;
  let dirY = input.moveY;
  const len = Math.hypot(dirX, dirY);
  if (len > 0) {
    dirX /= len;
    dirY /= len;
  }

  const accel = input.sprint ? SPRINT_ACCEL : ACCEL;
  state.vx += dirX * accel * dt;
  state.vy += dirY * accel * dt;

  const dragFactor = Math.max(0, 1 - (input.brake ? BRAKE_DRAG : DRAG) * dt);
  state.vx *= dragFactor;
  state.vy *= dragFactor;

  const speed = Math.hypot(state.vx, state.vy);
  if (speed > MAX_SPEED) {
    const k = MAX_SPEED / speed;
    state.vx *= k;
    state.vy *= k;
  }

  state.x += state.vx * dt;
  state.y += state.vy * dt;
  if (typeof input.aimAngle === 'number' && Number.isFinite(input.aimAngle)) {
    state.angle = input.aimAngle;
  } else if (speed > 1) {
    state.angle = Math.atan2(state.vy, state.vx);
  }
}
