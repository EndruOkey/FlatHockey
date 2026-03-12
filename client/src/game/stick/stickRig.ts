export interface StickPose {
  angle: number;
  pivotX: number;
  pivotY: number;
  bladeX: number;
  bladeY: number;
  shaftLength: number;
  bladeLength: number;
  behindBody: boolean;
}

export const STICK_CONFIG = {
  bodyOffsetForward: 14,
  bodyOffsetSide: 0,
  shaftLength: 34,
  bladeLength: 10,
  bladeAngleOffset: 0.42,
  shaftThickness: 4,
  bladeThickness: 5
} as const;

export function computeStickPose(playerX: number, playerY: number, aimAngle: number): StickPose {
  const aimX = Math.cos(aimAngle);
  const aimY = Math.sin(aimAngle);
  const sideX = -aimY;
  const sideY = aimX;
  const pivotX = playerX + aimX * STICK_CONFIG.bodyOffsetForward + sideX * STICK_CONFIG.bodyOffsetSide;
  const pivotY = playerY + aimY * STICK_CONFIG.bodyOffsetForward + sideY * STICK_CONFIG.bodyOffsetSide;
  const shaftEndX = pivotX + aimX * STICK_CONFIG.shaftLength;
  const shaftEndY = pivotY + aimY * STICK_CONFIG.shaftLength;
  const bladeAngle = aimAngle + STICK_CONFIG.bladeAngleOffset * (aimX >= 0 ? 1 : -1);

  return {
    angle: aimAngle,
    pivotX,
    pivotY,
    bladeX: shaftEndX + Math.cos(bladeAngle) * STICK_CONFIG.bladeLength,
    bladeY: shaftEndY + Math.sin(bladeAngle) * STICK_CONFIG.bladeLength,
    shaftLength: STICK_CONFIG.shaftLength,
    bladeLength: STICK_CONFIG.bladeLength,
    behindBody: aimY < 0
  };
}
