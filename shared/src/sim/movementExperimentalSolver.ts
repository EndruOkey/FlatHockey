import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachScalar, clamp, wrapToPi } from './movementMath';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

export type ExperimentalMovementModel = 'SKATE_STEERING' | 'DESIRED_HEADING_TRACTION';

export type ExperimentalStepArgs = {
  state: MovementStepState;
  input: MovementStepInput;
  dt: number;
  config: MovementStepConfig;
  rawInputX: number;
  rawInputY: number;
  hasInput: boolean;
  prevMoveAngle: number;
};

export type ExperimentalStepResult = {
  desiredMoveAngle: number;
  turnIntentAngle: number;
  turnResistance: number;
};

type ReverseDriveState = 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';

function resetStateForModelSwitch(state: MovementStepState, model: ExperimentalMovementModel) {
  const prev = state.movementModelActive;
  if (prev === model) return;
  const heading = Number.isFinite(state.heading)
    ? state.heading!
    : (Number.isFinite(state.moveAngle) ? state.moveAngle! : (Math.hypot(state.vx, state.vy) > 0.001 ? Math.atan2(state.vy, state.vx) : 0));
  state.vx = 0;
  state.vy = 0;
  state.heading = heading;
  state.moveAngle = heading;
  state.inputAngle = heading;
  state.headingOmega = 0;
  state.desiredHeadingAngle = heading;
  state.committedDirX = Math.cos(heading);
  state.committedDirY = Math.sin(heading);
  state.desiredDirX = state.committedDirX;
  state.desiredDirY = state.committedDirY;
  state.pendingDirX = state.committedDirX;
  state.pendingDirY = state.committedDirY;
  state.distanceSinceCommit = 0;
  state.commitNoInputTimer = 0;
  state.reverseDriveState = 'NORMAL';
  state.reverseTransitionActive = false;
  state.reverseTransitionTimer = 0;
  state.directionCommitTimer = 0;
  state.oppositeHoldTimer = 0;
  state.carveLockTimer = 0;
  state.carveSwitchCooldownTimer = 0;
  state.carveSide = 0;
  state.movementModelActive = model;
}

function stepReverseState(state: MovementStepState, throttleInput: number, brake: boolean, forwardSpeedAbs: number, config: MovementStepConfig, dt: number) {
  const reverseEnterSpeed = Math.max(0, config.reverseEnterSpeed ?? MOVEMENT_DEFAULTS.reverseEnterSpeed ?? 42);
  const reverseMinDurationSec = Math.max(0, (config.reverseMinDurationMs ?? MOVEMENT_DEFAULTS.reverseMinDurationMs ?? 140) / 1000);
  let reverseState: ReverseDriveState = state.reverseDriveState === 'TRANSITION_TO_REVERSE' || state.reverseDriveState === 'REVERSE_READY'
    ? state.reverseDriveState
    : 'NORMAL';
  let reverseTimer = Math.max(0, state.reverseTransitionTimer ?? 0);
  const oppositeRequested = throttleInput < -0.2;

  if (reverseState === 'NORMAL') {
    if (oppositeRequested && brake && forwardSpeedAbs > reverseEnterSpeed * 0.5) {
      reverseState = 'TRANSITION_TO_REVERSE';
      reverseTimer = 0;
    }
  } else if (reverseState === 'TRANSITION_TO_REVERSE') {
    reverseTimer += dt;
    const complete = reverseTimer >= reverseMinDurationSec && forwardSpeedAbs <= reverseEnterSpeed;
    if (complete && brake) {
      reverseState = 'REVERSE_READY';
    } else if (!oppositeRequested || !brake) {
      reverseState = 'NORMAL';
      reverseTimer = 0;
    }
  } else if (!oppositeRequested || !brake) {
    reverseState = 'NORMAL';
    reverseTimer = 0;
  }

  state.reverseDriveState = reverseState;
  state.reverseTransitionTimer = reverseTimer;
  state.reverseTransitionActive = reverseState === 'TRANSITION_TO_REVERSE';
  return reverseState;
}

export function applyExperimentalMovementStep(model: ExperimentalMovementModel, args: ExperimentalStepArgs): ExperimentalStepResult {
  const { state, input, dt, config, rawInputX, rawInputY, hasInput, prevMoveAngle } = args;
  resetStateForModelSwitch(state, model);

  const brakeActive = !!input.buttons.brake;
  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1500);
  const forwardMaxSpeed = Math.max(1, config.forwardMaxSpeed ?? MOVEMENT_DEFAULTS.forwardMaxSpeed ?? 342.5);
  const reverseAccelMul = clamp(config.reverseAccelMul ?? config.reverseAccelMult ?? MOVEMENT_DEFAULTS.reverseAccelMul ?? 0.22, 0.05, 1);
  const brakeForce = Math.max(0, config.brakeForce ?? config.brakeDrag ?? MOVEMENT_DEFAULTS.brakeDrag ?? 4.8) * 32;
  const lateralDamping = Math.max(0, config.lateralDamping ?? MOVEMENT_DEFAULTS.lateralDamping ?? 0.18);
  const forwardDamping = Math.max(0, config.forwardDamping ?? MOVEMENT_DEFAULTS.forwardDamping ?? 2.1);
  const brakeTurnMult = Math.max(1, config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1.8);

  let headingAngle = Number.isFinite(state.heading) ? state.heading! : (Number.isFinite(state.moveAngle) ? state.moveAngle! : 0);
  let headingOmega = Number.isFinite(state.headingOmega) ? state.headingOmega! : 0;
  let desiredHeading = Number.isFinite(state.desiredHeadingAngle) ? state.desiredHeadingAngle! : headingAngle;
  let steerInput = 0;
  let throttleInput = 0;

  if (model === 'SKATE_STEERING') {
    steerInput = clamp(rawInputX, -1, 1);
    throttleInput = clamp(-rawInputY, -1, 1);
    const headingTurnRate = Math.max(0, config.headingTurnRate ?? MOVEMENT_DEFAULTS.headingTurnRate ?? 4.9);
    const headingTurnAccel = Math.max(0, config.headingTurnAccel ?? MOVEMENT_DEFAULTS.headingTurnAccel ?? 24);
    const targetOmega = steerInput * headingTurnRate * (brakeActive ? brakeTurnMult : 1);
    headingOmega = approachScalar(headingOmega, targetOmega, headingTurnAccel * dt);
    headingOmega *= Math.exp(-2.2 * dt);
    headingAngle = wrapToPi(headingAngle + headingOmega * dt);
    desiredHeading = headingAngle;
  } else {
    if (hasInput) desiredHeading = Math.atan2(rawInputY, rawInputX);
    const desiredHeadingTurnRate = Math.max(0, config.desiredHeadingTurnRate ?? MOVEMENT_DEFAULTS.desiredHeadingTurnRate ?? 7.2);
    const desiredHeadingTurnAccel = Math.max(0, config.desiredHeadingTurnAccel ?? MOVEMENT_DEFAULTS.desiredHeadingTurnAccel ?? 32);
    const responseCurve = Math.max(0.1, config.headingResponseCurve ?? MOVEMENT_DEFAULTS.headingResponseCurve ?? 1.2);
    const headingError = wrapToPi(desiredHeading - headingAngle);
    const errNorm = Math.pow(Math.min(1, Math.abs(headingError) / Math.PI), responseCurve);
    const targetOmega = Math.sign(headingError) * errNorm * desiredHeadingTurnRate * (brakeActive ? brakeTurnMult : 1);
    headingOmega = approachScalar(headingOmega, targetOmega, desiredHeadingTurnAccel * dt);
    headingOmega *= Math.exp(-1.6 * dt);
    headingAngle = wrapToPi(headingAngle + headingOmega * dt);
    steerInput = clamp(headingError / (Math.PI * 0.5), -1, 1);
    const dirX = Math.cos(desiredHeading);
    const dirY = Math.sin(desiredHeading);
    throttleInput = clamp(dirX * Math.cos(headingAngle) + dirY * Math.sin(headingAngle), -1, 1) * (hasInput ? 1 : 0);
  }

  const fx = Math.cos(headingAngle);
  const fy = Math.sin(headingAngle);
  const rx = -fy;
  const ry = fx;
  let forwardSpeed = state.vx * fx + state.vy * fy;
  let lateralSpeed = state.vx * rx + state.vy * ry;
  const reverseState = stepReverseState(state, throttleInput, brakeActive, Math.abs(forwardSpeed), config, dt);

  if (throttleInput > 0) {
    forwardSpeed += forwardAccel * throttleInput * dt;
  } else if (throttleInput < 0) {
    if (reverseState === 'REVERSE_READY' && brakeActive) {
      forwardSpeed += forwardAccel * reverseAccelMul * throttleInput * dt;
    } else {
      forwardSpeed = approachScalar(forwardSpeed, 0, brakeForce * (brakeActive ? 1.4 : 1) * dt);
    }
  }

  if (brakeActive || reverseState === 'TRANSITION_TO_REVERSE') {
    const brakeMul = reverseState === 'TRANSITION_TO_REVERSE'
      ? (config.reverseBrakeForceMul ?? MOVEMENT_DEFAULTS.reverseBrakeForceMul ?? 1.8)
      : 1;
    forwardSpeed = approachScalar(forwardSpeed, 0, brakeForce * brakeMul * dt);
  }

  forwardSpeed *= Math.exp(-forwardDamping * dt);
  const lateralMul = brakeActive ? 1.45 : 1;
  lateralSpeed *= Math.exp(-lateralDamping * lateralMul * dt);

  const reverseMaxSpeed = Math.max(1, forwardMaxSpeed * reverseAccelMul);
  forwardSpeed = clamp(forwardSpeed, -reverseMaxSpeed, forwardMaxSpeed);
  state.vx = fx * forwardSpeed + rx * lateralSpeed;
  state.vy = fy * forwardSpeed + ry * lateralSpeed;

  const prevX = state.x;
  const prevY = state.y;
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  const speedNow = Math.hypot(state.vx, state.vy);
  const travelAngle = speedNow > 0.001 ? Math.atan2(state.vy, state.vx) : headingAngle;
  state.heading = headingAngle;
  state.headingOmega = headingOmega;
  state.desiredHeadingAngle = desiredHeading;
  state.moveAngle = travelAngle;
  state.inputAngle = desiredHeading;
  state.committedDirX = fx;
  state.committedDirY = fy;
  state.desiredDirX = Math.cos(desiredHeading);
  state.desiredDirY = Math.sin(desiredHeading);
  state.pendingDirX = state.desiredDirX;
  state.pendingDirY = state.desiredDirY;
  state.lastStableTravelAngle = travelAngle;
  state.movementPhase = brakeActive ? 'BRAKE' : 'GLIDE';
  state.distanceSinceCommit = Math.max(0, (state.distanceSinceCommit ?? 0) + Math.hypot(state.x - prevX, state.y - prevY));
  state.commitNoInputTimer = hasInput ? 0 : Math.max(0, (state.commitNoInputTimer ?? 0) + dt);

  const headingError = wrapToPi(desiredHeading - headingAngle);
  state.debugMovementModel = model === 'SKATE_STEERING' ? 'skateSteering' : 'desiredHeadingTraction';
  state.debugHeadingAngle = headingAngle;
  state.debugHeadingOmega = headingOmega;
  state.debugForwardSpeed = forwardSpeed;
  state.debugLateralSpeed = lateralSpeed;
  state.debugBrakeActive = brakeActive;
  state.debugReverseState = reverseState;
  state.debugReverseTransitionActive = reverseState === 'TRANSITION_TO_REVERSE';
  state.debugDesiredHeadingAngle = desiredHeading;
  state.debugHeadingErrorDeg = headingError * (180 / Math.PI);
  state.debugSteerInput = steerInput;
  state.debugThrottleInput = throttleInput;
  state.debugDesiredMoveAngle = desiredHeading;
  state.debugTurnIntentAngle = headingAngle;
  state.debugMoveTurnRateAppliedDeg = Math.abs(wrapToPi(travelAngle - prevMoveAngle)) * (180 / Math.PI) / Math.max(dt, 0.0001);
  state.debugVelocityDesiredDeltaDeg = wrapToPi(desiredHeading - travelAngle) * (180 / Math.PI);
  state.debugTurnResistance = Math.min(1, Math.abs(headingError) / Math.PI);
  state.debugRedirectAccelScale = reverseState === 'TRANSITION_TO_REVERSE' ? reverseAccelMul : 1;
  state.debugAntiFlipActive = reverseState !== 'NORMAL';
  state.debugMajorDirectionChangeBlocked = reverseState === 'TRANSITION_TO_REVERSE' && throttleInput < -0.2;
  state.debugDriveCommitLocked = reverseState === 'TRANSITION_TO_REVERSE';
  state.debugOppositeIntentBlocked = reverseState === 'TRANSITION_TO_REVERSE';
  state.debugCommitUnlockReason = reverseState === 'REVERSE_READY' ? 'BRAKE_REVERSE_READY' : 'NONE';
  state.debugMinHeadingAuthorityActive = speedNow < (config.minHeadingAuthoritySpeed ?? MOVEMENT_DEFAULTS.minHeadingAuthoritySpeed ?? 70);
  state.debugCommittedDriveAngle = headingAngle;
  state.debugDesiredDriveAngle = desiredHeading;
  state.debugRequestedInputDirX = state.desiredDirX;
  state.debugRequestedInputDirY = state.desiredDirY;
  state.debugFilteredInputX = state.desiredDirX;
  state.debugFilteredInputY = state.desiredDirY;
  state.debugAppliedForwardForce = forwardSpeed;
  state.debugAppliedLateralForce = lateralSpeed;
  state.debugSteerDirX = fx;
  state.debugSteerDirY = fy;
  state.debugMovementPhase = state.movementPhase;
  state.debugCarveLockTimer = 0;
  state.debugCarveSide = 0;
  state.debugAngularCapDegPerSec = 0;
  state.debugSharpRedirectGated = false;

  return {
    desiredMoveAngle: desiredHeading,
    turnIntentAngle: headingAngle,
    turnResistance: state.debugTurnResistance ?? 0
  };
}
