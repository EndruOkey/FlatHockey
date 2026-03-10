import type { GameplayConfig, GameplayTuning } from './gameplayConfig.types';
import { GAMEPLAY_DEFAULTS } from './gameplay.defaults';

export type GameplayConfigListener = (config: GameplayTuning) => void;

const listeners = new Set<GameplayConfigListener>();
const state: GameplayTuning = { ...GAMEPLAY_DEFAULTS };

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

export const gameplayConfigStore = {
  get(): GameplayTuning {
    return state;
  },

  set<K extends keyof GameplayTuning>(key: K, value: GameplayTuning[K]) {
    (state as Record<string, unknown>)[String(key)] = value as unknown;
    bumpVersion();
    emit();
  },

  apply(preset: Partial<GameplayTuning> | Partial<GameplayConfig>) {
    Object.assign(state, preset);
    bumpVersion();
    emit();
  },

  reset() {
    Object.keys(state).forEach((key) => delete (state as Record<string, unknown>)[key]);
    Object.assign(state, GAMEPLAY_DEFAULTS);
    bumpVersion();
    emit();
  },

  snapshot(): GameplayTuning {
    const out: GameplayTuning = {} as GameplayTuning;
    const keys = new Set<string>([
      ...Object.keys(GAMEPLAY_DEFAULTS),
      ...Object.keys(state)
    ]);
    for (const key of keys) {
      if (key === '__version') continue;
      const value = (state as Record<string, unknown>)[key];
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        (out as Record<string, unknown>)[key] = value;
      }
    }
    return out;
  },

  subscribe(listener: GameplayConfigListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

export type { GameplayConfig, GameplayTuning };
