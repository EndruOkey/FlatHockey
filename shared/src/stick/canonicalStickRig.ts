// ── Stick State Types & Timing Config ───────────────────────────────────────────────────
//
// This file retains the StickState type and CANONICAL_STICK_CONFIG timing constants.
// The stick geometry computation (computeCanonicalStickRig, computeStickRigWorld) has been
// removed — all stick pose math now lives in minimalStickRig.ts (computeMinimalStickPose).
//
// CANONICAL_STICK_CONFIG timing values are still used by:
//   server/src/game/roomSystems.ts  — stickTimer durations for each state transition
//   client/src/game/net/prediction.ts — client-side stick state prediction
//
// StickState is the wire-protocol stick state — sent over the network and stored on
// PlayerState. MinimalStickState (in minimalStickRig.ts) is the 3-value internal subset
// used for pose computation.

// Wire-protocol stick state — the value sent over the network and stored on PlayerState.
export type StickState =
  | 'neutral'
  | 'control'
  | 'turning'
  | 'oneTimerReady'
  | 'crosscheck'
  | 'pass'
  | 'charge'
  | 'release'
  | 'charge_break';

// Timing and tuning constants used by server and client prediction for state transitions.
// Geometry constants (shaftLength, bladeLength, etc.) have been removed.
export const CANONICAL_STICK_CONFIG = {
  // State durations (seconds)
  releaseDurationSec: 0.25,
  passDurationSec: 0.06,
  chargeBreakDurationSec: 0.22,
  crosscheckHoldDurationSec: 0.12,
  crosscheckRecoverySec: 0.16,
  // Impulse values (world units/s)
  passImpulse: 220,
  pokeImpulse: 180,
  // Turning threshold (rad/s) — above this angular velocity, stick state = 'turning'
  turningPenaltyAngularSpeed: 4.2,
} as const;
