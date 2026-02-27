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

function save() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(movementTuningStore.snapshot()));
  } catch {}
}

function hydrateFromStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<MovementTuning> & Record<string, unknown>;
    if ('syncEnabled' in parsed) delete parsed.syncEnabled;
    movementTuningStore.apply(parsed);
  } catch {}
}

hydrateFromStorage();
movementTuningStore.subscribe(() => save());

export function getTuning() {
  return movementTuningStore.get();
}

export function setTuning<K extends keyof MovementTuning>(partial: Pick<MovementTuning, K> | Partial<MovementTuning>) {
  movementTuningStore.apply(partial);
}

export function setTuningKey<K extends keyof MovementTuning>(key: K, value: MovementTuning[K]) {
  movementTuningStore.set(key, value);
}

export function replaceTuning(next: Partial<MovementTuning>) {
  movementTuningStore.reset();
  movementTuningStore.apply(next);
}

export function applyMovementTuning(patch: Partial<MovementTuning>) {
  movementTuningStore.apply(patch);
}

export function resetTuning() {
  movementTuningStore.reset();
}

export function clearStoredTuning() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {}
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

export default movementTuning;
