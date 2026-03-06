export type MovementDebugMetrics = {
  currentSpeed: number;
  velocityX: number;
  velocityY: number;
  turnRate: number;
  turnRateAppliedDeg: number;
  inputVector: string;
  pointerVector: string;
  aimAngle: number;
  targetAimAngle: number;
  stickRotation: number;
  actualStickAngle: number;
  stickAngularSpeed: number;
  angleDelta: number;
  desiredMoveAngle: number;
  actualMoveAngle: number;
  velocityDesiredDeltaDeg: number;
  brakeActive: boolean;
  baseBodyAngle: number;
  bodyYawOffset: number;
  currentBodyAngle: number;
  recorderState: 'idle' | 'recording' | 'replaying';
  recordedFrames: number;
};

const DEFAULT_MOVEMENT: MovementDebugMetrics = {
  currentSpeed: 0,
  velocityX: 0,
  velocityY: 0,
  turnRate: 0,
  turnRateAppliedDeg: 0,
  inputVector: '(0,0)',
  pointerVector: '(0,0)',
  aimAngle: 0,
  targetAimAngle: 0,
  stickRotation: 0,
  actualStickAngle: 0,
  stickAngularSpeed: 0,
  angleDelta: 0,
  desiredMoveAngle: 0,
  actualMoveAngle: 0,
  velocityDesiredDeltaDeg: 0,
  brakeActive: false,
  baseBodyAngle: 0,
  bodyYawOffset: 0,
  currentBodyAngle: 0,
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
