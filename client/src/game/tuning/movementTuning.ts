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
const SAVE_DEBOUNCE_MS = 700;
let saveTimer: number | null = null;
let tuningApplyCount = 0;

function save() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(movementTuningStore.snapshot()));
  } catch {}
}

function scheduleSave() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    save();
  }, SAVE_DEBOUNCE_MS);
}

function markApply() {
  tuningApplyCount += 1;
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
movementTuningStore.subscribe(() => scheduleSave());

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
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {}
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
