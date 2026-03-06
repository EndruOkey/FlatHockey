import type { InputMsg, PlayerStateMsg } from '@flathockey/shared';
import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';
import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';
import { getTuning, usedTuning } from '../debug/movementTuning';

export let lastTelemetry: Record<string, any> = {};
export let lastAimInputRateLimited = false;

export function setAimInputRateLimited(flag: boolean) {
  lastAimInputRateLimited = !!flag;
}

export type PredictedPlayerState = PlayerStateMsg & {
  stamina?: number;
  heading?: number;
  moveAngle?: number;
  inputAngle?: number;
  lastRawInputAngle?: number;
  antiFlipTimer?: number;
  baseBodyAngle?: number;
  bodyYawOffset?: number;
  bodyTargetAngle?: number;
  aimAngle?: number;
  aimAngleRaw?: number;
  stickAngVel?: number;
  stickLocalAngle?: number;
  prevHasInput?: boolean;
  brakeAssistLeft?: number;
  startLinearActive?: boolean;
  stickSide?: -1 | 1;
  debugSnapFactor?: number;
  debugBrakeAssistActive?: boolean;
  debugStartModeActive?: boolean;
  debugVelForward?: number;
  debugVelSide?: number;
  debugStickDeltaDeg?: number;
  debugStickAngVelDeg?: number;
  debugStickAngVelClamped?: boolean;
  debugStickTargetSlewActive?: boolean;
  debugStickMode?: 'TAU' | 'SPRING' | 'APPROACH';
  debugTargetAimAngle?: number;
  debugRawInputAngle?: number;
  debugDesiredMoveAngle?: number;
  debugTurnIntentAngle?: number;
  debugMoveTurnRateAppliedDeg?: number;
  debugVelocityDesiredDeltaDeg?: number;
  debugTurnResistance?: number;
  debugRedirectAccelScale?: number;
  debugAntiFlipActive?: boolean;
  debugBaseBodyAngle?: number;
  debugBodyYawOffset?: number;
  debugBodyTurnInput?: number;
  debugActiveBodyModel?: 'B' | 'C';
};

export const CLIENT_FIXED_DT = 1 / 60;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  const tuning = getTuning();
  const config: MovementStepConfig = { ...tuning };

  // Keep alias and canonical max-speed fields aligned.
  if (typeof tuning.maxSpeed === 'number') {
    config.maxSpeed = tuning.maxSpeed;
    config.maxSpeedNoPuck = tuning.maxSpeed;
    config.maxSpeedWithPuck = tuning.maxSpeed;
  }

  const prevVx = state.vx;
  const prevVy = state.vy;
  const prevSpeed = Math.hypot(prevVx, prevVy);

  const simState: MovementStepState = {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    stamina: state.stamina ?? 1,
    aimAngle: state.aimAngle ?? state.angle,
    aimAngleRaw: state.aimAngleRaw,
    stickAngVel: state.stickAngVel,
    stickLocalAngle: state.stickLocalAngle,
    moveAngle: state.moveAngle,
    inputAngle: state.inputAngle,
    lastRawInputAngle: state.lastRawInputAngle,
    antiFlipTimer: state.antiFlipTimer,
    baseBodyAngle: state.baseBodyAngle,
    bodyYawOffset: state.bodyYawOffset,
    bodyTargetAngle: state.bodyTargetAngle,
    bodyAngle: state.angle,
    heading: state.heading,
    prevHasInput: state.prevHasInput,
    brakeAssistLeft: state.brakeAssistLeft,
    startLinearActive: state.startLinearActive,
    stickSide: state.stickSide,
    debugSnapFactor: state.debugSnapFactor,
    debugBrakeAssistActive: state.debugBrakeAssistActive,
    debugStartModeActive: state.debugStartModeActive,
    debugVelForward: state.debugVelForward,
    debugVelSide: state.debugVelSide,
    debugStickDeltaDeg: state.debugStickDeltaDeg,
    debugStickAngVelDeg: state.debugStickAngVelDeg,
    debugStickAngVelClamped: state.debugStickAngVelClamped,
    debugStickTargetSlewActive: state.debugStickTargetSlewActive,
    debugStickMode: state.debugStickMode,
    debugTargetAimAngle: state.debugTargetAimAngle,
    debugRawInputAngle: state.debugRawInputAngle,
    debugDesiredMoveAngle: state.debugDesiredMoveAngle,
    debugTurnIntentAngle: state.debugTurnIntentAngle,
    debugMoveTurnRateAppliedDeg: state.debugMoveTurnRateAppliedDeg,
    debugVelocityDesiredDeltaDeg: state.debugVelocityDesiredDeltaDeg,
    debugTurnResistance: state.debugTurnResistance,
    debugRedirectAccelScale: state.debugRedirectAccelScale,
    debugAntiFlipActive: state.debugAntiFlipActive,
    debugBaseBodyAngle: state.debugBaseBodyAngle,
    debugBodyYawOffset: state.debugBodyYawOffset,
    debugBodyTurnInput: state.debugBodyTurnInput,
    debugActiveBodyModel: state.debugActiveBodyModel
  };

  applyMovementStep(
    simState,
    {
      moveX: input.moveX,
      moveY: input.moveY,
      aimAngleRaw: typeof input.aimAngleRaw === 'number'
        ? input.aimAngleRaw
        : (typeof input.aimAngle === 'number' ? input.aimAngle : (state.aimAngleRaw ?? state.angle)),
      bodyTurn: typeof input.bodyTurn === 'number' ? input.bodyTurn : 0,
      buttons: {
        sprint: !!input.sprint,
        brake: !!input.brake
      }
    },
    dt,
    config
  );

  state.x = simState.x;
  state.y = simState.y;
  state.vx = simState.vx;
  state.vy = simState.vy;
  state.stamina = simState.stamina;
  state.heading = simState.heading;
  state.moveAngle = simState.moveAngle;
  state.inputAngle = simState.inputAngle;
  state.lastRawInputAngle = simState.lastRawInputAngle;
  state.antiFlipTimer = simState.antiFlipTimer;
  state.baseBodyAngle = simState.baseBodyAngle;
  state.bodyYawOffset = simState.bodyYawOffset;
  state.bodyTargetAngle = simState.bodyTargetAngle;
  state.aimAngleRaw = simState.aimAngleRaw;
  state.aimAngle = simState.aimAngle;
  state.stickAngVel = simState.stickAngVel;
  state.stickLocalAngle = simState.stickLocalAngle;
  state.angle = simState.aimAngle;
  if (Number.isFinite(simState.bodyAngle)) {
    state.angle = simState.bodyAngle!;
  }
  state.prevHasInput = simState.prevHasInput;
  state.brakeAssistLeft = simState.brakeAssistLeft;
  state.startLinearActive = simState.startLinearActive;
  state.stickSide = simState.stickSide;
  state.debugSnapFactor = simState.debugSnapFactor;
  state.debugBrakeAssistActive = simState.debugBrakeAssistActive;
  state.debugStartModeActive = simState.debugStartModeActive;
  state.debugVelForward = simState.debugVelForward;
  state.debugVelSide = simState.debugVelSide;
  state.debugStickDeltaDeg = simState.debugStickDeltaDeg;
  state.debugStickAngVelDeg = simState.debugStickAngVelDeg;
  state.debugStickAngVelClamped = simState.debugStickAngVelClamped;
  state.debugStickTargetSlewActive = simState.debugStickTargetSlewActive;
  state.debugStickMode = simState.debugStickMode;
  state.debugTargetAimAngle = simState.debugTargetAimAngle;
  state.debugRawInputAngle = simState.debugRawInputAngle;
  state.debugDesiredMoveAngle = simState.debugDesiredMoveAngle;
  state.debugTurnIntentAngle = simState.debugTurnIntentAngle;
  state.debugMoveTurnRateAppliedDeg = simState.debugMoveTurnRateAppliedDeg;
  state.debugVelocityDesiredDeltaDeg = simState.debugVelocityDesiredDeltaDeg;
  state.debugTurnResistance = simState.debugTurnResistance;
  state.debugRedirectAccelScale = simState.debugRedirectAccelScale;
  state.debugAntiFlipActive = simState.debugAntiFlipActive;
  state.debugBaseBodyAngle = simState.debugBaseBodyAngle;
  state.debugBodyYawOffset = simState.debugBodyYawOffset;
  state.debugBodyTurnInput = simState.debugBodyTurnInput;
  state.debugActiveBodyModel = simState.debugActiveBodyModel;

  const speed = Math.hypot(state.vx, state.vy);
  const maxSpeed = (config.maxSpeed ?? config.maxSpeedNoPuck ?? 1);
  const wishLen = Math.hypot(input.moveX, input.moveY);
  const wishX = wishLen > 0 ? input.moveX / wishLen : 0;
  const wishY = wishLen > 0 ? input.moveY / wishLen : 0;
  const forwardSpeed = wishLen > 0 ? (state.vx * wishX + state.vy * wishY) : 0;
  const lateralSpeed = wishLen > 0
    ? Math.hypot(state.vx - wishX * forwardSpeed, state.vy - wishY * forwardSpeed)
    : 0;

  const beforeDir = prevSpeed > 0 ? Math.atan2(prevVy, prevVx) : (state.moveAngle ?? 0);
  const afterDir = speed > 0 ? Math.atan2(state.vy, state.vx) : beforeDir;
  let driftAngle = Math.abs(afterDir - (wishLen > 0 ? Math.atan2(wishY, wishX) : afterDir));
  if (driftAngle > Math.PI) driftAngle = Math.PI * 2 - driftAngle;

  let blendT = 0;
  if (tuning.regimesEnabled) {
    const split = tuning.speedSplit ?? MOVEMENT_DEFAULTS.speedSplit ?? 0.55;
    const width = Math.max(0.0001, tuning.splitBlendWidth ?? 0.12);
    blendT = smoothstep(split - width * 0.5, split + width * 0.5, maxSpeed > 0 ? speed / maxSpeed : 0);
  }

  const telemetry = {
    currentSpeed: speed,
    speedRatio: maxSpeed > 0 ? speed / maxSpeed : 0,
    lateralSpeed,
    forwardSpeed,
    driftAngle,
    gripApplied: Math.max(0, 1 - (tuning.lateralDamping ?? MOVEMENT_DEFAULTS.lateralDamping ?? 0.98) * dt),
    brakeApplied: input.brake ? Math.max(0, prevSpeed - speed) / Math.max(prevSpeed, 1) : 0,
    blendT,
    snapFactor: simState.debugSnapFactor ?? 0,
    brakeAssistActive: !!simState.debugBrakeAssistActive,
    startModeActive: !!simState.debugStartModeActive,
    velForward: simState.debugVelForward ?? 0,
    velSide: simState.debugVelSide ?? 0,
    desiredMoveAngle: simState.debugDesiredMoveAngle ?? simState.moveAngle ?? 0,
    turnIntentAngle: simState.debugTurnIntentAngle ?? simState.heading ?? simState.moveAngle ?? 0,
    actualMoveAngle: simState.moveAngle ?? 0,
    turnRateAppliedDeg: simState.debugMoveTurnRateAppliedDeg ?? 0,
    velocityDesiredDeltaDeg: simState.debugVelocityDesiredDeltaDeg ?? 0,
    turnResistance: simState.debugTurnResistance ?? 0,
    redirectAccelScale: simState.debugRedirectAccelScale ?? 1,
    antiFlipActive: !!simState.debugAntiFlipActive,
    moveAngle: simState.moveAngle ?? 0,
    aimAngle: simState.aimAngle ?? state.aimAngle ?? state.angle,
    aimAngleRaw: simState.aimAngleRaw ?? state.aimAngleRaw ?? state.angle,
    targetAimAngle: simState.debugTargetAimAngle ?? simState.aimAngle ?? state.aimAngle ?? state.angle,
    baseBodyAngle: simState.debugBaseBodyAngle ?? simState.baseBodyAngle ?? state.baseBodyAngle ?? state.angle,
    bodyYawOffset: simState.debugBodyYawOffset ?? simState.bodyYawOffset ?? state.bodyYawOffset ?? 0,
    bodyTurnInput: simState.debugBodyTurnInput ?? 0,
    activeBodyModel: simState.debugActiveBodyModel ?? ((config.bodyOrientationModel ?? MOVEMENT_DEFAULTS.bodyOrientationModel ?? 'B') === 'C' ? 'C' : 'B'),
    aimDiffRaw: simState.debugAimDiffRaw ?? 0,
    aimDiffClamped: simState.debugAimDiffClamped ?? 0,
    stickDeltaDeg: simState.debugStickDeltaDeg ?? 0,
    stickAngVelDeg: simState.debugStickAngVelDeg ?? 0,
    stickAngVelClamped: !!simState.debugStickAngVelClamped,
    targetSlewActive: !!simState.debugStickTargetSlewActive,
    stickMode: simState.debugStickMode ?? 'APPROACH',
    aimInputRateLimited: lastAimInputRateLimited
  };

  try {
    usedTuning.accel = config.accel;
    usedTuning.dragMove = config.dragMove;
    usedTuning.dragIdle = config.dragIdle;
    usedTuning.brakeDrag = config.brakeDrag;
    usedTuning.maxSpeed = config.maxSpeed;
    usedTuning.headingModeEnabled = config.headingModeEnabled;
    usedTuning.maxTurnRateLowSpeed = config.maxTurnRateLowSpeed;
    usedTuning.maxTurnRateHighSpeed = config.maxTurnRateHighSpeed;
    usedTuning.lateralDamping = config.lateralDamping;
    usedTuning.regimesEnabled = config.regimesEnabled;
    usedTuning.speedSplit = config.speedSplit;
    usedTuning.splitBlendWidth = config.splitBlendWidth;
  } catch {}

  try {
    lastTelemetry = telemetry;
  } catch {}

  return telemetry;
}

