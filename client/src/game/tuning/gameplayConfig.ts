import { GAMEPLAY_DEFAULTS } from '@flathockey/shared/tuning/gameplay.defaults';
import {
  gameplayConfigStore,
  type GameplayConfig,
  type GameplayConfigListener,
  type GameplayTuning
} from '@flathockey/shared/tuning/gameplayConfigStore';

export type { GameplayConfig, GameplayTuning };

export const LOCAL_KEY = 'gameplayConfig_v1';
export const DEFAULTS: GameplayTuning = { ...GAMEPLAY_DEFAULTS };

export const usedTuning: Partial<GameplayTuning> = {};
export const gameplayConfig: GameplayTuning = gameplayConfigStore.get();
let tuningApplyCount = 0;

function markApply() {
  tuningApplyCount += 1;
}

export function getTuning() {
  return gameplayConfigStore.get();
}

export function setTuning<K extends keyof GameplayTuning>(partial: Pick<GameplayTuning, K> | Partial<GameplayTuning>) {
  markApply();
  gameplayConfigStore.apply(partial);
}

export function setTuningKey<K extends keyof GameplayTuning>(key: K, value: GameplayTuning[K]) {
  markApply();
  gameplayConfigStore.set(key, value);
}

export function replaceTuning(next: Partial<GameplayTuning>) {
  markApply();
  gameplayConfigStore.reset();
  gameplayConfigStore.apply(next);
}

export function applyGameplayConfig(patch: Partial<GameplayTuning>) {
  markApply();
  gameplayConfigStore.apply(patch);
}

export function resetTuning() {
  markApply();
  gameplayConfigStore.reset();
}

export function clearStoredTuning() {
  markApply();
  gameplayConfigStore.reset();
}

export function exportTuning() {
  return JSON.stringify(gameplayConfigStore.snapshot(), null, 2);
}

export function importTuning(json: string) {
  try {
    const parsed = JSON.parse(json) as Partial<GameplayTuning>;
    replaceTuning(parsed);
  } catch {}
}

export function snapshotTuning(): Partial<GameplayTuning> {
  return gameplayConfigStore.snapshot();
}

export function subscribeTuning(listener: GameplayConfigListener) {
  return gameplayConfigStore.subscribe(listener);
}

export function getTuningApplyCount() {
  return tuningApplyCount;
}

export default gameplayConfig;
