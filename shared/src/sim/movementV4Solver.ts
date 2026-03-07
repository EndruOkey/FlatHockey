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

function approachAngle(current: number, target: number, maxStep: number): number {
  const d = wrapToPi(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return wrapToPi(current + Math.sign(d) * maxStep);
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

function phaseFromSide(side: -1 | 0 | 1): 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' {
  if (side < 0) return 'CARVE_LEFT';
  if (side > 0) return 'CARVE_RIGHT';
  return 'GLIDE';
}

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

  const prevVx = state.vx;
  const prevVy = state.vy;
  const speedBefore = Math.hypot(prevVx, prevVy);
  const speedNorm = clamp(speedBefore / Math.max(forwardMaxSpeed, 1), 0, 1);
  state.pendingDirX = filteredX;
  state.pendingDirY = filteredY;
  const minSteerSpeed = Math.max(0, config.minSteerSpeed ?? MOVEMENT_DEFAULTS.minSteerSpeed ?? 55);
  const noSteerSpeedThreshold = Math.max(
    minSteerSpeed,
    config.noSteerSpeedThreshold
      ?? MOVEMENT_DEFAULTS.noSteerSpeedThreshold
      ?? config.startCommitSpeed
      ?? MOVEMENT_DEFAULTS.startCommitSpeed
      ?? 75
  );
  const startupDirHoldSec = Math.max(
    0,
    (
      config.startupDirHoldMs
      ?? MOVEMENT_DEFAULTS.startupDirHoldMs
      ?? config.startCommitMs
      ?? MOVEMENT_DEFAULTS.startCommitMs
      ?? 120
    ) / 1000
  );
  const startupInputThreshold = clamp(
    config.startupInputThreshold
      ?? MOVEMENT_DEFAULTS.startupInputThreshold
      ?? config.startInputThreshold
      ?? MOVEMENT_DEFAULTS.startInputThreshold
      ?? 0.35,
    0.05,
    1.2
  );
  const minTravelDirSpeed = Math.max(
    0.001,
    config.minTravelDirSpeed
      ?? MOVEMENT_DEFAULTS.minTravelDirSpeed
      ?? minSteerSpeed
  );
  const startupLockSpeedThreshold = Math.max(
    0.001,
    config.startupLockSpeedThreshold
      ?? MOVEMENT_DEFAULTS.startupLockSpeedThreshold
      ?? minTravelDirSpeed
  );
  const startupOppositeLockSec = Math.max(
    0,
    (config.startupOppositeLockMs ?? MOVEMENT_DEFAULTS.startupOppositeLockMs ?? 140) / 1000
  );
  const startupOppositeSuppression = clamp(
    config.startupOppositeSuppression
      ?? MOVEMENT_DEFAULTS.startupOppositeSuppression
      ?? 1.0,
    0,
    1
  );
  const startOppositeSuppression = clamp(config.startOppositeSuppression ?? MOVEMENT_DEFAULTS.startOppositeSuppression ?? 0.2, 0, 1);

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

  let startCommitLeft = Math.max(0, state.startCommitTimer ?? 0);
  let startNoInputLeft = Math.max(0, state.startNoInputTimer ?? 0);
  let startupOppositeLockLeft = Math.max(0, state.startupOppositeLockTimer ?? 0);
  let startDirX = state.startDirX ?? filteredX;
  let startDirY = state.startDirY ?? filteredY;
  const startDirMag = Math.hypot(startDirX, startDirY);
  if (startDirMag > 0.0001) {
    startDirX /= startDirMag;
    startDirY /= startDirMag;
  } else {
    startDirX = filteredX;
    startDirY = filteredY;
  }
  const lowSpeedStartupActive = speedBefore < noSteerSpeedThreshold;
  const startupOppositeLockActiveRegime = speedBefore < startupLockSpeedThreshold;
  const validStartInput = hasInput && rawLen >= startupInputThreshold;
  const releaseToRearmSec = Math.max(0.06, startupDirHoldSec * 0.45);
  if (lowSpeedStartupActive) {
    const hasStoredStartDir = Math.hypot(state.startDirX ?? 0, state.startDirY ?? 0) > 0.0001;
    if (validStartInput) {
      const canCaptureFromInput = startCommitLeft <= 0.0001 && (!hasStoredStartDir || startNoInputLeft >= releaseToRearmSec);
      if (canCaptureFromInput) {
        startDirX = filteredX;
        startDirY = filteredY;
        startCommitLeft = startupDirHoldSec;
        startupOppositeLockLeft = startupOppositeLockSec;
      }
      startNoInputLeft = 0;
    } else {
      startNoInputLeft += simDt;
      if (startNoInputLeft >= releaseToRearmSec) {
        startCommitLeft = 0;
        startupOppositeLockLeft = 0;
      }
    }
  } else {
    startCommitLeft = 0;
    startNoInputLeft = 0;
    startupOppositeLockLeft = 0;
  }
  if (startCommitLeft > 0) {
    startCommitLeft = Math.max(0, startCommitLeft - simDt);
  }
  if (startupOppositeLockLeft > 0) {
    startupOppositeLockLeft = Math.max(0, startupOppositeLockLeft - simDt);
  }
  if (speedBefore >= minTravelDirSpeed) {
    startupOppositeLockLeft = 0;
  }
  if (!startupOppositeLockActiveRegime) {
    startupOppositeLockLeft = 0;
  }
  const startCommitActive = startCommitLeft > 0.0001 && lowSpeedStartupActive;
  const startupOppositeLocked = startupOppositeLockLeft > 0.0001 && startupOppositeLockActiveRegime;
  state.startCommitTimer = startCommitLeft;
  state.startNoInputTimer = startNoInputLeft;
  state.startupOppositeLockTimer = startupOppositeLockLeft;
  state.startDirX = startDirX;
  state.startDirY = startDirY;
  state.debugStartCommitActive = startCommitActive;
  state.debugStartCommitTimer = startCommitLeft;
  state.debugStartDirX = startDirX;
  state.debugStartDirY = startDirY;
  state.debugLowSpeedStartupActive = lowSpeedStartupActive;

  const directionCommitWindowSec = Math.max(0, (config.directionCommitWindowMs ?? MOVEMENT_DEFAULTS.directionCommitWindowMs ?? 110) / 1000);
  const commitAngleThresholdRad = ((config.commitAngleThreshold ?? MOVEMENT_DEFAULTS.commitAngleThreshold ?? 70) * Math.PI) / 180;
  const oppositeThresholdRad = ((config.oppositeThreshold ?? MOVEMENT_DEFAULTS.oppositeThreshold ?? 120) * Math.PI) / 180;
  const oppositeHoldWindowSec = Math.max(0, (config.oppositeHoldMs ?? MOVEMENT_DEFAULTS.oppositeHoldMs ?? 90) / 1000);
  const carveEnterAngleRad = ((config.carveEnterAngle ?? MOVEMENT_DEFAULTS.carveEnterAngle ?? 30) * Math.PI) / 180;
  const carveExitAngleRad = ((config.carveExitAngle ?? MOVEMENT_DEFAULTS.carveExitAngle ?? 16) * Math.PI) / 180;
  const carveLockWindowSec = Math.max(0, (config.carveLockMs ?? MOVEMENT_DEFAULTS.carveLockMs ?? 140) / 1000);
  const carveSwitchCooldownSec = Math.max(0, (config.carveSwitchCooldownMs ?? MOVEMENT_DEFAULTS.carveSwitchCooldownMs ?? 70) / 1000);
  const minCarveSpeed = Math.max(0, config.minCarveSpeed ?? MOVEMENT_DEFAULTS.minCarveSpeed ?? 90);
  const carveSideSuppression = clamp(config.carveSideSuppression ?? MOVEMENT_DEFAULTS.carveSideSuppression ?? 0.22, 0, 1);
  const lowSpeedSteeringDisabled = speedBefore < minSteerSpeed;
  const lowSpeedNoSteer = lowSpeedStartupActive;
  state.debugMinSteerSpeed = minSteerSpeed;
  state.debugLowSpeedSteeringDisabled = lowSpeedSteeringDisabled;

  let commitLeft = Math.max(0, state.directionCommitTimer ?? 0);
  let oppositeHoldLeft = Math.max(0, state.oppositeHoldTimer ?? 0);

  const filteredAngle = Math.atan2(filteredY, filteredX);
  const velocityAngle = speedBefore > 0.001 ? Math.atan2(prevVy, prevVx) : filteredAngle;
  const inputVsVelocity = hasInput ? Math.abs(wrapToPi(filteredAngle - velocityAngle)) : 0;
  if (!(lowSpeedNoSteer || lowSpeedSteeringDisabled) && !startCommitActive && hasInput && inputVsVelocity > commitAngleThresholdRad && commitLeft <= 0.0001) {
    committedX = filteredX;
    committedY = filteredY;
    commitLeft = directionCommitWindowSec;
  }

  const dotInputCommitted = clamp(committedX * filteredX + committedY * filteredY, -1, 1);
  const oppositeDetected = hasInput && Math.acos(dotInputCommitted) > oppositeThresholdRad;
  const pendingX = state.pendingDirX ?? filteredX;
  const pendingY = state.pendingDirY ?? filteredY;
  const candidateStable = clamp(pendingX * filteredX + pendingY * filteredY, -1, 1) > Math.cos((22 * Math.PI) / 180);

  if (!(lowSpeedNoSteer || lowSpeedSteeringDisabled) && !startCommitActive && oppositeDetected) {
    if (oppositeHoldLeft <= 0.0001 || !candidateStable) {
      oppositeHoldLeft = oppositeHoldWindowSec;
      state.pendingDirX = filteredX;
      state.pendingDirY = filteredY;
    } else {
      oppositeHoldLeft = Math.max(0, oppositeHoldLeft - simDt);
      if (oppositeHoldLeft <= 0.0001) {
        committedX = filteredX;
        committedY = filteredY;
        commitLeft = Math.max(commitLeft, directionCommitWindowSec);
      }
    }
  } else {
    oppositeHoldLeft = 0;
    state.pendingDirX = filteredX;
    state.pendingDirY = filteredY;
  }

  const commitLocked = commitLeft > 0.0001;
  const holdLocked = oppositeHoldLeft > 0.0001;
  if ((lowSpeedNoSteer || lowSpeedSteeringDisabled || startCommitActive || (!commitLocked && !holdLocked)) && hasInput) {
    const commitAlpha = clamp(desiredAlpha, 0.04, 1);
    committedX += (filteredX - committedX) * commitAlpha;
    committedY += (filteredY - committedY) * commitAlpha;
    const committedNextMag = Math.hypot(committedX, committedY);
    if (committedNextMag > 0.0001) {
      committedX /= committedNextMag;
      committedY /= committedNextMag;
    }
  }

  if (lowSpeedNoSteer || lowSpeedSteeringDisabled || startCommitActive) {
    commitLeft = 0;
    oppositeHoldLeft = 0;
  } else {
    commitLeft = Math.max(0, commitLeft - simDt);
  }
  state.directionCommitTimer = commitLeft;
  state.oppositeHoldTimer = oppositeHoldLeft;
  state.antiFlipTimer = commitLeft;
  state.debugAntiFlipActive = commitLeft > 0.0001 || oppositeHoldLeft > 0.0001;
  state.debugCommitTimer = commitLeft;
  state.debugOppositeHoldTimer = oppositeHoldLeft;
  state.committedDirX = committedX;
  state.committedDirY = committedY;
  const steerX = lowSpeedNoSteer
    ? startDirX
    : (startCommitActive
      ? startDirX
      : ((lowSpeedSteeringDisabled || !(commitLeft > 0.0001 || oppositeHoldLeft > 0.0001)) ? filteredX : committedX));
  const steerY = lowSpeedNoSteer
    ? startDirY
    : (startCommitActive
      ? startDirY
      : ((lowSpeedSteeringDisabled || !(commitLeft > 0.0001 || oppositeHoldLeft > 0.0001)) ? filteredY : committedY));
  state.debugSteerDirX = steerX;
  state.debugSteerDirY = steerY;
  state.debugEffectiveStartDirX = steerX;
  state.debugEffectiveStartDirY = steerY;

  const desiredMoveAngle = Math.atan2(steerY, steerX);
  state.inputAngle = desiredMoveAngle;
  state.lastRawInputAngle = rawTargetAngle;
  state.debugRawInputAngle = rawTargetAngle;
  state.debugDesiredInputX = steerX;
  state.debugDesiredInputY = steerY;
  state.debugFilteredInputX = filteredX;
  state.debugFilteredInputY = filteredY;
  const stableTravelAngle = Number.isFinite(state.lastStableTravelAngle)
    ? state.lastStableTravelAngle!
    : (state.moveAngle ?? Math.atan2(startDirY, startDirX));
  const lockedTravelAngle = stableTravelAngle;
  const velDirAngle = speedBefore > 0.001
    ? Math.atan2(state.vy, state.vx)
    : (lowSpeedNoSteer ? lockedTravelAngle : desiredMoveAngle);
  const fx = Math.cos(velDirAngle);
  const fy = Math.sin(velDirAngle);
  const sx = -fy;
  const sy = fx;
  const intentForward = fx * steerX + fy * steerY;
  const intentSideRaw = (lowSpeedNoSteer || lowSpeedSteeringDisabled) ? 0 : (sx * steerX + sy * steerY);
  const signedInputVsVelocity = Math.atan2(intentSideRaw, intentForward);
  state.debugSignedInputVsVelocityAngle = signedInputVsVelocity;
  const desiredVsVelocity = Math.abs(wrapToPi(desiredMoveAngle - velDirAngle));
  const angleNorm = clamp(desiredVsVelocity / Math.PI, 0, 1);

  let movementPhase: 'GLIDE' | 'CARVE_LEFT' | 'CARVE_RIGHT' | 'BRAKE' = state.movementPhase ?? 'GLIDE';
  let carveSide: -1 | 0 | 1 = state.carveSide ?? 0;
  let carveLockLeft = Math.max(0, state.carveLockTimer ?? 0);
  let carveSwitchCooldownLeft = Math.max(0, state.carveSwitchCooldownTimer ?? 0);
  const speedCanCarve = speedBefore >= minCarveSpeed;
  const desiredCarveSide: -1 | 0 | 1 = Math.abs(signedInputVsVelocity) >= carveEnterAngleRad
    ? (signedInputVsVelocity > 0 ? 1 : -1)
    : 0;

  if (lowSpeedNoSteer || lowSpeedSteeringDisabled || startCommitActive) {
    movementPhase = 'GLIDE';
    carveSide = 0;
    carveLockLeft = 0;
    carveSwitchCooldownLeft = 0;
  } else if (input.buttons.brake) {
    movementPhase = 'BRAKE';
    carveSide = 0;
    carveLockLeft = 0;
  } else {
    carveLockLeft = Math.max(0, carveLockLeft - simDt);
    carveSwitchCooldownLeft = Math.max(0, carveSwitchCooldownLeft - simDt);
    if (!speedCanCarve || !hasInput) {
      if (Math.abs(signedInputVsVelocity) <= carveExitAngleRad && carveLockLeft <= 0.0001) {
        carveSide = 0;
        movementPhase = 'GLIDE';
      } else if (carveSide !== 0) {
        movementPhase = phaseFromSide(carveSide);
      }
    } else if (desiredCarveSide === 0) {
      if (Math.abs(signedInputVsVelocity) <= carveExitAngleRad && carveLockLeft <= 0.0001) {
        carveSide = 0;
        movementPhase = 'GLIDE';
      }
    } else if (carveSide === 0) {
      carveSide = desiredCarveSide;
      carveLockLeft = carveLockWindowSec;
      movementPhase = phaseFromSide(carveSide);
    } else if (desiredCarveSide === carveSide) {
      movementPhase = phaseFromSide(carveSide);
    } else {
      // Opposite carve switches are blocked while carve lock or switch cooldown is active.
      if (carveLockLeft <= 0.0001 && carveSwitchCooldownLeft <= 0.0001) {
        carveSide = desiredCarveSide;
        carveLockLeft = carveLockWindowSec;
        carveSwitchCooldownLeft = carveSwitchCooldownSec;
      }
      movementPhase = phaseFromSide(carveSide);
    }
  }
  state.movementPhase = movementPhase;
  state.carveSide = carveSide;
  state.carveLockTimer = carveLockLeft;
  state.carveSwitchCooldownTimer = carveSwitchCooldownLeft;
  state.debugMovementPhase = movementPhase;
  state.debugCarveLockTimer = carveLockLeft;
  state.debugCarveSide = carveSide;

  const carveLockNorm = carveLockWindowSec > 0 ? clamp(carveLockLeft / carveLockWindowSec, 0, 1) : 0;
  const carveBias = movementPhase === 'CARVE_LEFT' || movementPhase === 'CARVE_RIGHT'
    ? lerp(0.12, 0.32, carveLockNorm)
    : 0;
  const edgeFactor = (lowSpeedNoSteer || lowSpeedSteeringDisabled)
    ? 0
    : clamp(0.08 + angleNorm * lerp(0.22, 0.76, speedNorm) + carveBias + (input.buttons.brake ? 0.26 : 0), 0, 1);
  state.debugEdgeFactor = edgeFactor;

  const turnResistance = (lowSpeedNoSteer || lowSpeedSteeringDisabled)
    ? 0
    : clamp(
      smoothstep01((desiredVsVelocity - Math.PI * 0.06) / (Math.PI * 0.94)) * speedNorm * velocityTurnResistance,
      0,
      1
    );
  const oppositeScale = input.buttons.brake
    ? clamp(oppositeSteerScale + brakeOppositeRecovery, 0, 1)
    : oppositeSteerScale;
  const reverseNoBrakeScale = input.buttons.brake
    ? 1
    : lerp(0.42, 0.02, smoothstep01(speedNorm));
  const reverseScale = oppositeScale * reverseNoBrakeScale;
  const reverseEntryPenalty = intentForward < 0 && !input.buttons.brake
    ? lerp(0.42, 0.08, smoothstep01(speedNorm))
    : 1;
  const startOpposesCommitted = validStartInput && (rawNx * startDirX + rawNy * startDirY) < 0;
  const startupOppositeScale = startupOppositeLocked && startOpposesCommitted ? startupOppositeSuppression : 1;
  const startCommitForwardScale = startOpposesCommitted
    ? (startCommitActive ? startOppositeSuppression : startupOppositeScale)
    : 1;
  const forwardInput = (lowSpeedNoSteer || startCommitActive)
    ? ((validStartInput ? 1 : 0) * startCommitForwardScale)
    : (lowSpeedSteeringDisabled
      ? (hasInput ? 1 : 0)
      : (intentForward >= 0 ? intentForward : intentForward * reverseScale));
  const baseTurnAuthority = lerp(turnLowSpeed, turnHighSpeed, speedNorm);
  const turnAuthority = clamp(
    (baseTurnAuthority + edgeTurnBonusMax * edgeFactor + (input.buttons.brake ? brakeTurnBonusValue : 0)) * (1 - turnResistance),
    0.02,
    1.25
  );
  const dotSteerFiltered = clamp(steerX * filteredX + steerY * filteredY, -1, 1);
  const alternatingPenalty = (lowSpeedNoSteer || lowSpeedSteeringDisabled) ? 1 : lerp(1, 0.55, clamp((1 - dotSteerFiltered) * 0.5 * speedNorm, 0, 1));
  const lateralAuthority = (lowSpeedNoSteer || lowSpeedSteeringDisabled)
    ? 0
    : clamp(turnAuthority * alternatingPenalty * (chargeActive ? chargeTurnMul : 1), 0.02, 1);
  const appliedForwardForce = forwardAccel * (chargeActive ? chargeAccelMul : 1) * forwardInput * reverseEntryPenalty;
  const oppositeSteerClamp = clamp(config.oppositeSteerClamp ?? MOVEMENT_DEFAULTS.oppositeSteerClamp ?? 0.35, 0.05, 1);
  const inputOpposesVelocity = hasInput && intentForward < 0;
  const commitClamp = (!(lowSpeedNoSteer || lowSpeedSteeringDisabled) && commitLeft > 0.0001 && inputOpposesVelocity) ? oppositeSteerClamp : 1;
  const oppositeCarveSuppression = (carveLockLeft > 0.0001 && carveSide !== 0 && Math.sign(intentSideRaw || 0) !== carveSide)
    ? carveSideSuppression
    : 1;
  const intentSide = intentSideRaw * oppositeCarveSuppression;
  const appliedLateralForce = lateralSteerForce * intentSide * lateralAuthority * commitClamp;
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
  const slipRef = speedAfterDrag >= minTravelDirSpeed ? Math.atan2(state.vy, state.vx) : lockedTravelAngle;
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
  const candidateVx = dfx * forwardVel + dsx * lateralVel;
  const candidateVy = dfy * forwardVel + dsy * lateralVel;

  // Velocity-first anti-flip guard: even with strong input alternation, travel direction
  // can only rotate by a bounded amount per step. This preserves visible carve arcs.
  const prevSpeed = speedBefore;
  const candidateSpeed = Math.hypot(candidateVx, candidateVy);
  if (prevSpeed > 0.001 && candidateSpeed > 0.001) {
    const prevDir = Math.atan2(prevVy, prevVx);
    const candDir = Math.atan2(candidateVy, candidateVx);
    const delta = Math.abs(wrapToPi(candDir - prevDir));
    const bigFlipNorm = smoothstep01((delta - (120 * Math.PI) / 180) / ((Math.PI - (120 * Math.PI) / 180)));
    const speedTurnBase = lerp(turnLowSpeed, turnHighSpeed, speedNorm);
    const brakeBoost = input.buttons.brake ? brakeTurnBonusValue : 0;
    const antiFlipSlowdown = input.buttons.brake ? lerp(1, 0.85, bigFlipNorm) : lerp(1, 0.25, bigFlipNorm);
    const maxTurnRate = Math.max(0.08, (speedTurnBase + edgeTurnBonusMax * edgeFactor + brakeBoost) * antiFlipSlowdown);
    const steppedDir = approachAngle(prevDir, candDir, maxTurnRate * simDt);
    const steppedSpeed = candidateSpeed;
    state.vx = Math.cos(steppedDir) * steppedSpeed;
    state.vy = Math.sin(steppedDir) * steppedSpeed;
  } else {
    state.vx = candidateVx;
    state.vy = candidateVy;
  }

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
  let nextStableTravelAngle = stableTravelAngle;
  if (speedAfterSolve >= minTravelDirSpeed) {
    nextStableTravelAngle = Math.atan2(state.vy, state.vx);
  }
  state.lastStableTravelAngle = nextStableTravelAngle;
  const useLockedTravelAngle = lowSpeedStartupActive || speedAfterSolve < minTravelDirSpeed;
  const moveAngle = useLockedTravelAngle
    ? nextStableTravelAngle
    : Math.atan2(state.vy, state.vx);
  state.debugTravelDirLocked = useLockedTravelAngle;
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
