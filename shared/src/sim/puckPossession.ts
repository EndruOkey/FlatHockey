// Possession states, instability meter, and break rules

export type PossessionState = 'LOOSE' | 'PROTECTED_OWNED' | 'OWNED';

// Constants (all tunable later)
const DECAY_RATE = 2.8;
const CONTACT_INSTABILITY_SCALE = 0.004;
const BREAK_THRESHOLD = 0.65;             // instability threshold — only reachable via crosscheck contact
const HARD_TURN_BREAK_AV = 6.5;          // rad/s — immediate break on extreme spin

export const PROTECTED_DURATION_SEC = 0.12;
export const REPICKUP_LOCKOUT_MS = 200;

// Tick instability each frame while puck is owned.
// Only body-contact impulse builds instability — turning and speed do not.
// Puck is sticky by default; strips only come from explicit combat contact.
export function tickInstability(
  instability: number,
  dt: number,
  contactImpulse: number
): number {
  let inst = instability - DECAY_RATE * dt;
  if (contactImpulse > 0) {
    inst += contactImpulse * CONTACT_INSTABILITY_SCALE;
  }
  return Math.max(0, Math.min(1, inst));
}

// Returns true if possession should break.
// Breaks only from: extreme angular velocity (hard spin) or crosscheck instability threshold.
export function checkPossessionBreak(
  instability: number,
  angularVelocity: number
): boolean {
  if (Math.abs(angularVelocity) > HARD_TURN_BREAK_AV) return true;
  return instability >= BREAK_THRESHOLD;
}

// Compute body contact impulse between carrier and nearby opponents
// Returns total contact impulse to add this tick
export function computeBodyContactImpulse(
  carrierX: number,
  carrierY: number,
  carrierVx: number,
  carrierVy: number,
  opponentX: number,
  opponentY: number,
  opponentVx: number,
  opponentVy: number,
  playerRadius: number
): number {
  const dist = Math.hypot(carrierX - opponentX, carrierY - opponentY);
  const contactThreshold = playerRadius * 2.2;
  if (dist >= contactThreshold) return 0;
  // Relative velocity of opponent toward carrier
  const relVx = opponentVx - carrierVx;
  const relVy = opponentVy - carrierVy;
  const dirX = (carrierX - opponentX) / Math.max(0.001, dist);
  const dirY = (carrierY - opponentY) / Math.max(0.001, dist);
  const approachSpeed = relVx * dirX + relVy * dirY;
  return Math.max(0, approachSpeed);
}
