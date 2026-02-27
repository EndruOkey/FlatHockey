import type { MovementStepConfig } from '../sim/movementStep';
import { MOVEMENT_DEFAULTS, type MovementTuning } from './movement.defaults';

export type MovementTuningListener = (tuning: MovementTuning) => void;

const listeners = new Set<MovementTuningListener>();
const state: MovementTuning = { ...MOVEMENT_DEFAULTS };

function normalizeAliases() {
  if (typeof state.maxSpeed === 'number') {
    state.maxSpeedNoPuck = state.maxSpeed;
    state.maxSpeedWithPuck = state.maxSpeed;
    return;
  }
  if (typeof state.maxSpeedNoPuck === 'number') {
    state.maxSpeed = state.maxSpeedNoPuck;
    if (typeof state.maxSpeedWithPuck !== 'number') {
      state.maxSpeedWithPuck = state.maxSpeedNoPuck;
    }
  }
}

function emit() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {}
  }
}

function bumpVersion() {
  state.__version = (state.__version ?? 0) + 1;
}

normalizeAliases();

export const movementTuningStore = {
  get(): MovementTuning {
    normalizeAliases();
    return state;
  },

  set<K extends keyof MovementTuning>(key: K, value: MovementTuning[K]) {
    (state as Record<string, unknown>)[String(key)] = value as unknown;
    normalizeAliases();
    bumpVersion();
    emit();
  },

  apply(preset: Partial<MovementTuning> | Partial<MovementStepConfig>) {
    Object.assign(state, preset);
    normalizeAliases();
    bumpVersion();
    emit();
  },

  reset() {
    Object.keys(state).forEach((k) => delete (state as Record<string, unknown>)[k]);
    Object.assign(state, MOVEMENT_DEFAULTS);
    normalizeAliases();
    bumpVersion();
    emit();
  },

  snapshot(): MovementTuning {
    normalizeAliases();
    const out: MovementTuning = {} as MovementTuning;
    const keys = new Set<string>([
      ...Object.keys(MOVEMENT_DEFAULTS),
      ...Object.keys(state)
    ]);
    for (const key of keys) {
      if (key === '__version') continue;
      const val = (state as Record<string, unknown>)[key];
      if (typeof val === 'number' || typeof val === 'boolean') {
        (out as Record<string, unknown>)[key] = val;
      }
    }
    return out;
  },

  subscribe(listener: MovementTuningListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

export type { MovementTuning };
