// Crosscheck v2: hold model, directional outcomes, positional push.
//
// First contact (initial press) = strongest instability hit.
// Sustain (held) = continuous weaker pressure, gated by sustainCooldown.
// Impact magnitude scales with attacker's velocity aligned to their blade direction.

export type CrosscheckMode = 'first_contact' | 'sustain';

// Contact geometry
const CROSSCHECK_CONTACT_RADIUS_MULT = 2.0;

// Instability amounts per mode
const FIRST_CONTACT_BASE_INSTABILITY = 0.48;
const SUSTAIN_BASE_INSTABILITY = 0.15;
const CROSSCHECK_ANGLE_BONUS = 0.18;   // bonus when attacker blade faces puck

// Directional velocity multiplier range — replaces zone-based multipliers
// 0.5 (glancing / slow) → 1.5 (full-speed aligned attack)
const VELOCITY_DIR_MULT_MIN = 0.5;
const VELOCITY_DIR_MULT_MAX = 1.5;
const VELOCITY_DIR_NORMALIZER = 30;    // wu/s at which mult reaches max

// Force break / transfer thresholds
const FORCE_BREAK_INSTABILITY_THRESHOLD = 0.65;
const TRANSFER_MIN_QUALITY = 0.55;

// Positional push force applied to carrier (world units/s impulse)
const PUSH_FORCE_FIRST = 38;
const PUSH_FORCE_SUSTAIN = 15;

const PROTECTED_MULT = 0.45;

export type CrosscheckResult = {
  didContact: boolean;
  instabilityAdded: number;
  forceBreak: boolean;
  transferToAttacker: boolean;
  contactImpulse: number;
  /** Velocity impulse applied to the carrier on the server (world units/s). */
  pushVx: number;
  pushVy: number;
};

export type BladeZone = {
  bladeContactX: number;
  bladeContactY: number;
  bladeForwardX: number;
  bladeForwardY: number;
  bladeZoneRadius: number;
};

export function evaluateCrosscheck(
  puckX: number,
  puckY: number,
  puckVx: number,
  puckVy: number,
  puckRadius: number,
  attackerPose: BladeZone,
  attackerVx: number,
  attackerVy: number,
  carrierVx: number,
  carrierVy: number,
  carrierX: number,
  carrierY: number,
  attackerX: number,
  attackerY: number,
  currentInstability: number,
  pickupRadius: number,
  pickupMaxRelativeSpeed: number,
  isProtected: boolean,
  mode: CrosscheckMode
): CrosscheckResult {
  const dist = Math.hypot(puckX - attackerPose.bladeContactX, puckY - attackerPose.bladeContactY);
  const contactRadius = (attackerPose.bladeZoneRadius + puckRadius) * CROSSCHECK_CONTACT_RADIUS_MULT;

  if (dist > contactRadius) {
    return { didContact: false, instabilityAdded: 0, forceBreak: false, transferToAttacker: false, contactImpulse: 0, pushVx: 0, pushVy: 0 };
  }

  const relVx = attackerVx - carrierVx;
  const relVy = attackerVy - carrierVy;
  const relSpeed = Math.hypot(relVx, relVy);
  const contactImpulse = relSpeed;

  // Angle bonus: attacker blade is well-aligned toward puck
  let angleBonus = 0;
  if (dist > 0.001) {
    const toPuckX = (puckX - attackerPose.bladeContactX) / dist;
    const toPuckY = (puckY - attackerPose.bladeContactY) / dist;
    const angleDot = toPuckX * attackerPose.bladeForwardX + toPuckY * attackerPose.bladeForwardY;
    if (angleDot > 0.5) angleBonus = CROSSCHECK_ANGLE_BONUS;
  }

  // Directional velocity multiplier: how aligned is attacker's relative velocity with their blade forward?
  // High alignment (attacker charging straight at carrier) = strong impact.
  // Glancing or slow = weak impact. Replaces zone-based carrier multiplier.
  const velDirDot = relSpeed > 0.001
    ? (relVx / relSpeed) * attackerPose.bladeForwardX + (relVy / relSpeed) * attackerPose.bladeForwardY
    : 0;
  const velocityDirMult = VELOCITY_DIR_MULT_MIN + Math.max(0, velDirDot) * (VELOCITY_DIR_MULT_MAX - VELOCITY_DIR_MULT_MIN);

  const baseInstability = mode === 'first_contact' ? FIRST_CONTACT_BASE_INSTABILITY : SUSTAIN_BASE_INSTABILITY;
  const protectedMult = isProtected ? PROTECTED_MULT : 1.0;
  const instabilityAdded = (baseInstability + angleBonus) * protectedMult * velocityDirMult;
  const newInstability = Math.min(1, currentInstability + instabilityAdded);
  const forceBreak = newInstability >= FORCE_BREAK_INSTABILITY_THRESHOLD;

  // Positional push: push carrier away from attacker
  const pushBodyDist = Math.hypot(carrierX - attackerX, carrierY - attackerY);
  const pushDirX = pushBodyDist > 0.001 ? (carrierX - attackerX) / pushBodyDist : 1;
  const pushDirY = pushBodyDist > 0.001 ? (carrierY - attackerY) / pushBodyDist : 0;
  const pushMagnitude = mode === 'first_contact' ? PUSH_FORCE_FIRST : PUSH_FORCE_SUSTAIN;
  const pushVx = pushDirX * pushMagnitude;
  const pushVy = pushDirY * pushMagnitude;

  // Transfer: can attacker instantly receive the puck?
  let transferToAttacker = false;
  if (forceBreak) {
    const relSpeed = Math.hypot(puckVx - attackerVx, puckVy - attackerVy);
    if (relSpeed <= pickupMaxRelativeSpeed && dist <= pickupRadius + attackerPose.bladeZoneRadius) {
      let transferQuality = 0;
      if (dist > 0.001) {
        const toPuckX = (puckX - attackerPose.bladeContactX) / dist;
        const toPuckY = (puckY - attackerPose.bladeContactY) / dist;
        transferQuality = Math.max(0, toPuckX * attackerPose.bladeForwardX + toPuckY * attackerPose.bladeForwardY);
      }
      transferToAttacker = transferQuality >= TRANSFER_MIN_QUALITY;
    }
  }

  return { didContact: true, instabilityAdded, forceBreak, transferToAttacker, contactImpulse, pushVx, pushVy };
}
