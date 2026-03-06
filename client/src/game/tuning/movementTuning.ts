import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';
import {
  movementTuningStore,
  type MovementTuning,
  type MovementTuningListener
} from '@flathockey/shared/tuning/movementTuningStore';

export type { MovementTuning };

export const LOCAL_KEY = 'movementTuning_v1';
export const DEFAULTS: MovementTuning = { ...MOVEMENT_DEFAULTS };

export const usedTuning: Partial<MovementTuning> = {};
export const movementTuning: MovementTuning = movementTuningStore.get();
let tuningApplyCount = 0;

function markApply() {
  tuningApplyCount += 1;
}

export function getTuning() {
  return movementTuningStore.get();
}

export function setTuning<K extends keyof MovementTuning>(partial: Pick<MovementTuning, K> | Partial<MovementTuning>) {
  markApply();
  movementTuningStore.apply(partial);
}

export function setTuningKey<K extends keyof MovementTuning>(key: K, value: MovementTuning[K]) {
  markApply();
  movementTuningStore.set(key, value);
}

export function replaceTuning(next: Partial<MovementTuning>) {
  markApply();
  movementTuningStore.reset();
  movementTuningStore.apply(next);
}

export function applyMovementTuning(patch: Partial<MovementTuning>) {
  markApply();
  movementTuningStore.apply(patch);
}

export function resetTuning() {
  markApply();
  movementTuningStore.reset();
}

export function clearStoredTuning() {
  markApply();
  movementTuningStore.reset();
}

export function exportTuning() {
  return JSON.stringify(movementTuningStore.snapshot(), null, 2);
}

export function importTuning(json: string) {
  try {
    const parsed = JSON.parse(json) as Partial<MovementTuning>;
    replaceTuning(parsed);
  } catch {}
}

export function snapshotTuning(): Partial<MovementTuning> {
  return movementTuningStore.snapshot();
}

export function subscribeTuning(listener: MovementTuningListener) {
  return movementTuningStore.subscribe(listener);
}

export function getTuningApplyCount() {
  return tuningApplyCount;
}

export default movementTuning;
