import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function wrapToPi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function expBlend(ratePerSec: number, dt: number): number {
  const rate = Math.max(0, ratePerSec);
  if (rate <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

export type MovementV4Result = {
  desiredMoveAngle: number;
  turnIntentAngle: number;
  turnResistance: number;
  chargeActive: boolean;
};

type MovementV4Args = {
  state: MovementStepState;
  input: MovementStepInput;
  dt: number;
  config: MovementStepConfig;
  hasPuck: boolean;
  mouseDrivesMove: boolean;
  inputAimRaw: number;
  rawInputX: number;
  rawInputY: number;
  prevMoveAngle: number;
};

export function applyMovementV4Solver(args: MovementV4Args): MovementV4Result {
  const { state, input, dt, config, hasPuck, mouseDrivesMove, inputAimRaw, rawInputX, rawInputY, prevMoveAngle } = args;

  const simDt = clamp(dt, 0.001, 0.05);
  const rawLen = Math.hypot(rawInputX, rawInputY);
  const hasInput = rawLen > 0.0001;
  const rawNx = hasInput ? rawInputX / rawLen : 0;
  const rawNy = hasInput ? rawInputY / rawLen : 0;

  const chargeActive = !!input.buttons.sprint && !hasPuck;
  state.debugChargeActive = chargeActive;

  const inputVectorResponsiveness = Math.max(
    1,
    config.inputVectorResponsiveness
      ?? config.inputVectorTauMs
      ?? MOVEMENT_DEFAULTS.inputVectorResponsiveness
      ?? MOVEMENT_DEFAULTS.inputVectorTauMs
      ?? 95
  );
  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1500);
  const forwardMaxSpeed = Math.max(1, config.forwardMaxSpeed ?? MOVEMENT_DEFAULTS.forwardMaxSpeed ?? 342.5);
  const sideMaxSpeed = clamp(config.sideMaxSpeed ?? MOVEMENT_DEFAULTS.sideMaxSpeed ?? forwardMaxSpeed * 0.85, 1, forwardMaxSpeed);
  const reverseMaxSpeed = clamp(config.reverseMaxSpeed ?? MOVEMENT_DEFAULTS.reverseMaxSpeed ?? forwardMaxSpeed * 0.7, 1, forwardMaxSpeed);
  const turnLowSpeed = Math.max(0, config.turnLowSpeed ?? MOVEMENT_DEFAULTS.turnLowSpeed ?? 1);
  const turnHighSpeed = Math.max(0, config.turnHighSpeed ?? MOVEMENT_DEFAULTS.turnHighSpeed ?? 0.28);
  const edgeTurnBonusMax = Math.max(0, config.edgeTurnBonusMax ?? MOVEMENT_DEFAULTS.edgeTurnBonusMax ?? 0.35);
  const brakeTurnBonusValue = Math.max(0, config.brakeTurnBonusValue ?? MOVEMENT_DEFAULTS.brakeTurnBonusValue ?? 0.28);
  const oppositeSteerScale = clamp(config.oppositeSteerScale ?? MOVEMENT_DEFAULTS.oppositeSteerScale ?? 0.08, 0, 1);
  const brakeOppositeRecovery = Math.max(0, config.brakeOppositeRecovery ?? MOVEMENT_DEFAULTS.brakeOppositeRecovery ?? 0.4);
  const lateralSteerForce = Math.max(0, config.lateralSteerForce ?? MOVEMENT_DEFAULTS.lateralSteerForce ?? 620);
  const baseLateralDamping = Math.max(0, config.baseLateralDamping ?? MOVEMENT_DEFAULTS.baseLateralDamping ?? 0.18);
  const maxLateralDamping = Math.max(baseLateralDamping, config.maxLateralDamping ?? MOVEMENT_DEFAULTS.maxLateralDamping ?? 1.35);
  const brakeLateralDampingBonus = Math.max(0, config.brakeLateralDampingBonus ?? MOVEMENT_DEFAULTS.brakeLateralDampingBonus ?? 0.65);
  const carveLossStrength = Math.max(0, config.carveLossStrength ?? MOVEMENT_DEFAULTS.carveLossStrength ?? 0.42);
  const glideDrag = Math.max(0, config.glideDrag ?? MOVEMENT_DEFAULTS.glideDrag ?? 0.96909);
  const moveDrag = Math.max(0, config.moveDrag ?? MOVEMENT_DEFAULTS.moveDrag ?? 2.6);
  const brakeDrag = Math.max(0, config.brakeDrag ?? MOVEMENT_DEFAULTS.brakeDrag ?? 4.8);
  const velocityTurnResistance = Math.max(0, config.velocityTurnResistance ?? MOVEMENT_DEFAULTS.velocityTurnResistance ?? 1.2);
  const antiFlipWindowSec = Math.max(0, (config.antiFlipWindowMs ?? MOVEMENT_DEFAULTS.antiFlipWindowMs ?? 220) / 1000);
  const antiFlipPenalty = clamp(config.antiFlipPenalty ?? MOVEMENT_DEFAULTS.antiFlipPenalty ?? 0.72, 0, 0.95);
  const chargeSpeedMul = Math.max(1, config.chargeSpeedMul ?? MOVEMENT_DEFAULTS.chargeSpeedMul ?? 1.2);
  const chargeAccelMul = Math.max(1, config.chargeAccelMul ?? MOVEMENT_DEFAULTS.chargeAccelMul ?? 1.25);
  const chargeTurnMul = clamp(config.chargeTurnMul ?? MOVEMENT_DEFAULTS.chargeTurnMul ?? 0.55, 0.1, 1);
  const chargeLateralGripMul = clamp(config.chargeLateralGripMul ?? MOVEMENT_DEFAULTS.chargeLateralGripMul ?? 0.7, 0.1, 1);

  const rawTargetAngle = hasInput
    ? wrapToPi(mouseDrivesMove ? inputAimRaw : Math.atan2(rawNy, rawNx))
    : (state.moveAngle ?? 0);
  const rawTargetX = Math.cos(rawTargetAngle);
  const rawTargetY = Math.sin(rawTargetAngle);

  const desiredRate = 1000 / inputVectorResponsiveness;
  const desiredAlpha = expBlend(desiredRate, simDt);
  const filteredXRaw = (state.desiredDirX ?? rawTargetX) + (rawTargetX - (state.desiredDirX ?? rawTargetX)) * desiredAlpha;
  const filteredYRaw = (state.desiredDirY ?? rawTargetY) + (rawTargetY - (state.desiredDirY ?? rawTargetY)) * desiredAlpha;
  const filteredMag = Math.hypot(filteredXRaw, filteredYRaw);
  let filteredX = rawTargetX;
  let filteredY = rawTargetY;
  if (filteredMag > 0.0001) {
    filteredX = filteredXRaw / filteredMag;
    filteredY = filteredYRaw / filteredMag;
    state.desiredDirX = filteredX;
    state.desiredDirY = filteredY;
  } else {
    state.desiredDirX = rawTargetX;
    state.desiredDirY = rawTargetY;
    filteredX = rawTargetX;
    filteredY = rawTargetY;
  }

  const speedBefore = Math.hypot(state.vx, state.vy);
  const speedNorm = clamp(speedBefore / Math.max(forwardMaxSpeed, 1), 0, 1);
  state.pendingDirX = filteredX;
  state.pendingDirY = filteredY;

  let committedX = state.committedDirX ?? filteredX;
  let committedY = state.committedDirY ?? filteredY;
  const committedMag = Math.hypot(committedX, committedY);
  if (committedMag > 0.0001) {
    committedX /= committedMag;
    committedY /= committedMag;
  } else {
    committedX = filteredX;
    committedY = filteredY;
  }

  const dotPendingCommitted = clamp(committedX * filteredX + committedY * filteredY, -1, 1);
  const sharpFlipIntent = hasInput && dotPendingCommitted < -0.42;
  let antiFlipLeft = Math.max(0, state.antiFlipTimer ?? 0);
  const shouldGateFlip = !input.buttons.brake && speedNorm > 0.15 && sharpFlipIntent;
  if (shouldGateFlip && antiFlipLeft <= 0) {
    antiFlipLeft = antiFlipWindowSec * lerp(0.75, 1.35, speedNorm);
  }
  antiFlipLeft = Math.max(0, antiFlipLeft - simDt);
  state.antiFlipTimer = antiFlipLeft;
  state.debugAntiFlipActive = antiFlipLeft > 0.0001;

  const commitPenalty = antiFlipLeft > 0.0001
    ? lerp(1 - antiFlipPenalty, 0.75, input.buttons.brake ? 1 : 0)
    : 1;
  const commitAlpha = clamp(desiredAlpha * commitPenalty, 0.01, 1);
  committedX += (filteredX - committedX) * commitAlpha;
  committedY += (filteredY - committedY) * commitAlpha;
  const committedNextMag = Math.hypot(committedX, committedY);
  if (committedNextMag > 0.0001) {
    committedX /= committedNextMag;
    committedY /= committedNextMag;
  } else {
    committedX = filteredX;
    committedY = filteredY;
  }
  state.committedDirX = committedX;
  state.committedDirY = committedY;

  const desiredMoveAngle = Math.atan2(committedY, committedX);
  state.inputAngle = desiredMoveAngle;
  state.lastRawInputAngle = rawTargetAngle;
  state.debugRawInputAngle = rawTargetAngle;
  state.debugDesiredInputX = committedX;
  state.debugDesiredInputY = committedY;
  state.debugFilteredInputX = filteredX;
  state.debugFilteredInputY = filteredY;
  const velDirAngle = speedBefore > 0.001 ? Math.atan2(state.vy, state.vx) : desiredMoveAngle;
  const fx = Math.cos(velDirAngle);
  const fy = Math.sin(velDirAngle);
  const sx = -fy;
  const sy = fx;
  const intentForward = fx * committedX + fy * committedY;
  const intentSide = sx * committedX + sy * committedY;
  const desiredVsVelocity = Math.abs(wrapToPi(desiredMoveAngle - velDirAngle));
  const angleNorm = clamp(desiredVsVelocity / Math.PI, 0, 1);
  const edgeFactor = clamp(0.08 + angleNorm * lerp(0.22, 0.76, speedNorm) + (input.buttons.brake ? 0.26 : 0), 0, 1);
  state.debugEdgeFactor = edgeFactor;

  const turnResistance = clamp(
    smoothstep01((desiredVsVelocity - Math.PI * 0.06) / (Math.PI * 0.94)) * speedNorm * velocityTurnResistance,
    0,
    1
  );
  const oppositeScale = input.buttons.brake
    ? clamp(oppositeSteerScale + brakeOppositeRecovery, 0, 1)
    : oppositeSteerScale;
  const forwardInput = intentForward >= 0 ? intentForward : intentForward * oppositeScale;
  const baseTurnAuthority = lerp(turnLowSpeed, turnHighSpeed, speedNorm);
  const turnAuthority = clamp(
    (baseTurnAuthority + edgeTurnBonusMax * edgeFactor + (input.buttons.brake ? brakeTurnBonusValue : 0)) * (1 - turnResistance),
    0.02,
    1.25
  );
  const alternatingPenalty = lerp(1, 0.55, clamp((1 - dotPendingCommitted) * 0.5 * speedNorm, 0, 1));
  const lateralAuthority = clamp(turnAuthority * alternatingPenalty * (chargeActive ? chargeTurnMul : 1), 0.02, 1);
  const appliedForwardForce = forwardAccel * (chargeActive ? chargeAccelMul : 1) * forwardInput;
  const appliedLateralForce = lateralSteerForce * intentSide * lateralAuthority;
  state.debugAppliedForwardForce = hasInput ? appliedForwardForce : 0;
  state.debugAppliedLateralForce = hasInput ? appliedLateralForce : 0;
  state.debugRedirectAccelScale = lateralAuthority;

  if (hasInput) {
    state.vx += (fx * appliedForwardForce + sx * appliedLateralForce) * simDt;
    state.vy += (fy * appliedForwardForce + sy * appliedLateralForce) * simDt;
  }

  const directionalSpeedScale = (() => {
    if (!hasInput) return 1;
    if (intentForward >= 0) return lerp(sideMaxSpeed / forwardMaxSpeed, 1, intentForward);
    return lerp(sideMaxSpeed / forwardMaxSpeed, reverseMaxSpeed / forwardMaxSpeed, -intentForward);
  })();
  const localMaxSpeed = Math.max(1, forwardMaxSpeed * directionalSpeedScale * (chargeActive ? chargeSpeedMul : 1));
  const speedAfterForces = Math.hypot(state.vx, state.vy);
  if (speedAfterForces > localMaxSpeed) {
    const k = localMaxSpeed / Math.max(1, speedAfterForces);
    state.vx *= k;
    state.vy *= k;
  }

  const dragFactor = Math.exp(-(hasInput ? moveDrag : glideDrag) * simDt);
  state.vx *= dragFactor;
  state.vy *= dragFactor;

  const speedAfterDrag = Math.hypot(state.vx, state.vy);
  const slipRef = speedAfterDrag > 0.001 ? Math.atan2(state.vy, state.vx) : desiredMoveAngle;
  const dfx = Math.cos(slipRef);
  const dfy = Math.sin(slipRef);
  const dsx = -dfy;
  const dsy = dfx;

  let forwardVel = state.vx * dfx + state.vy * dfy;
  let lateralVel = state.vx * dsx + state.vy * dsy;
  let lateralDamping = lerp(baseLateralDamping, maxLateralDamping, edgeFactor * lerp(0.4, 1, speedNorm));
  lateralDamping *= chargeActive ? chargeLateralGripMul : 1;
  if (input.buttons.brake) lateralDamping += brakeLateralDampingBonus;
  lateralVel *= Math.exp(-lateralDamping * simDt);

  if (input.buttons.brake) {
    const brakeFactor = Math.exp(-brakeDrag * simDt);
    forwardVel *= brakeFactor;
    lateralVel *= brakeFactor;
  }

  const carveLoss = Math.exp(-carveLossStrength * edgeFactor * simDt);
  forwardVel *= carveLoss;
  state.vx = dfx * forwardVel + dsx * lateralVel;
  state.vy = dfy * forwardVel + dsy * lateralVel;

  const finalSpeed = Math.hypot(state.vx, state.vy);
  const finalMaxSpeed = Math.max(1, forwardMaxSpeed * (chargeActive ? chargeSpeedMul : 1));
  if (finalSpeed > finalMaxSpeed) {
    const k = finalMaxSpeed / finalSpeed;
    state.vx *= k;
    state.vy *= k;
  }

  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

  const speedAfterSolve = Math.hypot(state.vx, state.vy);
  const moveAngle = speedAfterSolve > 0.001 ? Math.atan2(state.vy, state.vx) : desiredMoveAngle;
  state.moveAngle = moveAngle;
  state.heading = moveAngle;
  state.debugMoveTurnRateAppliedDeg = Math.abs(wrapToPi(moveAngle - prevMoveAngle)) * (180 / Math.PI) / Math.max(simDt, 0.0001);

  return {
    desiredMoveAngle,
    turnIntentAngle: moveAngle,
    turnResistance,
    chargeActive
  };
}
