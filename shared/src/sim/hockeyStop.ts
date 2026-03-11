const STOP_ACTIVE_SPEED_EPSILON = 10;

export type HockeyStopDecision = {
  stopRequested: boolean;
};

export type HockeyStopComputation = {
  active: boolean;
  speed: number;
  tractionMultiplier: number;
  rotationMultiplier: number;
};

export function shouldTriggerHockeyStop(explicitStop: boolean): HockeyStopDecision {
  return {
    stopRequested: !!explicitStop
  };
}

export function applyHockeyStop(speed: number, dt: number, deceleration: number, active: boolean): HockeyStopComputation {
  if (!active || speed <= 0 || dt <= 0) {
    return {
      active: false,
      speed,
      tractionMultiplier: 1,
      rotationMultiplier: 1
    };
  }

  const nextSpeed = approachScalar(speed, 0, Math.max(0, deceleration) * dt);
  return {
    active: nextSpeed > STOP_ACTIVE_SPEED_EPSILON,
    speed: nextSpeed,
    tractionMultiplier: 1.25,
    rotationMultiplier: 1.12
  };
}

function approachScalar(current: number, target: number, maxDelta: number) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}
