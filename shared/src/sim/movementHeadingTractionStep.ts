import { MOVEMENT_DEFAULTS } from '../tuning/movement.defaults';
import { approachAngle, clamp, wrapToPi } from './movementMath';
import type { MovementStepConfig, MovementStepInput, MovementStepState } from './movementStep.types';

/**
 * Velocity-based movement step.
 *
 * input.heading = desired world-space direction (angle) from WASD.
 *   W=-π/2 (up), D=0 (right), S=π/2 (down), A=π (left), diagonals in between.
 *
 * The visual heading (state.heading) follows the actual velocity direction
 * at a limited turn rate — it never snaps instantly and cannot be spun
 * via rapid input changes.
 */
export function applyHeadingTractionStep(
  state: MovementStepState,
  input: MovementStepInput,
  dt: number,
  config: MovementStepConfig
) {
  const simDt = clamp(dt, 0.001, 0.05);

  const forwardAccel  = config.forwardAccel  ?? MOVEMENT_DEFAULTS.forwardAccel  ?? 1400;
  const maxSpeed      = Math.max(1, config.maxForwardSpeed ?? config.maxSpeed ?? MOVEMENT_DEFAULTS.maxForwardSpeed ?? 340);
  const brakeDecel    = config.brakeDecel    ?? MOVEMENT_DEFAULTS.brakeDecel    ?? 600;
  const coastDecel    = config.coastDecel    ?? MOVEMENT_DEFAULTS.coastDecel    ?? 120;
  const drag          = config.forwardDrag   ?? MOVEMENT_DEFAULTS.forwardDrag   ?? 1.4;
  // How fast the visual heading can rotate to match the velocity direction (rad/s).
  const turnRate      = config.turnRate      ?? MOVEMENT_DEFAULTS.turnRate      ?? 6.0;
  const standstillEps = config.standstillSpeedEpsilon ?? MOVEMENT_DEFAULTS.standstillSpeedEpsilon ?? 6;

  const throttle = input.throttle > 0;
  const brake    = !!input.brake;

  // Desired world-space direction sent by the client (atan2 of WASD vector).
  const hasDesiredDir  = typeof input.heading === 'number' && Number.isFinite(input.heading);
  const desiredHeading = hasDesiredDir ? input.heading! : state.heading;

  // ── Acceleration / deceleration ──────────────────────────────────────────
  if (throttle) {
    state.vx += Math.cos(desiredHeading) * forwardAccel * simDt;
    state.vy += Math.sin(desiredHeading) * forwardAccel * simDt;
  } else if (brake) {
    const speed = Math.hypot(state.vx, state.vy);
    if (speed > standstillEps) {
      const factor = Math.max(0, 1 - (brakeDecel * simDt) / speed);
      state.vx *= factor;
      state.vy *= factor;
    } else {
      state.vx = 0;
      state.vy = 0;
    }
  } else {
    const speed = Math.hypot(state.vx, state.vy);
    if (speed > standstillEps) {
      const factor = Math.max(0, 1 - (coastDecel * simDt) / speed);
      state.vx *= factor;
      state.vy *= factor;
    } else {
      state.vx = 0;
      state.vy = 0;
    }
  }

  // ── Drag (uniform, simulates ice friction) ────────────────────────────────
  const dragFactor = Math.exp(-drag * simDt);
  state.vx *= dragFactor;
  state.vy *= dragFactor;

  // ── Speed cap ─────────────────────────────────────────────────────────────
  state.speed = Math.hypot(state.vx, state.vy);
  if (state.speed > maxSpeed) {
    state.vx = (state.vx / state.speed) * maxSpeed;
    state.vy = (state.vy / state.speed) * maxSpeed;
    state.speed = maxSpeed;
  }

  // ── Hard standstill ───────────────────────────────────────────────────────
  if (state.speed < standstillEps && !throttle) {
    state.vx    = 0;
    state.vy    = 0;
    state.speed = 0;
  }

  // ── Visual heading follows velocity direction (rate-limited) ──────────────
  if (state.speed > standstillEps) {
    const velocityAngle = Math.atan2(state.vy, state.vx);
    state.heading   = approachAngle(state.heading, velocityAngle, turnRate * simDt);
    state.moveAngle = velocityAngle;
  }
  // When stationary, heading and moveAngle retain their last values.
  state.headingOmega = 0;

  // ── Position integration ──────────────────────────────────────────────────
  state.x += state.vx * simDt;
  state.y += state.vy * simDt;

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
