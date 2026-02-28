import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';

export type MovementStepState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  aimAngle: number;
  aimAngleRaw?: number;
  moveAngle?: number;
  bodyAngle?: number;
  // internal heading used by heading-mode movement (radians)
  heading?: number;
  prevHasInput?: boolean;
  brakeAssistLeft?: number;
  startLinearActive?: boolean;
  debugSnapFactor?: number;
  debugBrakeAssistActive?: boolean;
  debugStartModeActive?: boolean;
  debugVelForward?: number;
  debugVelSide?: number;
  debugAimAngleRaw?: number;
  debugAimAngleClamped?: number;
  debugAimDiffRaw?: number;
  debugAimDiffClamped?: number;
};

export type MovementStepInput = {
  moveX: number;
  moveY: number;
  aimAngle?: number;
  aimAngleRaw?: number;
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

  // stick (v1)
  stickOffsetX?: number;
  stickOffsetY?: number;
  stickLength?: number;
  stickTipRadius?: number;
  stickVisualLag?: number;
  stickVisualLagMaxDeg?: number;
  drawStickTarget?: boolean;
  drawStickHitbox?: boolean;

  // puck core physics
  puckRadius?: number;
  puckMaxSpeed?: number;
  puckLinearDamping?: number;
  puckRestitution?: number;
  puckSurfaceDrag?: number;

  // puck pickup / held
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

  // puck shot
  puckShotBaseImpulse?: number;
  puckShotChargeRate?: number;
  puckShotChargeMult?: number;
  puckShotMaxImpulse?: number;
  puckShotMinHoldMs?: number;

  // puck debug
  puckDrawPickupRadius?: boolean;
  puckDrawMagnetRadius?: boolean;
  puckDrawState?: boolean;
  puckDrawVelocity?: boolean;

  // aim + crosshair
  controlScheme?: 'WASD_MOVE_MOUSE_AIM' | 'MOUSE_DRIVES_MOVE';
  bodyFacingMode?: 'MOVE_LAST' | 'AIM_WHEN_IDLE' | 'BLEND';
  bodyTurnRate?: number; // rad/s
  bodyTurnRateLowSpeedMult?: number;
  aimEnabled?: boolean;
  aimMaxTurnRate?: number; // rad/s (legacy deg/s values > 60 are auto-converted on client)
  aimDeadzonePx?: number;
  aimSmoothing?: number; // 0..1
  stickAngleLimitEnabled?: boolean;
  maxStickAngleFromBodyDeg?: number;
  stickAngleLimitSoftness?: number; // 0..1 (1=hard clamp)
  // assist
  snapEnabled?: boolean;
  snapSpeedThreshold?: number;
  snapStrengthMax?: number;
  snapFadePower?: number;
  snapOnlyWhenInput?: boolean;
  startLinearEnabled?: boolean;
  startLinearOnThreshold?: number;
  startLinearOffThreshold?: number;
  startLinearSideKill?: number;
  startLinearAlignStrength?: number;
  startLinearRequiresInput?: boolean;
  brakeAssistEnabled?: boolean;
  brakeAssistDurationMs?: number;
  brakeAssistDragMult?: number;
  brakeMinSpeed?: number;
  alignSpeedThreshold?: number;
  alignStrength?: number;
  alignFadePower?: number;
  maxCurvatureEnabled?: boolean;
  maxCurvatureLow?: number;
  maxCurvatureHigh?: number;
  lowSpeedAlignThreshold?: number;
  lowSpeedAlignStrength?: number;
  crosshairEnabled?: boolean;
  crosshairSize?: number;
  crosshairThickness?: number;
  crosshairCenterGap?: number;
  hideSystemCursor?: boolean;
  drawAimLine?: boolean;
  drawTargetAngle?: boolean;
  showTargetAngle?: boolean;
  showHeading?: boolean;
  drawVectors?: boolean;
  showSnapFactor?: boolean;
  showBrakeActive?: boolean;
  showStartMode?: boolean;
  drawVelComponents?: boolean;
  debugDrawVectors?: boolean;
  debugDrawArcPreview?: boolean;
  drawMoveVector?: boolean;
  drawBodyVector?: boolean;
  drawAimVector?: boolean;
  drawAimVectorRaw?: boolean;
  drawAimVectorClamped?: boolean;
  showAngles?: boolean;
  showAngleDiff?: boolean;
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

function lerpAngle(a: number, b: number, t: number): number {
  return wrapToPi(a + wrapToPi(b - a) * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapToPi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = wrapToPi(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return wrapToPi(current + Math.sign(d) * maxStep);
}

export function applyMovementStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig = {}
) {
  const simDt = clamp(dt, 0.001, 0.05);
  const hasPuck = config.hasPuck ?? DEFAULTS.hasPuck!;
  const prevHasInput = !!state.prevHasInput;
  let brakeAssistLeft = Math.max(0, state.brakeAssistLeft ?? 0);
  let startLinearActive = !!state.startLinearActive;
  state.debugSnapFactor = 0;
  state.debugBrakeAssistActive = false;
  state.debugStartModeActive = false;
  state.debugVelForward = 0;
  state.debugVelSide = 0;
  state.debugAimAngleRaw = 0;
  state.debugAimAngleClamped = 0;
  state.debugAimDiffRaw = 0;
  state.debugAimDiffClamped = 0;

  const rawX = clamp(input.moveX, -1, 1);
  const rawY = clamp(input.moveY, -1, 1);
  const inputLen = Math.hypot(rawX, rawY);
  const hasInput = inputLen > 0.0001;
  const inputNx = hasInput ? rawX / inputLen : 0;
  const inputNy = hasInput ? rawY / inputLen : 0;
  if (!Number.isFinite(state.moveAngle)) {
    state.moveAngle = Math.hypot(state.vx, state.vy) > 0.01 ? Math.atan2(state.vy, state.vx) : 0;
  }
  if (!Number.isFinite(state.bodyAngle)) {
    state.bodyAngle = Number.isFinite(state.heading) ? state.heading! : state.moveAngle;
  }
  const inputAimRaw = Number.isFinite(input.aimAngleRaw)
    ? input.aimAngleRaw!
    : (Number.isFinite(input.aimAngle) ? input.aimAngle! : (Number.isFinite(state.aimAngleRaw) ? state.aimAngleRaw! : state.aimAngle));

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
  const startLinearEnabled = config.startLinearEnabled ?? DEFAULTS.startLinearEnabled ?? true;
  const startLinearRequiresInput = config.startLinearRequiresInput ?? DEFAULTS.startLinearRequiresInput ?? true;
  const startLinearOnThreshold = Math.max(0, config.startLinearOnThreshold ?? DEFAULTS.startLinearOnThreshold ?? (maxSpeed * 0.12));
  const startLinearOffThreshold = Math.max(
    startLinearOnThreshold,
    config.startLinearOffThreshold ?? DEFAULTS.startLinearOffThreshold ?? (maxSpeed * 0.22)
  );
  if (!startLinearEnabled) {
    startLinearActive = false;
  } else if (startLinearActive) {
    if (speed > startLinearOffThreshold || (startLinearRequiresInput && !hasInput)) {
      startLinearActive = false;
    }
  } else {
    const canActivate = !startLinearRequiresInput || hasInput;
    if (speed < startLinearOnThreshold && canActivate) {
      startLinearActive = true;
    }
  }

  const brakeAssistEnabled = config.brakeAssistEnabled ?? DEFAULTS.brakeAssistEnabled ?? false;
  const brakeMinSpeed = Math.max(0, config.brakeMinSpeed ?? DEFAULTS.brakeMinSpeed ?? 40);
  const brakeAssistDurationSec = Math.max(0, (config.brakeAssistDurationMs ?? DEFAULTS.brakeAssistDurationMs ?? 160) / 1000);
  const brakeAssistDragMult = Math.max(1, config.brakeAssistDragMult ?? DEFAULTS.brakeAssistDragMult ?? 1.6);
  if (brakeAssistEnabled && prevHasInput && !hasInput && speed > brakeMinSpeed) {
    brakeAssistLeft = brakeAssistDurationSec;
  }

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
  const controlScheme = config.controlScheme ?? DEFAULTS.controlScheme ?? 'WASD_MOVE_MOUSE_AIM';
  const mouseDrivesMove = controlScheme === 'MOUSE_DRIVES_MOVE';
  const bodyTurnRateBase = Math.max(0, config.bodyTurnRate ?? DEFAULTS.bodyTurnRate ?? DEFAULTS.maxTurnRateLowSpeed ?? 10);
  const bodyTurnRateLowSpeedMult = Math.max(0, config.bodyTurnRateLowSpeedMult ?? DEFAULTS.bodyTurnRateLowSpeedMult ?? 1);
  const bodyTurnRate = bodyTurnRateBase * lerp(bodyTurnRateLowSpeedMult, 1, speedNorm);

  if (headingOn) {
    const prevVelAngle = Math.atan2(state.vy, state.vx);
    const prevSpeed = Math.hypot(state.vx, state.vy);
    if (!Number.isFinite(state.moveAngle)) {
      state.moveAngle = speed > 0.01 ? Math.atan2(state.vy, state.vx) : 0;
    }
    if (!Number.isFinite(state.bodyAngle)) {
      state.bodyAngle = Number.isFinite(state.heading)
        ? state.heading
        : (Number.isFinite(state.moveAngle) ? state.moveAngle : 0);
    }

    if (hasInput) {
      const desiredMoveAngle = (mouseDrivesMove && Number.isFinite(inputAimRaw))
        ? inputAimRaw
        : Math.atan2(inputNy, inputNx);
      state.moveAngle = wrapToPi(desiredMoveAngle);
      const maxDelta = Math.max(0, bodyTurnRate) * simDt;
      state.bodyAngle = approachAngle(state.bodyAngle!, state.moveAngle, maxDelta);

      const hx = Math.cos(state.bodyAngle);
      const hy = Math.sin(state.bodyAngle);
      const rx = -hy;
      const ry = hx;
      state.vx += hx * accel * simDt;
      state.vy += hy * accel * simDt;

      const forward = state.vx * hx + state.vy * hy;
      let side = state.vx * rx + state.vy * ry;

      // Blend small damping with regime grip, keeping high-speed drift alive.
      const lateralDamping = config.lateralDamping ?? DEFAULTS.lateralDamping!;
      const lateralCombined = clamp(lateralDamping + lateralGrip * 0.05, 0, 8);
      const lateralFactor = Math.max(0, 1 - lateralCombined * simDt);
      side *= lateralFactor;

      if (startLinearActive) {
        const sideKill = Math.max(0, config.startLinearSideKill ?? DEFAULTS.startLinearSideKill ?? 8);
        const startLinearFactor = Math.max(0, 1 - sideKill * simDt);
        side *= startLinearFactor;
      }

      const forwardDrag = Math.exp(-(dragMove * simDt));
      state.vx = hx * (forward * forwardDrag) + rx * side;
      state.vy = hy * (forward * forwardDrag) + ry * side;

      if (startLinearActive) {
        const startAlignStrength = Math.max(0, config.startLinearAlignStrength ?? DEFAULTS.startLinearAlignStrength ?? 12);
        const startSpeedNow = Math.hypot(state.vx, state.vy);
        if (startAlignStrength > 0 && startSpeedNow > 0.001) {
          const velAngle = Math.atan2(state.vy, state.vx);
          const alignStep = startAlignStrength * simDt;
          const aligned = wrapToPi(velAngle + clamp(wrapToPi(state.bodyAngle! - velAngle), -alignStep, alignStep));
          state.vx = Math.cos(aligned) * startSpeedNow;
          state.vy = Math.sin(aligned) * startSpeedNow;
        }
      }

      if (input.buttons.brake) {
        const brakeBase = config.brakeDrag ?? DEFAULTS.brakeDrag!;
        const brakeScale = 1 + brakeCurve;
        const brakeFactor = Math.max(0, 1 - brakeBase * brakeScale * simDt);
        state.vx *= brakeFactor;
        state.vy *= brakeFactor;
      }

      const snapEnabled = config.snapEnabled ?? DEFAULTS.snapEnabled ?? false;
      const snapOnlyWhenInput = config.snapOnlyWhenInput ?? DEFAULTS.snapOnlyWhenInput ?? true;
      const snapSpeedThreshold = Math.max(0.0001, config.snapSpeedThreshold ?? DEFAULTS.snapSpeedThreshold ?? 70);
      const snapStrengthMax = Math.max(0, config.snapStrengthMax ?? DEFAULTS.snapStrengthMax ?? 6);
      const snapFadePower = Math.max(0.1, config.snapFadePower ?? DEFAULTS.snapFadePower ?? 1.6);
      const speedForSnap = Math.hypot(state.vx, state.vy);
      if (snapEnabled && (!snapOnlyWhenInput || hasInput) && speedForSnap > 0.001 && speedForSnap < snapSpeedThreshold) {
        const t = 1 - clamp(speedForSnap / snapSpeedThreshold, 0, 1);
        const snapFactor = Math.pow(t, snapFadePower);
        const velAngle = Math.atan2(state.vy, state.vx);
        const snapStep = snapStrengthMax * snapFactor * simDt;
        const snapped = wrapToPi(velAngle + clamp(wrapToPi(state.bodyAngle! - velAngle), -snapStep, snapStep));
        state.vx = Math.cos(snapped) * speedForSnap;
        state.vy = Math.sin(snapped) * speedForSnap;
        state.debugSnapFactor = snapFactor;
      }

      const alignSpeedThreshold = Math.max(
        0,
        config.alignSpeedThreshold
          ?? config.lowSpeedAlignThreshold
          ?? DEFAULTS.alignSpeedThreshold
          ?? DEFAULTS.lowSpeedAlignThreshold
          ?? 80
      );
      const alignStrength = Math.max(
        0,
        config.alignStrength
          ?? config.lowSpeedAlignStrength
          ?? DEFAULTS.alignStrength
          ?? DEFAULTS.lowSpeedAlignStrength
          ?? 4
      );
      const alignFadePower = Math.max(0.1, config.alignFadePower ?? DEFAULTS.alignFadePower ?? 1.5);
      const speedNow = Math.hypot(state.vx, state.vy);
      if (speedNow > 0.001 && speedNow < alignSpeedThreshold && alignStrength > 0) {
        const velAngle = Math.atan2(state.vy, state.vx);
        const diff = wrapToPi(state.bodyAngle! - velAngle);
        const fade = Math.pow(1 - clamp(speedNow / Math.max(0.0001, alignSpeedThreshold), 0, 1), alignFadePower);
        const maxAlignStep = alignStrength * fade * simDt;
        const aligned = wrapToPi(velAngle + clamp(diff, -maxAlignStep, maxAlignStep));
        state.vx = Math.cos(aligned) * speedNow;
        state.vy = Math.sin(aligned) * speedNow;
      }
    } else {
      const speedNow = Math.hypot(state.vx, state.vy);
      const brakeAssistActive = brakeAssistEnabled && brakeAssistLeft > 0 && speedNow > brakeMinSpeed;
      if (brakeAssistActive) {
        state.debugBrakeAssistActive = true;
        brakeAssistLeft = Math.max(0, brakeAssistLeft - simDt);
      }
      const idleFactor = Math.exp(-(dragIdle * simDt));
      const assistedFactor = Math.exp(-(dragIdle * brakeAssistDragMult * simDt));
      const dragFactor = brakeAssistActive ? assistedFactor : idleFactor;
      state.vx *= dragFactor;
      state.vy *= dragFactor;
    }

    if (config.maxCurvatureEnabled ?? DEFAULTS.maxCurvatureEnabled ?? false) {
      const speedNow = Math.hypot(state.vx, state.vy);
      if (speedNow > 0.001 && prevSpeed > 0.001) {
        const speedRatioNow = clamp(speedNow / maxSpeed, 0, 1);
        const curvLow = Math.max(0, config.maxCurvatureLow ?? DEFAULTS.maxCurvatureLow ?? 10);
        const curvHigh = Math.max(0, config.maxCurvatureHigh ?? DEFAULTS.maxCurvatureHigh ?? 2.5);
        const maxCurvStep = lerp(curvLow, curvHigh, speedRatioNow) * simDt;
        const velAngleNow = Math.atan2(state.vy, state.vx);
        const capped = wrapToPi(prevVelAngle + clamp(wrapToPi(velAngleNow - prevVelAngle), -maxCurvStep, maxCurvStep));
        state.vx = Math.cos(capped) * speedNow;
        state.vy = Math.sin(capped) * speedNow;
      }
    }
  } else {
    // Legacy steering path for compatibility if heading mode is manually disabled.
    if (hasInput) {
      const desiredMoveAngle = (mouseDrivesMove && Number.isFinite(inputAimRaw))
        ? inputAimRaw
        : Math.atan2(inputNy, inputNx);
      state.moveAngle = wrapToPi(desiredMoveAngle);
      state.bodyAngle = approachAngle(state.bodyAngle!, state.moveAngle, Math.max(0, bodyTurnRate) * simDt);
      const accelVec = sprinting ? accelSprint : accel;
      state.vx += Math.cos(state.bodyAngle!) * accelVec * simDt;
      state.vy += Math.sin(state.bodyAngle!) * accelVec * simDt;

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
      const speedNow = Math.hypot(state.vx, state.vy);
      const brakeAssistActive = brakeAssistEnabled && brakeAssistLeft > 0 && speedNow > brakeMinSpeed;
      if (brakeAssistActive) {
        state.debugBrakeAssistActive = true;
        brakeAssistLeft = Math.max(0, brakeAssistLeft - simDt);
      }
      const idleFactor = Math.exp(-(dragIdle * simDt));
      const assistedFactor = Math.exp(-(dragIdle * brakeAssistDragMult * simDt));
      const dragFactor = brakeAssistActive ? assistedFactor : idleFactor;
      state.vx *= dragFactor;
      state.vy *= dragFactor;
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

  if (!hasInput) {
    const bodyFacingMode = config.bodyFacingMode ?? DEFAULTS.bodyFacingMode ?? 'MOVE_LAST';
    if (bodyFacingMode === 'AIM_WHEN_IDLE' && Number.isFinite(inputAimRaw)) {
      state.bodyAngle = approachAngle(state.bodyAngle!, wrapToPi(inputAimRaw), Math.max(0, bodyTurnRate) * simDt);
    } else if (bodyFacingMode === 'BLEND' && Number.isFinite(inputAimRaw)) {
      const blend = 1 - clamp(Math.hypot(state.vx, state.vy) / Math.max(1, maxSpeed), 0, 1);
      const blendedTarget = lerpAngle(state.moveAngle!, wrapToPi(inputAimRaw), blend);
      state.bodyAngle = approachAngle(state.bodyAngle!, blendedTarget, Math.max(0, bodyTurnRate) * simDt);
    }
  }

  const aimAngleRaw = wrapToPi(inputAimRaw);
  const stickAngleLimitEnabled = config.stickAngleLimitEnabled ?? DEFAULTS.stickAngleLimitEnabled ?? true;
  const maxStickAngleFromBodyDeg = Math.max(0, config.maxStickAngleFromBodyDeg ?? DEFAULTS.maxStickAngleFromBodyDeg ?? 75);
  const maxStickAngleFromBody = (maxStickAngleFromBodyDeg * Math.PI) / 180;
  const stickAngleLimitSoftness = clamp(config.stickAngleLimitSoftness ?? DEFAULTS.stickAngleLimitSoftness ?? 1, 0, 1);
  const rawDiff = wrapToPi(aimAngleRaw - state.bodyAngle!);
  const diffClampedHard = stickAngleLimitEnabled
    ? clamp(rawDiff, -maxStickAngleFromBody, maxStickAngleFromBody)
    : rawDiff;
  const diffClamped = lerp(rawDiff, diffClampedHard, stickAngleLimitSoftness);
  const aimAngle = wrapToPi(state.bodyAngle! + diffClamped);
  state.aimAngleRaw = aimAngleRaw;
  state.aimAngle = aimAngle;
  state.heading = state.bodyAngle;

  const finalSpeedNow = Math.hypot(state.vx, state.vy);
  if (hasInput) {
    brakeAssistLeft = 0;
  } else if (brakeAssistLeft > 0 && !state.debugBrakeAssistActive) {
    brakeAssistLeft = Math.max(0, brakeAssistLeft - simDt);
  }
  state.prevHasInput = hasInput;
  state.brakeAssistLeft = brakeAssistLeft;
  state.startLinearActive = startLinearActive;
  state.debugStartModeActive = startLinearActive;
  const debugHeading = Number.isFinite(state.moveAngle)
    ? state.moveAngle!
    : (hasInput ? Math.atan2(inputNy, inputNx) : Math.atan2(state.vy, state.vx));
  const dhx = Math.cos(debugHeading);
  const dhy = Math.sin(debugHeading);
  state.debugVelForward = state.vx * dhx + state.vy * dhy;
  state.debugVelSide = state.vx * (-dhy) + state.vy * dhx;
  state.debugAimAngleRaw = state.aimAngleRaw;
  state.debugAimAngleClamped = state.aimAngle;
  state.debugAimDiffRaw = rawDiff;
  state.debugAimDiffClamped = diffClamped;
}

