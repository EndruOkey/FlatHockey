import { shortestAngleDelta, wrapAngle } from './turning';
import type { HockeyStopSide } from './movementTypes';

const STOP_ACTIVE_SPEED_EPSILON = 10;
const STOP_COOLDOWN_SEC = 0.28;
// How fast stopBlend tracks the target curve (full 0→1 in ~55ms)
const STOP_BLEND_TRACK_RATE = 1.0 / 0.055;

// Normalized event progress thresholds (0 = just entered, 1 = event fully done)
// totalEventDuration = durationSec + recoveryDurationSec (config-driven)
const STOP_POSE_PEAK_START = 0.10; // pose finishes ramping in
const STOP_POSE_PEAK_END = 0.36;  // pose starts releasing
const STOP_POSE_END = 0.84;       // pose fully at zero
const STOP_BRAKE_END_PHASE = 0.63; // active velocity-lock braking ends

export type HockeyStopStateInput = {
  speed: number;
  dt: number;
  hasMovement: boolean;
  explicitStop: boolean;
  desiredHeading: number;
  aimHeading: number;
  bodyHeading: number;
  travelHeading: number;
  stopTimerSec: number;
  stopRecoveryTimerSec: number;
  stopCooldownSec: number;
  stopBlend: number;
  stopSide: HockeyStopSide;
  stopTravelHeading: number;
  minSpeed: number;
  durationSec: number;
  recoveryDurationSec: number;
  lateralSlideFactor: number;
};

export type HockeyStopStateResult = {
  active: boolean;
  entered: boolean;
  stopTimerSec: number;
  stopRecoveryTimerSec: number;
  stopCooldownSec: number;
  stopBlend: number;
  stopSide: HockeyStopSide;
  stopTravelHeading: number;
  velocityHeading: number;
};

export type HockeyStopComputation = {
  active: boolean;
  speed: number;
  tractionMultiplier: number;
  rotationMultiplier: number;
};

export function advanceHockeyStopState(input: HockeyStopStateInput): HockeyStopStateResult {
  const dt = Math.max(0, input.dt);
  const durationSec = Math.max(0.01, input.durationSec);
  const recoveryDurationSec = Math.max(0.01, input.recoveryDurationSec);
  // stopTimerSec now counts down the ENTIRE event (durationSec + recoveryDurationSec → 0)
  const totalEventDuration = durationSec + recoveryDurationSec;
  let stopTimerSec = Math.max(0, input.stopTimerSec - dt);
  let stopCooldownSec = Math.max(0, input.stopCooldownSec - dt);
  let stopSide = sanitizeSide(input.stopSide);
  let stopTravelHeading = Number.isFinite(input.stopTravelHeading) ? wrapAngle(input.stopTravelHeading) : wrapAngle(input.travelHeading);
  let entered = false;

  if (canEnterHockeyStop(input, stopTimerSec, stopCooldownSec)) {
    entered = true;
    stopTimerSec = totalEventDuration;
    stopSide = resolveStopSide(input, stopSide);
    stopTravelHeading = wrapAngle(input.travelHeading + stopSide * input.lateralSlideFactor);
  }

  const eventRunning = stopTimerSec > 0 || entered;
  // Normalized progress through the event: 0 = just entered, 1 = done
  const eventProgress = eventRunning ? clamp01(1 - stopTimerSec / totalEventDuration) : 1;
  // Active braking (velocity lock): only during the brake phase while still moving
  const inBrakePhase = eventProgress < STOP_BRAKE_END_PHASE;
  const active = (eventRunning && inBrakePhase && input.speed > STOP_ACTIVE_SPEED_EPSILON) || entered;

  // stopBlend follows a bell-curve: fast commit → short peak → natural release
  // This drives both the visual pose AND the body orientation blend
  const targetBlend = eventRunning ? computePoseBlend(eventProgress) : 0;
  const blendStep = STOP_BLEND_TRACK_RATE * dt;
  let stopBlend = moveTowards(clamp01(input.stopBlend), targetBlend, blendStep);

  // Event fully done: start cooldown and reset transient state
  if (!eventRunning && stopBlend <= 0.001) {
    const wasInStop = input.stopSide !== 0 || input.stopBlend > 0.001;
    if (wasInStop) {
      stopCooldownSec = STOP_COOLDOWN_SEC;
    }
    stopBlend = 0;
    stopSide = 0;
    stopTravelHeading = wrapAngle(input.travelHeading);
  }

  return {
    active,
    entered,
    stopTimerSec,
    stopRecoveryTimerSec: 0, // no longer used separately — embedded in event duration
    stopCooldownSec,
    stopBlend,
    stopSide,
    stopTravelHeading,
    velocityHeading: active ? stopTravelHeading : wrapAngle(input.travelHeading)
  };
}

export function applyHockeyStop(
  speed: number,
  dt: number,
  deceleration: number,
  active: boolean,
  stopBlend: number
): HockeyStopComputation {
  if (!active || speed <= 0 || dt <= 0) {
    return {
      active: false,
      speed,
      tractionMultiplier: 1,
      rotationMultiplier: 1
    };
  }

  const blend = clamp01(stopBlend);
  const nextSpeed = approachScalar(speed, 0, Math.max(0, deceleration) * lerp(1.08, 1.28, blend) * dt);
  return {
    active: nextSpeed > STOP_ACTIVE_SPEED_EPSILON,
    speed: nextSpeed,
    tractionMultiplier: lerp(1.18, 1.42, blend),
    rotationMultiplier: lerp(1.4, 2.0, blend)
  };
}

// Bell-curve pose blend over normalized event progress:
// Ramp 0→1 (0 to PEAK_START), hold 1 (PEAK_START to PEAK_END), ramp 1→0 (PEAK_END to POSE_END), 0 after
function computePoseBlend(t: number): number {
  const ct = clamp01(t);
  if (ct < STOP_POSE_PEAK_START) {
    return ct / STOP_POSE_PEAK_START;
  }
  if (ct < STOP_POSE_PEAK_END) {
    return 1;
  }
  if (ct < STOP_POSE_END) {
    return 1 - (ct - STOP_POSE_PEAK_END) / (STOP_POSE_END - STOP_POSE_PEAK_END);
  }
  return 0;
}

function canEnterHockeyStop(input: HockeyStopStateInput, stopTimerSec: number, stopCooldownSec: number) {
  if (stopTimerSec > 0) return false;
  if (stopCooldownSec > 0) return false;
  // Block re-entry while pose is still meaningfully present from last event
  if (input.stopBlend > 0.05) return false;
  if (input.speed < Math.max(STOP_ACTIVE_SPEED_EPSILON, input.minSpeed)) return false;
  return input.explicitStop;
}

function resolveStopSide(input: HockeyStopStateInput, previousSide: HockeyStopSide): HockeyStopSide {
  const candidateHeading = input.hasMovement ? input.desiredHeading : input.aimHeading;
  const sideFromIntent = Math.sin(shortestAngleDelta(input.travelHeading, candidateHeading));
  if (Math.abs(sideFromIntent) > 0.05) {
    return sideFromIntent >= 0 ? 1 : -1;
  }

  const sideFromBody = Math.sin(shortestAngleDelta(input.travelHeading, input.bodyHeading));
  if (Math.abs(sideFromBody) > 0.05) {
    return sideFromBody >= 0 ? 1 : -1;
  }

  return previousSide === 0 ? 1 : previousSide;
}

function sanitizeSide(value: number): HockeyStopSide {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function approachScalar(current: number, target: number, maxDelta: number) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function moveTowards(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(target, current + Math.max(0, maxDelta));
  }
  return Math.max(target, current - Math.max(0, maxDelta));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
