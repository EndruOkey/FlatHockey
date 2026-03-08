export type MovementDebugMetrics = {
  currentSpeed: number;
  velocityX: number;
  velocityY: number;
  velocityVector: string;
  turnRate: number;
  turnRateAppliedDeg: number;
  inputVector: string;
  rawInputVector: string;
  filteredInputVector: string;
  desiredInputVector: string;
  pointerVector: string;
  aimAngle: number;
  bodyWorldAngle: number;
  targetAimAngle: number;
  stickRotation: number;
  actualStickAngle: number;
  stickAngularSpeed: number;
  angleDelta: number;
  stickAngleDeltaToTarget: number;
  stickSpriteForwardOffsetDeg: number;
  stickRotationSpace: string;
  desiredMoveAngle: number;
  turnIntentAngle: number;
  actualMoveAngle: number;
  velocityAngle: number;
  forwardVelocity: number;
  lateralVelocity: number;
  velocityDesiredDeltaDeg: number;
  turnResistance: number;
  redirectAccelScale: number;
  antiFlipActive: boolean;
  movementModel: string;
  headingAngle: number;
  headingOmega: number;
  forwardSpeedLocal: number;
  lateralSpeedLocal: number;
  desiredHeadingAngle: number;
  headingErrorDeg: number;
  steerInput: number;
  throttleInput: number;
  appliedForwardForce: number;
  appliedLateralForce: number;
  edgeFactor: number;
  commitTimer: number;
  oppositeHoldTimer: number;
  steerDir: string;
  movementPhase: string;
  carveLockTimer: number;
  carveSide: number;
  signedInputVsVelocityAngle: number;
  minSteerSpeed: number;
  lowSpeedSteeringDisabled: boolean;
  lowSpeedStartupActive: boolean;
  travelDirLocked: boolean;
  startupLatchActive: boolean;
  latchedInputIgnored: boolean;
  startupReleaseTimer: number;
  startCommitActive: boolean;
  startCommitTimer: number;
  startDir: string;
  effectiveStartDir: string;
  brakeActive: boolean;
  chargeActive: boolean;
  baseBodyAngle: number;
  bodyYawOffset: number;
  currentBodyAngle: number;
  bodyTurnInput: number;
  activeBodyModel: string;
  recorderState: 'idle' | 'recording' | 'replaying';
  recordedFrames: number;
};

const DEFAULT_MOVEMENT: MovementDebugMetrics = {
  currentSpeed: 0,
  velocityX: 0,
  velocityY: 0,
  velocityVector: '(0,0)',
  turnRate: 0,
  turnRateAppliedDeg: 0,
  inputVector: '(0,0)',
  rawInputVector: '(0,0)',
  filteredInputVector: '(0,0)',
  desiredInputVector: '(0,0)',
  pointerVector: '(0,0)',
  aimAngle: 0,
  bodyWorldAngle: 0,
  targetAimAngle: 0,
  stickRotation: 0,
  actualStickAngle: 0,
  stickAngularSpeed: 0,
  angleDelta: 0,
  stickAngleDeltaToTarget: 0,
  stickSpriteForwardOffsetDeg: 0,
  stickRotationSpace: 'WORLD',
  desiredMoveAngle: 0,
  turnIntentAngle: 0,
  actualMoveAngle: 0,
  velocityAngle: 0,
  forwardVelocity: 0,
  lateralVelocity: 0,
  velocityDesiredDeltaDeg: 0,
  turnResistance: 0,
  redirectAccelScale: 1,
  antiFlipActive: false,
  movementModel: 'desiredHeadingTraction',
  headingAngle: 0,
  headingOmega: 0,
  forwardSpeedLocal: 0,
  lateralSpeedLocal: 0,
  desiredHeadingAngle: 0,
  headingErrorDeg: 0,
  steerInput: 0,
  throttleInput: 0,
  appliedForwardForce: 0,
  appliedLateralForce: 0,
  edgeFactor: 0,
  commitTimer: 0,
  oppositeHoldTimer: 0,
  steerDir: '(0,0)',
  movementPhase: 'GLIDE',
  carveLockTimer: 0,
  carveSide: 0,
  signedInputVsVelocityAngle: 0,
  minSteerSpeed: 0,
  lowSpeedSteeringDisabled: false,
  lowSpeedStartupActive: false,
  travelDirLocked: false,
  startupLatchActive: false,
  latchedInputIgnored: false,
  startupReleaseTimer: 0,
  startCommitActive: false,
  startCommitTimer: 0,
  startDir: '(0,0)',
  effectiveStartDir: '(0,0)',
  brakeActive: false,
  chargeActive: false,
  baseBodyAngle: 0,
  bodyYawOffset: 0,
  currentBodyAngle: 0,
  bodyTurnInput: 0,
  activeBodyModel: 'B',
  recorderState: 'idle',
  recordedFrames: 0
};

let movementMetrics: MovementDebugMetrics = { ...DEFAULT_MOVEMENT };

export function setMovementDebugMetrics(next: Partial<MovementDebugMetrics>) {
  movementMetrics = { ...movementMetrics, ...next };
}

export function getMovementDebugMetrics(): MovementDebugMetrics {
  return { ...movementMetrics };
}
