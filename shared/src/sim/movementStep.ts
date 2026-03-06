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
  bodyTargetAngle?: number;
  bodyManualAngVel?: number;
  stickSide?: -1 | 1;
  stickLocalAngle?: number;
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
  debugBodyTurnInput?: number;
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
  brakeTurnRateBoost?: number;
  brakeLateralDamping?: number;

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
  stickAngularSpeedDeg?: number; // friendlier alias for max angular speed
  stickMaxAngVelDeg?: number; // deg/s
  stickBodyBias?: number; // 0..0.35 blend from cursor toward body posture
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

function expBlend(rate: number, dt: number): number {
  return clamp(1 - Math.exp(-Math.max(0, rate) * dt), 0, 1);
}

function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
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
  let brakeAssistLeft = 0;
  let startLinearActive = false;
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
  state.debugBodyTurnInput = 0;

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
  if (!Number.isFinite(state.stickLocalAngle)) {
    const fallbackAim = Number.isFinite(state.aimAngle) ? state.aimAngle! : state.bodyAngle!;
    state.stickLocalAngle = wrapToPi(fallbackAim - state.bodyAngle!);
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
  const accelBase = config.accel ?? DEFAULTS.accel!;
  const accelSprint = config.sprintAccel ?? config.accel ?? DEFAULTS.sprintAccel ?? accelBase;
  const accel = sprinting ? accelSprint : accelBase;
  const dragMove = Math.max(0, config.dragMove ?? DEFAULTS.dragMove!);
  const dragIdle = Math.max(0, config.dragIdle ?? DEFAULTS.dragIdle!);
  const brakeDrag = Math.max(0, config.brakeDrag ?? DEFAULTS.brakeDrag!);
  const lateralDamping = Math.max(0, config.lateralDamping ?? DEFAULTS.lateralDamping!);
  const brakeLateralDamping = Math.max(
    lateralDamping,
    config.brakeLateralDamping ?? DEFAULTS.brakeLateralDamping ?? lateralDamping * 2
  );

  const headingOn = config.headingModeEnabled ?? DEFAULTS.headingModeEnabled!;
  const controlScheme = config.controlScheme ?? DEFAULTS.controlScheme ?? 'WASD_MOVE_MOUSE_AIM';
  const mouseDrivesMove = controlScheme === 'MOUSE_DRIVES_MOVE';
  const bodyTurnRateBase = Math.max(0, config.bodyTurnRate ?? DEFAULTS.bodyTurnRate ?? DEFAULTS.maxTurnRateLowSpeed ?? 10);
  const bodyTurnRateLowSpeedMult = Math.max(0, config.bodyTurnRateLowSpeedMult ?? DEFAULTS.bodyTurnRateLowSpeedMult ?? 1);
  const bodyTurnRate = bodyTurnRateBase * lerp(bodyTurnRateLowSpeedMult, 1, speedNorm);
  const moveTurnRateLow = Math.max(0, config.maxTurnRateLowSpeed ?? DEFAULTS.maxTurnRateLowSpeed ?? bodyTurnRateBase);
  const moveTurnRateHigh = Math.max(0, config.maxTurnRateHighSpeed ?? DEFAULTS.maxTurnRateHighSpeed ?? moveTurnRateLow);
  const moveTurnRateBase = lerp(moveTurnRateLow, moveTurnRateHigh, speedNorm);
  const brakeTurnRateBoost = Math.max(1, config.brakeTurnRateBoost ?? DEFAULTS.brakeTurnRateBoost ?? 1);
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
  const manualTurningActive = Math.abs(bodyTurnInput) > 0.0001;

  let desiredMoveAngleDebug = Number.isFinite(state.moveAngle) ? state.moveAngle! : 0;
  if (!headingOn) {
    state.moveAngle = Math.hypot(state.vx, state.vy) > 0.01 ? Math.atan2(state.vy, state.vx) : state.moveAngle!;
  }
  const desiredMoveAngle = hasInput
    ? wrapToPi((mouseDrivesMove && Number.isFinite(inputAimRaw)) ? inputAimRaw : Math.atan2(inputNy, inputNx))
    : state.moveAngle!;
  desiredMoveAngleDebug = desiredMoveAngle;
  const velocityAngleBeforeTurn = speed > 0.001 ? Math.atan2(state.vy, state.vx) : state.moveAngle!;
  const desiredVsVelocity = Math.abs(wrapToPi(desiredMoveAngle - velocityAngleBeforeTurn));
  const oppositeRedirect01 = clamp((desiredVsVelocity - Math.PI * 0.42) / (Math.PI * 0.58), 0, 1);
  const oppositeTurnPenalty = lerp(1, input.buttons.brake ? 0.78 : 0.42, oppositeRedirect01);
  const moveTurnRate = moveTurnRateBase * oppositeTurnPenalty * (input.buttons.brake ? brakeTurnRateBoost : 1);
  if (hasInput) {
    state.moveAngle = approachAngle(state.moveAngle!, desiredMoveAngle, moveTurnRate * simDt);
  }
  const movementHeading = state.moveAngle!;
  const hx = Math.cos(movementHeading);
  const hy = Math.sin(movementHeading);
  const rx = -hy;
  const ry = hx;

  if (hasInput) {
    const velocityAngle = speed > 0.001 ? Math.atan2(state.vy, state.vx) : movementHeading;
    const headingVsVelocity = Math.abs(wrapToPi(movementHeading - velocityAngle));
    const redirectResistance01 = clamp((headingVsVelocity - Math.PI * 0.35) / (Math.PI * 0.65), 0, 1);
    const redirectAccelFloor = input.buttons.brake ? 0.36 : 0.06;
    const redirectAccelScale = lerp(1, redirectAccelFloor, redirectResistance01 * speedNorm);
    state.vx += hx * accel * redirectAccelScale * simDt;
    state.vy += hy * accel * redirectAccelScale * simDt;
  }

  const baseDrag = hasInput ? dragMove : dragIdle;
  const dragFactor = Math.exp(-baseDrag * simDt);
  state.vx *= dragFactor;
  state.vy *= dragFactor;

  const velocityAngleAfterDrag = Math.hypot(state.vx, state.vy) > 0.001
    ? Math.atan2(state.vy, state.vx)
    : movementHeading;
  const slipBlendRedirect = smoothstep01(speedNorm * (desiredVsVelocity / Math.PI) * (input.buttons.brake ? 0.45 : 1.25));
  const slipReferenceAngle = hasInput
    ? lerpAngle(movementHeading, velocityAngleAfterDrag, slipBlendRedirect)
    : velocityAngleAfterDrag;
  const sx = Math.cos(slipReferenceAngle);
  const sy = Math.sin(slipReferenceAngle);
  const tx = -sy;
  const ty = sx;

  let forward = state.vx * sx + state.vy * sy;
  let side = state.vx * tx + state.vy * ty;
  const sideDamping = input.buttons.brake ? brakeLateralDamping : lateralDamping;
  side *= Math.exp(-sideDamping * simDt);

  if (input.buttons.brake) {
    const brakeFactor = Math.exp(-brakeDrag * simDt);
    forward *= brakeFactor;
    side *= brakeFactor;
  }

  state.vx = sx * forward + tx * side;
  state.vy = sy * forward + ty * side;

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
  const speedNow = Math.hypot(state.vx, state.vy);
  const bodyBaseSpeedThreshold = Math.max(0, config.bodyBaseSpeedThreshold ?? DEFAULTS.bodyBaseSpeedThreshold ?? 51.375);
  const velocityAngleNow = speedNow > 0.001 ? Math.atan2(state.vy, state.vx) : baseBodyAngle;
  const moveTargetAngle = hasInput ? state.moveAngle! : baseBodyAngle;
  const velocityInfluence = smoothstep01((speedNow - bodyBaseSpeedThreshold) / Math.max(bodyBaseSpeedThreshold * 2.2, 1));
  const rawBodyTargetAngle = lerpAngle(moveTargetAngle, velocityAngleNow, velocityInfluence);
  if (!Number.isFinite(state.bodyTargetAngle)) {
    state.bodyTargetAngle = rawBodyTargetAngle;
  }
  const bodyTargetAlpha = expBlend(bodyTurnRate * 0.65, simDt);
  state.bodyTargetAngle = lerpAngle(state.bodyTargetAngle!, rawBodyTargetAngle, bodyTargetAlpha);
  const bodyTurnAlpha = expBlend(bodyTurnRate * 0.78, simDt);
  const bodyDeadzone = (1.5 * Math.PI) / 180;
  if (Math.abs(wrapToPi(state.bodyTargetAngle! - baseBodyAngle)) > bodyDeadzone) {
    baseBodyAngle = lerpAngle(baseBodyAngle, state.bodyTargetAngle!, bodyTurnAlpha);
  }

  let bodyYawOffset = clamp(Number.isFinite(state.bodyYawOffset) ? state.bodyYawOffset! : 0, -maxBodyYawOffset, maxBodyYawOffset);
  const yawTargetOffset = manualTurningActive ? bodyTurnInput * maxBodyYawOffset : 0;
  const yawRate = manualTurningActive ? bodyYawSpeed : bodyYawReturnSpeed;
  const yawAlpha = maxBodyYawOffset > 0.0001 ? expBlend(yawRate / maxBodyYawOffset, simDt) : 1;
  bodyYawOffset = clamp(bodyYawOffset + (yawTargetOffset - bodyYawOffset) * yawAlpha, -maxBodyYawOffset, maxBodyYawOffset);
  state.baseBodyAngle = baseBodyAngle;
  state.bodyYawOffset = bodyYawOffset;
  state.bodyAngle = wrapToPi(baseBodyAngle + bodyYawOffset);
  state.bodyManualAngVel = manualTurningActive ? bodyTurnInput * bodyYawSpeed : 0;

  const stickReferenceAngle = state.baseBodyAngle!;
  const aimAngleRaw = wrapToPi(inputAimRaw);
  const stickAngleLimitEnabled = config.stickAngleLimitEnabled ?? DEFAULTS.stickAngleLimitEnabled ?? true;
  const maxStickAngleFromBodyDeg = Math.max(0, config.maxStickAngleFromBodyDeg ?? DEFAULTS.maxStickAngleFromBodyDeg ?? 95);
  const maxStickAngleFromBody = (maxStickAngleFromBodyDeg * Math.PI) / 180;
  const stickClampSoftness = clamp(
    config.stickClampSoftness
      ?? config.stickAngleLimitSoftness
      ?? DEFAULTS.stickClampSoftness
      ?? DEFAULTS.stickAngleLimitSoftness
      ?? 0.25,
    0,
    1
  );
  const stickBodyBias = clamp(config.stickBodyBias ?? DEFAULTS.stickBodyBias ?? 0.12, 0, 0.35);
  const stickTauMs = Math.max(0, config.stickTauMs ?? DEFAULTS.stickTauMs ?? 180);
  const stickTauMinAlpha = clamp(config.stickTauMinAlpha ?? DEFAULTS.stickTauMinAlpha ?? 0.02, 0, 1);
  const stickAngularSpeedDeg = Math.max(
    0,
    config.stickAngularSpeedDeg
      ?? config.stickMaxAngVelDeg
      ?? DEFAULTS.stickAngularSpeedDeg
      ?? DEFAULTS.stickMaxAngVelDeg
      ?? 900
  );
  const prevStickDiff = clamp(
    Number.isFinite(state.stickLocalAngle) ? state.stickLocalAngle! : 0,
    -maxStickAngleFromBody,
    maxStickAngleFromBody
  );
  const bodyTurnDelta = Math.abs(wrapToPi(stickReferenceAngle - baseBodyAngle));
  const rawDiff = wrapToPi(aimAngleRaw - stickReferenceAngle);
  const biasedTargetDiff = rawDiff * (1 - stickBodyBias);
  let targetStickDiff = biasedTargetDiff;
  if (stickAngleLimitEnabled) {
    const sign = Math.sign(biasedTargetDiff || prevStickDiff || 1);
    const mag = Math.abs(biasedTargetDiff);
    const softZone = Math.max(0, Math.min(maxStickAngleFromBody * 0.35, maxStickAngleFromBody * stickClampSoftness));
    const hardStart = Math.max(0, maxStickAngleFromBody - softZone);
    if (mag <= hardStart || softZone <= 0.0001) {
      targetStickDiff = sign * Math.min(mag, maxStickAngleFromBody);
    } else {
      const t = smoothstep01((mag - hardStart) / Math.max(softZone, 0.0001));
      const curvedMag = hardStart + softZone * t;
      targetStickDiff = sign * Math.min(curvedMag, maxStickAngleFromBody);
    }
  }
  const diffDelta = Math.abs(targetStickDiff - prevStickDiff);
  const diffNorm = clamp(diffDelta / Math.max((stickAngleLimitEnabled ? maxStickAngleFromBody : Math.PI), 0.0001), 0, 1);
  const edgeNorm = stickAngleLimitEnabled
    ? clamp(Math.abs(targetStickDiff) / Math.max(maxStickAngleFromBody, 0.0001), 0, 1)
    : 0;
  const turnStabilityNorm = clamp(bodyTurnDelta / ((12 * Math.PI) / 180), 0, 1);
  const tauMsEffective = Math.max(24, lerp(stickTauMs * 1.22, stickTauMs * 0.68, diffNorm) * lerp(1, 1.18, turnStabilityNorm));
  const tauSec = tauMsEffective / 1000;
  const alphaRaw = 1 - Math.exp(-simDt / Math.max(0.0001, tauSec));
  const alpha = clamp(Math.max(alphaRaw, stickTauMinAlpha), 0, 1);
  const smoothedTargetDiff = prevStickDiff + (targetStickDiff - prevStickDiff) * alpha;
  const edgeSpeedPenalty = lerp(1, 0.82, smoothstep01((edgeNorm - 0.82) / 0.18));
  const stickAngularSpeedEffective = stickAngularSpeedDeg * lerp(0.88, 1.32, diffNorm) * edgeSpeedPenalty * lerp(1, 0.9, turnStabilityNorm);
  const stickMaxAngVel = (stickAngularSpeedEffective * Math.PI) / 180;
  const nextStickDiff = approachScalar(prevStickDiff, smoothedTargetDiff, stickMaxAngVel * simDt);
  const targetAim = wrapToPi(stickReferenceAngle + targetStickDiff);
  const aimAngle = wrapToPi(stickReferenceAngle + nextStickDiff);
  const stickAngVel = (nextStickDiff - prevStickDiff) / Math.max(0.0001, simDt);
  const stickAngVelClamped = Math.abs(smoothedTargetDiff - nextStickDiff) > 1e-6;
  state.stickAngVel = stickAngVel;
  state.stickLocalAngle = nextStickDiff;
  state.aimAngleRaw = aimAngleRaw;
  state.aimAngle = aimAngle;
  state.heading = state.moveAngle;
  state.debugStickDeltaDeg = Math.abs(wrapToPi(targetAim - aimAngle)) * (180 / Math.PI);
  state.debugStickAngVelDeg = Math.abs(stickAngVel) * (180 / Math.PI);
  state.debugStickAngVelClamped = stickAngVelClamped;
  state.debugStickTargetSlewActive = false;
  state.debugStickMode = 'TAU';
  state.debugTargetAimAngle = targetAim;
  state.debugBaseBodyAngle = state.baseBodyAngle;
  state.debugBodyYawOffset = state.bodyYawOffset;
  state.debugBodyTurnInput = bodyTurnInput;

  const finalSpeedNow = Math.hypot(state.vx, state.vy);
  state.prevHasInput = hasInput;
  state.brakeAssistLeft = brakeAssistLeft;
  state.startLinearActive = startLinearActive;
  state.debugStartModeActive = startLinearActive;
  const debugHeading = Number.isFinite(state.moveAngle)
    ? state.moveAngle!
    : (hasInput ? Math.atan2(inputNy, inputNx) : Math.atan2(state.vy, state.vx));
  const dhx = Math.cos(debugHeading);
  const dhy = Math.sin(debugHeading);
  const debugVelocityAngle = finalSpeedNow > 0.001 ? Math.atan2(state.vy, state.vx) : debugHeading;
  state.debugVelForward = state.vx * dhx + state.vy * dhy;
  state.debugVelSide = state.vx * (-dhy) + state.vy * dhx;
  state.debugAimAngleRaw = state.aimAngleRaw;
  state.debugAimAngleClamped = state.aimAngle;
  state.debugAimDiffRaw = rawDiff;
  state.debugAimDiffClamped = wrapToPi(targetAim - state.aimAngle);
  state.debugDesiredMoveAngle = desiredMoveAngleDebug;
  state.debugMoveTurnRateAppliedDeg = moveTurnRate * (180 / Math.PI);
  state.debugVelocityDesiredDeltaDeg = wrapToPi(desiredMoveAngleDebug - debugVelocityAngle) * (180 / Math.PI);
}

