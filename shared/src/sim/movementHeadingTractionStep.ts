import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachScalar, clamp, wrapToPi } from './movementMath';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

export function applyHeadingTractionStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig
) {
  const simDt = clamp(dt, 0.001, 0.05);
  const turnRate = config.turnRate ?? MOVEMENT_DEFAULTS.turnRate ?? 4.2;
  const turnAccel = config.turnAccel ?? MOVEMENT_DEFAULTS.turnAccel ?? 18.0;
  const brakeTurnMult = config.brakeTurnMult ?? MOVEMENT_DEFAULTS.brakeTurnMult ?? 1;
  const forwardAccel = config.forwardAccel ?? MOVEMENT_DEFAULTS.forwardAccel ?? 1400;
  const maxSpeed = Math.max(
    1,
    config.maxForwardSpeed ?? config.maxSpeed ?? MOVEMENT_DEFAULTS.maxForwardSpeed ?? 340
  );
  const brakeDecel = config.brakeDecel ?? MOVEMENT_DEFAULTS.brakeDecel ?? 380;
  const spaceDecel = brakeDecel * 2.2;
  const coastDecel = config.coastDecel ?? MOVEMENT_DEFAULTS.coastDecel ?? 90;
  const forwardDrag = config.forwardDrag ?? MOVEMENT_DEFAULTS.forwardDrag ?? 1.2;
  const lateralDrag = config.lateralDrag ?? MOVEMENT_DEFAULTS.lateralDrag ?? 8.0;
  const spaceLateralDrag = lateralDrag * 2.5;
  const standstillEps = config.standstillSpeedEpsilon ?? MOVEMENT_DEFAULTS.standstillSpeedEpsilon ?? 6;

  const throttle = input.throttle;
  const brake = !!input.brake;
  const isBraking = brake;
  const isSpace = brake && throttle === 0;

  const steer = input.steer ?? 0;
  if (typeof input.heading === 'number' && Number.isFinite(input.heading)) {
    // Client sent explicit heading, so we use it directly.
    state.heading = wrapToPi(input.heading);
    state.headingOmega = 0;
  } else {
    const targetOmega = steer * turnRate * (isBraking ? brakeTurnMult : 1);
    state.headingOmega = approachScalar(state.headingOmega, targetOmega, turnAccel * simDt);
    state.heading = wrapToPi(state.heading + state.headingOmega * simDt);
  }

  const fwdX = Math.cos(state.heading);
  const fwdY = Math.sin(state.heading);
  const latX = -fwdY;
  const latY = fwdX;

  let fwdSpeed = state.vx * fwdX + state.vy * fwdY;
  let latSpeed = state.vx * latX + state.vy * latY;

  if (Math.abs(steer) > 0 && throttle > 0) {
    const totalSpeed = Math.hypot(fwdSpeed, latSpeed);
    fwdSpeed = totalSpeed * Math.sign(fwdSpeed || 1);
    latSpeed = 0;
  }

  if (throttle > 0) {
    fwdSpeed += forwardAccel * simDt;
  } else if (brake) {
    const decel = isSpace ? spaceDecel : brakeDecel;
    fwdSpeed = approachScalar(fwdSpeed, 0, decel * simDt);
  } else {
    fwdSpeed = approachScalar(fwdSpeed, 0, coastDecel * simDt);
  }

  fwdSpeed *= Math.exp(-forwardDrag * simDt);
  latSpeed *= Math.exp(-(isSpace ? spaceLateralDrag : lateralDrag) * simDt);

  fwdSpeed = clamp(fwdSpeed, 0, maxSpeed);

  if (Math.abs(fwdSpeed) < standstillEps && !brake && throttle === 0) fwdSpeed = 0;
  if (Math.abs(latSpeed) < standstillEps * 0.5) latSpeed = 0;

  state.vx = fwdX * fwdSpeed + latX * latSpeed;
  state.vy = fwdY * fwdSpeed + latY * latSpeed;
  state.speed = Math.hypot(state.vx, state.vy);

  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

  state.moveAngle = state.speed > standstillEps
    ? Math.atan2(state.vy, state.vx)
    : state.heading;

  if (Number.isFinite(input.aimAngle)) {
    state.aimAngle = wrapToPi(input.aimAngle!);
  }

  state.stamina = clamp(
    state.stamina + (MOVEMENT_DEFAULTS.staminaRegen ?? 0.23) * simDt,
    0,
    1
  );
  state.reverseState = 'FORWARD';
}
