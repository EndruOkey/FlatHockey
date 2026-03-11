const STOP_ACTIVE_SPEED_EPSILON = 12;

export type HockeyStopDecisionInput = {
  explicitStop: boolean;
  velocityX: number;
  velocityY: number;
  speed: number;
  moveDirX: number;
  moveDirY: number;
  reverseDotThreshold: number;
  reverseSpeedThreshold: number;
};

export type HockeyStopDecision = {
  stopRequested: boolean;
  explicitStop: boolean;
  reverseIntent: boolean;
};

export type HockeyStopComputation = {
  active: boolean;
  velocityX: number;
  velocityY: number;
  speed: number;
};

export function shouldTriggerHockeyStop(input: HockeyStopDecisionInput): HockeyStopDecision {
  const hasMoveIntent = Math.hypot(input.moveDirX, input.moveDirY) > 0;
  let reverseIntent = false;

  if (hasMoveIntent && input.speed >= input.reverseSpeedThreshold) {
    const velocityDirX = input.velocityX / Math.max(input.speed, 0.0001);
    const velocityDirY = input.velocityY / Math.max(input.speed, 0.0001);
    const dot = velocityDirX * input.moveDirX + velocityDirY * input.moveDirY;
    reverseIntent = dot <= input.reverseDotThreshold;
  }

  return {
    stopRequested: input.explicitStop || reverseIntent,
    explicitStop: input.explicitStop,
    reverseIntent
  };
}

export function applyHockeyStop(
  velocityX: number,
  velocityY: number,
  dt: number,
  deceleration: number,
  active: boolean
): HockeyStopComputation {
  const speed = Math.hypot(velocityX, velocityY);
  if (!active || speed <= 0 || dt <= 0) {
    return {
      active: false,
      velocityX,
      velocityY,
      speed
    };
  }

  const nextSpeed = approachScalar(speed, 0, Math.max(0, deceleration) * dt);
  const scale = speed > 0 ? nextSpeed / speed : 0;

  return {
    active: nextSpeed > STOP_ACTIVE_SPEED_EPSILON,
    velocityX: velocityX * scale,
    velocityY: velocityY * scale,
    speed: nextSpeed
  };
}

function approachScalar(current: number, target: number, maxDelta: number) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}
