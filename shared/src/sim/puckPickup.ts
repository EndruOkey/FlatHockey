// Pickup gate, receive gate, sweet spot model

const PICKUP_ANGLE_MAX_COS = Math.cos(75 * Math.PI / 180); // ~0.259
const RECEIVE_ANGLE_MAX_COS = 0; // cos(90°) = 0 — more forgiving
const PICKUP_RADIUS_RECEIVE_BONUS = 1.15;
const SPIN_QUALITY_PENALTY_SCALE = 0.018;

export type SweetSpotZone = 'center' | 'toe' | 'heel';

export type PickupGateResult = {
  quality: number; // 0–1
  zone: SweetSpotZone;
};

export type PickupGateDebugResult = {
  success: boolean;
  reason: 'distance' | 'angle' | 'speed' | 'ok';
  distance: number;
  effectiveRadius: number;
  relativeSpeed: number;
  maxRelativeSpeed: number;
  angleCos: number | null;
  minAngleCos: number;
};

export type BladeZone = {
  bladeContactX: number;
  bladeContactY: number;
  bladeForwardX: number;
  bladeForwardY: number;
  bladeZoneRadius: number;
};

// Returns null if gate fails; PickupGateResult if puck can be picked up
export function evaluatePickupGate(
  puckX: number,
  puckY: number,
  puckVx: number,
  puckVy: number,
  puckSpin: number,
  playerVx: number,
  playerVy: number,
  pose: BladeZone,
  puckRadius: number,
  pickupRadius: number,
  pickupMaxRelativeSpeed: number,
  isReceive: boolean
): PickupGateResult | null;

export function evaluatePickupGate(
  puckX: number,
  puckY: number,
  puckVx: number,
  puckVy: number,
  puckSpin: number,
  playerVx: number,
  playerVy: number,
  pose: BladeZone,
  puckRadius: number,
  pickupRadius: number,
  pickupMaxRelativeSpeed: number,
  isReceive: boolean,
  debug: true
): { result: PickupGateResult | null; debug: PickupGateDebugResult };

export function evaluatePickupGate(
  puckX: number,
  puckY: number,
  puckVx: number,
  puckVy: number,
  puckSpin: number,
  playerVx: number,
  playerVy: number,
  pose: BladeZone,
  puckRadius: number,
  pickupRadius: number,
  pickupMaxRelativeSpeed: number,
  isReceive: boolean,
  debug = false
): PickupGateResult | null | { result: PickupGateResult | null; debug: PickupGateDebugResult } {
  const dx = puckX - pose.bladeContactX;
  const dy = puckY - pose.bladeContactY;
  const dist = Math.hypot(dx, dy);

  const baseRadius = pickupRadius + puckRadius;
  const effectiveRadius = baseRadius * (isReceive ? PICKUP_RADIUS_RECEIVE_BONUS : 1.0);

  // Relative speed check
  const relSpeed = Math.hypot(puckVx - playerVx, puckVy - playerVy);
  const maxRel = pickupMaxRelativeSpeed * (isReceive ? 1.12 : 1.0);

  // Angle check
  const minAngleCos = isReceive ? RECEIVE_ANGLE_MAX_COS : PICKUP_ANGLE_MAX_COS;
  let angleCos: number | null = null;
  if (dist > 0.001) {
    angleCos = (dx / dist) * pose.bladeForwardX + (dy / dist) * pose.bladeForwardY;
  }

  if (dist > effectiveRadius) {
    return finalize(null, {
      success: false,
      reason: 'distance',
      distance: dist,
      effectiveRadius,
      relativeSpeed: relSpeed,
      maxRelativeSpeed: maxRel,
      angleCos,
      minAngleCos,
    }, debug);
  }

  if (relSpeed > maxRel) {
    return finalize(null, {
      success: false,
      reason: 'speed',
      distance: dist,
      effectiveRadius,
      relativeSpeed: relSpeed,
      maxRelativeSpeed: maxRel,
      angleCos,
      minAngleCos,
    }, debug);
  }

  if (dist > 0.001) {
    if ((angleCos ?? -1) < minAngleCos) {
      return finalize(null, {
        success: false,
        reason: 'angle',
        distance: dist,
        effectiveRadius,
        relativeSpeed: relSpeed,
        maxRelativeSpeed: maxRel,
        angleCos,
        minAngleCos,
      }, debug);
    }
  }

  const zone = computeSweetSpotZone(dx, dy, dist, pose.bladeForwardX, pose.bladeForwardY);
  const zoneFactor = zone === 'center' ? 1.0 : zone === 'toe' ? 0.7 : 0.65;

  const distFactor = Math.max(0, 1 - dist / Math.max(0.001, effectiveRadius));
  const spinPenalty = Math.min(0.45, Math.abs(puckSpin) * SPIN_QUALITY_PENALTY_SCALE);
  const quality = Math.max(0, Math.min(1, distFactor * zoneFactor - spinPenalty));

  return finalize({ quality, zone }, {
    success: true,
    reason: 'ok',
    distance: dist,
    effectiveRadius,
    relativeSpeed: relSpeed,
    maxRelativeSpeed: maxRel,
    angleCos,
    minAngleCos,
  }, debug);
}

function finalize(
  result: PickupGateResult | null,
  debugResult: PickupGateDebugResult,
  debug: boolean
): PickupGateResult | null | { result: PickupGateResult | null; debug: PickupGateDebugResult } {
  return debug ? { result, debug: debugResult } : result;
}

function computeSweetSpotZone(
  dx: number,
  dy: number,
  dist: number,
  bladeForwardX: number,
  bladeForwardY: number
): SweetSpotZone {
  if (dist < 0.001) return 'center';
  const lateral = (dx / dist) * (-bladeForwardY) + (dy / dist) * bladeForwardX;
  if (Math.abs(lateral) <= 0.3) return 'center';
  return lateral > 0 ? 'toe' : 'heel';
}
