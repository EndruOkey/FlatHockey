import type { MovementTuning } from './movementTuning';
import { DEFAULTS } from './movementTuning';

export type TuningCategory = 'Home' | 'Movement' | 'NetDebug' | 'Rotation' | 'Puck';
export type TuningParamKind = 'number' | 'boolean' | 'enum';
export type TuningEnumOption = { value: string; label: string };

export type TuningParamMeta = {
  key: keyof MovementTuning;
  label: string;
  hint?: string;
  category: TuningCategory;
  group: string;
  kind: TuningParamKind;
  enumOptions?: TuningEnumOption[];
  min?: number;
  max?: number;
  step?: number;
  recommended?: boolean;
  keywords?: string[];
  advanced?: boolean;
};

const BASE_REGISTRY: TuningParamMeta[] = [
  { key: 'headingModeEnabled', label: 'Legacy Heading Steering (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'boolean', advanced: true, keywords: ['legacy', 'inactive', 'heading', 'steer'] },
  { key: 'maxTurnRateLowSpeed', label: 'Legacy Turn Rate Low (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 20, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'turn'] },
  { key: 'maxTurnRateHighSpeed', label: 'Legacy Turn Rate High (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 20, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'turn'] },
  { key: 'inputDirectionTauMs', label: 'Legacy Input Angle Tau (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 20, max: 400, step: 5, advanced: true, keywords: ['legacy', 'inactive', 'input', 'angle', 'tau'] },
  { key: 'turnIntentTauMs', label: 'Legacy Turn Intent Tau (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 20, max: 500, step: 5, advanced: true, keywords: ['legacy', 'inactive', 'turn', 'intent', 'tau'] },
  { key: 'inputVectorTauMs', label: 'Input Vector Tau (ms)', hint: 'Smoothing raw input vector before force solve.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 10, max: 300, step: 5, recommended: true, keywords: ['input', 'vector', 'tau'] },
  { key: 'forwardAccel', label: 'Forward Accel Force', hint: 'Primary skate push along travel frame.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 100, max: 5000, step: 1, recommended: true, keywords: ['forward', 'force', 'accel'] },
  { key: 'lateralSteerForce', label: 'Lateral Steer Force', hint: 'Side steering force before velocity resistance.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 3000, step: 1, recommended: true, keywords: ['lateral', 'steer', 'force'] },
  { key: 'velocityTurnResistance', label: 'Velocity Steer Resistance', hint: 'How strongly speed/angle delta limits steering.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 4, step: 0.01, recommended: true, keywords: ['velocity', 'resistance', 'steer'] },
  { key: 'oppositeSteerScale', label: 'Opposite Input Scale', hint: 'How much reverse input is allowed into force solve.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['opposite', 'reverse', 'scale'] },
  { key: 'carveStrength', label: 'Carve Strength', hint: 'Extra speed-scaled damping of lateral slip.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 3, step: 0.01, recommended: true, keywords: ['carve', 'lateral', 'damping'] },
  { key: 'oppositeTurnResistance', label: 'Legacy Opposite Turn Resistance (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 3, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'opposite', 'turn'] },
  { key: 'redirectAccelPenalty', label: 'Legacy Redirect Accel Penalty (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 3, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'redirect'] },
  { key: 'antiFlipWindowMs', label: 'Legacy Anti-Flip Window (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 400, step: 5, advanced: true, keywords: ['legacy', 'inactive', 'anti-flip'] },
  { key: 'antiFlipPenalty', label: 'Legacy Anti-Flip Penalty (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 1, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'anti-flip'] },
  { key: 'lateralDamping', label: 'Drift Stabilita', hint: 'Urcuje, jak moc hrac ujizdi bokem pri zmene smeru.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 2, step: 0.001, recommended: true, keywords: ['lateral', 'damp', 'drift'] },
  { key: 'brakeTurnRateBoost', label: 'Legacy Brake Turn Boost (inactive)', hint: 'Inactive with velocity-force movement core.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 1, max: 3, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'brake', 'turn'] },
  { key: 'brakeLateralDamping', label: 'Brake Lateral Damping', hint: 'Jak rychle brzda zabiji bocni skluz.', category: 'Movement', group: 'Arc Movement', kind: 'number', min: 0, max: 6, step: 0.01, recommended: true, keywords: ['brake', 'lateral', 'damping'] },

  { key: 'regimesEnabled', label: 'Legacy Two-Regime Enabled (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'boolean', advanced: true, keywords: ['legacy', 'inactive', 'regime', 'blend', 'split'] },
  { key: 'speedSplit', label: 'Legacy Speed Split (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 1, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'split', 'threshold'] },
  { key: 'splitBlendWidth', label: 'Legacy Split Blend Width (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0.01, max: 0.8, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'blend', 'width'] },
  { key: 'lateralGrip_hi', label: 'Legacy High-Speed Grip (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'grip', 'high'] },

  { key: 'maxSpeed', label: 'Maximalni rychlost', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, recommended: true, keywords: ['speed', 'cap'] },
  { key: 'accel', label: 'Accel', category: 'Movement', group: 'Core', kind: 'number', min: 200, max: 5000, step: 1, recommended: true, keywords: ['accel', 'core'] },
  { key: 'accel_lo', label: 'Legacy Low-Speed Accel (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 200, max: 5000, step: 1, advanced: true, keywords: ['legacy', 'inactive', 'accel', 'low'] },
  { key: 'accel_hi', label: 'Legacy High-Speed Accel (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 200, max: 5000, step: 1, advanced: true, keywords: ['legacy', 'inactive', 'accel', 'high'] },
  { key: 'dragMove', label: 'Move Drag', category: 'Movement', group: 'Core', kind: 'number', min: 0, max: 10, step: 0.001, recommended: true, keywords: ['drag', 'core'] },
  { key: 'dragMove_lo', label: 'Legacy Low-Speed Drag (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 10, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'drag', 'low'] },
  { key: 'dragMove_hi', label: 'Legacy High-Speed Drag (inactive)', hint: 'Inactive with current solver.', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 10, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'drag', 'high'] },

  { key: 'sprintAccel', label: 'Sprint Accel', category: 'Movement', group: 'Core', kind: 'number', min: 200, max: 6000, step: 1, advanced: true },
  { key: 'dragIdle', label: 'Idle Drag', category: 'Movement', group: 'Core', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'lateralGrip', label: 'Legacy Lateral Grip (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'grip'] },
  { key: 'reverseBrake', label: 'Legacy Reverse Brake (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 20, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'brake'] },
  { key: 'brakeCurve', label: 'Legacy Brake Curve (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'brake'] },
  { key: 'brakeDrag', label: 'Brake Drag', category: 'Movement', group: 'Brake', kind: 'number', min: 0, max: 30, step: 0.01, advanced: true },
  { key: 'steeringEnabled', label: 'Legacy Steering Enabled (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'boolean', advanced: true, keywords: ['legacy', 'inactive', 'steering'] },
  { key: 'steerStrength', label: 'Legacy Steer Strength (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 30, step: 0.01, advanced: true, keywords: ['legacy', 'inactive', 'steer'] },
  { key: 'turnAssist', label: 'Legacy Turn Assist (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'turn'] },
  { key: 'driftAssist', label: 'Legacy Drift Assist (inactive)', category: 'Movement', group: 'Legacy / Inactive', kind: 'number', min: 0, max: 1, step: 0.001, advanced: true, keywords: ['legacy', 'inactive', 'drift'] },
  {
    key: 'controlScheme',
    label: 'Control Scheme',
    category: 'Movement',
    group: 'Input / Controls',
    kind: 'enum',
    enumOptions: [
      { value: 'WASD_MOVE_MOUSE_AIM', label: 'WASD_MOVE_MOUSE_AIM' },
      { value: 'MOUSE_DRIVES_MOVE', label: 'MOUSE_DRIVES_MOVE' }
    ],
    recommended: true,
    keywords: ['control', 'input', 'scheme']
  },
  {
    key: 'handedness',
    label: 'Handedness',
    category: 'Movement',
    group: 'Input / Controls',
    kind: 'enum',
    enumOptions: [
      { value: 'R', label: 'Right' },
      { value: 'L', label: 'Left' }
    ],
    recommended: true,
    keywords: ['hand', 'left', 'right', 'stick']
  },
  {
    key: 'bodyOrientationModel',
    label: 'Body Model',
    category: 'Rotation',
    group: 'Body',
    kind: 'enum',
    enumOptions: [
      { value: 'B', label: 'B' },
      { value: 'C', label: 'C' }
    ],
    recommended: true,
    keywords: ['body', 'model', 'hybrid', 'experiment']
  },
  {
    key: 'bodyFacingMode',
    label: 'Legacy Body Facing Mode (inactive)',
    category: 'Rotation',
    group: 'Legacy / Inactive',
    kind: 'enum',
    enumOptions: [
      { value: 'MOVE_LAST', label: 'MOVE_LAST' },
      { value: 'AIM_WHEN_IDLE', label: 'AIM_WHEN_IDLE' },
      { value: 'BLEND', label: 'BLEND' },
      { value: 'AIM_ALWAYS', label: 'AIM_ALWAYS' }
    ],
    advanced: true,
    keywords: ['body', 'facing', 'idle', 'legacy', 'inactive']
  },
  { key: 'bodyTurnRate', label: 'Body Turn Rate (rad/s)', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 30, step: 0.1, recommended: true, keywords: ['body', 'turn'] },
  { key: 'bodyTurnRateLowSpeedMult', label: 'Body Turn LowSpeed Mult', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 4, step: 0.05, advanced: true, keywords: ['body', 'turn', 'low'] },
  { key: 'bodyAimBias', label: 'Body Aim Bias', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 0.4, step: 0.01, recommended: true, keywords: ['body', 'aim', 'bias', 'hybrid'] },
  { key: 'bodyAimResponseTauMs', label: 'Body Aim Response Tau (ms)', category: 'Rotation', group: 'Body', kind: 'number', min: 40, max: 400, step: 5, recommended: true, keywords: ['body', 'aim', 'tau', 'hybrid'] },
  { key: 'bodyHybridDeadzoneDeg', label: 'Body Hybrid Deadzone Deg', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 90, step: 1, recommended: true, keywords: ['body', 'aim', 'deadzone', 'hybrid'] },
  { key: 'maxBodyYawOffsetDeg', label: 'Max Body Yaw Offset Deg', category: 'Rotation', group: 'Body Yaw Offset', kind: 'number', min: 0, max: 90, step: 1, recommended: true, keywords: ['body', 'yaw', 'offset', 'max'] },
  { key: 'bodyYawSpeedDeg', label: 'Body Yaw Speed Deg/s', category: 'Rotation', group: 'Body Yaw Offset', kind: 'number', min: 30, max: 720, step: 5, recommended: true, keywords: ['body', 'yaw', 'speed'] },
  { key: 'bodyYawReturnSpeedDeg', label: 'Body Yaw Return Deg/s', category: 'Rotation', group: 'Body Yaw Offset', kind: 'number', min: 30, max: 720, step: 5, recommended: true, keywords: ['body', 'yaw', 'return'] },
  { key: 'bodyManualTurnRateDeg', label: 'Body Manual Turn Deg/s', category: 'Rotation', group: 'Body', kind: 'number', min: 90, max: 720, step: 5, recommended: true, keywords: ['body', 'manual', 'turn'] },
  { key: 'bodyManualTurnOverridesAutoFacing', label: 'Manual Turn Overrides AutoFacing', category: 'Rotation', group: 'Body', kind: 'boolean', recommended: true, keywords: ['body', 'manual', 'override', 'facing'] },
  { key: 'bodyManualMaxOffsetDeg', label: 'Body Manual Max Offset Deg', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'number', min: 0, max: 90, step: 1, recommended: true, keywords: ['body', 'manual', 'offset', 'carve'] },
  { key: 'bodyManualTauMs', label: 'Body Manual Tau (ms)', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'number', min: 40, max: 400, step: 5, recommended: true, keywords: ['body', 'manual', 'tau', 'spring'] },
  { key: 'bodyManualDampingRatio', label: 'Body Manual Damping Ratio', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'number', min: 0.6, max: 1.3, step: 0.01, recommended: true, keywords: ['body', 'manual', 'damping', 'spring'] },
  { key: 'bodyManualMaxAngVelDeg', label: 'Body Manual Max AngVel Deg/s', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'number', min: 300, max: 3000, step: 25, recommended: true, keywords: ['body', 'manual', 'max', 'angvel'] },
  { key: 'bodyManualUseVelBase', label: 'Body Manual Use Velocity Base', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'boolean', recommended: true, keywords: ['body', 'manual', 'velocity', 'base'] },
  { key: 'bodyManualVelBaseThreshold', label: 'Body Manual Vel Base Threshold', category: 'Rotation', group: 'Body / Edge-Carve', kind: 'number', min: 0, max: 200, step: 1, recommended: true, keywords: ['body', 'manual', 'velocity', 'threshold'] },
  { key: 'maxBodyOffsetDeg', label: 'Max Body Offset Deg', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 90, step: 1, recommended: true, keywords: ['body', 'offset', 'handling'] },
  { key: 'bodyReturnTauMs', label: 'Body Return Tau (ms)', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 600, step: 5, recommended: true, keywords: ['body', 'return', 'tau'] },
  { key: 'bodyBaseSpeedThreshold', label: 'Body Base Speed Threshold', category: 'Rotation', group: 'Body', kind: 'number', min: 0, max: 300, step: 1, advanced: true, keywords: ['body', 'base', 'speed'] },
  { key: 'visualLeanEnabled', label: 'Visual Lean Enabled', category: 'Rotation', group: 'Body / Visual Lean', kind: 'boolean', recommended: true, keywords: ['visual', 'lean', 'body'] },
  { key: 'visualLeanMaxPx', label: 'Visual Lean Max Px', category: 'Rotation', group: 'Body / Visual Lean', kind: 'number', min: 0, max: 20, step: 0.5, recommended: true, keywords: ['visual', 'lean', 'max'] },
  { key: 'visualLeanTauMs', label: 'Visual Lean Tau (ms)', category: 'Rotation', group: 'Body / Visual Lean', kind: 'number', min: 40, max: 400, step: 5, recommended: true, keywords: ['visual', 'lean', 'tau'] },
  { key: 'visualLeanDampingRatio', label: 'Visual Lean Damping Ratio', category: 'Rotation', group: 'Body / Visual Lean', kind: 'number', min: 0.6, max: 1.3, step: 0.01, recommended: true, keywords: ['visual', 'lean', 'damping'] },
  { key: 'visualLeanMaxAngleDeg', label: 'Visual Lean Max Angle Deg', category: 'Rotation', group: 'Body / Visual Lean', kind: 'number', min: 10, max: 120, step: 1, recommended: true, keywords: ['visual', 'lean', 'angle'] },
  { key: 'aimEnabled', label: 'Mouse Aim Enabled', category: 'Movement', group: 'Aim', kind: 'boolean', recommended: true, keywords: ['aim', 'mouse'] },
  { key: 'aimMaxTurnRate', label: 'Aim Max Turn Rate', hint: 'Input filter: values > 60 are treated as deg/s.', category: 'Rotation', group: 'Aim Input Filter', kind: 'number', min: 0, max: 2500, step: 10, recommended: true, keywords: ['aim', 'turn', 'rate'] },
  { key: 'aimDeadzonePx', label: 'Aim Deadzone Px', category: 'Rotation', group: 'Aim Input Filter', kind: 'number', min: 0, max: 80, step: 1, recommended: true, keywords: ['aim', 'deadzone'] },
  { key: 'aimSmoothing', label: 'Aim Smoothing', category: 'Rotation', group: 'Aim Input Filter', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['aim', 'smooth'] },
  { key: 'aimFromStickBaseEnabled', label: 'Aim From Stick Base', hint: 'Aim pivot from stick base using stickOffsetX/Y.', category: 'Rotation', group: 'Aim Pivot (Stick Base)', kind: 'boolean', recommended: true, keywords: ['aim', 'pivot', 'stick', 'base'] },
  { key: 'stickAngleLimitEnabled', label: 'Stick Angle Limit Enabled', category: 'Rotation', group: 'Stick Clamp', kind: 'boolean', recommended: true, keywords: ['aim', 'stick', 'limit'] },
  { key: 'maxStickAngleFromBodyDeg', label: 'Max Stick Angle From Body Deg', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 180, step: 1, recommended: true, keywords: ['aim', 'stick', 'limit', 'deg'] },
  { key: 'stickBehindStartDeg', label: 'Stick Behind Start Deg', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 90, max: 180, step: 1, recommended: true, keywords: ['stick', 'behind', 'start'] },
  { key: 'stickSideFlipHysteresisDeg', label: 'Stick Side Flip Hysteresis Deg', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 30, step: 1, recommended: true, keywords: ['stick', 'flip', 'hysteresis'] },
  { key: 'stickBehindTurnRateDeg', label: 'Stick Behind Turn Rate Deg/s', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 30, max: 720, step: 10, recommended: true, keywords: ['stick', 'behind', 'turnrate'] },
  { key: 'stickBehindTauMs', label: 'Stick Behind Tau (ms)', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 600, step: 10, recommended: true, keywords: ['stick', 'behind', 'tau', 'smoothing'] },
  { key: 'stickUseTauSmoothing', label: 'Stick Use Tau Smoothing', category: 'Rotation', group: 'Stick Clamp', kind: 'boolean', recommended: true, keywords: ['stick', 'tau', 'smoothing'] },
  { key: 'stickTargetSlewRateDeg', label: 'Stick Target Slew Deg/s', hint: 'Extra target limiter. If stick feels slow, this may be the bottleneck.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 3000, step: 10, recommended: true, keywords: ['stick', 'target', 'slew', 'rate'] },
  { key: 'stickTauMs', label: 'Stick Tau (ms)', hint: '30-400 is useful. If still slow, bottleneck is max ang vel / rate limit.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 30, max: 400, step: 5, recommended: true, keywords: ['stick', 'tau'] },
  { key: 'stickBodyBias', label: 'Stick Body Bias', hint: 'Lehky posture bias od kurzoru smerem k telu.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 0.35, step: 0.01, recommended: true, keywords: ['stick', 'body', 'bias'] },
  { key: 'stickAngularSpeedDeg', label: 'Stick Angular Speed Deg/s', hint: 'Hlavni limit rychlosti dotazeni hokejky.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 60, max: 3000, step: 30, recommended: true, keywords: ['stick', 'angular', 'speed'] },
  { key: 'stickTauMsBehind', label: 'Stick Tau Behind (ms)', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 800, step: 10, recommended: true, keywords: ['stick', 'tau', 'behind'] },
  { key: 'stickTauMinAlpha', label: 'Stick Tau Min Alpha', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 0.2, step: 0.005, recommended: true, keywords: ['stick', 'tau', 'alpha'] },
  { key: 'stickUseSpring', label: 'Stick Use Spring', category: 'Rotation', group: 'Stick Clamp', kind: 'boolean', recommended: true, keywords: ['stick', 'spring'] },
  { key: 'stickSnappiness', label: 'Stick Snappiness', hint: '1-slider feel: higher = faster stick response.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['stick', 'snappiness', 'spring'] },
  { key: 'stickDampingRatio', label: 'Stick Damping Ratio', hint: '1.0 = critical damping (no oscillation), <1 underdamped, >1 overdamped.', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0.7, max: 1.3, step: 0.01, advanced: true, keywords: ['stick', 'damping', 'ratio'] },
  { key: 'stickAutoSpring', label: 'Stick Auto Spring (from Snappiness)', category: 'Rotation', group: 'Stick Clamp', kind: 'boolean', advanced: true, keywords: ['stick', 'spring', 'auto'] },
  { key: 'stickSpringK', label: 'Stick Spring K', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 5, max: 120, step: 0.5, advanced: true, keywords: ['stick', 'spring', 'k'] },
  { key: 'stickDamping', label: 'Stick Damping', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 1, max: 40, step: 0.5, advanced: true, keywords: ['stick', 'damping'] },
  { key: 'stickMaxAngVelDeg', label: 'Stick Max AngVel Deg/s', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 60, max: 3000, step: 30, recommended: true, keywords: ['stick', 'vel', 'max'] },
  { key: 'stickInertiaEnabled', label: 'Stick Inertia Enabled', category: 'Rotation', group: 'Stick Clamp', kind: 'boolean', recommended: true, keywords: ['stick', 'inertia'] },
  { key: 'stickInertiaMaxDeg', label: 'Stick Inertia Max Deg', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 30, step: 1, recommended: true, keywords: ['stick', 'inertia', 'max'] },
  { key: 'stickInertiaFactor', label: 'Stick Inertia Factor', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['stick', 'inertia', 'factor'] },
  { key: 'stickInertiaSpeedThreshold', label: 'Stick Inertia Speed Threshold', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 400, step: 1, recommended: true, keywords: ['stick', 'inertia', 'speed'] },
  { key: 'stickBehindEaseDeg', label: 'Stick Behind Ease Deg', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 45, step: 1, recommended: true, keywords: ['stick', 'behind', 'ease'] },
  { key: 'stickBehindTurnRateMinDeg', label: 'Stick Behind Turn Rate Min Deg/s', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 360, step: 5, advanced: true, keywords: ['stick', 'behind', 'min', 'turnrate'] },
  { key: 'stickTrickBoostEnabled', label: 'Stick Trick Boost Enabled', category: 'Rotation', group: 'Stick Trick Boost', kind: 'boolean', recommended: true, keywords: ['stick', 'trick', 'boost'] },
  { key: 'stickTrickNearPx', label: 'Trick Near Px', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 0, max: 300, step: 1, recommended: true, keywords: ['stick', 'trick', 'near'] },
  { key: 'stickTrickFarPx', label: 'Trick Far Px', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 50, max: 800, step: 1, recommended: true, keywords: ['stick', 'trick', 'far'] },
  { key: 'stickTrickMaxAngVelNearDeg', label: 'Trick MaxVel Near Deg/s', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 60, max: 3000, step: 10, recommended: true, keywords: ['stick', 'trick', 'maxvel', 'near'] },
  { key: 'stickTrickMaxAngVelFarDeg', label: 'Trick MaxVel Far Deg/s', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 60, max: 3000, step: 10, recommended: true, keywords: ['stick', 'trick', 'maxvel', 'far'] },
  { key: 'stickTrickTargetSlewNearDeg', label: 'Trick Slew Near Deg/s', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 0, max: 3000, step: 10, recommended: true, keywords: ['stick', 'trick', 'slew', 'near'] },
  { key: 'stickTrickTargetSlewFarDeg', label: 'Trick Slew Far Deg/s', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 0, max: 3000, step: 10, recommended: true, keywords: ['stick', 'trick', 'slew', 'far'] },
  { key: 'stickTrickTauNearMs', label: 'Trick Tau Near (ms)', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 0, max: 400, step: 5, recommended: true, keywords: ['stick', 'trick', 'tau', 'near'] },
  { key: 'stickTrickTauFarMs', label: 'Trick Tau Far (ms)', category: 'Rotation', group: 'Stick Trick Boost', kind: 'number', min: 0, max: 600, step: 5, recommended: true, keywords: ['stick', 'trick', 'tau', 'far'] },
  {
    key: 'stickClampSoftness',
    label: 'Stick Clamp Softness',
    hint: '0 = hard clamp (freeze), 0.25 = soft movement behind limit, 1 = no clamp outside limit.',
    category: 'Rotation',
    group: 'Stick Clamp',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    recommended: true,
    keywords: ['aim', 'stick', 'soft', 'clamp']
  },
  { key: 'stickAngleLimitSoftness', label: 'Legacy Stick Limit Softness', category: 'Rotation', group: 'Stick Clamp', kind: 'number', min: 0, max: 1, step: 0.01, advanced: true, keywords: ['aim', 'stick', 'soft', 'legacy'] },
  { key: 'snapEnabled', label: 'Snap Enabled', category: 'Movement', group: 'Assist', kind: 'boolean', recommended: true, keywords: ['assist', 'snap'] },
  { key: 'snapSpeedThreshold', label: 'Snap Speed Threshold', category: 'Movement', group: 'Assist', kind: 'number', min: 0, max: 300, step: 1, recommended: true, keywords: ['assist', 'snap', 'speed'] },
  { key: 'snapStrengthMax', label: 'Snap Strength Max', category: 'Movement', group: 'Assist', kind: 'number', min: 0, max: 20, step: 0.1, recommended: true, keywords: ['assist', 'snap', 'strength'] },
  { key: 'snapFadePower', label: 'Snap Fade Power', category: 'Movement', group: 'Assist', kind: 'number', min: 0.1, max: 4, step: 0.1, recommended: true, keywords: ['assist', 'snap', 'fade'] },
  { key: 'snapOnlyWhenInput', label: 'Snap Only When Input', category: 'Movement', group: 'Assist', kind: 'boolean', recommended: true, keywords: ['assist', 'snap'] },
  { key: 'startLinearEnabled', label: 'Start Linear Enabled', category: 'Movement', group: 'Assist / Start', kind: 'boolean', recommended: true, keywords: ['start', 'linear', 'traction'] },
  { key: 'startLinearOnThreshold', label: 'Start Linear On Threshold', category: 'Movement', group: 'Assist / Start', kind: 'number', min: 0, max: 200, step: 0.5, recommended: true, keywords: ['start', 'linear', 'threshold'] },
  { key: 'startLinearOffThreshold', label: 'Start Linear Off Threshold', category: 'Movement', group: 'Assist / Start', kind: 'number', min: 0, max: 300, step: 0.5, recommended: true, keywords: ['start', 'linear', 'threshold', 'hysteresis'] },
  { key: 'startLinearSideKill', label: 'Start Linear Side Kill', category: 'Movement', group: 'Assist / Start', kind: 'number', min: 0, max: 30, step: 0.1, recommended: true, keywords: ['start', 'linear', 'side'] },
  { key: 'startLinearAlignStrength', label: 'Start Linear Align Strength', category: 'Movement', group: 'Assist / Start', kind: 'number', min: 0, max: 40, step: 0.1, recommended: true, keywords: ['start', 'linear', 'align'] },
  { key: 'startLinearRequiresInput', label: 'Start Linear Requires Input', category: 'Movement', group: 'Assist / Start', kind: 'boolean', recommended: true, keywords: ['start', 'linear', 'input'] },
  { key: 'brakeAssistEnabled', label: 'Brake Assist Enabled', category: 'Movement', group: 'Assist', kind: 'boolean', recommended: true, keywords: ['assist', 'brake'] },
  { key: 'brakeAssistDurationMs', label: 'Brake Assist Duration (ms)', category: 'Movement', group: 'Assist', kind: 'number', min: 0, max: 500, step: 5, recommended: true, keywords: ['assist', 'brake'] },
  { key: 'brakeAssistDragMult', label: 'Brake Assist Drag Mult', category: 'Movement', group: 'Assist', kind: 'number', min: 1, max: 3, step: 0.05, recommended: true, keywords: ['assist', 'brake', 'drag'] },
  { key: 'brakeMinSpeed', label: 'Brake Min Speed', category: 'Movement', group: 'Assist', kind: 'number', min: 0, max: 300, step: 1, recommended: true, keywords: ['assist', 'brake'] },
  { key: 'alignSpeedThreshold', label: 'Align Speed Threshold', category: 'Movement', group: 'Clarity', kind: 'number', min: 0, max: 300, step: 1, recommended: true, keywords: ['align', 'low speed'] },
  { key: 'alignStrength', label: 'Align Strength', category: 'Movement', group: 'Clarity', kind: 'number', min: 0, max: 16, step: 0.1, recommended: true, keywords: ['align', 'strength'] },
  { key: 'alignFadePower', label: 'Align Fade Power', category: 'Movement', group: 'Clarity', kind: 'number', min: 0.1, max: 4, step: 0.1, recommended: true, keywords: ['align', 'fade'] },
  { key: 'couplingEnabled', label: 'Coupling Enabled', category: 'Movement', group: 'Coupling', kind: 'boolean', recommended: true, keywords: ['coupling', 'handling'] },
  { key: 'couplingStrength', label: 'Coupling Strength', category: 'Movement', group: 'Coupling', kind: 'number', min: 0, max: 0.35, step: 0.01, recommended: true, keywords: ['coupling', 'strength'] },
  { key: 'maxCurvatureEnabled', label: 'Max Curvature Enabled', category: 'Movement', group: 'Clarity', kind: 'boolean', recommended: true, keywords: ['curvature', 'arc'] },
  { key: 'maxCurvatureLow', label: 'Max Curvature Low', category: 'Movement', group: 'Clarity', kind: 'number', min: 0, max: 20, step: 0.1, recommended: true, keywords: ['curvature', 'low'] },
  { key: 'maxCurvatureHigh', label: 'Max Curvature High', category: 'Movement', group: 'Clarity', kind: 'number', min: 0, max: 20, step: 0.1, recommended: true, keywords: ['curvature', 'high'] },
  { key: 'lowSpeedAlignThreshold', label: 'Legacy Low Speed Align Threshold', category: 'Movement', group: 'Advanced', kind: 'number', min: 0, max: 300, step: 1, advanced: true, keywords: ['legacy', 'align'] },
  { key: 'lowSpeedAlignStrength', label: 'Legacy Low Speed Align Strength', category: 'Movement', group: 'Advanced', kind: 'number', min: 0, max: 12, step: 0.1, advanced: true, keywords: ['legacy', 'align'] },
  { key: 'drawAimLine', label: 'Draw Aim Line', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['aim', 'debug'] },
  { key: 'drawVectors', label: 'Draw Vectors', category: 'Movement', group: 'Assist Debug', kind: 'boolean', keywords: ['debug', 'vectors'] },
  { key: 'showSnapFactor', label: 'Show Snap Factor', category: 'Movement', group: 'Assist Debug', kind: 'boolean', keywords: ['debug', 'snap'] },
  { key: 'showBrakeActive', label: 'Show Brake Active', category: 'Movement', group: 'Assist Debug', kind: 'boolean', keywords: ['debug', 'brake'] },
  { key: 'showStartMode', label: 'Show Start Mode', category: 'Movement', group: 'Assist Debug', kind: 'boolean', keywords: ['debug', 'start', 'linear'] },
  { key: 'drawVelComponents', label: 'Draw Vel Components', category: 'Movement', group: 'Assist Debug', kind: 'boolean', keywords: ['debug', 'velocity', 'forward', 'side'] },
  { key: 'drawMoveVector', label: 'Draw Move Vector', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'move'] },
  { key: 'drawBodyVector', label: 'Draw Body Vector', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'body'] },
  { key: 'drawAimVector', label: 'Draw Aim Vector', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'aim'] },
  { key: 'drawAimVectorRaw', label: 'Draw Aim Vector Raw', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'aim', 'raw'] },
  { key: 'drawAimVectorClamped', label: 'Draw Aim Vector Clamped', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'aim', 'clamped'] },
  { key: 'showAngles', label: 'Show Angles', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'moveAngle', 'aimAngle'] },
  { key: 'showAngleDiff', label: 'Show Angle Diff', category: 'Rotation', group: 'Debug', kind: 'boolean', keywords: ['debug', 'diff'] },
  { key: 'showHeading', label: 'Show Heading', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['aim', 'debug', 'heading'] },
  { key: 'showTargetAngle', label: 'Show Target Angle', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['aim', 'debug', 'target'] },
  { key: 'drawTargetAngle', label: 'Draw Target Angle', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['aim', 'debug'] },
  { key: 'debugDrawVectors', label: 'Debug Draw Vectors', category: 'Movement', group: 'Clarity Debug', kind: 'boolean', keywords: ['debug', 'vectors'] },
  { key: 'debugDrawArcPreview', label: 'Debug Draw Arc Preview', category: 'Movement', group: 'Clarity Debug', kind: 'boolean', keywords: ['debug', 'arc'] },
  { key: 'crosshairEnabled', label: 'Crosshair Enabled', category: 'Movement', group: 'Crosshair', kind: 'boolean', recommended: true, keywords: ['crosshair'] },
  { key: 'crosshairSize', label: 'Crosshair Size', category: 'Movement', group: 'Crosshair', kind: 'number', min: 2, max: 80, step: 1, recommended: true, keywords: ['crosshair'] },
  { key: 'crosshairThickness', label: 'Crosshair Thickness', category: 'Movement', group: 'Crosshair', kind: 'number', min: 1, max: 12, step: 1, recommended: true, keywords: ['crosshair'] },
  { key: 'crosshairCenterGap', label: 'Crosshair Center Gap', category: 'Movement', group: 'Crosshair', kind: 'number', min: 0, max: 30, step: 1, recommended: true, keywords: ['crosshair'] },
  { key: 'hideSystemCursor', label: 'Hide System Cursor', category: 'Movement', group: 'Crosshair', kind: 'boolean', recommended: true, keywords: ['cursor', 'crosshair'] },

  { key: 'maxSpeedNoPuck', label: 'Max Speed No Puck', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, advanced: true },
  { key: 'maxSpeedWithPuck', label: 'Max Speed With Puck', category: 'Movement', group: 'Core', kind: 'number', min: 80, max: 900, step: 1, advanced: true },
  { key: 'dragIdle_lo', label: 'Idle Drag Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'dragIdle_hi', label: 'Idle Drag High', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'lateralGrip_lo', label: 'Lateral Grip Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 5, step: 0.001, advanced: true },
  { key: 'brakeCurve_lo', label: 'Brake Curve Low', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },
  { key: 'brakeCurve_hi', label: 'Brake Curve High', category: 'Movement', group: 'Two-Regime', kind: 'number', min: 0, max: 3, step: 0.001, advanced: true },

  { key: '__version', label: 'Version', category: 'NetDebug', group: 'State', kind: 'number', advanced: true, keywords: ['version', 'hash'] }
  ,
  { key: 'stickOffsetX', label: 'Posun hokejky X', category: 'Puck', group: 'Hokejka', kind: 'number', min: -80, max: 80, step: 1, recommended: true, keywords: ['stick', 'offset'] },
  { key: 'stickOffsetY', label: 'Posun hokejky Y', category: 'Puck', group: 'Hokejka', kind: 'number', min: -80, max: 80, step: 1, recommended: true, keywords: ['stick', 'offset'] },
  { key: 'stickLength', label: 'Delka hokejky', category: 'Puck', group: 'Hokejka', kind: 'number', min: 8, max: 80, step: 1, recommended: true, keywords: ['stick', 'length'] },
  { key: 'stickTipRadius', label: 'Velikost spicky (hitbox)', category: 'Puck', group: 'Hokejka', kind: 'number', min: 2, max: 40, step: 1, recommended: true, keywords: ['stick', 'tip'] },
  { key: 'stickVisualLag', label: 'Zpozdeni hokejky (vizualni)', category: 'Puck', group: 'Hokejka', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['stick', 'lag'] },
  { key: 'stickVisualLagMaxDeg', label: 'Limit zpozdeni (st.)', category: 'Puck', group: 'Hokejka', kind: 'number', min: 0, max: 90, step: 1, recommended: true, keywords: ['stick', 'lag'] },
  { key: 'drawStickTarget', label: 'Zobrazit cil hokejky', category: 'Puck', group: 'Debug hokejky', kind: 'boolean', keywords: ['debug', 'stick'] },
  { key: 'drawStickHitbox', label: 'Zobrazit hitbox spicky', category: 'Puck', group: 'Debug hokejky', kind: 'boolean', keywords: ['debug', 'stick'] },

  { key: 'puckRadius', label: 'Velikost puku', category: 'Puck', group: 'Puk - fyzika', kind: 'number', min: 2, max: 30, step: 1, recommended: true, keywords: ['puck', 'radius'] },
  { key: 'puckMaxSpeed', label: 'Max. rychlost puku', category: 'Puck', group: 'Puk - fyzika', kind: 'number', min: 60, max: 1200, step: 1, recommended: true, keywords: ['puck', 'speed'] },
  { key: 'puckLinearDamping', label: 'Zpomaleni puku (odpor)', hint: 'Jak rychle puk sam zpomaluje.', category: 'Puck', group: 'Puk - fyzika', kind: 'number', min: 0, max: 20, step: 0.01, recommended: true, keywords: ['puck', 'damping'] },
  { key: 'puckRestitution', label: 'Odrazivost (bounce)', hint: 'Jak moc puk odskakuje od sten.', category: 'Puck', group: 'Puk - fyzika', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['puck', 'bounce'] },
  { key: 'puckSurfaceDrag', label: 'Treni o led', category: 'Puck', group: 'Puk - fyzika', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['puck', 'drag'] },

  { key: 'puckPickupRadius', label: 'Dosah sebrani puku', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 2, max: 100, step: 1, recommended: true, keywords: ['pickup'] },
  { key: 'puckPickupMaxSpeed', label: 'Max. rychlost puku pro sebrani', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 10, max: 1000, step: 1, recommended: true, keywords: ['pickup', 'speed'] },
  { key: 'puckPickupMaxRelativeSpeed', label: 'Max. relativni rychlost pro sebrani', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 10, max: 1200, step: 1, recommended: true, keywords: ['pickup', 'relative', 'speed'] },
  { key: 'puckMagnetRadius', label: 'Magnet radius', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 140, step: 1, recommended: true, keywords: ['magnet', 'radius'] },
  { key: 'puckMagnetStrength', label: 'Magnet sila', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 400, step: 1, recommended: true, keywords: ['magnet', 'strength'] },
  { key: 'puckMagnetMaxForce', label: 'Magnet limit sily', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 500, step: 1, recommended: true, keywords: ['magnet', 'cap', 'force'] },
  { key: 'puckHoldSpringK', label: 'Sila pritazeni k hokejce', hint: 'Jak pevne puk drzi u hokejky pri vedeni.', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 120, step: 0.1, recommended: true, keywords: ['hold', 'spring'] },
  { key: 'puckHoldDampingC', label: 'Tlumeni pri vedeni', hint: 'Zabiji rozkmitani puku pri vedeni.', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 60, step: 0.1, recommended: true, keywords: ['hold', 'damping'] },
  { key: 'puckHoldMaxError', label: 'Max. vychyleni nez upadne', hint: 'Kdyz je puk moc daleko od hokejky, upusti se.', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 5, max: 180, step: 1, recommended: true, keywords: ['hold', 'error'] },
  { key: 'puckPickupCooldownMs', label: 'Cooldown sebrani po strele (ms)', category: 'Puck', group: 'Vedeni puku', kind: 'number', min: 0, max: 1200, step: 10, recommended: true, keywords: ['pickup', 'cooldown'] },

  { key: 'puckShotBaseImpulse', label: 'Sila strely (zaklad)', category: 'Puck', group: 'Strela', kind: 'number', min: 0, max: 1000, step: 1, recommended: true, keywords: ['shot'] },
  { key: 'puckShotChargeRate', label: 'Rychlost nabijeni', category: 'Puck', group: 'Strela', kind: 'number', min: 0, max: 8, step: 0.01, recommended: true, keywords: ['shot', 'charge'] },
  { key: 'puckShotChargeMult', label: 'Bonus za nabiti', category: 'Puck', group: 'Strela', kind: 'number', min: 0, max: 1200, step: 1, recommended: true, keywords: ['shot', 'charge'] },
  { key: 'puckShotMaxImpulse', label: 'Limit sily strely', category: 'Puck', group: 'Strela', kind: 'number', min: 1, max: 2000, step: 1, recommended: true, keywords: ['shot'] },
  { key: 'puckShotMinHoldMs', label: 'Min. doba drzeni pro strelu (ms)', category: 'Puck', group: 'Strela', kind: 'number', min: 0, max: 500, step: 5, recommended: true, keywords: ['shot'] },

  { key: 'puckDrawPickupRadius', label: 'Zobrazit dosah sebrani', category: 'Puck', group: 'Debug puku', kind: 'boolean', keywords: ['debug', 'pickup'] },
  { key: 'puckDrawMagnetRadius', label: 'Zobrazit magnet radius', category: 'Puck', group: 'Debug puku', kind: 'boolean', keywords: ['debug', 'magnet'] },
  { key: 'puckDrawState', label: 'Zobrazit stav puku', category: 'Puck', group: 'Debug puku', kind: 'boolean', keywords: ['debug', 'state'] },
  { key: 'puckDrawVelocity', label: 'Zobrazit rychlost puku', category: 'Puck', group: 'Debug puku', kind: 'boolean', keywords: ['debug', 'velocity'] }
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
    const kind: TuningParamKind = typeof val === 'boolean' ? 'boolean' : (typeof val === 'string' ? 'enum' : 'number');
    const range = typeof val === 'number' ? inferRange(val) : undefined;

    map.set(key, {
      key,
      label: titleCaseFromKey(keyRaw),
      category: keyRaw.startsWith('puck') || keyRaw.startsWith('stick') || keyRaw.startsWith('drawStick') ? 'Puck' : 'Movement',
      group: keyRaw.startsWith('puck') || keyRaw.startsWith('stick') || keyRaw.startsWith('drawStick') ? 'Advanced Puck' : 'Advanced',
      kind,
      enumOptions: kind === 'enum' ? [{ value: String(val ?? ''), label: String(val ?? '') }] : undefined,
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
