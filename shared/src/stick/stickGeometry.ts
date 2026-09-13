/**
 * Canonical stick geometry — single deterministic source of truth.
 * Both renderer and gameplay read exclusively from computeCanonicalStickPose().
 *
 * Coordinate system: world units, right = +X, down = +Y.
 *
 * Key invariants enforced by this module:
 *   - Shaft never passes through the player circle.
 *   - Pivot is stable (bodyAngle-driven), never aimAngle-driven.
 *   - Blade is NOT perpendicular to shaft (~9° off perpendicular).
 *   - One canonical bladeContactPoint and puckCarryRefPoint.
 *   - aimAngle passed in must already be clamped via clampAimToBodyZone().
 */

export type StickPoseInput = {
  playerX: number;
  playerY: number;
  /** Body facing direction (radians). Pivot derives from this — stable, not aim-driven. */
  bodyAngle: number;
  /**
   * Resolved aim direction (radians). Must be pre-clamped by clampAimToBodyZone().
   * computeCanonicalStickPose() treats this as ground truth — no additional clamping.
   */
  aimAngle: number;
  handedness: 'left' | 'right';
  playerRadius: number;
};

export type CanonicalStickPose = {
  /**
   * Grip anchor: side-front of player circle, derived from bodyAngle + handedness.
   * Stable — does NOT move with aimAngle.
   */
  pivotX: number;
  pivotY: number;
  /**
   * Shaft start: guaranteed to be outside the player circle.
   * When aim points generally outward from pivot, shaftStart = pivot.
   * When aim points inward (across player body), shaftStart is pushed to the
   * far circle intersection so the shaft never passes through the player.
   */
  shaftStartX: number;
  shaftStartY: number;
  /** Shaft end: shaftStart + aimDir * shaftLength. */
  shaftEndX: number;
  shaftEndY: number;
  /** Blade center: at shaft end. */
  bladeCenterX: number;
  bladeCenterY: number;
  /** Blade direction unit vector (heel → toe). */
  bladeDirX: number;
  bladeDirY: number;
  /** Blade heel end (toward player body side). */
  bladeHeelX: number;
  bladeHeelY: number;
  /** Blade toe end (away from player body). */
  bladeToeX: number;
  bladeToeY: number;
  /**
   * Canonical blade contact point.
   * Future basis for: puck carry, pickup gate, release origin.
   * Stable and deterministic.
   */
  bladeContactX: number;
  bladeContactY: number;
  /**
   * Puck carry reference point.
   * Defines where the puck "sits" relative to the blade.
   * Shared between renderer and gameplay — no duplicates allowed.
   */
  puckCarryRefX: number;
  puckCarryRefY: number;
};

/**
 * Geometric constants — tune here, never hardcode in callers.
 */
export const STICK_GEOMETRY_CONFIG = {
  /**
   * Pivot forward offset from body center (× playerRadius).
   * Keeps the grip anchor near the hands instead of deep in the torso.
   */
  pivotForwardFactor: 0.45,

  /**
   * Pivot side offset from body center (× playerRadius × handedness sign).
   * Tuned to keep the hands visually outside the torso silhouette.
   */
  pivotSideFactor: 0.78,

  /**
   * Shaft clearance from player circle (world units).
   * Applied when aimAngle would cause shaft to pass through player.
   */
  shaftClearance: 1.0,

  /**
   * Shaft length = playerRadius × this factor.
   * Measured from shaftStart to shaftEnd.
   */
  shaftLengthFactor: 2.38,

  /**
   * Blade half-length = playerRadius × this factor.
   */
  bladeHalfLengthFactor: 0.53,

  /**
   * Blade offset from perpendicular-to-shaft (radians).
   * 0 = exactly perpendicular (T-shape, forbidden).
   * ~9° (≈ 0.157 rad) gives a visible blade hook without going too diagonal.
   */
  bladeOffsetFromPerpRad: Math.PI / 20,   // exactly 9°

  /**
   * Blade heel fraction: how much of half-length extends toward player body.
   */
  bladeHeelFraction: 0.40,

  /**
   * Blade toe fraction: how much of half-length extends away from player body.
   */
  bladeToeAFraction: 0.60,

  /**
   * Contact point position along blade heel→toe (0 = heel, 1 = toe).
   * Slightly past center toward toe for natural puck carry feel.
   */
  bladeContactRatio: 0.55,

  /**
   * Maximum stick aim offset from bodyAngle (radians).
   * Defines the working zone: stick can only point within ±maxAimOffsetRad of bodyAngle.
   * 90° = stick stays in the front hemisphere. Tune 70°–110° for feel.
   * Used by clampAimToBodyZone() — not enforced internally by computeCanonicalStickPose().
   */
  maxAimOffsetRad: Math.PI / 2,   // 90°

  /**
   * Cursor must cross the body center by at least this much before the stick
   * is allowed to swap to the opposite side after being latched on an edge.
   */
  centerCrossBufferRad: Math.PI / 9, // 20°

  /**
   * Tolerance for treating the current resolved angle as effectively sitting
   * on a cone boundary.
   */
  boundaryLatchEpsilonRad: Math.PI / 36, // 5°
} as const;

/**
 * Normalize angle to [-π, π].
 */
function normalizeAngle(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

/**
 * Clamp raw aim angle to the stick working zone relative to bodyAngle.
 *
 * Returns resolvedAimAngle — the angle to pass into computeCanonicalStickPose().
 *
 * Anti-snap: when aim sweeps behind the player and crosses the ±π boundary,
 * the sign of the normalized delta flips, which would cause a 2×maxOffset jump.
 * This is prevented by locking to the last-used boundary side until aim re-enters
 * the zone from a consistent direction.
 *
 * @param bodyAngle    Current body facing direction (radians)
 * @param rawAim       Raw aim angle from input (radians) — unclamped
 * @param maxOffset    Working zone half-width (radians). Use STICK_GEOMETRY_CONFIG.maxAimOffsetRad.
 * @param prevResolved Previously returned resolved angle. Pass bodyAngle on first call.
 * @returns            Resolved aim angle, guaranteed within [bodyAngle-maxOffset, bodyAngle+maxOffset]
 */
export function clampAimToBodyZone(
  bodyAngle: number,
  rawAim: number,
  maxOffset: number,
  prevResolved: number,
): number {
  const rawDelta  = normalizeAngle(rawAim      - bodyAngle);
  const prevDelta = normalizeAngle(prevResolved - bodyAngle);
  const centerCrossBuffer = Math.min(maxOffset * 0.45, STICK_GEOMETRY_CONFIG.centerCrossBufferRad);
  const boundaryLatchEpsilon = STICK_GEOMETRY_CONFIG.boundaryLatchEpsilonRad;
  const rawSide = sideOfDelta(rawDelta);
  const prevSide = sideOfDelta(prevDelta);
  const prevLatchedToBoundary = Math.abs(Math.abs(prevDelta) - maxOffset) <= boundaryLatchEpsilon;

  if (Math.abs(rawDelta) <= maxOffset) {
    // Aim is inside working zone.
    // If we were previously pinned to one edge and the cursor only just crossed
    // center to the opposite side, stay on the old edge until the cross is
    // deliberate enough. This removes edge-to-edge snapping across the torso.
    if (
      prevLatchedToBoundary &&
      prevSide !== 0 &&
      rawSide !== 0 &&
      rawSide !== prevSide &&
      Math.abs(rawDelta) < centerCrossBuffer
    ) {
      return bodyAngle + prevSide * maxOffset;
    }

    return bodyAngle + rawDelta;
  }

  // Aim is outside zone — lock to a boundary.
  //
  // Key: when aim crosses directly behind (rawDelta sign flips at ±π),
  // we prefer the side the stick was already on (prevDelta sign) to prevent snap.
  // Only switch sides once aim genuinely returns to the zone from the new side.
  if (prevSide === 0 || rawSide === prevSide) {
    // Same side as before, or no history — lock to this boundary.
    return bodyAngle + rawSide * maxOffset;
  }

  // Aim and previous resolved are on opposite sides (swept behind).
  // Stay locked to the previous boundary — no snap.
  return bodyAngle + prevSide * maxOffset;
}

function sideOfDelta(delta: number): -1 | 0 | 1 {
  if (delta > 0.0001) return 1;
  if (delta < -0.0001) return -1;
  return 0;
}

/**
 * Compute the canonical stick pose from current player state.
 *
 * Pure function — no hidden state, no smoothing, no blending.
 * Call once per render/sim tick per player.
 *
 * IMPORTANT: aimAngle must already be clamped via clampAimToBodyZone().
 * This function treats aimAngle as ground truth and does not re-clamp.
 */
export function computeCanonicalStickPose(input: StickPoseInput): CanonicalStickPose {
  const { playerX, playerY, bodyAngle, aimAngle, handedness, playerRadius } = input;
  const handSign = handedness === 'right' ? 1 : -1;
  const cfg = STICK_GEOMETRY_CONFIG;

  // ── Pivot ──────────────────────────────────────────────────────────────────
  // Side-front grip anchor, stable from bodyAngle only.
  const bodyForwardX = Math.cos(bodyAngle);
  const bodyForwardY = Math.sin(bodyAngle);
  const bodyRightX = -bodyForwardY;
  const bodyRightY = bodyForwardX;
  const pivotX =
    playerX +
    bodyForwardX * playerRadius * cfg.pivotForwardFactor +
    bodyRightX * playerRadius * cfg.pivotSideFactor * handSign;
  const pivotY =
    playerY +
    bodyForwardY * playerRadius * cfg.pivotForwardFactor +
    bodyRightY * playerRadius * cfg.pivotSideFactor * handSign;

  // ── Shaft start (guaranteed outside player circle) ─────────────────────────
  // The line from pivot in aimAngle direction may re-enter the player circle when
  // aim points "back through" the player (pivot on one side, aim going the other).
  //
  // Analytical solution: pivot is on the circle, so the parametric line
  //   P(t) = pivot + t * aimDir
  // intersects the circle at t = 0 (pivot) and t = -2*(v · aimDir)
  //   where v = pivot - playerCenter.
  //
  // If tExit > 0, the shaft would start inside the player — we push shaftStart
  // to the far intersection plus clearance. Otherwise shaftStart = pivot.
  const aimDirX = Math.cos(aimAngle);
  const aimDirY = Math.sin(aimAngle);
  const vx = pivotX - playerX;
  const vy = pivotY - playerY;
  const vDotAim = vx * aimDirX + vy * aimDirY;
  const tExit = -2 * vDotAim;

  let shaftStartX: number;
  let shaftStartY: number;
  if (tExit > 0) {
    // Aim crosses through player — push to far circle edge + clearance.
    const t = tExit + cfg.shaftClearance;
    shaftStartX = pivotX + aimDirX * t;
    shaftStartY = pivotY + aimDirY * t;
  } else {
    // Aim points outward from pivot — start at pivot (already on circle edge).
    shaftStartX = pivotX;
    shaftStartY = pivotY;
  }

  // ── Shaft end ──────────────────────────────────────────────────────────────
  const shaftLength = playerRadius * cfg.shaftLengthFactor;
  const shaftEndX = shaftStartX + aimDirX * shaftLength;
  const shaftEndY = shaftStartY + aimDirY * shaftLength;

  // ── Blade ──────────────────────────────────────────────────────────────────
  // Blade direction = aimAngle ± (90° - 9°) * handSign.
  // Result: ~81° from shaft — clearly non-perpendicular (not T-shape),
  // reads as a hockey blade from top-down.
  const bladeAngle = aimAngle + (Math.PI / 2 - cfg.bladeOffsetFromPerpRad) * handSign;
  const bladeDirX = Math.cos(bladeAngle);
  const bladeDirY = Math.sin(bladeAngle);

  const bladeHalfLen = playerRadius * cfg.bladeHalfLengthFactor;
  const bladeCenterX = shaftEndX;
  const bladeCenterY = shaftEndY;

  // Heel: toward player body (negative blade direction).
  const bladeHeelX = bladeCenterX - bladeDirX * bladeHalfLen * cfg.bladeHeelFraction;
  const bladeHeelY = bladeCenterY - bladeDirY * bladeHalfLen * cfg.bladeHeelFraction;

  // Toe: away from player body (positive blade direction).
  const bladeToeX = bladeCenterX + bladeDirX * bladeHalfLen * cfg.bladeToeAFraction;
  const bladeToeY = bladeCenterY + bladeDirY * bladeHalfLen * cfg.bladeToeAFraction;

  // ── Blade contact point ────────────────────────────────────────────────────
  const cr = cfg.bladeContactRatio;
  const bladeContactX = bladeHeelX + (bladeToeX - bladeHeelX) * cr;
  const bladeContactY = bladeHeelY + (bladeToeY - bladeHeelY) * cr;

  // ── Puck carry reference ───────────────────────────────────────────────────
  // Baseline: same as blade contact point.
  // Future: may shift slightly toward blade concave face.
  const puckCarryRefX = bladeContactX;
  const puckCarryRefY = bladeContactY;

  return {
    pivotX, pivotY,
    shaftStartX, shaftStartY,
    shaftEndX, shaftEndY,
    bladeCenterX, bladeCenterY,
    bladeDirX, bladeDirY,
    bladeHeelX, bladeHeelY,
    bladeToeX, bladeToeY,
    bladeContactX, bladeContactY,
    puckCarryRefX, puckCarryRefY,
  };
}
