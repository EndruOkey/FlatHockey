import type { MovementTuning } from './movementTuning';
import { DEFAULTS } from './movementTuning';

export type TuningCategory = 'Home' | 'Movement' | 'NetDebug' | 'Rotation' | 'Puck';
export type TuningParamKind = 'number' | 'boolean';

export type TuningParamMeta = {
  key: keyof MovementTuning;
  label: string;
  hint?: string;
  category: TuningCategory;
  group: string;
  kind: TuningParamKind;
  min?: number;
  max?: number;
  step?: number;
  recommended?: boolean;
  keywords?: string[];
  advanced?: boolean;
};

const BASE_REGISTRY: TuningParamMeta[] = [
  { key: 'headingModeEnabled', label: 'Smer tela ovlivnuje pohyb', category: 'Movement', group: 'Arc Movement', kind: 'boolean', recommended: true, keywords: ['arc', 'heading', 'steer'] },
  { key: 'maxTurnRateLowSpeed', label: 'Zataceni pri rozjezdu', hint: 'Jak rychle se hrac otaci pri nizke rychlosti.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 20, step: 0.01, recommended: true, keywords: ['turn', 'arc', 'low'] },
  { key: 'maxTurnRateHighSpeed', label: 'Zataceni ve skluzu', hint: 'Jak rychle se hrac otaci pri vysoke rychlosti.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 20, step: 0.01, recommended: true, keywords: ['turn', 'arc', 'high'] },
  { key: 'lateralDamping', label: 'Drift Stabilita', hint: 'Urcuje, jak moc hrac ujizdi bokem pri zmene smeru.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 2, step: 0.001, recommended: true, keywords: ['lateral', 'damp', 'drift'] },

  { key: 'regimesEnabled', label: 'Two-Regime Enabled', category: 'Movement', group: 'Two-Regime', kind: 'boolean', recommended: true, keywords: ['regime', 'blend', 'split'] },
  { key: 'speedSplit', label: 'Prechod do skluzu', hint: 'Procento rychlosti, kdy se aktivuje skluzovy rezim.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 1, step: 0.001, recommended: true, keywords: ['split', 'threshold'] },
  { key: 'splitBlendWidth', label: 'Split Blend Width', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0.01, max: 0.8, step: 0.001, recommended: true, keywords: ['blend', 'width'] },
  { key: 'lateralGrip_hi', label: 'Prilnavost ve skluzu', hint: 'Jak moc drzi smer pri vysoke rychlosti.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, recommended: true, keywords: ['grip', 'high'] },

  { key: 'maxSpeed', label: 'Maximalni rychlost', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, recommended: true, keywords: ['speed', 'cap'] },
  { key: 'accel', label: 'Accel', category: 'Movement', group: 'Core', kind: 'number', min: 200, max: 5000, step: 1, recommended: true, keywords: ['accel', 'core'] },
  { key: 'accel_lo', label: 'Rozjezd', hint: 'Jak svizne hrac startuje z mista.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 200, max: 5000, step: 1, recommended: true, keywords: ['accel', 'low'] },
  { key: 'accel_hi', label: 'Boost pri skluzu', hint: 'Zrychleni, ktere hrac ziskava pri vyssi rychlosti.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 200, max: 5000, step: 1, recommended: true, keywords: ['accel', 'high'] },
  { key: 'dragMove', label: 'Move Drag', category: 'Movement', group: 'Core', kind: 'number', min: 0, max: 10, step: 0.001, recommended: true, keywords: ['drag', 'core'] },
  { key: 'dragMove_lo', label: 'Brzdeni pri pomale jizde', hint: 'Jak rychle se zastavi pri nizke rychlosti.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 10, step: 0.001, recommended: true, keywords: ['drag', 'low'] },
  { key: 'dragMove_hi', label: 'Ubytek rychlosti ve skluzu', hint: 'Jak rychle ztraci rychlost pri vysokem pohybu.', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 10, step: 0.001, recommended: true, keywords: ['drag', 'high'] },

  { key: 'sprintAccel', label: 'Sprint Accel', category: 'Movement', group: 'Core', kind: 'number', min: 200, max: 6000, step: 1, advanced: true },
  { key: 'dragIdle', label: 'Idle Drag', category: 'Movement', group: 'Core', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'lateralGrip', label: 'Lateral Grip', category: 'Movement', group: 'Grip & Turn', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'reverseBrake', label: 'Reverse Brake', category: 'Movement', group: 'Brake', kind: 'number', min: 0, max: 20, step: 0.01, advanced: true },
  { key: 'brakeCurve', label: 'Brake Curve', category: 'Movement', group: 'Brake', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },
  { key: 'brakeDrag', label: 'Brake Drag', category: 'Movement', group: 'Brake', kind: 'number', min: 0, max: 30, step: 0.01, advanced: true },
  { key: 'steeringEnabled', label: 'Steering Enabled', category: 'Movement', group: 'Grip & Turn', kind: 'boolean', advanced: true },
  { key: 'steerStrength', label: 'Steer Strength', category: 'Movement', group: 'Grip & Turn', kind: 'number', min: 0, max: 30, step: 0.01, advanced: true },
  { key: 'turnAssist', label: 'Turn Assist', category: 'Movement', group: 'Grip & Turn', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },
  { key: 'driftAssist', label: 'Drift Assist', category: 'Movement', group: 'Grip & Turn', kind: 'number', min: 0, max: 1, step: 0.001, advanced: true },

  { key: 'maxSpeedNoPuck', label: 'Max Speed No Puck', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, advanced: true },
  { key: 'maxSpeedWithPuck', label: 'Max Speed With Puck', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, advanced: true },
  { key: 'dragIdle_lo', label: 'Idle Drag Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'dragIdle_hi', label: 'Idle Drag High', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'lateralGrip_lo', label: 'Lateral Grip Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'brakeCurve_lo', label: 'Brake Curve Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },
  { key: 'brakeCurve_hi', label: 'Brake Curve High', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },

  { key: '__version', label: 'Version', category: 'NetDebug', group: 'State', kind: 'number', advanced: true, keywords: ['version', 'hash'] }
];

function titleCaseFromKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase());
}

function inferRange(v: number) {
  const abs = Math.abs(v);
  return {
    min: v >= 0 ? 0 : -Math.max(1, abs * 2),
    max: Math.max(1, abs * 2),
    step: abs >= 100 ? 1 : 0.01
  };
}

export const PARAM_REGISTRY: TuningParamMeta[] = (() => {
  const map = new Map<keyof MovementTuning, TuningParamMeta>();
  for (const item of BASE_REGISTRY) {
    map.set(item.key, item);
  }

  const defaults = DEFAULTS as Record<string, unknown>;
  for (const keyRaw of Object.keys(defaults)) {
    const key = keyRaw as keyof MovementTuning;
    if (map.has(key)) continue;
    if (key === '__version') continue;

    const val = defaults[keyRaw];
    const kind: TuningParamKind = typeof val === 'boolean' ? 'boolean' : 'number';
    const range = typeof val === 'number' ? inferRange(val) : undefined;

    map.set(key, {
      key,
      label: titleCaseFromKey(keyRaw),
      category: 'Movement',
      group: 'Advanced',
      kind,
      min: range?.min,
      max: range?.max,
      step: range?.step,
      advanced: true,
      keywords: [keyRaw.toLowerCase()]
    });
  }

  return [...map.values()];
})();

export function getParamMeta(key: keyof MovementTuning): TuningParamMeta | undefined {
  return PARAM_REGISTRY.find((p) => p.key === key);
}
