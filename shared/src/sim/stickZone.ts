// Stick zone: mouse-distance-based carry/interaction zones with hysteresis.
// Zones determine pickup quality, instability gain, crosscheck outcome, and poke strength.
// All thresholds are in world units (default playerRadius = 18).

export type StickZone = 'CLOSE' | 'MID' | 'EXTENDED';

// Entry thresholds — transition INTO a zone when distance crosses these
const CLOSE_ENTER = 24;      // enter CLOSE when dist < 24
const EXTENDED_ENTER = 50;   // enter EXTENDED when dist >= 50

// Exit thresholds — leave a zone only when distance crosses these (hysteresis gap)
const CLOSE_EXIT = 30;       // leave CLOSE when dist > 30
const EXTENDED_EXIT = 44;    // leave EXTENDED when dist < 44

export const ZONE_THRESHOLDS = {
  CLOSE_ENTER,
  CLOSE_EXIT,
  EXTENDED_ENTER,
  EXTENDED_EXIT
} as const;

/**
 * Resolves the new stick zone given the current aim distance from the player center
 * and the previous zone (for hysteresis).
 *
 * @param aimDistance  World-space distance from player center to aim cursor.
 *                     Pass undefined / negative to default to EXTENDED (safe fallback).
 * @param current      Current zone (for hysteresis dead-band logic).
 */
export function resolveStickZone(
  aimDistance: number | undefined,
  current: StickZone
): StickZone {
  const d = typeof aimDistance === 'number' && aimDistance >= 0 ? aimDistance : EXTENDED_ENTER + 1;

  switch (current) {
    case 'CLOSE':
      if (d > CLOSE_EXIT) return d >= EXTENDED_ENTER ? 'EXTENDED' : 'MID';
      return 'CLOSE';

    case 'MID':
      if (d <= CLOSE_ENTER) return 'CLOSE';
      if (d >= EXTENDED_ENTER) return 'EXTENDED';
      return 'MID';

    case 'EXTENDED':
      if (d < EXTENDED_EXIT) return d <= CLOSE_ENTER ? 'CLOSE' : 'MID';
      return 'EXTENDED';
  }
}
