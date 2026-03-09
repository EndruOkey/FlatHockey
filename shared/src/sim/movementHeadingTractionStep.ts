import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachScalar, clamp, wrapToPi } from './movementMath';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

function resolveMaxForwardSpeed(config: MovementStepConfig): number {
  if (typeof config.maxForwardSpeed === 'number') return Math.max(1, config.maxForwardSpeed);
  if (typeof config.maxSpeed === 'number') return Math.max(1, config.maxSpeed);
  if (config.hasPuck && typeof config.maxSpeedWithPuck === 'number') return Math.max(1, config.maxSpeedWithPuck);
  if (typeof config.maxSpeedNoPuck === 'number') return Math.max(1, config.maxSpeedNoPuck);
  return Math.max(1, MOVEMENT_DEFAULTS.maxForwardSpeed ?? MOVEMENT_DEFAULTS.maxSpeed ?? 342.5);
}

export function applyHeadingTractionStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig
) {
  const simDt = clamp(dt, 0.001, 0.05);
  const turnRate = Math.max(0, config.turnRate ?? MOVEMENT_DEFAULTS.turnRate ?? 7.2);
  const turnAccel = Math.max(0, config.turnAccel ?? MOVEMENT_DEFAULTS.turnAccel ?? 32);
  const brakeTurnMult = Math.max(1, config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1.8);
  const forwardAccel = Math.max(0, config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1681.36);
  const maxForwardSpeed = resolveMaxForwardSpeed(config);
  const maxReverseSpeed = clamp(
    config.maxReverseSpeed ?? MOVEMENT_DEFAULTS.maxReverseSpeed ?? maxForwardSpeed * 0.35,
    1,
    maxForwardSpeed
  );
  const reverseAccelMul = clamp(config.reverseAccelMul ?? MOVEMENT_DEFAULTS.reverseAccelMul ?? 0.35, 0.05, 1);
  const brakeDecel = Math.max(0, config.brakeDecel ?? MOVEMENT_DEFAULTS.brakeDecel ?? 950);
  const coastDecel = Math.max(0, config.coastDecel ?? MOVEMENT_DEFAULTS.coastDecel ?? 260);
  const forwardDrag = Math.max(0, config.forwardDrag ?? MOVEMENT_DEFAULTS.forwardDrag ?? 1.45);
  const lateralDrag = Math.max(0, config.lateralDrag ?? MOVEMENT_DEFAULTS.lateralDrag ?? 7.2);
  const brakeLateralDrag = Math.max(
    lateralDrag,
    config.brakeLateralDrag ?? MOVEMENT_DEFAULTS.brakeLateralDrag ?? 12
  );
  const reverseGateSpeed = Math.max(0, config.reverseGateSpeed ?? MOVEMENT_DEFAULTS.reverseGateSpeed ?? 45);
  const standstillEpsilon = Math.max(
    0,
    config.standstillSpeedEpsilon ?? MOVEMENT_DEFAULTS.standstillSpeedEpsilon ?? 8
  );

  const throttle = input.throttle;
  const steer = input.steer;
  const brake = !!input.brake;
  const steerOnlyStandstill = throttle === 0 && !brake && Math.abs(steer) > 0 && state.speed <= standstillEpsilon;

  const targetOmega = steer * turnRate * (brake ? brakeTurnMult : 1);
  state.headingOmega = approachScalar(state.headingOmega, targetOmega, turnAccel * simDt);
  state.heading = wrapToPi(state.heading + state.headingOmega * simDt);

  const fwdX = Math.cos(state.heading);
  const fwdY = Math.sin(state.heading);
  const rightX = -fwdY;
  const rightY = fwdX;

  let forwardSpeed = state.vx * fwdX + state.vy * fwdY;
  let lateralSpeed = state.vx * rightX + state.vy * rightY;

  if (throttle > 0) {
    forwardSpeed += forwardAccel * simDt;
  } else if (throttle < 0) {
    if (forwardSpeed > reverseGateSpeed) {
      forwardSpeed = approachScalar(forwardSpeed, 0, brakeDecel * simDt);
    } else {
      forwardSpeed -= forwardAccel * reverseAccelMul * simDt;
    }
  } else {
    forwardSpeed = approachScalar(forwardSpeed, 0, coastDecel * simDt);
  }

  if (brake) {
    forwardSpeed = approachScalar(forwardSpeed, 0, brakeDecel * simDt);
  }

  forwardSpeed *= Math.exp(-forwardDrag * simDt);
  lateralSpeed *= Math.exp(-(brake ? brakeLateralDrag : lateralDrag) * simDt);

  forwardSpeed = clamp(forwardSpeed, -maxReverseSpeed, maxForwardSpeed);
  if (steerOnlyStandstill) {
    forwardSpeed = 0;
    lateralSpeed = 0;
  }

  state.vx = fwdX * forwardSpeed + rightX * lateralSpeed;
  state.vy = fwdY * forwardSpeed + rightY * lateralSpeed;
  state.speed = Math.hypot(state.vx, state.vy);

  if (state.speed <= standstillEpsilon) {
    state.vx = 0;
    state.vy = 0;
    state.speed = 0;
  }

  state.x += state.vx * simDt;
  state.y += state.vy * simDt;
  if (state.speed > 0) {
    state.moveAngle = Math.atan2(state.vy, state.vx);
  } else {
    state.moveAngle = state.heading;
  }

  if (Number.isFinite(input.aimAngle)) {
    state.aimAngle = wrapToPi(input.aimAngle!);
  }
  state.stamina = clamp(state.stamina + (MOVEMENT_DEFAULTS.staminaRegen ?? 0.23) * simDt, 0, 1);
  state.reverseState = forwardSpeed < -0.5 ? 'REVERSING' : 'FORWARD';
}
