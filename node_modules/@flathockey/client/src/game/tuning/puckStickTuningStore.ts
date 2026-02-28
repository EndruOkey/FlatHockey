import {
  PUCK_STICK_DEFAULTS,
  puckStickPatchToMovementPatch,
  resolvePuckStickTuning,
  type PuckStickTuning
} from '@flathockey/shared/tuning/puckStickTuning';
import { movementTuningStore } from '@flathockey/shared/tuning/movementTuningStore';

export type { PuckStickTuning };
export const PUCK_STICK_DEFAULTS_LOCAL: PuckStickTuning = { ...PUCK_STICK_DEFAULTS };

type PuckStickListener = (t: PuckStickTuning) => void;

export const puckStickTuningStore = {
  get(): PuckStickTuning {
    return resolvePuckStickTuning(movementTuningStore.get());
  },

  set<K extends keyof PuckStickTuning>(key: K, value: PuckStickTuning[K]) {
    movementTuningStore.apply(puckStickPatchToMovementPatch({ [key]: value } as Partial<PuckStickTuning>));
  },

  apply(preset: Partial<PuckStickTuning>) {
    movementTuningStore.apply(puckStickPatchToMovementPatch(preset));
  },

  resetToDefaults() {
    movementTuningStore.apply(puckStickPatchToMovementPatch(PUCK_STICK_DEFAULTS));
  },

  snapshot(): PuckStickTuning {
    return this.get();
  },

  subscribe(listener: PuckStickListener) {
    return movementTuningStore.subscribe((t) => listener(resolvePuckStickTuning(t)));
  }
};
