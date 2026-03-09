import type { InputMsg } from '@flathockey/shared';
import type { MovementStepConfig, MovementStepState } from '@flathockey/shared/sim/movementStep';
import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';
import { getTuning } from '../tuning/movementTuning';
import { syncUsedTuning } from './predictionUsedTuning';
import type { PredictedPlayerState } from './predictionState.types';
import { applyHeadingMovementStep } from './movementHeadingSolver';
export type { PredictedPlayerState } from './predictionState.types';

export let lastTelemetry: Record<string, any> = {};
export let lastAimInputRateLimited = false;
export let lastStepTrace: Record<string, any> = {};

export function setAimInputRateLimited(flag: boolean) {
  lastAimInputRateLimited = !!flag;
}

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
  delete (config as any).movementCoreModel;

  // Keep alias and canonical max-speed fields aligned.
  if (typeof tuning.maxSpeed === 'number') {
    config.maxSpeed = tuning.maxSpeed;
    config.maxSpeedNoPuck = tuning.maxSpeed;
    config.maxSpeedWithPuck = tuning.maxSpeed;
  }

  const prevVx = state.vx;
  const prevVy = state.vy;
  const prevSpeed = Math.hypot(prevVx, prevVy);
  const preStepX = state.x;
  const preStepY = state.y;

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
    distanceSinceCommit: state.distanceSinceCommit,
    reverseDriveState: state.reverseDriveState,
    commitNoInputTimer: state.commitNoInputTimer,
    reverseTransitionActive: state.reverseTransitionActive,
    reverseTransitionTimer: state.reverseTransitionTimer,
    pendingDirX: state.pendingDirX,
    pendingDirY: state.pendingDirY,
    directionCommitTimer: state.directionCommitTimer,
    oppositeHoldTimer: state.oppositeHoldTimer,
    carveLockTimer: state.carveLockTimer,
    carveSwitchCooldownTimer: state.carveSwitchCooldownTimer,
    carveSide: state.carveSide,
    movementPhase: state.movementPhase,
    startCommitTimer: state.startCommitTimer,
    startNoInputTimer: state.startNoInputTimer,
    startupOppositeLockTimer: state.startupOppositeLockTimer,
    startupLatchActive: state.startupLatchActive,
    startupReleaseTimer: state.startupReleaseTimer,
    startDirX: state.startDirX,
    startDirY: state.startDirY,
    lastStableTravelAngle: state.lastStableTravelAngle,
    lastRawInputAngle: state.lastRawInputAngle,
    antiFlipTimer: state.antiFlipTimer,
    baseBodyAngle: state.baseBodyAngle,
    bodyYawOffset: state.bodyYawOffset,
    bodyTargetAngle: state.bodyTargetAngle,
    bodyAngle: state.angle,
    heading: state.heading,
    headingOmega: state.headingOmega,
    desiredHeadingAngle: state.desiredHeadingAngle,
    debugMovementModelRequested: state.debugMovementModelRequested,
    debugMovementModelAuthoritative: state.debugMovementModelAuthoritative,
    debugMovementModelSource: state.debugMovementModelSource,
    movementModelActive: state.movementModelActive,
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
    debugRequestedInputDirX: state.debugRequestedInputDirX,
    debugRequestedInputDirY: state.debugRequestedInputDirY,
    debugAppliedForwardForce: state.debugAppliedForwardForce,
    debugAppliedLateralForce: state.debugAppliedLateralForce,
    debugCommitTimer: state.debugCommitTimer,
    debugOppositeHoldTimer: state.debugOppositeHoldTimer,
    debugSteerDirX: state.debugSteerDirX,
    debugSteerDirY: state.debugSteerDirY,
    debugStartCommitActive: state.debugStartCommitActive,
    debugStartCommitTimer: state.debugStartCommitTimer,
    debugStartDirX: state.debugStartDirX,
    debugStartDirY: state.debugStartDirY,
    debugEffectiveStartDirX: state.debugEffectiveStartDirX,
    debugEffectiveStartDirY: state.debugEffectiveStartDirY,
    debugMovementPhase: state.debugMovementPhase,
    debugCarveLockTimer: state.debugCarveLockTimer,
    debugCarveSide: state.debugCarveSide,
    debugSignedInputVsVelocityAngle: state.debugSignedInputVsVelocityAngle,
    debugMajorDirectionChangeBlocked: state.debugMajorDirectionChangeBlocked,
    debugBrakeActive: state.debugBrakeActive,
    debugReverseTransitionActive: state.debugReverseTransitionActive,
    debugSharpRedirectGated: state.debugSharpRedirectGated,
    debugAngularCapDegPerSec: state.debugAngularCapDegPerSec,
    debugCommittedDriveAngle: state.debugCommittedDriveAngle,
    debugDesiredDriveAngle: state.debugDesiredDriveAngle,
    debugDriveCommitLocked: state.debugDriveCommitLocked,
    debugReverseState: state.debugReverseState,
    debugOppositeIntentBlocked: state.debugOppositeIntentBlocked,
    debugCommitUnlockReason: state.debugCommitUnlockReason,
    debugMinHeadingAuthorityActive: state.debugMinHeadingAuthorityActive,
    debugMovementModel: state.debugMovementModel,
    debugMovementModelStepUsed: state.debugMovementModelStepUsed,
    debugHeadingAngle: state.debugHeadingAngle,
    debugHeadingOmega: state.debugHeadingOmega,
    debugForwardSpeed: state.debugForwardSpeed,
    debugLateralSpeed: state.debugLateralSpeed,
    debugDesiredHeadingAngle: state.debugDesiredHeadingAngle,
    debugHeadingErrorDeg: state.debugHeadingErrorDeg,
    debugSteerInput: state.debugSteerInput,
    debugThrottleInput: state.debugThrottleInput,
    debugChargeActive: state.chargeActive,
    debugBaseBodyAngle: state.debugBaseBodyAngle,
    debugBodyYawOffset: state.debugBodyYawOffset,
    debugBodyTurnInput: state.debugBodyTurnInput,
    debugActiveBodyModel: state.debugActiveBodyModel
  };

  applyHeadingMovementStep(
    simState,
    {
      throttle: input.throttle,
      steer: input.steer,
      brake: input.brake ?? 0,
      shoot: input.shoot ?? 0,
      aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : (state.aimAngleRaw ?? state.angle)
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
  state.headingOmega = simState.headingOmega;
  state.desiredHeadingAngle = simState.desiredHeadingAngle;
  state.movementModelActive = simState.movementModelActive;
  state.debugMovementModelRequested = simState.debugMovementModelRequested;
  state.debugMovementModelAuthoritative = simState.debugMovementModelAuthoritative;
  state.debugMovementModelSource = simState.debugMovementModelSource;
  state.moveAngle = simState.moveAngle ?? state.moveAngle ?? state.angle;
  state.inputAngle = simState.inputAngle;
  state.desiredDirX = simState.desiredDirX;
  state.desiredDirY = simState.desiredDirY;
  state.committedDirX = simState.committedDirX;
  state.committedDirY = simState.committedDirY;
  state.distanceSinceCommit = simState.distanceSinceCommit;
  state.reverseDriveState = simState.reverseDriveState;
  state.commitNoInputTimer = simState.commitNoInputTimer;
  state.reverseTransitionActive = simState.reverseTransitionActive;
  state.reverseTransitionTimer = simState.reverseTransitionTimer;
  state.pendingDirX = simState.pendingDirX;
  state.pendingDirY = simState.pendingDirY;
  state.directionCommitTimer = simState.directionCommitTimer;
  state.oppositeHoldTimer = simState.oppositeHoldTimer;
  state.carveLockTimer = simState.carveLockTimer;
  state.carveSwitchCooldownTimer = simState.carveSwitchCooldownTimer;
  state.carveSide = simState.carveSide;
  state.movementPhase = simState.movementPhase;
  state.startCommitTimer = simState.startCommitTimer;
  state.startNoInputTimer = simState.startNoInputTimer;
  state.startupOppositeLockTimer = simState.startupOppositeLockTimer;
  state.startupLatchActive = simState.startupLatchActive;
  state.startupReleaseTimer = simState.startupReleaseTimer;
  state.startDirX = simState.startDirX;
  state.startDirY = simState.startDirY;
  state.lastStableTravelAngle = simState.lastStableTravelAngle;
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
  state.debugRequestedInputDirX = simState.debugRequestedInputDirX;
  state.debugRequestedInputDirY = simState.debugRequestedInputDirY;
  state.debugAppliedForwardForce = simState.debugAppliedForwardForce;
  state.debugAppliedLateralForce = simState.debugAppliedLateralForce;
  state.debugCommitTimer = simState.debugCommitTimer;
  state.debugOppositeHoldTimer = simState.debugOppositeHoldTimer;
  state.debugSteerDirX = simState.debugSteerDirX;
  state.debugSteerDirY = simState.debugSteerDirY;
  state.debugMinSteerSpeed = simState.debugMinSteerSpeed;
  state.debugLowSpeedSteeringDisabled = simState.debugLowSpeedSteeringDisabled;
  state.debugLowSpeedStartupActive = simState.debugLowSpeedStartupActive;
  state.debugTravelDirLocked = simState.debugTravelDirLocked;
  state.debugStartupLatchActive = simState.debugStartupLatchActive;
  state.debugLatchedInputIgnored = simState.debugLatchedInputIgnored;
  state.debugStartupReleaseTimer = simState.debugStartupReleaseTimer;
  state.debugStartCommitActive = simState.debugStartCommitActive;
  state.debugStartCommitTimer = simState.debugStartCommitTimer;
  state.debugStartDirX = simState.debugStartDirX;
  state.debugStartDirY = simState.debugStartDirY;
  state.debugEffectiveStartDirX = simState.debugEffectiveStartDirX;
  state.debugEffectiveStartDirY = simState.debugEffectiveStartDirY;
  state.debugMovementPhase = simState.debugMovementPhase;
  state.debugCarveLockTimer = simState.debugCarveLockTimer;
  state.debugCarveSide = simState.debugCarveSide;
  state.debugSignedInputVsVelocityAngle = simState.debugSignedInputVsVelocityAngle;
  state.debugMajorDirectionChangeBlocked = simState.debugMajorDirectionChangeBlocked;
  state.debugBrakeActive = simState.debugBrakeActive;
  state.debugReverseTransitionActive = simState.debugReverseTransitionActive;
  state.debugSharpRedirectGated = simState.debugSharpRedirectGated;
  state.debugAngularCapDegPerSec = simState.debugAngularCapDegPerSec;
  state.debugCommittedDriveAngle = simState.debugCommittedDriveAngle;
  state.debugDesiredDriveAngle = simState.debugDesiredDriveAngle;
  state.debugDriveCommitLocked = simState.debugDriveCommitLocked;
  state.debugReverseState = simState.debugReverseState;
  state.debugOppositeIntentBlocked = simState.debugOppositeIntentBlocked;
  state.debugCommitUnlockReason = simState.debugCommitUnlockReason;
  state.debugMinHeadingAuthorityActive = simState.debugMinHeadingAuthorityActive;
  state.debugMovementModel = simState.debugMovementModel;
  state.debugMovementModelStepUsed = simState.debugMovementModelStepUsed;
  state.debugHeadingAngle = simState.debugHeadingAngle;
  state.debugHeadingOmega = simState.debugHeadingOmega;
  state.debugForwardSpeed = simState.debugForwardSpeed;
  state.debugLateralSpeed = simState.debugLateralSpeed;
  state.debugDesiredHeadingAngle = simState.debugDesiredHeadingAngle;
  state.debugHeadingErrorDeg = simState.debugHeadingErrorDeg;
  state.debugSteerInput = simState.debugSteerInput;
  state.debugThrottleInput = simState.debugThrottleInput;
  state.chargeActive = !!simState.debugChargeActive;
  state.debugBaseBodyAngle = simState.debugBaseBodyAngle;
  state.debugBodyYawOffset = simState.debugBodyYawOffset;
  state.debugBodyTurnInput = simState.debugBodyTurnInput;
  state.debugActiveBodyModel = simState.debugActiveBodyModel;
  const postStepX = state.x;
  const postStepY = state.y;
  const postStepSpeed = Math.hypot(state.vx, state.vy);
  lastStepTrace = {
    throttle: input.throttle ?? 0,
    steer: input.steer ?? 0,
    brake: input.brake ?? 0,
    preStepX,
    preStepY,
    postStepX,
    postStepY,
    deltaPos: Math.hypot(postStepX - preStepX, postStepY - preStepY),
    preStepVx: prevVx,
    preStepVy: prevVy,
    postStepVx: state.vx,
    postStepVy: state.vy,
    speed: postStepSpeed,
    heading: state.heading ?? 0,
    moveAngle: state.moveAngle ?? 0
  };

  const speed = Math.hypot(state.vx, state.vy);
  const maxSpeed = (config.maxSpeed ?? config.maxSpeedNoPuck ?? 1);
  const heading = Number.isFinite(simState.heading) ? simState.heading! : (simState.moveAngle ?? 0);
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const forwardSpeed = state.vx * hx + state.vy * hy;
  const lateralSpeed = state.vx * (-hy) + state.vy * hx;

  const beforeDir = prevSpeed > 0 ? Math.atan2(prevVy, prevVx) : (state.moveAngle ?? 0);
  const afterDir = speed > 0 ? Math.atan2(state.vy, state.vx) : beforeDir;
  let driftAngle = Math.abs(afterDir - heading);
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
    requestedInputDirX: simState.debugRequestedInputDirX ?? simState.debugFilteredInputX ?? 0,
    requestedInputDirY: simState.debugRequestedInputDirY ?? simState.debugFilteredInputY ?? 0,
    committedDirX: simState.committedDirX ?? 0,
    committedDirY: simState.committedDirY ?? 0,
    distanceSinceCommit: simState.distanceSinceCommit ?? 0,
    reverseDriveState: simState.reverseDriveState ?? 'NORMAL',
    reverseTransitionActive: !!simState.reverseTransitionActive,
    reverseTransitionTimer: simState.reverseTransitionTimer ?? 0,
    majorDirectionChangeBlocked: !!simState.debugMajorDirectionChangeBlocked,
    sharpRedirectGated: !!simState.debugSharpRedirectGated,
    angularCapDegPerSec: simState.debugAngularCapDegPerSec ?? 0,
    committedDriveAngle: simState.debugCommittedDriveAngle ?? 0,
    desiredDriveAngle: simState.debugDesiredDriveAngle ?? 0,
    driveCommitLocked: !!simState.debugDriveCommitLocked,
    reverseState: simState.debugReverseState ?? 'NORMAL',
    oppositeIntentBlocked: !!simState.debugOppositeIntentBlocked,
    commitUnlockReason: simState.debugCommitUnlockReason ?? 'NONE',
    minHeadingAuthorityActive: !!simState.debugMinHeadingAuthorityActive,
    movementModel: simState.debugMovementModel ?? 'desiredHeadingTraction',
    movementModelRequested: simState.debugMovementModelRequested ?? 'DESIRED_HEADING_TRACTION',
    movementModelAuthoritative: simState.debugMovementModelAuthoritative ?? 'DESIRED_HEADING_TRACTION',
    movementModelSource: 'serverPlayerState',
    movementModelStepUsed: simState.debugMovementModelStepUsed ?? simState.debugMovementModel ?? 'desiredHeadingTraction',
    headingAngle: simState.debugHeadingAngle ?? simState.heading ?? 0,
    headingOmega: simState.debugHeadingOmega ?? simState.headingOmega ?? 0,
    forwardSpeedLocal: simState.debugForwardSpeed ?? 0,
    lateralSpeedLocal: simState.debugLateralSpeed ?? 0,
    desiredHeadingAngle: simState.debugDesiredHeadingAngle ?? simState.desiredHeadingAngle ?? simState.inputAngle ?? 0,
    headingErrorDeg: simState.debugHeadingErrorDeg ?? 0,
    steerInput: simState.debugSteerInput ?? 0,
    throttleInput: simState.debugThrottleInput ?? 0,
    brakeActive: !!simState.debugBrakeActive,
    rawInputX: simState.debugRawInputX ?? input.steer ?? 0,
    rawInputY: simState.debugRawInputY ?? input.throttle ?? 0,
    filteredInputX: simState.debugFilteredInputX ?? simState.debugDesiredInputX ?? 0,
    filteredInputY: simState.debugFilteredInputY ?? simState.debugDesiredInputY ?? 0,
    appliedForwardForce: simState.debugAppliedForwardForce ?? 0,
    appliedLateralForce: simState.debugAppliedLateralForce ?? 0,
    edgeFactor: simState.debugEdgeFactor ?? 0,
    commitTimer: simState.debugCommitTimer ?? simState.directionCommitTimer ?? 0,
    oppositeHoldTimer: simState.debugOppositeHoldTimer ?? simState.oppositeHoldTimer ?? 0,
    steerDirX: simState.debugSteerDirX ?? simState.committedDirX ?? 0,
    steerDirY: simState.debugSteerDirY ?? simState.committedDirY ?? 0,
    minSteerSpeed: simState.debugMinSteerSpeed ?? 0,
    lowSpeedSteeringDisabled: !!simState.debugLowSpeedSteeringDisabled,
    lowSpeedStartupActive: !!simState.debugLowSpeedStartupActive,
    travelDirLocked: !!simState.debugTravelDirLocked,
    startupLatchActive: !!simState.debugStartupLatchActive,
    latchedInputIgnored: !!simState.debugLatchedInputIgnored,
    startupReleaseTimer: simState.debugStartupReleaseTimer ?? simState.startupReleaseTimer ?? 0,
    startCommitActive: !!simState.debugStartCommitActive,
    startCommitTimer: simState.debugStartCommitTimer ?? simState.startCommitTimer ?? 0,
    startDirX: simState.debugStartDirX ?? simState.startDirX ?? 0,
    startDirY: simState.debugStartDirY ?? simState.startDirY ?? 0,
    effectiveStartDirX: simState.debugEffectiveStartDirX ?? simState.debugSteerDirX ?? 0,
    effectiveStartDirY: simState.debugEffectiveStartDirY ?? simState.debugSteerDirY ?? 0,
    movementPhase: simState.debugMovementPhase ?? simState.movementPhase ?? 'GLIDE',
    carveLockTimer: simState.debugCarveLockTimer ?? simState.carveLockTimer ?? 0,
    carveSide: simState.debugCarveSide ?? simState.carveSide ?? 0,
    signedInputVsVelocityAngle: simState.debugSignedInputVsVelocityAngle ?? 0,
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

  syncUsedTuning(config);

  try {
    lastTelemetry = telemetry;
  } catch {}

  return telemetry;
}

