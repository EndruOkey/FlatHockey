// Loose puck physics: movement, spin decay, friction, boundary, release helpers
import { DEFAULT_RINK_BOUNDS } from './playerMovement';

const SPIN_DAMPING_PER_SEC = 0.85;
const WALL_SPIN_REFLECT = -0.55;

export type LoosePuckState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angularVelocity: number;
};

export function advanceLoosePuck(
  state: LoosePuckState,
  dt: number,
  linearDamping: number,
  surfaceDrag: number,
  maxSpeed: number,
  restitution: number
): LoosePuckState {
  let { x, y, vx, vy, angularVelocity } = state;

  const damp = Math.exp(-linearDamping * dt);
  vx *= damp;
  vy *= damp;

  const dragFactor = 1 - Math.min(0.95, surfaceDrag) * dt * 60;
  vx *= dragFactor;
  vy *= dragFactor;

  const speed = Math.hypot(vx, vy);
  if (speed > maxSpeed) {
    const k = maxSpeed / speed;
    vx *= k;
    vy *= k;
  }

  x += vx * dt;
  y += vy * dt;

  angularVelocity *= Math.pow(SPIN_DAMPING_PER_SEC, dt);
  if (Math.abs(angularVelocity) < 0.005) angularVelocity = 0;

  if (x < DEFAULT_RINK_BOUNDS.left) {
    x = DEFAULT_RINK_BOUNDS.left;
    vx = Math.abs(vx) * restitution;
    angularVelocity *= WALL_SPIN_REFLECT;
  } else if (x > DEFAULT_RINK_BOUNDS.right) {
    x = DEFAULT_RINK_BOUNDS.right;
    vx = -Math.abs(vx) * restitution;
    angularVelocity *= WALL_SPIN_REFLECT;
  }
  if (y < DEFAULT_RINK_BOUNDS.top) {
    y = DEFAULT_RINK_BOUNDS.top;
    vy = Math.abs(vy) * restitution;
    angularVelocity *= WALL_SPIN_REFLECT;
  } else if (y > DEFAULT_RINK_BOUNDS.bottom) {
    y = DEFAULT_RINK_BOUNDS.bottom;
    vy = -Math.abs(vy) * restitution;
    angularVelocity *= WALL_SPIN_REFLECT;
  }

  return { x, y, vx, vy, angularVelocity };
}

const SHOT_SPIN_SCALE = 14.0;
const SHOT_ANGULAR_SPIN_FACTOR = 0.30; // wrist-rotation spin on shots (angular vel → puck spin)
const VELOCITY_INHERIT_SHOT = 0.55;
const VELOCITY_INHERIT_PASS = 0.45;
const VELOCITY_INHERIT_DROP = 0.68;

export type ReleaseResult = { vx: number; vy: number; angularVelocity: number };

export function computeShotRelease(
  playerVx: number,
  playerVy: number,
  bladeForwardX: number,
  bladeForwardY: number,
  impulse: number,
  lateralOffset: number,
  maxSpeed: number,
  playerAngularVelocity = 0
): ReleaseResult {
  const vx = playerVx * VELOCITY_INHERIT_SHOT + bladeForwardX * impulse;
  const vy = playerVy * VELOCITY_INHERIT_SHOT + bladeForwardY * impulse;
  const speed = Math.hypot(vx, vy);
  const k = speed > maxSpeed ? maxSpeed / speed : 1;
  // lateralOffset is 0 for hard-attached puck; wrist rotation drives spin instead
  const angularVelocity = lateralOffset * SHOT_SPIN_SCALE * (impulse / 300)
    + playerAngularVelocity * SHOT_ANGULAR_SPIN_FACTOR;
  return { vx: vx * k, vy: vy * k, angularVelocity };
}

export function computePassRelease(
  playerVx: number,
  playerVy: number,
  bladeForwardX: number,
  bladeForwardY: number,
  impulse: number,
  playerAngularVelocity: number,
  maxSpeed: number
): ReleaseResult {
  const vx = playerVx * VELOCITY_INHERIT_PASS + bladeForwardX * impulse;
  const vy = playerVy * VELOCITY_INHERIT_PASS + bladeForwardY * impulse;
  const speed = Math.hypot(vx, vy);
  const k = speed > maxSpeed ? maxSpeed / speed : 1;
  const angularVelocity = playerAngularVelocity * 0.4;
  return { vx: vx * k, vy: vy * k, angularVelocity };
}

export function computeDropRelease(
  playerVx: number,
  playerVy: number,
  bladeForwardX: number,
  bladeForwardY: number,
  playerAngularVelocity: number,
  isForceBreak: boolean
): ReleaseResult {
  const inherit = isForceBreak ? VELOCITY_INHERIT_DROP : 0.35;
  const vx = playerVx * inherit;
  const vy = playerVy * inherit;
  const speed = Math.hypot(playerVx, playerVy);
  const bladeContrib = isForceBreak ? 0.22 : 0;
  const angularVelocity = isForceBreak ? Math.abs(playerAngularVelocity) * 0.5 * (playerAngularVelocity >= 0 ? 1 : -1) : 0;
  return {
    vx: vx + bladeForwardX * speed * bladeContrib,
    vy: vy + bladeForwardY * speed * bladeContrib,
    angularVelocity
  };
}

// Compute signed lateral offset of puck from blade center (for shot spin)
export function computeLateralOffset(
  puckX: number,
  puckY: number,
  bladeCenterX: number,
  bladeCenterY: number,
  bladeForwardX: number,
  bladeForwardY: number
): number {
  const dx = puckX - bladeCenterX;
  const dy = puckY - bladeCenterY;
  // Lateral = perpendicular component to blade forward
  return dx * (-bladeForwardY) + dy * bladeForwardX;
}
