import type { MovementStepConfig } from '@flathockey/shared/sim/movementStep';
import { BestNow } from '@flathockey/shared/tuning/movementPresets';

export type MovementTuning = MovementStepConfig & {
  __version?: number;
};

export const LOCAL_KEY = 'movementTuning_v1';

export const DEFAULTS: MovementTuning = {
  // legacy alias used by the local prediction/UI
  maxSpeed: BestNow.maxSpeedNoPuck ?? 342.5,
  maxSpeedNoPuck: BestNow.maxSpeedNoPuck ?? 342.5,
  maxSpeedWithPuck: BestNow.maxSpeedWithPuck ?? 342.5,

  accel: BestNow.accel ?? 1681.36,
  sprintAccel: 2800,
  dragMove: BestNow.dragMove ?? 2.75,
  dragIdle: BestNow.dragIdle ?? 0.96909,
  brakeDrag: 11,

  lateralGrip: BestNow.lateralGrip ?? 1.13636,
  reverseBrake: BestNow.reverseBrake ?? 0,
  brakeCurve: BestNow.brakeCurve ?? 0.7545,

  headingModeEnabled: true,
  maxTurnRateLowSpeed: 6,
  maxTurnRateHighSpeed: 1.8,
  lateralDamping: 0.12,

  steeringEnabled: false,
  steerStrength: 6,
  brakeDecel: 20,
  turnAssist: 0,
  driftAssist: 0,

  regimesEnabled: true,
  speedSplit: 0.4,
  splitBlendWidth: 0.12,

  accel_lo: 1932.57,
  dragMove_lo: 3.025,
  dragIdle_lo: 0.96909,
  lateralGrip_lo: 1.36363,
  brakeCurve_lo: 0.7922,

  accel_hi: 1429.156,
  dragMove_hi: 2.3375,
  dragIdle_hi: 0.920636,
  lateralGrip_hi: 0.9659,
  brakeCurve_hi: 0.71678,

  __version: 1
};

export const movementTuning: MovementTuning = { ...DEFAULTS };
export const usedTuning: Partial<MovementTuning> = {};

function normalizeAliases() {
  if (typeof movementTuning.maxSpeed === 'number') {
    movementTuning.maxSpeedNoPuck = movementTuning.maxSpeed;
    movementTuning.maxSpeedWithPuck = movementTuning.maxSpeed;
  } else if (typeof movementTuning.maxSpeedNoPuck === 'number') {
    movementTuning.maxSpeed = movementTuning.maxSpeedNoPuck;
    if (typeof movementTuning.maxSpeedWithPuck !== 'number') {
      movementTuning.maxSpeedWithPuck = movementTuning.maxSpeedNoPuck;
    }
  }
}

function save() {
  normalizeAliases();
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(movementTuning));
  } catch {}
}

try {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<MovementTuning> & Record<string, unknown>;
    if ('syncEnabled' in parsed) delete parsed.syncEnabled;
    Object.assign(movementTuning, parsed);
  }
} catch {}

normalizeAliases();
movementTuning.__version = (movementTuning.__version ?? 0) || 1;

export function getTuning() {
  return movementTuning;
}

export function setTuning(partial: Partial<MovementTuning>) {
  Object.assign(movementTuning, partial);
  normalizeAliases();
  movementTuning.__version = (movementTuning.__version ?? 0) + 1;
  save();
}

export function replaceTuning(next: Partial<MovementTuning>) {
  Object.keys(movementTuning).forEach((k) => delete (movementTuning as Record<string, unknown>)[k]);
  Object.assign(movementTuning, { ...DEFAULTS, ...next });
  normalizeAliases();
  movementTuning.__version = (movementTuning.__version ?? 0) + 1;
  save();
}

export function applyMovementTuning(patch: Partial<MovementTuning>) {
  setTuning(patch);
}

export function resetTuning() {
  Object.keys(movementTuning).forEach((k) => delete (movementTuning as Record<string, unknown>)[k]);
  Object.assign(movementTuning, { ...DEFAULTS, __version: 1 });
  save();
}

export function clearStoredTuning() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {}
  resetTuning();
}

export function exportTuning() {
  normalizeAliases();
  return JSON.stringify(movementTuning, null, 2);
}

export function importTuning(json: string) {
  try {
    const parsed = JSON.parse(json) as Partial<MovementTuning>;
    replaceTuning(parsed);
  } catch {}
}

export function snapshotTuning(): Partial<MovementTuning> {
  normalizeAliases();
  const out: Partial<MovementTuning> = {};
  const keys = new Set<string>([
    ...Object.keys(DEFAULTS),
    ...Object.keys(movementTuning)
  ]);
  for (const key of keys) {
    if (key === '__version') continue;
    const val = (movementTuning as Record<string, unknown>)[key];
    if (typeof val === 'number' || typeof val === 'boolean') {
      (out as Record<string, unknown>)[key] = val;
    }
  }
  return out;
}

export default movementTuning;
