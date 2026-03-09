import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachScalar, clamp, wrapToPi } from './movementMath';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

export type ExperimentalStepArgs = {
  state: MovementStepState;
  input: MovementStepInput;
  dt: number;
  config: MovementStepConfig;
  prevMoveAngle: number;
};

export type ExperimentalStepResult = {
  desiredMoveAngle: number;
  turnIntentAngle: number;
  turnResistance: number;
};

type ReverseDriveState = 'NORMAL' | 'TRANSITION_TO_REVERSE' | 'REVERSE_READY';

function stepReverseState(state: MovementStepState, requestReverse: boolean, brake: boolean, speed: number, config: MovementStepConfig, dt: number): ReverseDriveState {
  const reverseGateSpeed = Math.max(0, config.reverseEnterSpeed ?? MOVEMENT_DEFAULTS.reverseEnterSpeed ?? 42);
  const reverseMinDuration = Math.max(0, (config.reverseMinDurationMs ?? MOVEMENT_DEFAULTS.reverseMinDurationMs ?? 140) / 1000);
  let reverseState: ReverseDriveState = state.reverseDriveState === 'TRANSITION_TO_REVERSE' || state.reverseDriveState === 'REVERSE_READY'
    ? state.reverseDriveState
    : 'NORMAL';
  let reverseTimer = Math.max(0, state.reverseTransitionTimer ?? 0);

  if (reverseState === 'NORMAL') {
    if (requestReverse && brake && speed > reverseGateSpeed) {
      reverseState = 'TRANSITION_TO_REVERSE';
      reverseTimer = 0;
    }
  } else if (reverseState === 'TRANSITION_TO_REVERSE') {
    reverseTimer += dt;
    if (speed <= reverseGateSpeed && reverseTimer >= reverseMinDuration && brake) {
      reverseState = 'REVERSE_READY';
    } else if (!requestReverse) {
      reverseState = 'NORMAL';
      reverseTimer = 0;
    }
  } else if (!requestReverse) {
    reverseState = 'NORMAL';
    reverseTimer = 0;
  }

  state.reverseDriveState = reverseState;
  state.reverseTransitionTimer = reverseTimer;
  state.reverseTransitionActive = reverseState === 'TRANSITION_TO_REVERSE';
  return reverseState;
}

export function applyHeadingTractionStep(args: ExperimentalStepArgs): ExperimentalStepResult {
  const { state, input, dt, config, prevMoveAngle } = args;
  const steer = input.steer;
  const throttle = input.throttle;
  const brakeActive = !!input.brake;

  const turnRate = Math.max(0, config.desiredHeadingTurnRate ?? MOVEMENT_DEFAULTS.desiredHeadingTurnRate ?? 7.2);
  const turnAccel = Math.max(0, config.desiredHeadingTurnAccel ?? MOVEMENT_DEFAULTS.desiredHeadingTurnAccel ?? 32);
  const brakeTurnMult = Math.max(1, config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1.8);
  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1500);
  const maxForwardSpeed = Math.max(1, config.forwardMaxSpeed ?? MOVEMENT_DEFAULTS.forwardMaxSpeed ?? 342.5);
  const reverseAccelMul = clamp(config.reverseAccelMul ?? config.reverseAccelMult ?? MOVEMENT_DEFAULTS.reverseAccelMul ?? 0.22, 0.05, 1);
  const brakeForce = Math.max(0, config.brakeForce ?? MOVEMENT_DEFAULTS.brakeForce ?? 150);
  const forwardDrag = Math.max(0, config.forwardDamping ?? MOVEMENT_DEFAULTS.forwardDamping ?? 2.1);
  const lateralTraction = Math.max(0, config.lateralDamping ?? MOVEMENT_DEFAULTS.lateralDamping ?? 0.18);

  let heading = Number.isFinite(state.heading) ? state.heading! : (Number.isFinite(state.moveAngle) ? state.moveAngle! : 0);
  let headingOmega = Number.isFinite(state.headingOmega) ? state.headingOmega! : 0;
  const targetOmega = steer * turnRate * (brakeActive ? brakeTurnMult : 1);
  headingOmega = approachScalar(headingOmega, targetOmega, turnAccel * dt);
  headingOmega *= Math.exp(-2.0 * dt);
  heading = wrapToPi(heading + headingOmega * dt);

  const forwardX = Math.cos(heading);
  const forwardY = Math.sin(heading);
  const rightX = -forwardY;
  const rightY = forwardX;
  let forwardSpeed = state.vx * forwardX + state.vy * forwardY;
  let lateralSpeed = state.vx * rightX + state.vy * rightY;

  const requestReverse = throttle < 0;
  const reverseState = stepReverseState(state, requestReverse, brakeActive, Math.abs(forwardSpeed), config, dt);
  const reverseAllowed = reverseState === 'REVERSE_READY' && brakeActive;

  if (throttle > 0) {
    forwardSpeed += forwardAccel * dt;
  } else if (throttle < 0) {
    if (reverseAllowed) {
      forwardSpeed -= forwardAccel * reverseAccelMul * dt;
    } else {
      forwardSpeed = approachScalar(forwardSpeed, 0, brakeForce * dt);
    }
  }

  if (brakeActive) {
    forwardSpeed = approachScalar(forwardSpeed, 0, brakeForce * 1.4 * dt);
  }

  forwardSpeed *= Math.exp(-forwardDrag * dt);
  lateralSpeed *= Math.exp(-lateralTraction * (brakeActive ? 1.8 : 1) * dt);
  forwardSpeed = clamp(forwardSpeed, -maxForwardSpeed * reverseAccelMul, maxForwardSpeed);

  state.vx = forwardX * forwardSpeed + rightX * lateralSpeed;
  state.vy = forwardY * forwardSpeed + rightY * lateralSpeed;
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  const speed = Math.hypot(state.vx, state.vy);
  const moveAngle = speed > 0.001 ? Math.atan2(state.vy, state.vx) : (Number.isFinite(state.moveAngle) ? state.moveAngle! : heading);
  state.heading = heading;
  state.headingOmega = headingOmega;
  state.desiredHeadingAngle = heading;
  state.inputAngle = heading;
  state.moveAngle = moveAngle;
  state.committedDirX = forwardX;
  state.committedDirY = forwardY;
  state.desiredDirX = forwardX;
  state.desiredDirY = forwardY;
  state.pendingDirX = forwardX;
  state.pendingDirY = forwardY;
  state.movementPhase = brakeActive ? 'BRAKE' : 'GLIDE';
  state.movementModelActive = 'DESIRED_HEADING_TRACTION';

  state.debugMovementModel = 'desiredHeadingTraction';
  state.debugMovementModelStepUsed = 'desiredHeadingTraction';
  state.debugHeadingAngle = heading;
  state.debugHeadingOmega = headingOmega;
  state.debugDesiredHeadingAngle = heading;
  state.debugHeadingErrorDeg = 0;
  state.debugForwardSpeed = forwardSpeed;
  state.debugLateralSpeed = lateralSpeed;
  state.debugBrakeActive = brakeActive;
  state.debugReverseState = reverseState;
  state.debugSteerInput = steer;
  state.debugThrottleInput = throttle;
  state.debugMoveTurnRateAppliedDeg = Math.abs(wrapToPi(moveAngle - prevMoveAngle)) * (180 / Math.PI) / Math.max(dt, 0.0001);

  return {
    desiredMoveAngle: heading,
    turnIntentAngle: heading,
    turnResistance: 0
  };
}
