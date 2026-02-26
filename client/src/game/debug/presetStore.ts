import { PRESETS } from '@flathockey/shared/tuning/movementPresets';
import type { MovementTuning } from './movementTuning';
import { DEFAULTS, snapshotTuning } from './movementTuning';

export type PresetSource = 'builtin' | 'user';

export type StoredPreset = {
  id: string;
  name: string;
  source: PresetSource;
  tuning: Partial<MovementTuning>;
  updatedAt: number;
};

export type PresetState = {
  selectedPresetId: string;
  presets: StoredPreset[];
};

export const PRESET_STATE_KEY = 'movementPresetState_v1';
export const PINNED_PARAMS_KEY = 'movementPinnedParams_v1';

const BUILTIN_PREFIX = 'builtin:';
const USER_PREFIX = 'user:';

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'preset';
}

function sanitizeTuning(input: Partial<MovementTuning>): Partial<MovementTuning> {
  const out: Partial<MovementTuning> = {};
  const validKeys = new Set<string>([
    ...Object.keys(DEFAULTS),
    ...Object.keys(input as Record<string, unknown>)
  ]);
  for (const key of validKeys) {
    if (key === '__version') continue;
    const val = (input as Record<string, unknown>)[key];
    if (typeof val === 'number' || typeof val === 'boolean') {
      (out as Record<string, unknown>)[key] = val;
    }
  }
  return out;
}

function expandPresetTuning(tuning: Partial<MovementTuning>): Partial<MovementTuning> {
  return sanitizeTuning({ ...DEFAULTS, ...tuning });
}

export function getBuiltinPresets(): StoredPreset[] {
  const out: StoredPreset[] = [];
  for (const [name, patch] of Object.entries(PRESETS)) {
    out.push({
      id: `${BUILTIN_PREFIX}${name}`,
      name,
      source: 'builtin',
      tuning: sanitizeTuning(patch as Partial<MovementTuning>),
      updatedAt: 0
    });
  }
  return out;
}

export function loadPresetState(): PresetState {
  const builtins = getBuiltinPresets();
  const fallback = builtins.find((p) => p.name === 'BestNow')?.id ?? builtins[0]?.id ?? `${BUILTIN_PREFIX}BestNow`;

  try {
    const raw = localStorage.getItem(PRESET_STATE_KEY);
    if (!raw) {
      return { selectedPresetId: fallback, presets: [] };
    }

    const parsed = JSON.parse(raw) as Partial<PresetState>;
    const users = Array.isArray(parsed.presets)
      ? parsed.presets
          .filter((p): p is StoredPreset => !!p && typeof p === 'object' && p.source === 'user' && typeof p.name === 'string')
          .map((p) => ({
            ...p,
            id: p.id || `${USER_PREFIX}${slugify(p.name)}`,
            source: 'user' as const,
            tuning: sanitizeTuning(p.tuning ?? {}),
            updatedAt: Number.isFinite(p.updatedAt) ? Number(p.updatedAt) : Date.now()
          }))
      : [];

    const allIds = new Set<string>([...builtins.map((b) => b.id), ...users.map((u) => u.id)]);
    const selected = typeof parsed.selectedPresetId === 'string' && allIds.has(parsed.selectedPresetId)
      ? parsed.selectedPresetId
      : fallback;

    return { selectedPresetId: selected, presets: users };
  } catch {
    return { selectedPresetId: fallback, presets: [] };
  }
}

export function savePresetState(state: PresetState) {
  const payload: PresetState = {
    selectedPresetId: state.selectedPresetId,
    presets: state.presets.filter((p) => p.source === 'user').map((p) => ({
      ...p,
      tuning: sanitizeTuning(p.tuning)
    }))
  };
  try {
    localStorage.setItem(PRESET_STATE_KEY, JSON.stringify(payload));
  } catch {}
}

export function listAllPresets(state: PresetState): StoredPreset[] {
  return [...getBuiltinPresets(), ...state.presets];
}

export function findPresetById(state: PresetState, id: string): StoredPreset | undefined {
  return listAllPresets(state).find((p) => p.id === id);
}

export function applySelection(state: PresetState, presetId: string): PresetState {
  const exists = !!findPresetById(state, presetId);
  return {
    ...state,
    selectedPresetId: exists ? presetId : state.selectedPresetId
  };
}

export function saveCurrentToSelected(state: PresetState): { state: PresetState; saved: boolean; requiresSaveAs: boolean } {
  const selected = findPresetById(state, state.selectedPresetId);
  if (!selected || selected.source === 'builtin') {
    return { state, saved: false, requiresSaveAs: true };
  }

  const snapshot = sanitizeTuning(snapshotTuning());
  const updated: StoredPreset = {
    ...selected,
    tuning: snapshot,
    updatedAt: Date.now()
  };

  const nextState: PresetState = {
    ...state,
    presets: state.presets.map((p) => (p.id === updated.id ? updated : p))
  };
  savePresetState(nextState);
  return { state: nextState, saved: true, requiresSaveAs: false };
}

export function saveAsPreset(state: PresetState, nameRaw: string): PresetState {
  const name = nameRaw.trim();
  if (!name) return state;

  const now = Date.now();
  const snapshot = sanitizeTuning(snapshotTuning());
  const byName = state.presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const id = byName?.id ?? `${USER_PREFIX}${slugify(name)}`;

  const updated: StoredPreset = {
    id,
    name,
    source: 'user',
    tuning: snapshot,
    updatedAt: now
  };

  const existingIdx = state.presets.findIndex((p) => p.id === id);
  const nextPresets = [...state.presets];
  if (existingIdx >= 0) {
    nextPresets[existingIdx] = updated;
  } else {
    nextPresets.push(updated);
  }

  const nextState: PresetState = {
    selectedPresetId: updated.id,
    presets: nextPresets
  };

  savePresetState(nextState);
  return nextState;
}

export function loadPinnedKeys(validKeys: string[]): string[] {
  try {
    const raw = localStorage.getItem(PINNED_PARAMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(validKeys);
    return parsed.filter((k): k is string => typeof k === 'string' && valid.has(k));
  } catch {
    return [];
  }
}

export function savePinnedKeys(keys: string[]) {
  const deduped = [...new Set(keys)];
  try {
    localStorage.setItem(PINNED_PARAMS_KEY, JSON.stringify(deduped));
  } catch {}
}

export function clearPresetAndPinnedStorage() {
  try {
    localStorage.removeItem(PRESET_STATE_KEY);
  } catch {}
  try {
    localStorage.removeItem(PINNED_PARAMS_KEY);
  } catch {}
}

export function isPresetDirty(preset: StoredPreset | undefined): boolean {
  if (!preset) return false;
  const current = sanitizeTuning(snapshotTuning());
  const target = expandPresetTuning(preset.tuning);
  const keys = new Set<string>([...Object.keys(current), ...Object.keys(target)]);
  for (const key of keys) {
    if ((current as Record<string, unknown>)[key] !== (target as Record<string, unknown>)[key]) {
      return true;
    }
  }
  return false;
}
