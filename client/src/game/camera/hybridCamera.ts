export type Vec2 = {
  x: number;
  y: number;
};

export type HybridCameraTuning = {
  puckInfluence: number;
  lookAhead: number;
  smoothing: number;
  maxOffsetViewportRatio: number;
};

export type ResponsiveCameraFraming = {
  cameraScale: number;
  visibleWorldWidth: number;
  visibleWorldHeight: number;
  playerScreenHeightRatio: number;
  anchorBiasYWorld: number;
  aspectRatio: number;
  wideFactor: number;
  spanFactor: number;
};

export type CameraImpulse = {
  x: number;
  y: number;
  timer: number;
  duration: number;
};

export const HYBRID_CAMERA_CONFIG = {
  base: {
    puckInfluence: 0.18,
    lookAhead: 0.1,
    smoothing: 0.1,
    maxOffsetViewportRatio: 0.25
  },
  localControl: {
    puckInfluence: 0.12,
    lookAhead: 0.14
  },
  remoteControl: {
    puckInfluence: 0.22,
    lookAhead: 0.08
  },
  fastPuckInfluence: 0.3,
  fastPuckSpeedThreshold: 320,
  stopKick: {
    minPixels: 4,
    maxPixels: 8,
    durationSec: 0.1
  },
  shotPulse: {
    minPixels: 3,
    maxPixels: 5,
    durationSec: 0.08
  },
  turnLean: {
    maxPixels: 3.2,
    angularVelocityForMax: 6.4
  },
  responsiveFraming: {
    minPlayerScreenHeightRatio: 0.048,
    maxPlayerScreenHeightRatio: 0.062,
    standardAspect: 16 / 9,
    ultraWideAspect: 3.2,
    minScale: 0.9,
    maxScale: 2.75,
    screenBiasYMin: 0.07,
    screenBiasYMax: 0.115,
    referenceVisibleWorldHeight: 480,
    maxVisibleWidthMarginStandard: 1.22,
    maxVisibleWidthMarginWide: 1.1
  }
} as const;

export function resolveHybridCameraTuning(input: {
  localHasPuck: boolean;
  remoteHasPuck: boolean;
  puckSpeed: number;
  spanFactor?: number;
}): HybridCameraTuning {
  let puckInfluence = HYBRID_CAMERA_CONFIG.base.puckInfluence;
  let lookAhead = HYBRID_CAMERA_CONFIG.base.lookAhead;
  const spanFactor = clamp(input.spanFactor ?? 1, 0.65, 1.25);

  if (input.localHasPuck) {
    puckInfluence = HYBRID_CAMERA_CONFIG.localControl.puckInfluence;
    lookAhead = HYBRID_CAMERA_CONFIG.localControl.lookAhead;
  } else if (input.remoteHasPuck) {
    puckInfluence = HYBRID_CAMERA_CONFIG.remoteControl.puckInfluence;
    lookAhead = HYBRID_CAMERA_CONFIG.remoteControl.lookAhead;
  }

  if (input.puckSpeed >= HYBRID_CAMERA_CONFIG.fastPuckSpeedThreshold) {
    puckInfluence = Math.max(puckInfluence, HYBRID_CAMERA_CONFIG.fastPuckInfluence);
  }

  puckInfluence *= lerp(0.9, 1.08, clamp((spanFactor - 0.65) / 0.6, 0, 1));
  lookAhead *= spanFactor;

  return {
    puckInfluence: clamp(puckInfluence, 0.08, 0.32),
    lookAhead: clamp(lookAhead, 0.055, 0.16),
    smoothing: HYBRID_CAMERA_CONFIG.base.smoothing,
    maxOffsetViewportRatio: HYBRID_CAMERA_CONFIG.base.maxOffsetViewportRatio
  };
}

export function resolveResponsiveCameraFraming(input: {
  viewportWidth: number;
  viewportHeight: number;
  playerWorldHeight: number;
  rinkWorldWidth: number;
}): ResponsiveCameraFraming {
  const width = Math.max(1, input.viewportWidth);
  const height = Math.max(1, input.viewportHeight);
  const aspectRatio = width / height;
  const wideFactor = clamp(
    (aspectRatio - HYBRID_CAMERA_CONFIG.responsiveFraming.standardAspect) /
      Math.max(
        0.001,
        HYBRID_CAMERA_CONFIG.responsiveFraming.ultraWideAspect -
          HYBRID_CAMERA_CONFIG.responsiveFraming.standardAspect
      ),
    0,
    1
  );
  const playerScreenHeightRatio = lerp(
    HYBRID_CAMERA_CONFIG.responsiveFraming.minPlayerScreenHeightRatio,
    HYBRID_CAMERA_CONFIG.responsiveFraming.maxPlayerScreenHeightRatio,
    wideFactor
  );
  const visibleHeightByPlayer = input.playerWorldHeight / Math.max(0.001, playerScreenHeightRatio);
  const maxVisibleWidth =
    input.rinkWorldWidth *
    lerp(
      HYBRID_CAMERA_CONFIG.responsiveFraming.maxVisibleWidthMarginStandard,
      HYBRID_CAMERA_CONFIG.responsiveFraming.maxVisibleWidthMarginWide,
      wideFactor
    );
  const visibleHeightByWidth = maxVisibleWidth / Math.max(1, aspectRatio);
  const desiredVisibleWorldHeight = Math.min(visibleHeightByPlayer, visibleHeightByWidth);
  const cameraScale = clamp(
    height / Math.max(1, desiredVisibleWorldHeight),
    HYBRID_CAMERA_CONFIG.responsiveFraming.minScale,
    HYBRID_CAMERA_CONFIG.responsiveFraming.maxScale
  );
  const visibleWorldHeight = height / cameraScale;
  const visibleWorldWidth = width / cameraScale;
  const anchorBiasYWorld =
    (lerp(
      HYBRID_CAMERA_CONFIG.responsiveFraming.screenBiasYMin,
      HYBRID_CAMERA_CONFIG.responsiveFraming.screenBiasYMax,
      wideFactor
    ) *
      height) /
    cameraScale;
  const spanFactor =
    visibleWorldHeight / HYBRID_CAMERA_CONFIG.responsiveFraming.referenceVisibleWorldHeight;

  return {
    cameraScale,
    visibleWorldWidth,
    visibleWorldHeight,
    playerScreenHeightRatio,
    anchorBiasYWorld,
    aspectRatio,
    wideFactor,
    spanFactor
  };
}

export function computeHybridCameraTarget(input: {
  playerPosition: Vec2;
  puckPosition: Vec2;
  playerVelocity: Vec2;
  puckInfluence: number;
  lookAhead: number;
  maxOffsetX: number;
  maxOffsetY: number;
}): Vec2 {
  const unclamped = {
    x:
      input.playerPosition.x +
      (input.puckPosition.x - input.playerPosition.x) * input.puckInfluence +
      input.playerVelocity.x * input.lookAhead,
    y:
      input.playerPosition.y +
      (input.puckPosition.y - input.playerPosition.y) * input.puckInfluence +
      input.playerVelocity.y * input.lookAhead
  };

  return {
    x: input.playerPosition.x + clamp(unclamped.x - input.playerPosition.x, -input.maxOffsetX, input.maxOffsetX),
    y: input.playerPosition.y + clamp(unclamped.y - input.playerPosition.y, -input.maxOffsetY, input.maxOffsetY)
  };
}

export function computeCameraAlpha(dtSec: number, smoothing: number) {
  const clampedSmoothing = clamp(smoothing, 0, 0.95);
  const frames = Math.max(0, dtSec) * 60;
  return 1 - Math.pow(1 - clampedSmoothing, frames);
}

export function softClamp(value: number, min: number, max: number, margin: number) {
  if (min >= max) {
    return (min + max) * 0.5;
  }
  if (value <= min) return min;
  if (value >= max) return max;
  if (margin <= 0) return clamp(value, min, max);

  const low = min + margin;
  if (value < low) {
    const t = clamp((value - min) / margin, 0, 1);
    return lerp(min, value, smoothstep(t));
  }

  const high = max - margin;
  if (value > high) {
    const t = clamp((max - value) / margin, 0, 1);
    return lerp(max, value, smoothstep(t));
  }

  return value;
}

export function triggerCameraImpulse(direction: Vec2, amplitude: number, duration: number): CameraImpulse {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude <= 0.0001 || duration <= 0) {
    return {
      x: 0,
      y: 0,
      timer: 0,
      duration: 0
    };
  }

  return {
    x: (direction.x / magnitude) * amplitude,
    y: (direction.y / magnitude) * amplitude,
    timer: duration,
    duration
  };
}

export function sampleCameraImpulse(impulse: CameraImpulse, dtSec: number): Vec2 {
  if (impulse.timer <= 0 || impulse.duration <= 0) {
    impulse.timer = 0;
    return { x: 0, y: 0 };
  }

  impulse.timer = Math.max(0, impulse.timer - Math.max(0, dtSec));
  const t = clamp(impulse.timer / impulse.duration, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return {
    x: impulse.x * eased,
    y: impulse.y * eased
  };
}

export function clampMagnitude(vector: Vec2, maxMagnitude: number): Vec2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= maxMagnitude || magnitude <= 0.0001) {
    return vector;
  }

  const scale = maxMagnitude / magnitude;
  return {
    x: vector.x * scale,
    y: vector.y * scale
  };
}

export function perpendicular(vector: Vec2): Vec2 {
  return {
    x: -vector.y,
    y: vector.x
  };
}

export function normalizeOrZero(vector: Vec2): Vec2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= 0.0001) {
    return { x: 0, y: 0 };
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
