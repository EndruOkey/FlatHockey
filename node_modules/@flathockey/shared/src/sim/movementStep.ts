import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';

export type MovementStepState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  aimAngle: number;
  // internal heading used by heading-mode movement (radians)
  heading?: number;
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
  accel?: number;
  sprintAccel?: number;
  dragMove?: number;
  dragIdle?: number;
  brakeDrag?: number;
  maxSpeed?: number; // alias: applied to both puck/no-puck caps
  maxSpeedNoPuck?: number;
  maxSpeedWithPuck?: number;
  sprintMulNoPuck?: number;
  sprintMulWithPuck?: number;
  sprintMinStamina?: number;
  staminaDrain?: number;
  staminaRegen?: number;
  staminaDrainMulWithPuck?: number;

  // heading arc model
  headingModeEnabled?: boolean;
  maxTurnRateLowSpeed?: number; // rad/s
  maxTurnRateHighSpeed?: number; // rad/s
  lateralDamping?: number;

  // compatibility steering layer (kept for non-heading tuning)
  steeringEnabled?: boolean;
  steerStrength?: number;
  brakeDecel?: number;
  turnAssist?: number;
  driftAssist?: number;

  // two-regime blending
  regimesEnabled?: boolean;
  speedSplit?: number;
  splitBlendWidth?: number;

  // low-speed (control)
  accel_lo?: number;
  dragMove_lo?: number;
  dragIdle_lo?: number;
  lateralGrip_lo?: number;
  brakeCurve_lo?: number;

  // high-speed (glide)
  accel_hi?: number;
  dragMove_hi?: number;
  dragIdle_hi?: number;
  lateralGrip_hi?: number;
  brakeCurve_hi?: number;

  // shared fallback params used by the legacy/non-heading path
  lateralGrip?: number;
  gripCurve?: number;
  brakeCurve?: number;
  reverseBrake?: number;
  overspeedDamping?: number;

  // accepted for compatibility with older presets/UI
  inputDeadzone?: number;
  inputExponent?: number;
  overspeedDamping_lo?: number;
  overspeedDamping_hi?: number;
};

const BASE_DEFAULTS: MovementStepConfig = { ...MOVEMENT_DEFAULTS };

export const DEFAULTS: MovementStepConfig = {
  ...BASE_DEFAULTS
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function applyMovementStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig = {}
) {
  const simDt = clamp(dt, 0.001, 0.05);
  const hasPuck = config.hasPuck ?? DEFAULTS.hasPuck!;

  const rawX = clamp(input.moveX, -1, 1);
  const rawY = clamp(input.moveY, -1, 1);
  const inputLen = Math.hypot(rawX, rawY);
  const hasInput = inputLen > 0.0001;
  const inputNx = hasInput ? rawX / inputLen : 0;
  const inputNy = hasInput ? rawY / inputLen : 0;

  if (input.buttons.sprint) {
    const drainMul = hasPuck ? (config.staminaDrainMulWithPuck ?? DEFAULTS.staminaDrainMulWithPuck!) : 1;
    state.stamina = clamp(state.stamina - (config.staminaDrain ?? DEFAULTS.staminaDrain!) * drainMul * simDt, 0, 1);
  } else {
    state.stamina = clamp(state.stamina + (config.staminaRegen ?? DEFAULTS.staminaRegen!) * simDt, 0, 1);
  }

  const sprinting = input.buttons.sprint && state.stamina > (config.sprintMinStamina ?? DEFAULTS.sprintMinStamina!);
  const maxSpeedAlias = config.maxSpeed;
  const maxSpeedBase = maxSpeedAlias
    ?? (hasPuck ? (config.maxSpeedWithPuck ?? DEFAULTS.maxSpeedWithPuck!) : (config.maxSpeedNoPuck ?? DEFAULTS.maxSpeedNoPuck!));
  const sprintMul = hasPuck ? (config.sprintMulWithPuck ?? DEFAULTS.sprintMulWithPuck!) : (config.sprintMulNoPuck ?? DEFAULTS.sprintMulNoPuck!);
  const maxSpeed = Math.max(1, maxSpeedBase * (sprinting ? sprintMul : 1));

  const speed = Math.hypot(state.vx, state.vy);
  const speedNorm = clamp(speed / maxSpeed, 0, 1);

  let blendT = 0;
  if (config.regimesEnabled ?? DEFAULTS.regimesEnabled!) {
    const split = config.speedSplit ?? DEFAULTS.speedSplit!;
    const width = Math.max(0.0001, config.splitBlendWidth ?? DEFAULTS.splitBlendWidth!);
    blendT = smoothstep(split - width * 0.5, split + width * 0.5, speedNorm);
  }

  const accelBase = config.accel ?? DEFAULTS.accel!;
  const accelSprint = config.sprintAccel ?? config.accel ?? DEFAULTS.sprintAccel ?? accelBase;
  const accelLo = config.accel_lo ?? accelBase;
  const accelHi = config.accel_hi ?? accelBase;
  const blendedAccelBase = lerp(accelLo, accelHi, blendT);
  const accel = sprinting ? accelSprint : blendedAccelBase;

  const dragMoveBase = config.dragMove ?? DEFAULTS.dragMove!;
  const dragIdleBase = config.dragIdle ?? DEFAULTS.dragIdle!;
  const dragMove = lerp(config.dragMove_lo ?? dragMoveBase, config.dragMove_hi ?? dragMoveBase, blendT);
  const dragIdle = lerp(config.dragIdle_lo ?? dragIdleBase, config.dragIdle_hi ?? dragIdleBase, blendT);
  const lateralGrip = lerp(
    config.lateralGrip_lo ?? (config.lateralGrip ?? DEFAULTS.lateralGrip!),
    config.lateralGrip_hi ?? (config.lateralGrip ?? DEFAULTS.lateralGrip!),
    blendT
  );
  const brakeCurve = lerp(
    config.brakeCurve_lo ?? (config.brakeCurve ?? DEFAULTS.brakeCurve!),
    config.brakeCurve_hi ?? (config.brakeCurve ?? DEFAULTS.brakeCurve!),
    blendT
  );

  const headingOn = config.headingModeEnabled ?? DEFAULTS.headingModeEnabled!;

  if (headingOn) {
    if (!Number.isFinite(state.heading)) {
      state.heading = speed > 0.01 ? Math.atan2(state.vy, state.vx) : (Number.isFinite(state.aimAngle) ? state.aimAngle : 0);
    }

    if (hasInput) {
      const desiredHeading = Math.atan2(inputNy, inputNx);
      const turnRate = lerp(
        config.maxTurnRateLowSpeed ?? DEFAULTS.maxTurnRateLowSpeed!,
        config.maxTurnRateHighSpeed ?? DEFAULTS.maxTurnRateHighSpeed!,
        speedNorm
      );
      const maxDelta = Math.max(0, turnRate) * simDt;
      const headingDelta = clamp(normalizeAngle(desiredHeading - state.heading!), -maxDelta, maxDelta);
      state.heading = normalizeAngle(state.heading! + headingDelta);

      const hx = Math.cos(state.heading);
      const hy = Math.sin(state.heading);
      state.vx += hx * accel * simDt;
      state.vy += hy * accel * simDt;

      const forward = state.vx * hx + state.vy * hy;
      const fVx = hx * forward;
      const fVy = hy * forward;
      let lVx = state.vx - fVx;
      let lVy = state.vy - fVy;

      // Blend small damping with regime grip, keeping high-speed drift alive.
      const lateralDamping = config.lateralDamping ?? DEFAULTS.lateralDamping!;
      const lateralCombined = clamp(lateralDamping + lateralGrip * 0.05, 0, 8);
      const lateralFactor = Math.max(0, 1 - lateralCombined * simDt);
      lVx *= lateralFactor;
      lVy *= lateralFactor;

      const forwardDrag = Math.exp(-(dragMove * simDt));
      state.vx = fVx * forwardDrag + lVx;
      state.vy = fVy * forwardDrag + lVy;

      if (input.buttons.brake) {
        const brakeBase = config.brakeDrag ?? DEFAULTS.brakeDrag!;
        const brakeScale = 1 + brakeCurve;
        const brakeFactor = Math.max(0, 1 - brakeBase * brakeScale * simDt);
        state.vx *= brakeFactor;
        state.vy *= brakeFactor;
      }
    } else {
      const idleFactor = Math.exp(-(dragIdle * simDt));
      state.vx *= idleFactor;
      state.vy *= idleFactor;
    }
  } else {
    // Legacy steering path for compatibility if heading mode is manually disabled.
    if (hasInput) {
      const accelVec = sprinting ? accelSprint : accel;
      state.vx += inputNx * accelVec * simDt;
      state.vy += inputNy * accelVec * simDt;

      const drag = Math.exp(-((input.buttons.brake ? (config.brakeDrag ?? DEFAULTS.brakeDrag!) : dragMove) * simDt));
      state.vx *= drag;
      state.vy *= drag;

      const velLen = Math.hypot(state.vx, state.vy);
      if (velLen > 0) {
        const velNx = state.vx / velLen;
        const velNy = state.vy / velLen;
        const dot = clamp(velNx * inputNx + velNy * inputNy, -1, 1);
        const angleNorm = Math.acos(dot) / Math.PI;
        if (dot < 0) {
          const reverseBrake = config.reverseBrake ?? DEFAULTS.reverseBrake!;
          const reverseFactor = Math.max(0, 1 - reverseBrake * Math.pow(angleNorm, Math.max(0.01, brakeCurve)) * simDt);
          state.vx *= reverseFactor;
          state.vy *= reverseFactor;
        }
      }
    } else {
      const idleFactor = Math.exp(-(dragIdle * simDt));
      state.vx *= idleFactor;
      state.vy *= idleFactor;
    }
  }

  const finalSpeed = Math.hypot(state.vx, state.vy);
  if (finalSpeed > maxSpeed) {
    const k = maxSpeed / finalSpeed;
    state.vx *= k;
    state.vy *= k;
  }

  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

  if (Number.isFinite(input.aimAngle)) {
    state.aimAngle = input.aimAngle;
  }
}

