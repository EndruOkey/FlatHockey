export type MovementAxis = -1 | 0 | 1;
export type MovementButton = 0 | 1;
export type LocomotionState = 'idle' | 'driving' | 'gliding' | 'stopping' | 'reorienting';

export type PlayerMovementInput = {
  moveX?: number;
  moveY?: number;
  aimAngle?: number;
  stop?: number;
  reorient?: number;
};

export type PlayerMovementState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
};

export type RinkBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ResolvedPlayerMovementConfig = {
  moveSpeed: number;
  playerRadius: number;
  acceleration: number;
  passiveDeceleration: number;
  stopDeceleration: number;
  turnRateMin: number;
  turnRateMax: number;
  lowSpeedPivotTurnRate: number;
  reorientationTurnRate: number;
  edgeBoostAmount: number;
  rinkBounds: RinkBounds;
};

export type PlayerMovementStepResult = {
  x: number;
  y: number;
  moveX: MovementAxis;
  moveY: MovementAxis;
  vx: number;
  vy: number;
  speed: number;
  heading: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  stopActive: boolean;
  reorientationActive: boolean;
};

export type PlayerMovementDebugState = {
  speed: number;
  velocityX: number;
  velocityY: number;
  heading: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  stopActive: boolean;
  reorientationActive: boolean;
};
