import { GAMEPLAY_DEFAULTS } from '@flathockey/shared/tuning/gameplay.defaults';
import {
  gameplayConfigStore,
  type GameplayConfig,
  type GameplayTuning
} from '@flathockey/shared/tuning/gameplayConfigStore';

export type { GameplayConfig, GameplayTuning };

export const DEFAULTS: GameplayTuning = { ...GAMEPLAY_DEFAULTS };

export const usedTuning: Partial<GameplayTuning> = {};
export const gameplayConfig: GameplayTuning = gameplayConfigStore.get();

export function getTuning() {
  return gameplayConfigStore.get();
}

export function setTuning<K extends keyof GameplayTuning>(partial: Pick<GameplayTuning, K> | Partial<GameplayTuning>) {
  gameplayConfigStore.apply(partial);
}

export function setTuningKey<K extends keyof GameplayTuning>(key: K, value: GameplayTuning[K]) {
  gameplayConfigStore.set(key, value);
}

export function replaceTuning(next: Partial<GameplayTuning>) {
  gameplayConfigStore.reset();
  gameplayConfigStore.apply(next);
}

export function applyGameplayConfig(patch: Partial<GameplayTuning>) {
  gameplayConfigStore.apply(patch);
}

export function resetTuning() {
  gameplayConfigStore.reset();
}

export default gameplayConfig;
