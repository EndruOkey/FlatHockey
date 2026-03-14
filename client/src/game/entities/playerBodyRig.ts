export type Handedness = 'left' | 'right';
export type HandSocketSide = 'left' | 'right';

export type PlayerCosmeticSlots = {
  headSlot: null;
  torsoSlot: null;
  gloveSlotLeft: null;
  gloveSlotRight: null;
  lowerSlot: null;
  stickSlot: null;
};

export type BodyRigAnchor = {
  x: number;
  y: number;
};

type BodySpaceOffset = {
  forward: number;
  side: number;
};

export type PlayerBodyRig = {
  handedness: Handedness;
  gripHand: HandSocketSide;
  guideHand: HandSocketSide;
  ringRadius: number;
  ringCenter: BodyRigAnchor;
  bodyCenter: BodyRigAnchor;
  torsoBaseAnchor: BodyRigAnchor;
  lowerBodyAnchor: BodyRigAnchor;
  chestAnchor: BodyRigAnchor;
  headAnchor: BodyRigAnchor;
  leftShoulderAnchor: BodyRigAnchor;
  rightShoulderAnchor: BodyRigAnchor;
  leftHandSocket: BodyRigAnchor;
  rightHandSocket: BodyRigAnchor;
  nameTagAnchor: BodyRigAnchor;
  forward: BodyRigAnchor;
  right: BodyRigAnchor;
  bodyWidth: number;
  bodyHeight: number;
  torsoWidth: number;
  torsoHeight: number;
  shoulderWidth: number;
  shoulderHeight: number;
  lowerBodyWidth: number;
  lowerBodyHeight: number;
  headRadius: number;
};

export const PLAYER_RIG = {
  REFERENCE_RING_RADIUS: 32,
  BODY_CENTER: { forward: 0, side: 0 },
  HEAD: { forward: 16, side: 0 },
  CHEST: { forward: 4.5, side: 0 },
  SHOULDER_L: { forward: 4, side: -19 },
  SHOULDER_R: { forward: 4, side: 19 },
  HAND_L: { forward: 11, side: -20 },
  HAND_R: { forward: 14, side: 18 },
  HIPS: { forward: -6.5, side: 0 },
  NAME_TAG: { forward: 29, side: 0 },
  TORSO_BASE: { forward: -3, side: 0 },
  HEAD_RADIUS: 9.4,
  BODY_WIDTH: 52,
  BODY_HEIGHT: 40,
  TORSO_WIDTH: 41,
  TORSO_HEIGHT: 33,
  SHOULDER_WIDTH: 58,
  SHOULDER_HEIGHT: 24,
  LOWER_BODY_WIDTH: 27,
  LOWER_BODY_HEIGHT: 21
} as const;

export function createPlayerCosmeticSlots(): PlayerCosmeticSlots {
  return {
    headSlot: null,
    torsoSlot: null,
    gloveSlotLeft: null,
    gloveSlotRight: null,
    lowerSlot: null,
    stickSlot: null
  };
}

export function derivePlayerBodyRig(input: {
  facingAngle: number;
  handedness: Handedness;
  ringRadius: number;
}): PlayerBodyRig {
  const ringRadius = Math.max(12, input.ringRadius);
  const scaleFactor = ringRadius / PLAYER_RIG.REFERENCE_RING_RADIUS;
  const bodyAngle = input.facingAngle;
  const forward = {
    x: Math.cos(bodyAngle),
    y: Math.sin(bodyAngle)
  };
  const right = {
    x: -forward.y,
    y: forward.x
  };
  const ringCenter = point(0, 0);
  const bodyCenter = bodyAnchor(ringCenter, PLAYER_RIG.BODY_CENTER, scaleFactor, forward, right);
  const gripHand: HandSocketSide = input.handedness === 'left' ? 'left' : 'right';
  const guideHand: HandSocketSide = gripHand === 'left' ? 'right' : 'left';
  const torsoBaseAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.TORSO_BASE, scaleFactor, forward, right);
  const chestAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.CHEST, scaleFactor, forward, right);
  const lowerBodyAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.HIPS, scaleFactor, forward, right);
  const headAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.HEAD, scaleFactor, forward, right);
  const leftShoulderAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.SHOULDER_L, scaleFactor, forward, right);
  const rightShoulderAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.SHOULDER_R, scaleFactor, forward, right);
  const leftHandSocket = bodyAnchor(bodyCenter, PLAYER_RIG.HAND_L, scaleFactor, forward, right);
  const rightHandSocket = bodyAnchor(bodyCenter, PLAYER_RIG.HAND_R, scaleFactor, forward, right);
  const nameTagAnchor = bodyAnchor(bodyCenter, PLAYER_RIG.NAME_TAG, scaleFactor, forward, right);

  return {
    handedness: input.handedness,
    gripHand,
    guideHand,
    ringRadius,
    ringCenter,
    bodyCenter,
    torsoBaseAnchor,
    lowerBodyAnchor,
    chestAnchor,
    headAnchor,
    leftShoulderAnchor,
    rightShoulderAnchor,
    leftHandSocket,
    rightHandSocket,
    nameTagAnchor,
    forward,
    right,
    bodyWidth: PLAYER_RIG.BODY_WIDTH * scaleFactor,
    bodyHeight: PLAYER_RIG.BODY_HEIGHT * scaleFactor,
    torsoWidth: PLAYER_RIG.TORSO_WIDTH * scaleFactor,
    torsoHeight: PLAYER_RIG.TORSO_HEIGHT * scaleFactor,
    shoulderWidth: PLAYER_RIG.SHOULDER_WIDTH * scaleFactor,
    shoulderHeight: PLAYER_RIG.SHOULDER_HEIGHT * scaleFactor,
    lowerBodyWidth: PLAYER_RIG.LOWER_BODY_WIDTH * scaleFactor,
    lowerBodyHeight: PLAYER_RIG.LOWER_BODY_HEIGHT * scaleFactor,
    headRadius: PLAYER_RIG.HEAD_RADIUS * scaleFactor
  };
}

function point(x: number, y: number): BodyRigAnchor {
  return { x, y };
}

function add(a: BodyRigAnchor, b: BodyRigAnchor): BodyRigAnchor {
  return {
    x: a.x + b.x,
    y: a.y + b.y
  };
}

function scale(v: BodyRigAnchor, s: number): BodyRigAnchor {
  return {
    x: v.x * s,
    y: v.y * s
  };
}

function bodyAnchor(
  origin: BodyRigAnchor,
  local: BodySpaceOffset,
  scaleFactor: number,
  forward: BodyRigAnchor,
  right: BodyRigAnchor
): BodyRigAnchor {
  return add(
    add(origin, scale(forward, local.forward * scaleFactor)),
    scale(right, local.side * scaleFactor)
  );
}
