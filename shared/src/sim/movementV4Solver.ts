import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachAngle, clamp, expBlend, lerp, wrapToPi } from './movementMath';
import type { MovementV4Args, MovementV4Result } from './movementV4.types';

type CommitUnlockReason = 'NONE' | 'LOW_SPEED' | 'DISTANCE_RELAXED' | 'BRAKE_REVERSE_READY';
type ReverseDriveState = 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';

export function applyMovementV4Solver(args: MovementV4Args): MovementV4Result {
  const { state, input, dt, config, hasPuck, mouseDrivesMove, inputAimRaw, rawInputX, rawInputY, prevMoveAngle } = args;

  const simDt = clamp(dt, 0.001, 0.05);
  const rawLen = Math.hypot(rawInputX, rawInputY);
  const hasInput = rawLen > 0.0001;
  const rawNx = hasInput ? rawInputX / rawLen : 0;
  const rawNy = hasInput ? rawInputY / rawLen : 0;
  const brakeActive = !!input.buttons.brake;

  const chargeActive = !!input.buttons.sprint && !hasPuck;
  state.debugChargeActive = chargeActive;

  const inputVectorResponsiveness = Math.max(1, config.inputVectorResponsiveness ?? config.inputVectorTauMs ?? MOVEMENT_DEFAULTS.inputVectorResponsiveness ?? MOVEMENT_DEFAULTS.inputVectorTauMs ?? 95);
  const desiredAlpha = expBlend(1000 / inputVectorResponsiveness, simDt);

  const rawDriveAngle = hasInput ? wrapToPi(mouseDrivesMove ? inputAimRaw : Math.atan2(rawNy, rawNx)) : (state.inputAngle ?? state.moveAngle ?? 0);
  const rawDriveX = Math.cos(rawDriveAngle);
  const rawDriveY = Math.sin(rawDriveAngle);

  const filteredXRaw = (state.desiredDirX ?? rawDriveX) + (rawDriveX - (state.desiredDirX ?? rawDriveX)) * desiredAlpha;
  const filteredYRaw = (state.desiredDirY ?? rawDriveY) + (rawDriveY - (state.desiredDirY ?? rawDriveY)) * desiredAlpha;
  const filteredMag = Math.hypot(filteredXRaw, filteredYRaw);
  const desiredDriveX = filteredMag > 0.0001 ? filteredXRaw / filteredMag : rawDriveX;
  const desiredDriveY = filteredMag > 0.0001 ? filteredYRaw / filteredMag : rawDriveY;
  const desiredDriveAngle = Math.atan2(desiredDriveY, desiredDriveX);

  state.desiredDirX = desiredDriveX;
  state.desiredDirY = desiredDriveY;
  state.pendingDirX = desiredDriveX;
  state.pendingDirY = desiredDriveY;

  const prevVx = state.vx;
  const prevVy = state.vy;
  const speedBefore = Math.hypot(prevVx, prevVy);
  const prevTravelAngle = speedBefore > 0.001
    ? Math.atan2(prevVy, prevVx)
    : (Number.isFinite(state.lastStableTravelAngle) ? state.lastStableTravelAngle! : desiredDriveAngle);

  let committedDriveAngle = Number.isFinite(state.committedDirX) && Number.isFinite(state.committedDirY)
    ? Math.atan2(state.committedDirY!, state.committedDirX!)
    : desiredDriveAngle;
  let committedDriveX = Math.cos(committedDriveAngle);
  let committedDriveY = Math.sin(committedDriveAngle);

  const minCommitDistance = Math.max(0, config.minCommitDistance ?? MOVEMENT_DEFAULTS.minCommitDistance ?? 44);
  const commitSpeedThreshold = Math.max(0, config.commitSpeedThreshold ?? MOVEMENT_DEFAULTS.commitSpeedThreshold ?? 52);
  const commitSpeedRelaxedThreshold = Math.max(commitSpeedThreshold, config.commitSpeedRelaxedThreshold ?? MOVEMENT_DEFAULTS.commitSpeedRelaxedThreshold ?? 145);
  const oppositeIntentThreshold = clamp(config.oppositeIntentThreshold ?? MOVEMENT_DEFAULTS.oppositeIntentThreshold ?? -0.35, -0.98, -0.05);
  const directionChangeThresholdRad = ((config.directionChangeThresholdDeg ?? MOVEMENT_DEFAULTS.directionChangeThresholdDeg ?? 105) * Math.PI) / 180;
  const minHeadingAuthoritySpeed = Math.max(0, config.minHeadingAuthoritySpeed ?? MOVEMENT_DEFAULTS.minHeadingAuthoritySpeed ?? 70);
  const reverseEnterSpeed = Math.max(0, config.reverseEnterSpeed ?? MOVEMENT_DEFAULTS.reverseEnterSpeed ?? 42);
  const reverseMinDurationSec = Math.max(0, (config.reverseMinDurationMs ?? MOVEMENT_DEFAULTS.reverseMinDurationMs ?? 140) / 1000);
  const reverseBrakeForceMul = Math.max(1, config.reverseBrakeForceMul ?? MOVEMENT_DEFAULTS.reverseBrakeForceMul ?? 1.8);
  const reverseSteerMul = clamp(config.reverseSteerMul ?? MOVEMENT_DEFAULTS.reverseSteerMul ?? 0.18, 0.01, 1);
  const reverseAccelMul = clamp(config.reverseAccelMul ?? MOVEMENT_DEFAULTS.reverseAccelMul ?? 0.22, 0.01, 1);

  const desiredDeltaCommitted = Math.abs(wrapToPi(desiredDriveAngle - committedDriveAngle));
  const desiredDotCommitted = hasInput ? clamp(desiredDriveX * committedDriveX + desiredDriveY * committedDriveY, -1, 1) : 1;
  const desiredSideCommitted = hasInput ? (committedDriveX * desiredDriveY - committedDriveY * desiredDriveX) : 0;
  const oppositeIntent = hasInput && desiredDotCommitted < oppositeIntentThreshold;
  const majorDirectionChange = hasInput && desiredDeltaCommitted > directionChangeThresholdRad;
  const minHeadingAuthorityActive = speedBefore < minHeadingAuthoritySpeed && (majorDirectionChange || oppositeIntent);

  let reverseState: ReverseDriveState = state.reverseDriveState === 'TRANSITION_TO_REVERSE' || state.reverseDriveState === 'REVERSE_READY'
    ? state.reverseDriveState
    : 'NORMAL';
  let reverseTimer = Math.max(0, state.reverseTransitionTimer ?? 0);

  if (reverseState === 'NORMAL') {
    if (oppositeIntent && brakeActive && speedBefore >= reverseEnterSpeed * 0.6) {
      reverseState = 'TRANSITION_TO_REVERSE';
      reverseTimer = 0;
    }
  } else if (reverseState === 'TRANSITION_TO_REVERSE') {
    reverseTimer += simDt;
    const transitionSatisfied = reverseTimer >= reverseMinDurationSec && speedBefore <= reverseEnterSpeed;
    if (transitionSatisfied && brakeActive) {
      reverseState = 'REVERSE_READY';
    } else if (!oppositeIntent || !brakeActive) {
      reverseState = 'NORMAL';
      reverseTimer = 0;
    }
  } else if (reverseState === 'REVERSE_READY') {
    if (!oppositeIntent || !brakeActive) {
      reverseState = 'NORMAL';
      reverseTimer = 0;
    }
  }

  let commitUnlockReason: CommitUnlockReason = 'NONE';
  let commitUnlocked = false;
  if (speedBefore < commitSpeedThreshold) {
    commitUnlocked = true;
    commitUnlockReason = 'LOW_SPEED';
  } else if ((state.distanceSinceCommit ?? 0) >= minCommitDistance && speedBefore < commitSpeedRelaxedThreshold) {
    commitUnlocked = true;
    commitUnlockReason = 'DISTANCE_RELAXED';
  } else if (brakeActive && reverseState === 'REVERSE_READY') {
    commitUnlocked = true;
    commitUnlockReason = 'BRAKE_REVERSE_READY';
  }

  let driveCommitLocked = false;
  let oppositeIntentBlocked = false;
  let committedChanged = false;

  if (hasInput) {
    const canCommitLarge = commitUnlocked && (!oppositeIntent || (brakeActive && reverseState === 'REVERSE_READY'));
    if ((majorDirectionChange || oppositeIntent || minHeadingAuthorityActive) && !canCommitLarge) {
      driveCommitLocked = true;
      oppositeIntentBlocked = oppositeIntent && !brakeActive;
    } else if (canCommitLarge) {
      committedDriveAngle = desiredDriveAngle;
      committedChanged = true;
      if (oppositeIntent && reverseState === 'REVERSE_READY') {
        reverseState = 'NORMAL';
        reverseTimer = 0;
      }
    } else {
      const turnRateBase = Math.max(0.05, config.turnRateBase ?? MOVEMENT_DEFAULTS.turnRateBase ?? 1.8);
      const turnRateSpeedScale = Math.max(0, config.turnRateSpeedScale ?? MOVEMENT_DEFAULTS.turnRateSpeedScale ?? 0.0065);
      const smallStep = (turnRateBase + speedBefore * turnRateSpeedScale) * (minHeadingAuthorityActive ? 0.12 : 0.45) * simDt;
      committedDriveAngle = approachAngle(committedDriveAngle, desiredDriveAngle, smallStep);
      committedChanged = true;
    }
  }

  committedDriveX = Math.cos(committedDriveAngle);
  committedDriveY = Math.sin(committedDriveAngle);
  state.committedDirX = committedDriveX;
  state.committedDirY = committedDriveY;
  state.inputAngle = desiredDriveAngle;

  const turnRateBase = Math.max(0.05, config.turnRateBase ?? MOVEMENT_DEFAULTS.turnRateBase ?? 1.8);
  const turnRateSpeedScale = Math.max(0, config.turnRateSpeedScale ?? MOVEMENT_DEFAULTS.turnRateSpeedScale ?? 0.0065);
  const brakeTurnMult = Math.max(1, config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1.8);
  const sharpRedirectNoBrakeTurnMul = clamp(config.sharpRedirectNoBrakeTurnMul ?? MOVEMENT_DEFAULTS.sharpRedirectNoBrakeTurnMul ?? 0.45, 0.05, 1);
  let maxTurnRate = turnRateBase + speedBefore * turnRateSpeedScale;
  if (brakeActive) {
    maxTurnRate *= brakeTurnMult;
  } else if (majorDirectionChange) {
    maxTurnRate *= sharpRedirectNoBrakeTurnMul;
  }

  const travelIntentAngle = hasInput
    ? approachAngle(prevTravelAngle, committedDriveAngle, maxTurnRate * simDt)
    : prevTravelAngle;
  const travelIntentX = Math.cos(travelIntentAngle);
  const travelIntentY = Math.sin(travelIntentAngle);

  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1500);
  const lateralSteerForce = Math.max(0, config.lateralSteerForce ?? MOVEMENT_DEFAULTS.lateralSteerForce ?? 620);
  const reverseBrakeBonus = Math.max(0, config.reverseBrakeBonus ?? MOVEMENT_DEFAULTS.reverseBrakeBonus ?? 3.5);

  const driveDotCommitted = hasInput ? clamp(desiredDriveX * committedDriveX + desiredDriveY * committedDriveY, -1, 1) : 0;
  const driveSideCommitted = hasInput ? (committedDriveX * desiredDriveY - committedDriveY * desiredDriveX) : 0;
  const transitionActive = reverseState === 'TRANSITION_TO_REVERSE';
  const reverseActive = transitionActive || reverseState === 'REVERSE_READY';

  const transitionAccelScale = transitionActive ? reverseAccelMul : 1;
  const oppositeForwardScale = oppositeIntentBlocked ? 0 : (transitionActive ? 0.05 : 0.15);
  const forwardIntent = hasInput ? driveDotCommitted : 0;
  const forwardForce = forwardAccel * transitionAccelScale * (forwardIntent >= 0 ? forwardIntent : forwardIntent * oppositeForwardScale);
  const steerMul = transitionActive || driveCommitLocked ? reverseSteerMul : 1;
  const lateralForce = lateralSteerForce * driveSideCommitted * steerMul * (brakeActive ? 1.2 : 1);

  if (hasInput) {
    state.vx += (committedDriveX * forwardForce + (-committedDriveY) * lateralForce) * simDt;
    state.vy += (committedDriveY * forwardForce + committedDriveX * lateralForce) * simDt;
  }

  const forwardMaxSpeed = Math.max(1, config.forwardMaxSpeed ?? MOVEMENT_DEFAULTS.forwardMaxSpeed ?? 342.5);
  const sideMaxSpeed = clamp(config.sideMaxSpeed ?? MOVEMENT_DEFAULTS.sideMaxSpeed ?? forwardMaxSpeed * 0.85, 1, forwardMaxSpeed);
  const reverseMaxSpeed = clamp(config.reverseMaxSpeed ?? MOVEMENT_DEFAULTS.reverseMaxSpeed ?? forwardMaxSpeed * 0.7, 1, forwardMaxSpeed);
  const chargeSpeedMul = Math.max(1, config.chargeSpeedMul ?? MOVEMENT_DEFAULTS.chargeSpeedMul ?? 1.2);
  const directionalSpeedScale = (() => {
    if (!hasInput) return 1;
    if (driveDotCommitted >= 0) return lerp(sideMaxSpeed / forwardMaxSpeed, 1, driveDotCommitted);
    return lerp(sideMaxSpeed / forwardMaxSpeed, reverseMaxSpeed / forwardMaxSpeed, -driveDotCommitted);
  })();
  const localMaxSpeed = Math.max(1, forwardMaxSpeed * directionalSpeedScale * (chargeActive ? chargeSpeedMul : 1));
  const speedAfterForces = Math.hypot(state.vx, state.vy);
  if (speedAfterForces > localMaxSpeed) {
    const k = localMaxSpeed / Math.max(1, speedAfterForces);
    state.vx *= k;
    state.vy *= k;
  }

  const moveDrag = Math.max(0, config.moveDrag ?? MOVEMENT_DEFAULTS.moveDrag ?? 2.6);
  const glideDrag = Math.max(0, config.glideDrag ?? MOVEMENT_DEFAULTS.glideDrag ?? 0.96909);
  const brakeDrag = Math.max(0, config.brakeDrag ?? MOVEMENT_DEFAULTS.brakeDrag ?? 4.8);
  const baseLateralDamping = Math.max(0, config.baseLateralDamping ?? MOVEMENT_DEFAULTS.baseLateralDamping ?? 0.18);
  const maxLateralDamping = Math.max(baseLateralDamping, config.maxLateralDamping ?? MOVEMENT_DEFAULTS.maxLateralDamping ?? 1.35);
  const brakeLateralDampingBonus = Math.max(0, config.brakeLateralDampingBonus ?? MOVEMENT_DEFAULTS.brakeLateralDampingBonus ?? 0.65);
  const carveLossStrength = Math.max(0, config.carveLossStrength ?? MOVEMENT_DEFAULTS.carveLossStrength ?? 0.42);

  state.vx *= Math.exp(-(hasInput ? moveDrag : glideDrag) * simDt);
  state.vy *= Math.exp(-(hasInput ? moveDrag : glideDrag) * simDt);

  const minTravelDirSpeed = Math.max(0.001, config.minTravelDirSpeed ?? MOVEMENT_DEFAULTS.minTravelDirSpeed ?? 55);
  const speedAfterDrag = Math.hypot(state.vx, state.vy);
  const slipRef = speedAfterDrag >= minTravelDirSpeed ? Math.atan2(state.vy, state.vx) : travelIntentAngle;
  const sfx = Math.cos(slipRef);
  const sfy = Math.sin(slipRef);
  const stx = -sfy;
  const sty = sfx;

  let forwardVel = state.vx * sfx + state.vy * sfy;
  let sideVel = state.vx * stx + state.vy * sty;
  let lateralDamping = lerp(baseLateralDamping, maxLateralDamping, clamp(speedAfterDrag / Math.max(forwardMaxSpeed, 1), 0, 1));
  if (brakeActive) lateralDamping += brakeLateralDampingBonus;
  if (transitionActive || oppositeIntentBlocked) lateralDamping += reverseBrakeBonus;
  sideVel *= Math.exp(-lateralDamping * simDt);

  if (brakeActive || transitionActive || oppositeIntentBlocked || reverseActive) {
    let brakeMul = 1;
    if (brakeActive) brakeMul *= 1.15;
    if (transitionActive) brakeMul *= reverseBrakeForceMul;
    if (oppositeIntentBlocked) brakeMul *= 1.2;
    const dynBrake = brakeDrag * brakeMul;
    const brakeFactor = Math.exp(-dynBrake * simDt);
    forwardVel *= brakeFactor;
    sideVel *= brakeFactor;
  }

  forwardVel *= Math.exp(-carveLossStrength * clamp(Math.abs(driveSideCommitted), 0, 1) * simDt);
  state.vx = sfx * forwardVel + stx * sideVel;
  state.vy = sfy * forwardVel + sty * sideVel;

  const finalSpeed = Math.hypot(state.vx, state.vy);
  const finalMaxSpeed = Math.max(1, forwardMaxSpeed * (chargeActive ? chargeSpeedMul : 1));
  if (finalSpeed > finalMaxSpeed) {
    const k = finalMaxSpeed / finalSpeed;
    state.vx *= k;
    state.vy *= k;
  }

  const velocityAngleRaw = Math.hypot(state.vx, state.vy) > 0.001 ? Math.atan2(state.vy, state.vx) : travelIntentAngle;
  const cappedTravelAngle = approachAngle(prevTravelAngle, velocityAngleRaw, maxTurnRate * simDt);
  const speedAfterSolve = Math.hypot(state.vx, state.vy);
  if (speedAfterSolve > 0.001) {
    state.vx = Math.cos(cappedTravelAngle) * speedAfterSolve;
    state.vy = Math.sin(cappedTravelAngle) * speedAfterSolve;
  }

  const prevX = state.x;
  const prevY = state.y;
  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

  const moved = Math.hypot(state.x - prevX, state.y - prevY);
  if (committedChanged) state.distanceSinceCommit = 0;
  state.distanceSinceCommit = Math.max(0, (state.distanceSinceCommit ?? 0) + moved);
  state.commitNoInputTimer = hasInput ? 0 : Math.max(0, (state.commitNoInputTimer ?? 0) + simDt);

  const stableTravelAngle = speedAfterSolve >= minTravelDirSpeed
    ? Math.atan2(state.vy, state.vx)
    : (Number.isFinite(state.lastStableTravelAngle) ? state.lastStableTravelAngle! : cappedTravelAngle);

  state.lastStableTravelAngle = stableTravelAngle;
  state.moveAngle = stableTravelAngle;
  state.heading = stableTravelAngle;
  state.directionCommitTimer = 0;
  state.oppositeHoldTimer = 0;
  state.antiFlipTimer = 0;
  state.carveLockTimer = 0;
  state.carveSwitchCooldownTimer = 0;
  state.carveSide = 0;
  state.movementPhase = brakeActive ? 'BRAKE' : 'GLIDE';
  state.reverseDriveState = reverseState;
  state.reverseTransitionActive = transitionActive;
  state.reverseTransitionTimer = reverseTimer;

  const velocityDesiredDelta = wrapToPi(desiredDriveAngle - stableTravelAngle);
  state.debugRawInputAngle = rawDriveAngle;
  state.debugDesiredMoveAngle = desiredDriveAngle;
  state.debugTurnIntentAngle = travelIntentAngle;
  state.debugVelocityDesiredDeltaDeg = velocityDesiredDelta * (180 / Math.PI);
  state.debugMoveTurnRateAppliedDeg = Math.abs(wrapToPi(stableTravelAngle - prevMoveAngle)) * (180 / Math.PI) / Math.max(simDt, 0.0001);
  state.debugTurnResistance = clamp(oppositeIntent ? -desiredDotCommitted : 0, 0, 1);
  state.debugRedirectAccelScale = transitionAccelScale;
  state.debugDesiredInputX = desiredDriveX;
  state.debugDesiredInputY = desiredDriveY;
  state.debugRequestedInputDirX = desiredDriveX;
  state.debugRequestedInputDirY = desiredDriveY;
  state.debugFilteredInputX = desiredDriveX;
  state.debugFilteredInputY = desiredDriveY;
  state.debugAppliedForwardForce = hasInput ? forwardForce : 0;
  state.debugAppliedLateralForce = hasInput ? lateralForce : 0;
  state.debugSteerDirX = Math.cos(cappedTravelAngle);
  state.debugSteerDirY = Math.sin(cappedTravelAngle);
  state.debugEffectiveStartDirX = state.debugSteerDirX;
  state.debugEffectiveStartDirY = state.debugSteerDirY;
  state.debugSignedInputVsVelocityAngle = Math.atan2(driveSideCommitted, driveDotCommitted);
  state.debugEdgeFactor = clamp(Math.abs(driveSideCommitted), 0, 1);
  state.debugTravelDirLocked = speedAfterSolve < minTravelDirSpeed;
  state.debugMajorDirectionChangeBlocked = driveCommitLocked && majorDirectionChange;
  state.debugBrakeActive = brakeActive;
  state.debugReverseTransitionActive = transitionActive;
  state.debugSharpRedirectGated = majorDirectionChange && !brakeActive;
  state.debugAngularCapDegPerSec = maxTurnRate * (180 / Math.PI);
  state.debugCommitTimer = 0;
  state.debugOppositeHoldTimer = 0;
  state.debugAntiFlipActive = transitionActive || oppositeIntentBlocked || driveCommitLocked;
  state.debugMovementPhase = state.movementPhase;
  state.debugCarveLockTimer = 0;
  state.debugCarveSide = 0;
  state.debugCommittedDriveAngle = committedDriveAngle;
  state.debugDesiredDriveAngle = desiredDriveAngle;
  state.debugDriveCommitLocked = driveCommitLocked;
  state.debugReverseState = reverseState;
  state.debugOppositeIntentBlocked = oppositeIntentBlocked;
  state.debugCommitUnlockReason = commitUnlockReason;
  state.debugMinHeadingAuthorityActive = minHeadingAuthorityActive;

  return {
    desiredMoveAngle: desiredDriveAngle,
    turnIntentAngle: travelIntentAngle,
    turnResistance: state.debugTurnResistance ?? 0,
    chargeActive
  };
}
