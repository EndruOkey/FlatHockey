import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';

export type MovementStepState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number;
  aimAngle: number;
  aimAngleRaw?: number;
  stickAngVel?: number;
  moveAngle?: number;
  baseBodyAngle?: number;
  bodyYawOffset?: number;
  bodyAngle?: number;
  bodyManualAngVel?: number;
  stickSide?: -1 | 1;
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
  debugStickDeltaDeg?: number;
  debugStickAngVelDeg?: number;
  debugStickAngVelClamped?: boolean;
  debugStickTargetSlewActive?: boolean;
  debugStickMode?: 'TAU' | 'SPRING' | 'APPROACH';
  debugTargetAimAngle?: number;
  debugDesiredMoveAngle?: number;
  debugMoveTurnRateAppliedDeg?: number;
  debugVelocityDesiredDeltaDeg?: number;
  debugBaseBodyAngle?: number;
  debugBodyYawOffset?: number;
};

export type MovementStepInput = {
  moveX: number;
  moveY: number;
  aimAngle?: number;
  aimAngleRaw?: number;
  aimDistance01?: number; // 0=near cursor, 1=far cursor
  bodyTurn?: number; // -1..+1 manual body rotation (C/V)
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
  handedness?: 'R' | 'L';
  bodyFacingMode?: 'MOVE_LAST' | 'AIM_WHEN_IDLE' | 'BLEND' | 'AIM_ALWAYS';
  bodyTurnRate?: number; // rad/s
  bodyTurnRateLowSpeedMult?: number;
  bodyManualTurnRateDeg?: number; // deg/s
  bodyManualTurnOverridesAutoFacing?: boolean;
  bodyManualMaxOffsetDeg?: number;
  bodyManualTauMs?: number;
  bodyManualDampingRatio?: number;
  bodyManualMaxAngVelDeg?: number;
  bodyManualUseVelBase?: boolean;
  bodyManualVelBaseThreshold?: number;
  maxBodyOffsetDeg?: number; // handling offset limit around base angle
  maxBodyYawOffsetDeg?: number;
  bodyYawSpeedDeg?: number;
  bodyYawReturnSpeedDeg?: number;
  bodyReturnTauMs?: number; // return-to-base smoothing
  bodyBaseSpeedThreshold?: number; // speed threshold to use velocity as base angle
  aimEnabled?: boolean;
  aimMaxTurnRate?: number; // rad/s (legacy deg/s values > 60 are auto-converted on client)
  aimDeadzonePx?: number;
  aimSmoothing?: number; // 0..1
  aimFromStickBaseEnabled?: boolean;
  stickAngleLimitEnabled?: boolean;
  maxStickAngleFromBodyDeg?: number;
  stickBehindStartDeg?: number;
  stickSideFlipHysteresisDeg?: number;
  stickBehindTurnRateDeg?: number;
  stickBehindTauMs?: number;
  stickBehindEaseDeg?: number;
  stickBehindTurnRateMinDeg?: number;
  stickUseTauSmoothing?: boolean;
  stickTargetSlewRateDeg?: number; // deg/s, 0 disables explicit target slew limiter
  stickTauMs?: number;
  stickTauMsBehind?: number;
  stickTauMinAlpha?: number; // 0..1
  stickUseSpring?: boolean;
  stickAutoSpring?: boolean; // derive K/D from snappiness + damping ratio
  stickSnappiness?: number; // 0..1
  stickDampingRatio?: number; // 0.7..1.3 (1.0 = critical damping)
  stickSpringK?: number; // rad/s^2 per rad
  stickDamping?: number; // 1/s
  stickMaxAngVelDeg?: number; // deg/s
  stickInertiaEnabled?: boolean;
  stickInertiaMaxDeg?: number;
  stickInertiaFactor?: number; // 0..1
  stickInertiaSpeedThreshold?: number; // speed units
  stickTrickBoostEnabled?: boolean;
  stickTrickNearPx?: number;
  stickTrickFarPx?: number;
  stickTrickMaxAngVelNearDeg?: number;
  stickTrickMaxAngVelFarDeg?: number;
  stickTrickTargetSlewNearDeg?: number;
  stickTrickTargetSlewFarDeg?: number;
  stickTrickTauNearMs?: number;
  stickTrickTauFarMs?: number;
  couplingEnabled?: boolean;
  couplingStrength?: number; // 0..0.35
  stickClampSoftness?: number; // 0..1, compression outside the hard limit
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
  visualLeanEnabled?: boolean;
  visualLeanMaxPx?: number;
  visualLeanTauMs?: number;
  visualLeanDampingRatio?: number;
  visualLeanMaxAngleDeg?: number;
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

function approachScalar(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
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
  state.debugStickDeltaDeg = 0;
  state.debugStickAngVelDeg = 0;
  state.debugStickAngVelClamped = false;
  state.debugStickTargetSlewActive = false;
  state.debugStickMode = 'APPROACH';
  state.debugTargetAimAngle = 0;
  state.debugDesiredMoveAngle = 0;
  state.debugMoveTurnRateAppliedDeg = 0;
  state.debugVelocityDesiredDeltaDeg = 0;
  state.debugBaseBodyAngle = 0;
  state.debugBodyYawOffset = 0;

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
  if (!Number.isFinite(state.baseBodyAngle)) {
    state.baseBodyAngle = state.bodyAngle!;
  }
  if (!Number.isFinite(state.bodyYawOffset)) {
    state.bodyYawOffset = wrapToPi(state.bodyAngle! - state.baseBodyAngle!);
  }
  const inputAimRaw = Number.isFinite(input.aimAngleRaw)
    ? input.aimAngleRaw!
    : (Number.isFinite(input.aimAngle) ? input.aimAngle! : (Number.isFinite(state.aimAngleRaw) ? state.aimAngleRaw! : state.aimAngle));
  if (state.stickSide !== -1 && state.stickSide !== 1) {
    state.stickSide = (wrapToPi(inputAimRaw - state.bodyAngle!) >= 0 ? 1 : -1);
  }

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
  const bodyFacingMode = config.bodyFacingMode ?? DEFAULTS.bodyFacingMode ?? 'AIM_ALWAYS';
  const bodyTurnRateBase = Math.max(0, config.bodyTurnRate ?? DEFAULTS.bodyTurnRate ?? DEFAULTS.maxTurnRateLowSpeed ?? 10);
  const bodyTurnRateLowSpeedMult = Math.max(0, config.bodyTurnRateLowSpeedMult ?? DEFAULTS.bodyTurnRateLowSpeedMult ?? 1);
  const bodyTurnRate = bodyTurnRateBase * lerp(bodyTurnRateLowSpeedMult, 1, speedNorm);
  const moveTurnRateLow = Math.max(0, config.maxTurnRateLowSpeed ?? DEFAULTS.maxTurnRateLowSpeed ?? bodyTurnRateBase);
  const moveTurnRateHigh = Math.max(0, config.maxTurnRateHighSpeed ?? DEFAULTS.maxTurnRateHighSpeed ?? moveTurnRateLow);
  const moveTurnRate = lerp(moveTurnRateLow, moveTurnRateHigh, speedNorm);
  const bodyTurnInput = clamp(input.bodyTurn ?? 0, -1, 1);
  const bodyYawSpeedDeg = Math.max(
    0,
    config.bodyYawSpeedDeg
      ?? config.bodyManualTurnRateDeg
      ?? DEFAULTS.bodyYawSpeedDeg
      ?? DEFAULTS.bodyManualTurnRateDeg
      ?? 360
  );
  const bodyYawSpeed = (bodyYawSpeedDeg * Math.PI) / 180;
  const maxBodyYawOffsetDeg = Math.max(
    0,
    config.maxBodyYawOffsetDeg
      ?? config.maxBodyOffsetDeg
      ?? config.bodyManualMaxOffsetDeg
      ?? DEFAULTS.maxBodyYawOffsetDeg
      ?? DEFAULTS.maxBodyOffsetDeg
      ?? DEFAULTS.bodyManualMaxOffsetDeg
      ?? 35
  );
  const maxBodyYawOffset = (maxBodyYawOffsetDeg * Math.PI) / 180;
  const bodyYawReturnSpeedDeg = Math.max(0, config.bodyYawReturnSpeedDeg ?? DEFAULTS.bodyYawReturnSpeedDeg ?? 220);
  const bodyYawReturnSpeed = (bodyYawReturnSpeedDeg * Math.PI) / 180;
  const couplingEnabled = config.couplingEnabled ?? DEFAULTS.couplingEnabled ?? true;
  const couplingStrength = clamp(config.couplingStrength ?? DEFAULTS.couplingStrength ?? 0.15, 0, 0.35);
  const manualTurningActive = Math.abs(bodyTurnInput) > 0.0001;

  let desiredMoveAngleDebug = Number.isFinite(state.moveAngle) ? state.moveAngle! : 0;
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
      const desiredMoveAngle = wrapToPi((mouseDrivesMove && Number.isFinite(inputAimRaw))
        ? inputAimRaw
        : Math.atan2(inputNy, inputNx));
      desiredMoveAngleDebug = desiredMoveAngle;
      state.moveAngle = approachAngle(state.moveAngle!, desiredMoveAngle, moveTurnRate * simDt);
      const movementHeading = state.moveAngle!;

      const hx = Math.cos(movementHeading);
      const hy = Math.sin(movementHeading);
      const rx = -hy;
      const ry = hx;
      let accelMul = 1;
      if (couplingEnabled) {
        const bodyDx = Math.cos(state.bodyAngle!);
        const bodyDy = Math.sin(state.bodyAngle!);
        const align = clamp(inputNx * bodyDx + inputNy * bodyDy, -1, 1);
        accelMul = lerp(1 - couplingStrength, 1, (align + 1) * 0.5);
      }
      const accelEff = accel * accelMul;
      state.vx += hx * accelEff * simDt;
      state.vy += hy * accelEff * simDt;

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
          const aligned = wrapToPi(velAngle + clamp(wrapToPi(movementHeading - velAngle), -alignStep, alignStep));
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
        const snapped = wrapToPi(velAngle + clamp(wrapToPi(movementHeading - velAngle), -snapStep, snapStep));
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
        const diff = wrapToPi(movementHeading - velAngle);
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
      const desiredMoveAngle = wrapToPi((mouseDrivesMove && Number.isFinite(inputAimRaw))
        ? inputAimRaw
        : Math.atan2(inputNy, inputNx));
      desiredMoveAngleDebug = desiredMoveAngle;
      state.moveAngle = approachAngle(state.moveAngle!, desiredMoveAngle, moveTurnRate * simDt);
      const movementHeading = state.moveAngle!;
      const accelVecBase = sprinting ? accelSprint : accel;
      let accelMul = 1;
      if (couplingEnabled) {
        const bodyDx = Math.cos(state.bodyAngle!);
        const bodyDy = Math.sin(state.bodyAngle!);
        const align = clamp(inputNx * bodyDx + inputNy * bodyDy, -1, 1);
        accelMul = lerp(1 - couplingStrength, 1, (align + 1) * 0.5);
      }
      const accelVec = accelVecBase * accelMul;
      state.vx += Math.cos(movementHeading) * accelVec * simDt;
      state.vy += Math.sin(movementHeading) * accelVec * simDt;

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
    const speedNow = Math.hypot(state.vx, state.vy);
    if (speedNow > 0.001) {
      state.moveAngle = Math.atan2(state.vy, state.vx);
    }
  }

  let baseBodyAngle = Number.isFinite(state.baseBodyAngle) ? state.baseBodyAngle! : state.bodyAngle!;
  const bodyTurnStep = Math.max(0, bodyTurnRate) * simDt;
  const speedNow = Math.hypot(state.vx, state.vy);
  const moveOrVelAngle = Number.isFinite(state.moveAngle)
    ? state.moveAngle!
    : (speedNow > 0.001 ? Math.atan2(state.vy, state.vx) : baseBodyAngle);
  if (bodyFacingMode === 'AIM_ALWAYS' && Number.isFinite(inputAimRaw)) {
    baseBodyAngle = approachAngle(baseBodyAngle, wrapToPi(inputAimRaw), bodyTurnStep);
  } else if (bodyFacingMode === 'AIM_WHEN_IDLE' && Number.isFinite(inputAimRaw) && !hasInput) {
    baseBodyAngle = approachAngle(baseBodyAngle, wrapToPi(inputAimRaw), bodyTurnStep);
  } else if (bodyFacingMode === 'BLEND' && Number.isFinite(inputAimRaw)) {
    const blend = 1 - clamp(speedNow / Math.max(1, maxSpeed), 0, 1);
    const blendedTarget = lerpAngle(moveOrVelAngle, wrapToPi(inputAimRaw), clamp(blend, 0, 1));
    baseBodyAngle = approachAngle(baseBodyAngle, blendedTarget, bodyTurnStep);
  } else {
    baseBodyAngle = approachAngle(baseBodyAngle, moveOrVelAngle, bodyTurnStep);
  }

  let bodyYawOffset = clamp(Number.isFinite(state.bodyYawOffset) ? state.bodyYawOffset! : 0, -maxBodyYawOffset, maxBodyYawOffset);
  if (manualTurningActive) {
    bodyYawOffset = clamp(bodyYawOffset + bodyTurnInput * bodyYawSpeed * simDt, -maxBodyYawOffset, maxBodyYawOffset);
  } else {
    bodyYawOffset = approachScalar(bodyYawOffset, 0, bodyYawReturnSpeed * simDt);
  }
  state.baseBodyAngle = baseBodyAngle;
  state.bodyYawOffset = bodyYawOffset;
  state.bodyAngle = wrapToPi(baseBodyAngle + bodyYawOffset);
  state.bodyManualAngVel = manualTurningActive ? bodyTurnInput * bodyYawSpeed : 0;

  const aimAngleRaw = wrapToPi(inputAimRaw);
  const stickAngleLimitEnabled = config.stickAngleLimitEnabled ?? DEFAULTS.stickAngleLimitEnabled ?? true;
  const maxStickAngleFromBodyDeg = Math.max(0, config.maxStickAngleFromBodyDeg ?? DEFAULTS.maxStickAngleFromBodyDeg ?? 75);
  const maxStickAngleFromBody = (maxStickAngleFromBodyDeg * Math.PI) / 180;
  const stickBehindStartDeg = Math.max(maxStickAngleFromBodyDeg, config.stickBehindStartDeg ?? DEFAULTS.stickBehindStartDeg ?? 120);
  const stickBehindStart = (stickBehindStartDeg * Math.PI) / 180;
  const stickSideFlipHysteresisDeg = Math.max(0, config.stickSideFlipHysteresisDeg ?? DEFAULTS.stickSideFlipHysteresisDeg ?? 8);
  const stickSideFlipHysteresis = (stickSideFlipHysteresisDeg * Math.PI) / 180;
  const stickBehindTurnRateDeg = Math.max(0, config.stickBehindTurnRateDeg ?? DEFAULTS.stickBehindTurnRateDeg ?? 1440);
  const stickBehindTurnRate = (stickBehindTurnRateDeg * Math.PI) / 180;
  const stickBehindTauMs = Math.max(0, config.stickBehindTauMs ?? DEFAULTS.stickBehindTauMs ?? 0);
  const stickBehindTauSec = stickBehindTauMs / 1000;
  const stickBehindEaseDeg = Math.max(0, config.stickBehindEaseDeg ?? DEFAULTS.stickBehindEaseDeg ?? 20);
  const stickBehindEase = (stickBehindEaseDeg * Math.PI) / 180;
  const stickBehindTurnRateMinDeg = Math.max(0, config.stickBehindTurnRateMinDeg ?? DEFAULTS.stickBehindTurnRateMinDeg ?? 120);
  const stickBehindTurnRateMin = (stickBehindTurnRateMinDeg * Math.PI) / 180;
  const stickUseTauSmoothing = config.stickUseTauSmoothing ?? DEFAULTS.stickUseTauSmoothing ?? true;
  const stickTargetSlewRateDeg = Math.max(0, config.stickTargetSlewRateDeg ?? DEFAULTS.stickTargetSlewRateDeg ?? 0);
  const stickTauMs = Math.max(0, config.stickTauMs ?? DEFAULTS.stickTauMs ?? 180);
  const stickTauMsBehind = Math.max(0, config.stickTauMsBehind ?? DEFAULTS.stickTauMsBehind ?? 320);
  const stickTauMinAlpha = clamp(config.stickTauMinAlpha ?? DEFAULTS.stickTauMinAlpha ?? 0.02, 0, 1);
  const stickUseSpring = config.stickUseSpring ?? DEFAULTS.stickUseSpring ?? true;
  const stickAutoSpring = config.stickAutoSpring ?? DEFAULTS.stickAutoSpring ?? true;
  const stickSnappiness = clamp(config.stickSnappiness ?? DEFAULTS.stickSnappiness ?? 0.22, 0, 1);
  const stickDampingRatio = clamp(config.stickDampingRatio ?? DEFAULTS.stickDampingRatio ?? 1.0, 0.7, 1.3);
  const stickSpringKManual = Math.max(0, config.stickSpringK ?? DEFAULTS.stickSpringK ?? 35);
  const stickDampingManual = Math.max(0, config.stickDamping ?? DEFAULTS.stickDamping ?? 14);
  const stickSpringK = stickAutoSpring ? lerp(12, 120, stickSnappiness) : stickSpringKManual;
  const stickDamping = stickAutoSpring
    ? (stickDampingRatio * 2 * Math.sqrt(Math.max(0, stickSpringK)))
    : stickDampingManual;
  const stickMaxAngVelBaseDeg = Math.max(0, config.stickMaxAngVelDeg ?? DEFAULTS.stickMaxAngVelDeg ?? 900);
  const aimDistance01 = clamp(input.aimDistance01 ?? 1, 0, 1);
  const nearWeight = 1 - aimDistance01;
  const stickTrickBoostEnabled = config.stickTrickBoostEnabled ?? DEFAULTS.stickTrickBoostEnabled ?? false;
  const stickTrickMaxAngVelNearDeg = Math.max(0, config.stickTrickMaxAngVelNearDeg ?? DEFAULTS.stickTrickMaxAngVelNearDeg ?? 2500);
  const stickTrickMaxAngVelFarDeg = Math.max(0, config.stickTrickMaxAngVelFarDeg ?? DEFAULTS.stickTrickMaxAngVelFarDeg ?? 1200);
  const stickTrickTargetSlewNearDeg = Math.max(0, config.stickTrickTargetSlewNearDeg ?? DEFAULTS.stickTrickTargetSlewNearDeg ?? 2500);
  const stickTrickTargetSlewFarDeg = Math.max(0, config.stickTrickTargetSlewFarDeg ?? DEFAULTS.stickTrickTargetSlewFarDeg ?? 1200);
  const stickTrickTauNearMs = Math.max(0, config.stickTrickTauNearMs ?? DEFAULTS.stickTrickTauNearMs ?? 50);
  const stickTrickTauFarMs = Math.max(0, config.stickTrickTauFarMs ?? DEFAULTS.stickTrickTauFarMs ?? 160);
  const stickMaxAngVelDeg = stickTrickBoostEnabled
    ? lerp(stickTrickMaxAngVelFarDeg, stickTrickMaxAngVelNearDeg, nearWeight)
    : stickMaxAngVelBaseDeg;
  const stickTargetSlewRateActiveDeg = stickTrickBoostEnabled
    ? lerp(stickTrickTargetSlewFarDeg, stickTrickTargetSlewNearDeg, nearWeight)
    : stickTargetSlewRateDeg;
  const stickTargetSlewRateActive = (stickTargetSlewRateActiveDeg * Math.PI) / 180;
  const stickMaxAngVel = (stickMaxAngVelDeg * Math.PI) / 180;
  const stickInertiaEnabled = config.stickInertiaEnabled ?? DEFAULTS.stickInertiaEnabled ?? true;
  const stickInertiaMaxDeg = Math.max(0, config.stickInertiaMaxDeg ?? DEFAULTS.stickInertiaMaxDeg ?? 10);
  const stickInertiaMax = (stickInertiaMaxDeg * Math.PI) / 180;
  const stickInertiaFactor = clamp(config.stickInertiaFactor ?? DEFAULTS.stickInertiaFactor ?? 0.25, 0, 1);
  const stickInertiaSpeedThreshold = Math.max(
    0,
    config.stickInertiaSpeedThreshold
      ?? DEFAULTS.stickInertiaSpeedThreshold
      ?? (maxSpeed * 0.2)
  );
  const stickClampSoftness = clamp(
    config.stickClampSoftness
      ?? config.stickAngleLimitSoftness
      ?? DEFAULTS.stickClampSoftness
      ?? DEFAULTS.stickAngleLimitSoftness
      ?? 0,
    0,
    1
  );
  const prevAimAngle = Number.isFinite(state.aimAngle) ? state.aimAngle : state.bodyAngle!;
  const rawDiff = wrapToPi(aimAngleRaw - state.bodyAngle!);
  const isBehind = Math.abs(rawDiff) > stickBehindStart;
  const targetSide: -1 | 1 = rawDiff >= 0 ? 1 : -1;
  if (stickAngleLimitEnabled && isBehind) {
    if (targetSide !== state.stickSide && Math.abs(rawDiff) > (stickBehindStart + stickSideFlipHysteresis)) {
      state.stickSide = targetSide;
    }
  } else if (!stickAngleLimitEnabled || Math.abs(rawDiff) <= maxStickAngleFromBody) {
    state.stickSide = targetSide;
  }
  let diffClampedHard = rawDiff;
  if (stickAngleLimitEnabled) {
    if (Math.abs(rawDiff) <= maxStickAngleFromBody) {
      diffClampedHard = rawDiff;
    } else if (isBehind) {
      diffClampedHard = state.stickSide * maxStickAngleFromBody;
    } else {
      const excess = Math.abs(rawDiff) - maxStickAngleFromBody;
      const relMag = maxStickAngleFromBody + excess * stickClampSoftness;
      diffClampedHard = Math.sign(rawDiff || state.stickSide) * relMag;
    }
  }
  const diffClamped = diffClampedHard;
  const clampedAim = wrapToPi(state.bodyAngle! + diffClamped);
  let targetAim = clampedAim;
  let targetSlewActive = false;
  let aimAngle = clampedAim;
  let activeMode: 'TAU' | 'SPRING' | 'APPROACH' = 'APPROACH';
  let stickAngVelClamped = false;
  if (!Number.isFinite(state.stickAngVel)) state.stickAngVel = 0;
  if (stickInertiaEnabled) {
    const speedNow = Math.hypot(state.vx, state.vy);
    if (speedNow > stickInertiaSpeedThreshold) {
      const speedNormInertia = clamp(
        (speedNow - stickInertiaSpeedThreshold) / Math.max(1, maxSpeed - stickInertiaSpeedThreshold),
        0,
        1
      );
      const moveDir = Math.atan2(state.vy, state.vx);
      const inertiaErr = wrapToPi(moveDir - prevAimAngle);
      const inertiaBias = clamp(inertiaErr, -stickInertiaMax, stickInertiaMax) * stickInertiaFactor * speedNormInertia;
      targetAim = wrapToPi(clampedAim + inertiaBias);
    }
  }
  if (stickTargetSlewRateActive > 0) {
    const targetSlewed = approachAngle(prevAimAngle, targetAim, stickTargetSlewRateActive * simDt);
    targetSlewActive = Math.abs(wrapToPi(targetAim - targetSlewed)) > 1e-6;
    targetAim = targetSlewed;
  }
  let tauMsActive = (stickAngleLimitEnabled && isBehind) ? stickTauMsBehind : stickTauMs;
  if (stickTrickBoostEnabled) {
    tauMsActive = lerp(stickTrickTauNearMs, stickTrickTauFarMs, aimDistance01);
  }
  const tauModeActive = stickUseTauSmoothing && tauMsActive > 0;

  if (stickUseSpring && !tauModeActive) {
    const err = wrapToPi(targetAim - prevAimAngle);
    let stickAngVel = state.stickAngVel ?? 0;
    stickAngVel += (err * stickSpringK - stickAngVel * stickDamping) * simDt;
    if (stickMaxAngVel > 0) {
      const beforeClamp = stickAngVel;
      stickAngVel = clamp(stickAngVel, -stickMaxAngVel, stickMaxAngVel);
      stickAngVelClamped = Math.abs(beforeClamp - stickAngVel) > 1e-9;
    }
    state.stickAngVel = stickAngVel;
    aimAngle = wrapToPi(prevAimAngle + stickAngVel * simDt);
    activeMode = 'SPRING';
  } else {
    state.stickAngVel = 0;
  }
  if (tauModeActive) {
    const tauSec = tauMsActive / 1000;
    const alphaRaw = 1 - Math.exp(-simDt / Math.max(0.0001, tauSec));
    const alpha = clamp(Math.max(alphaRaw, stickTauMinAlpha), 0, 1);
    aimAngle = lerpAngle(prevAimAngle, targetAim, alpha);
    activeMode = 'TAU';
  } else if (!stickUseSpring && stickAngleLimitEnabled && isBehind) {
    let behindRate = stickBehindTurnRate;
    if (stickBehindEase > 0) {
      const delta = Math.abs(wrapToPi(targetAim - prevAimAngle));
      if (delta < stickBehindEase) {
        behindRate = Math.max(stickBehindTurnRateMin, stickBehindTurnRate * (delta / Math.max(0.0001, stickBehindEase)));
      }
    }
    if (stickBehindTauSec > 0) {
      const alpha = 1 - Math.exp(-simDt / Math.max(0.0001, stickBehindTauSec));
      aimAngle = lerpAngle(prevAimAngle, targetAim, clamp(alpha, 0, 1));
      activeMode = 'TAU';
    } else {
      aimAngle = approachAngle(prevAimAngle, targetAim, behindRate * simDt);
      activeMode = 'APPROACH';
    }
  }
  state.aimAngleRaw = aimAngleRaw;
  state.aimAngle = aimAngle;
  state.heading = state.moveAngle;
  state.debugStickDeltaDeg = Math.abs(wrapToPi(targetAim - aimAngle)) * (180 / Math.PI);
  state.debugStickAngVelDeg = Math.abs(wrapToPi(aimAngle - prevAimAngle)) * (180 / Math.PI) / Math.max(0.0001, simDt);
  state.debugStickAngVelClamped = stickAngVelClamped;
  state.debugStickTargetSlewActive = targetSlewActive;
  state.debugStickMode = activeMode;
  state.debugTargetAimAngle = targetAim;
  state.debugBaseBodyAngle = state.baseBodyAngle;
  state.debugBodyYawOffset = state.bodyYawOffset;

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
  const velocityAngleNow = finalSpeedNow > 0.001 ? Math.atan2(state.vy, state.vx) : debugHeading;
  state.debugVelForward = state.vx * dhx + state.vy * dhy;
  state.debugVelSide = state.vx * (-dhy) + state.vy * dhx;
  state.debugAimAngleRaw = state.aimAngleRaw;
  state.debugAimAngleClamped = state.aimAngle;
  state.debugAimDiffRaw = rawDiff;
  state.debugAimDiffClamped = wrapToPi(state.aimAngle - state.bodyAngle!);
  state.debugDesiredMoveAngle = desiredMoveAngleDebug;
  state.debugMoveTurnRateAppliedDeg = moveTurnRate * (180 / Math.PI);
  state.debugVelocityDesiredDeltaDeg = wrapToPi(desiredMoveAngleDebug - velocityAngleNow) * (180 / Math.PI);
}

