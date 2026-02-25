export type MovementTuning = {
  maxSpeed: number;
  accel: number;
  sprintAccel: number;
  dragMove: number;
  dragIdle: number;
  brakeDrag: number;
  lateralGrip: number;
  reverseBrake: number;
  turnAssist: number;
  minSpeedForGrip: number;
  diagonalNormalize?: boolean;
  __version?: number;
};

const LOCAL_KEY = 'movementTuning_v1';

export const DEFAULTS: MovementTuning = {
  maxSpeed: 540,
  accel: 2200,
  sprintAccel: 2800,
  dragMove: 0.9,
  dragIdle: 0.995,
  brakeDrag: 11,
  lateralGrip: 4.0,
  reverseBrake: 6.0,
  turnAssist: 0.0,
  minSpeedForGrip: 6,
  diagonalNormalize: true,
  __version: 1
};

// Single source-of-truth object (mutable)
export const movementTuning: MovementTuning = { ...DEFAULTS };

// used tuning snapshot written by movement code for debug overlay
export const usedTuning: Partial<MovementTuning> = {};

function save() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(movementTuning)); } catch {}
}

// load any saved values into the singleton
try {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<MovementTuning>;
    Object.assign(movementTuning, parsed);
    movementTuning.__version = (movementTuning.__version ?? 0) || 1;
  }
} catch {}

export function getTuning() {
  return movementTuning;
}

export function setTuning(partial: Partial<MovementTuning>) {
  Object.assign(movementTuning, partial);
  movementTuning.__version = (movementTuning.__version ?? 0) + 1;
  save();
}

export function applyMovementTuning(patch: Partial<MovementTuning>) {
  setTuning(patch);
}

export function resetTuning() {
  Object.keys(movementTuning).forEach(k => delete (movementTuning as any)[k]);
  Object.assign(movementTuning, { ...DEFAULTS });
  movementTuning.__version = 1;
  save();
}

export function exportTuning() {
  return JSON.stringify(movementTuning, null, 2);
}

export function importTuning(json: string) {
  try {
    const parsed = JSON.parse(json) as Partial<MovementTuning>;
    Object.assign(movementTuning, { ...DEFAULTS, ...parsed });
    movementTuning.__version = (movementTuning.__version ?? 0) + 1;
    save();
  } catch {}
}

export default movementTuning;
