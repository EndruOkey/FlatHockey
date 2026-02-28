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
    key: 'bodyFacingMode',
    label: 'Body Facing Mode',
    category: 'Movement',
    group: 'Input / Controls',
    kind: 'enum',
    enumOptions: [
      { value: 'MOVE_LAST', label: 'MOVE_LAST' },
      { value: 'AIM_WHEN_IDLE', label: 'AIM_WHEN_IDLE' },
      { value: 'BLEND', label: 'BLEND' }
    ],
    recommended: true,
    keywords: ['body', 'facing', 'idle']
  },
  { key: 'bodyTurnRate', label: 'Body Turn Rate (rad/s)', category: 'Movement', group: 'Movement', kind: 'number', min: 0, max: 30, step: 0.1, recommended: true, keywords: ['body', 'turn'] },
  { key: 'bodyTurnRateLowSpeedMult', label: 'Body Turn LowSpeed Mult', category: 'Movement', group: 'Movement', kind: 'number', min: 0, max: 4, step: 0.05, advanced: true, keywords: ['body', 'turn', 'low'] },
  { key: 'aimEnabled', label: 'Mouse Aim Enabled', category: 'Movement', group: 'Aim', kind: 'boolean', recommended: true, keywords: ['aim', 'mouse'] },
  { key: 'aimMaxTurnRate', label: 'Aim Max Turn Rate (rad/s)', category: 'Movement', group: 'Aim', kind: 'number', min: 0, max: 20, step: 0.1, recommended: true, keywords: ['aim', 'turn', 'rad'] },
  { key: 'aimDeadzonePx', label: 'Aim Deadzone Px', category: 'Movement', group: 'Aim', kind: 'number', min: 0, max: 80, step: 1, recommended: true, keywords: ['aim', 'deadzone'] },
  { key: 'aimSmoothing', label: 'Aim Smoothing', category: 'Movement', group: 'Aim', kind: 'number', min: 0, max: 1, step: 0.01, recommended: true, keywords: ['aim', 'smooth'] },
  { key: 'stickAngleLimitEnabled', label: 'Stick Angle Limit Enabled', category: 'Movement', group: 'Aim / Stick', kind: 'boolean', recommended: true, keywords: ['aim', 'stick', 'limit'] },
  { key: 'maxStickAngleFromBodyDeg', label: 'Max Stick Angle From Body Deg', category: 'Movement', group: 'Aim / Stick', kind: 'number', min: 0, max: 180, step: 1, recommended: true, keywords: ['aim', 'stick', 'limit', 'deg'] },
  { key: 'stickAngleLimitSoftness', label: 'Stick Angle Limit Softness', category: 'Movement', group: 'Aim / Stick', kind: 'number', min: 0, max: 1, step: 0.01, advanced: true, keywords: ['aim', 'stick', 'soft'] },
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
  { key: 'drawMoveVector', label: 'Draw Move Vector', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'move'] },
  { key: 'drawBodyVector', label: 'Draw Body Vector', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'body'] },
  { key: 'drawAimVector', label: 'Draw Aim Vector', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'aim'] },
  { key: 'drawAimVectorRaw', label: 'Draw Aim Vector Raw', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'aim', 'raw'] },
  { key: 'drawAimVectorClamped', label: 'Draw Aim Vector Clamped', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'aim', 'clamped'] },
  { key: 'showAngles', label: 'Show Angles', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'moveAngle', 'aimAngle'] },
  { key: 'showAngleDiff', label: 'Show Angle Diff', category: 'Movement', group: 'Aim Debug', kind: 'boolean', keywords: ['debug', 'diff'] },
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
