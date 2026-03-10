import {
  PUCK_STICK_DEFAULTS,
  puckStickPatchToGameplayPatch,
  resolvePuckStickTuning,
  type PuckStickTuning
} from '@flathockey/shared/tuning/puckStickTuning';
import { gameplayConfigStore } from '@flathockey/shared/tuning/gameplayConfigStore';

export type { PuckStickTuning };
export const PUCK_STICK_DEFAULTS_LOCAL: PuckStickTuning = { ...PUCK_STICK_DEFAULTS };

type PuckStickListener = (t: PuckStickTuning) => void;

export const puckStickTuningStore = {
  get(): PuckStickTuning {
    return resolvePuckStickTuning(gameplayConfigStore.get());
  },

  set<K extends keyof PuckStickTuning>(key: K, value: PuckStickTuning[K]) {
    gameplayConfigStore.apply(puckStickPatchToGameplayPatch({ [key]: value } as Partial<PuckStickTuning>));
  },

  apply(preset: Partial<PuckStickTuning>) {
    gameplayConfigStore.apply(puckStickPatchToGameplayPatch(preset));
  },

  resetToDefaults() {
    gameplayConfigStore.apply(puckStickPatchToGameplayPatch(PUCK_STICK_DEFAULTS));
  },

  snapshot(): PuckStickTuning {
    return this.get();
  },

  subscribe(listener: PuckStickListener) {
    return gameplayConfigStore.subscribe((t) => listener(resolvePuckStickTuning(t)));
  }
};
