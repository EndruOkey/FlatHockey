export type MovementStepState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  aimAngle: number;
};

export type MovementStepInput = {
  moveX: number;
  moveY: number;
  aimAngle: number;
  buttons: {
    sprint: boolean;
    brake: boolean;
  };
};

export type MovementStepConfig = {
  hasPuck?: boolean;
  baseAccel?: number;
  turnAccel?: number;
  baseDrag?: number;
  brakeDrag?: number;
  maxSpeedNoPuck?: number;
  maxSpeedWithPuck?: number;
  sprintMulNoPuck?: number;
  sprintMulWithPuck?: number;
  sprintMinStamina?: number;
  staminaDrain?: number;
  staminaRegen?: number;
  staminaDrainMulWithPuck?: number;
  minDt?: number;
  maxDt?: number;
};

const DEFAULTS = {
  hasPuck: false,
  baseAccel: 42,
  turnAccel: 58,
  baseDrag: 2.2,
  brakeDrag: 8.5,
  maxSpeedNoPuck: 10.2,
  maxSpeedWithPuck: 8.6,
  sprintMulNoPuck: 1.2,
  sprintMulWithPuck: 1.07,
  sprintMinStamina: 0.1,
  staminaDrain: 0.38,
  staminaRegen: 0.23,
  staminaDrainMulWithPuck: 1.2,
  minDt: 0.001,
  maxDt: 0.05
} as const;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function applyMovementStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig = {}
) {
  const hasPuck = config.hasPuck ?? DEFAULTS.hasPuck;
  const simDt = clamp(dt, config.minDt ?? DEFAULTS.minDt, config.maxDt ?? DEFAULTS.maxDt);
  const moveX = clamp(input.moveX, -1, 1);
  const moveY = clamp(input.moveY, -1, 1);
  const len = Math.hypot(moveX, moveY);
  const nx = len > 0 ? moveX / len : 0;
  const ny = len > 0 ? moveY / len : 0;

  if (input.buttons.sprint) {
    const drainMul = hasPuck ? (config.staminaDrainMulWithPuck ?? DEFAULTS.staminaDrainMulWithPuck) : 1;
    state.stamina = clamp(state.stamina - (config.staminaDrain ?? DEFAULTS.staminaDrain) * drainMul * simDt, 0, 1);
  } else {
    state.stamina = clamp(state.stamina + (config.staminaRegen ?? DEFAULTS.staminaRegen) * simDt, 0, 1);
  }

  const sprinting = input.buttons.sprint && state.stamina > (config.sprintMinStamina ?? DEFAULTS.sprintMinStamina);
  const maxSpeedBase = hasPuck ? (config.maxSpeedWithPuck ?? DEFAULTS.maxSpeedWithPuck) : (config.maxSpeedNoPuck ?? DEFAULTS.maxSpeedNoPuck);
  const sprintMul = hasPuck ? (config.sprintMulWithPuck ?? DEFAULTS.sprintMulWithPuck) : (config.sprintMulNoPuck ?? DEFAULTS.sprintMulNoPuck);
  const maxSpeed = maxSpeedBase * (sprinting ? sprintMul : 1);

  const vLen = Math.hypot(state.vx, state.vy);
  const dot = vLen > 0 && len > 0 ? (state.vx / vLen) * nx + (state.vy / vLen) * ny : 1;
  const accel = dot < 0 ? (config.turnAccel ?? DEFAULTS.turnAccel) : (config.baseAccel ?? DEFAULTS.baseAccel);

  if (len > 0) {
    state.vx += nx * accel * simDt;
    state.vy += ny * accel * simDt;
  }

  const drag = Math.exp(-((input.buttons.brake ? (config.brakeDrag ?? DEFAULTS.brakeDrag) : (config.baseDrag ?? DEFAULTS.baseDrag)) * simDt));
  state.vx *= drag;
  state.vy *= drag;

  const speed = Math.hypot(state.vx, state.vy);
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    state.vx *= s;
    state.vy *= s;
  }

  state.x += state.vx * simDt;
  state.y += state.vy * simDt;
  state.aimAngle = input.aimAngle;
}
