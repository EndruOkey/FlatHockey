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
  desiredDirX?: number;
  desiredDirY?: number;
  committedDirX?: number;
  committedDirY?: number;
  pendingDirX?: number;
  pendingDirY?: number;
  directionCommitTimer?: number;
  oppositeHoldTimer?: number;
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
  chargeActive?: boolean;
  stunLeft?: number;
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
  debugDesiredInputX?: number;
  debugDesiredInputY?: number;
  debugAppliedForwardForce?: number;
  debugAppliedLateralForce?: number;
  debugCommitTimer?: number;
  debugOppositeHoldTimer?: number;
  debugSteerDirX?: number;
  debugSteerDirY?: number;
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
    desiredDirX: state.desiredDirX,
    desiredDirY: state.desiredDirY,
    committedDirX: state.committedDirX,
    committedDirY: state.committedDirY,
    pendingDirX: state.pendingDirX,
    pendingDirY: state.pendingDirY,
    directionCommitTimer: state.directionCommitTimer,
    oppositeHoldTimer: state.oppositeHoldTimer,
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
    debugDesiredInputX: state.debugDesiredInputX,
    debugDesiredInputY: state.debugDesiredInputY,
    debugAppliedForwardForce: state.debugAppliedForwardForce,
    debugAppliedLateralForce: state.debugAppliedLateralForce,
    debugCommitTimer: state.debugCommitTimer,
    debugOppositeHoldTimer: state.debugOppositeHoldTimer,
    debugSteerDirX: state.debugSteerDirX,
    debugSteerDirY: state.debugSteerDirY,
    debugChargeActive: state.chargeActive,
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
      bodyTurn: 0,
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
  state.moveAngle = simState.moveAngle ?? state.moveAngle ?? state.angle;
  state.inputAngle = simState.inputAngle;
  state.desiredDirX = simState.desiredDirX;
  state.desiredDirY = simState.desiredDirY;
  state.committedDirX = simState.committedDirX;
  state.committedDirY = simState.committedDirY;
  state.pendingDirX = simState.pendingDirX;
  state.pendingDirY = simState.pendingDirY;
  state.directionCommitTimer = simState.directionCommitTimer;
  state.oppositeHoldTimer = simState.oppositeHoldTimer;
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
  state.chargeActive = !!simState.debugChargeActive;
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
  state.debugDesiredInputX = simState.debugDesiredInputX;
  state.debugDesiredInputY = simState.debugDesiredInputY;
  state.debugAppliedForwardForce = simState.debugAppliedForwardForce;
  state.debugAppliedLateralForce = simState.debugAppliedLateralForce;
  state.debugCommitTimer = simState.debugCommitTimer;
  state.debugOppositeHoldTimer = simState.debugOppositeHoldTimer;
  state.debugSteerDirX = simState.debugSteerDirX;
  state.debugSteerDirY = simState.debugSteerDirY;
  state.chargeActive = !!simState.debugChargeActive;
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
    desiredInputX: simState.debugDesiredInputX ?? 0,
    desiredInputY: simState.debugDesiredInputY ?? 0,
    rawInputX: simState.debugRawInputX ?? input.moveX ?? 0,
    rawInputY: simState.debugRawInputY ?? input.moveY ?? 0,
    filteredInputX: simState.debugFilteredInputX ?? simState.debugDesiredInputX ?? 0,
    filteredInputY: simState.debugFilteredInputY ?? simState.debugDesiredInputY ?? 0,
    appliedForwardForce: simState.debugAppliedForwardForce ?? 0,
    appliedLateralForce: simState.debugAppliedLateralForce ?? 0,
    edgeFactor: simState.debugEdgeFactor ?? 0,
    commitTimer: simState.debugCommitTimer ?? simState.directionCommitTimer ?? 0,
    oppositeHoldTimer: simState.debugOppositeHoldTimer ?? simState.oppositeHoldTimer ?? 0,
    steerDirX: simState.debugSteerDirX ?? simState.committedDirX ?? 0,
    steerDirY: simState.debugSteerDirY ?? simState.committedDirY ?? 0,
    chargeActive: !!simState.debugChargeActive,
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
    usedTuning.movementCoreModel = config.movementCoreModel as any;
    usedTuning.inputVectorResponsiveness = config.inputVectorResponsiveness as any;
    usedTuning.inputVectorTauMs = config.inputVectorTauMs as any;
    usedTuning.forwardAccel = config.forwardAccel as any;
    usedTuning.forwardMaxSpeed = config.forwardMaxSpeed as any;
    usedTuning.sideMaxSpeed = config.sideMaxSpeed as any;
    usedTuning.reverseMaxSpeed = config.reverseMaxSpeed as any;
    usedTuning.turnLowSpeed = config.turnLowSpeed as any;
    usedTuning.turnHighSpeed = config.turnHighSpeed as any;
    usedTuning.edgeTurnBonusMax = config.edgeTurnBonusMax as any;
    usedTuning.brakeTurnBonusValue = config.brakeTurnBonusValue as any;
    usedTuning.brakeOppositeRecovery = config.brakeOppositeRecovery as any;
    usedTuning.lateralSteerForce = config.lateralSteerForce as any;
    usedTuning.baseLateralDamping = config.baseLateralDamping as any;
    usedTuning.maxLateralDamping = config.maxLateralDamping as any;
    usedTuning.brakeLateralDampingBonus = config.brakeLateralDampingBonus as any;
    usedTuning.carveLossStrength = config.carveLossStrength as any;
    usedTuning.glideDrag = config.glideDrag as any;
    usedTuning.moveDrag = config.moveDrag as any;
    usedTuning.oppositeSteerScale = config.oppositeSteerScale as any;
    usedTuning.carveStrength = config.carveStrength as any;
    usedTuning.brakeSteerBoost = config.brakeSteerBoost as any;
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

