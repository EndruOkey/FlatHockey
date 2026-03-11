export type MovementAxis = -1 | 0 | 1;
export type MovementButton = 0 | 1;
export type LocomotionState = 'idle' | 'skating' | 'gliding' | 'stopping' | 'backwards';

export type PlayerMovementInput = {
  moveX?: number;
  moveY?: number;
  aimAngle?: number;
  stop?: number;
  backwards?: number;
};

export type PlayerMovementState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  travelHeading: number;
  aimAngle: number;
  desiredHeading: number;
  locomotionState: LocomotionState;
  backwards: boolean;
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
  backwardsAngle: number;
  backwardsRotationMultiplier: number;
  backwardsAccelerationMultiplier: number;
  backwardsSpeedMultiplier: number;
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
  backwardsActive: boolean;
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
  backwardsActive: boolean;
};
