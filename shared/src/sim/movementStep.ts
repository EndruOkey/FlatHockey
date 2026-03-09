import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { resetMovementDebugState } from './movementStepDebug';
import { applyHeadingTractionStep } from './movementExperimentalSolver';
import { approachScalar, clamp, expBlend, lerp, lerpAngle, smoothstep01, wrapToPi } from './movementMath';
import { ensureMovementStateBase } from './movementStateInit';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

export type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';
export { approachAngle, wrapToPi } from './movementMath';

const BASE_DEFAULTS: MovementStepConfig = { ...MOVEMENT_DEFAULTS };
export const DEFAULTS: MovementStepConfig = { ...BASE_DEFAULTS };

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
  resetMovementDebugState(state);

  const rawX = clamp(input.moveX, -1, 1);
  const rawY = clamp(input.moveY, -1, 1);
  const inputLen = Math.hypot(rawX, rawY);
  const hasInput = inputLen > 0.0001;
  const inputNx = hasInput ? rawX / inputLen : 0;
  const inputNy = hasInput ? rawY / inputLen : 0;
  state.debugRawInputX = rawX;
  state.debugRawInputY = rawY;
  ensureMovementStateBase(state);
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

  state.stamina = clamp(state.stamina + (config.staminaRegen ?? DEFAULTS.staminaRegen!) * simDt, 0, 1);
  const sprinting = false;
  const maxSpeedAlias = config.maxSpeed;
  const maxSpeedBase = maxSpeedAlias
    ?? (hasPuck ? (config.maxSpeedWithPuck ?? DEFAULTS.maxSpeedWithPuck!) : (config.maxSpeedNoPuck ?? DEFAULTS.maxSpeedNoPuck!));
  const sprintMul = hasPuck ? (config.sprintMulWithPuck ?? DEFAULTS.sprintMulWithPuck!) : (config.sprintMulNoPuck ?? DEFAULTS.sprintMulNoPuck!);
  const maxSpeed = Math.max(1, maxSpeedBase * (sprinting ? sprintMul : 1));

  const speed = Math.hypot(state.vx, state.vy);
  const speedNorm = clamp(speed / maxSpeed, 0, 1);
  const controlScheme = config.controlScheme ?? DEFAULTS.controlScheme ?? 'WASD_MOVE_MOUSE_AIM';
  const mouseDrivesMove = controlScheme === 'MOUSE_DRIVES_MOVE';
  const bodyOrientationModel = (config.bodyOrientationModel ?? DEFAULTS.bodyOrientationModel ?? 'B') === 'C' ? 'C' : 'B';
  const bodyTurnRateBase = Math.max(0, config.bodyTurnRate ?? DEFAULTS.bodyTurnRate ?? DEFAULTS.maxTurnRateLowSpeed ?? 10);
  const bodyTurnRateLowSpeedMult = Math.max(0, config.bodyTurnRateLowSpeedMult ?? DEFAULTS.bodyTurnRateLowSpeedMult ?? 1);
  const bodyTurnRate = bodyTurnRateBase * lerp(bodyTurnRateLowSpeedMult, 1, speedNorm);
  const bodyAimBias = clamp(config.bodyAimBias ?? DEFAULTS.bodyAimBias ?? 0.18, 0, 0.5);
  const bodyAimResponseTauMs = Math.max(1, config.bodyAimResponseTauMs ?? DEFAULTS.bodyAimResponseTauMs ?? 160);
  const bodyTurnInput = 0;
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
  const manualTurningActive = false;

  let desiredMoveAngleDebug = Number.isFinite(state.moveAngle) ? state.moveAngle! : 0;
  const prevMoveAngle = state.moveAngle!;
  const rawDesiredMoveAngle = hasInput
    ? wrapToPi((mouseDrivesMove && Number.isFinite(inputAimRaw)) ? inputAimRaw : Math.atan2(inputNy, inputNx))
    : state.moveAngle!;
  state.debugRawInputAngle = rawDesiredMoveAngle;
  let turnIntentAngle = state.moveAngle!;
  let turnResistance = 0;

  const result = applyHeadingTractionStep({
    state,
    input,
    dt: simDt,
    config,
    rawInputX: rawX,
    rawInputY: rawY,
    hasInput,
    prevMoveAngle
  });
  desiredMoveAngleDebug = result.desiredMoveAngle;
  turnIntentAngle = result.turnIntentAngle;
  turnResistance = result.turnResistance;

  let baseBodyAngle = Number.isFinite(state.baseBodyAngle) ? state.baseBodyAngle! : state.bodyAngle!;
  const speedNow = Math.hypot(state.vx, state.vy);
  const bodySpeedMin = Math.max(0, config.bodySpeedMin ?? DEFAULTS.bodySpeedMin ?? config.bodyBaseSpeedThreshold ?? DEFAULTS.bodyBaseSpeedThreshold ?? 35);
  const bodySpeedMax = Math.max(bodySpeedMin + 1, config.bodySpeedMax ?? DEFAULTS.bodySpeedMax ?? 280);
  const bodyAimWeightLowSpeed = clamp(config.bodyAimWeightLowSpeed ?? DEFAULTS.bodyAimWeightLowSpeed ?? 0.9, 0, 1);
  const bodyAimWeightHighSpeed = clamp(config.bodyAimWeightHighSpeed ?? DEFAULTS.bodyAimWeightHighSpeed ?? 0.25, 0, 1);
  const velocityAngleNow = speedNow > 0.001 ? Math.atan2(state.vy, state.vx) : baseBodyAngle;
  const moveTargetAngle = hasInput ? state.moveAngle! : baseBodyAngle;
  const velocityInfluence = smoothstep01((speedNow - bodySpeedMin) / Math.max(bodySpeedMax - bodySpeedMin, 1));
  const movementBodyTargetAngle = lerpAngle(moveTargetAngle, velocityAngleNow, velocityInfluence);
  let rawBodyTargetAngle = movementBodyTargetAngle;
  let effectiveAimBias = 0;
  if (bodyOrientationModel === 'C') {
    const hybridAimAngle = wrapToPi(inputAimRaw);
    const aimBlendBySpeed = lerp(bodyAimWeightLowSpeed, bodyAimWeightHighSpeed, velocityInfluence);
    const aimFocus = clamp(input.aimDistance01 ?? 1, 0, 1);
    effectiveAimBias = clamp(aimBlendBySpeed * lerp(0.5, 1, aimFocus), 0, 1);
    rawBodyTargetAngle = lerpAngle(movementBodyTargetAngle, hybridAimAngle, effectiveAimBias);
  }
  if (!Number.isFinite(state.bodyTargetAngle)) {
    state.bodyTargetAngle = rawBodyTargetAngle;
  }
  const bodyTargetRate = bodyOrientationModel === 'C'
    ? lerp(bodyTurnRate * 0.65, 1000 / bodyAimResponseTauMs, effectiveAimBias)
    : bodyTurnRate * 0.65;
  const bodyTargetAlpha = expBlend(bodyTargetRate, simDt);
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
  state.heading = Number.isFinite(state.heading) ? state.heading : turnIntentAngle;
  state.debugStickDeltaDeg = Math.abs(wrapToPi(targetAim - aimAngle)) * (180 / Math.PI);
  state.debugStickAngVelDeg = Math.abs(stickAngVel) * (180 / Math.PI);
  state.debugStickAngVelClamped = stickAngVelClamped;
  state.debugStickTargetSlewActive = false;
  state.debugStickMode = 'TAU';
  state.debugTargetAimAngle = targetAim;
  state.debugBaseBodyAngle = state.baseBodyAngle;
  state.debugBodyYawOffset = state.bodyYawOffset;
  state.debugBodyTurnInput = bodyTurnInput;
  state.debugActiveBodyModel = bodyOrientationModel;

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
  state.debugTurnIntentAngle = turnIntentAngle;
  state.debugVelocityDesiredDeltaDeg = wrapToPi(desiredMoveAngleDebug - debugVelocityAngle) * (180 / Math.PI);
  state.debugTurnResistance = turnResistance;
  state.movementModelActive = 'DESIRED_HEADING_TRACTION';
}


