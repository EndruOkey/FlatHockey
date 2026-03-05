export type MovementDebugMetrics = {
  currentSpeed: number;
  velocityX: number;
  velocityY: number;
  turnRate: number;
  inputVector: string;
  recorderState: 'idle' | 'recording' | 'replaying';
  recordedFrames: number;
};

const DEFAULT_MOVEMENT: MovementDebugMetrics = {
  currentSpeed: 0,
  velocityX: 0,
  velocityY: 0,
  turnRate: 0,
  inputVector: '(0,0)',
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

