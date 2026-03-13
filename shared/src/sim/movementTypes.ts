export type MovementAxis = -1 | 0 | 1;
export type MovementButton = 0 | 1;
export type LocomotionState = 'idle' | 'skating' | 'gliding' | 'stopping';

export type PlayerMovementInput = {
  moveX?: number;
  moveY?: number;
  aimAngle?: number;
  stop?: number;
};

export type PlayerMovementState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  steeringHeading?: number;
  inputHeading?: number;
  intentBoostTimer: number;
  lastIntentAngle: number | null;
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
  traction: number;
  rotationSpeed: number;
  lowSpeedRotationSpeed: number;
  turnPenalty: number;
  carveResponse: number;
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
  travelHeading: number;
  locomotionState: LocomotionState;
  stopActive: boolean;
};

export type PlayerMovementDebugState = {
  speed: number;
  velocityX: number;
  velocityY: number;
  heading: number;
  desiredHeading: number;
  travelHeading: number;
  locomotionState: LocomotionState;
  stopActive: boolean;
};
