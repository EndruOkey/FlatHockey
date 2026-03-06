export type MovementDebugMetrics = {
  currentSpeed: number;
  velocityX: number;
  velocityY: number;
  turnRate: number;
  inputVector: string;
  pointerVector: string;
  aimAngle: number;
  targetAimAngle: number;
  stickRotation: number;
  stickAngularSpeed: number;
  angleDelta: number;
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
  inputVector: '(0,0)',
  pointerVector: '(0,0)',
  aimAngle: 0,
  targetAimAngle: 0,
  stickRotation: 0,
  stickAngularSpeed: 0,
  angleDelta: 0,
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
