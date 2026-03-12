import Phaser from 'phaser';
import { STICK_CONFIG, type StickPose } from '../stick/stickRig';

const SHAFT_COLOR = 0x2d333b;
const BLADE_COLOR = 0xe9ecef;

export function renderStick(
  graphics: Phaser.GameObjects.Graphics,
  pose: StickPose,
  playerX: number,
  playerY: number
) {
  const pivotX = pose.pivotX - playerX;
  const pivotY = pose.pivotY - playerY;
  const shaftEndX = pivotX + Math.cos(pose.angle) * pose.shaftLength;
  const shaftEndY = pivotY + Math.sin(pose.angle) * pose.shaftLength;
  const bladeX = pose.bladeX - playerX;
  const bladeY = pose.bladeY - playerY;

  graphics.clear();

  graphics.lineStyle(STICK_CONFIG.shaftThickness + 2, 0x11161c, 0.18);
  graphics.lineBetween(pivotX, pivotY, shaftEndX, shaftEndY);
  graphics.lineStyle(STICK_CONFIG.shaftThickness, SHAFT_COLOR, 1);
  graphics.lineBetween(pivotX, pivotY, shaftEndX, shaftEndY);
  graphics.fillStyle(SHAFT_COLOR, 1);
  graphics.fillCircle(pivotX, pivotY, STICK_CONFIG.shaftThickness * 0.55);
  graphics.fillCircle(shaftEndX, shaftEndY, STICK_CONFIG.shaftThickness * 0.55);

  graphics.lineStyle(STICK_CONFIG.bladeThickness + 2, 0x11161c, 0.16);
  graphics.lineBetween(shaftEndX, shaftEndY, bladeX, bladeY);
  graphics.lineStyle(STICK_CONFIG.bladeThickness, BLADE_COLOR, 1);
  graphics.lineBetween(shaftEndX, shaftEndY, bladeX, bladeY);
  graphics.fillStyle(BLADE_COLOR, 1);
  graphics.fillCircle(shaftEndX, shaftEndY, STICK_CONFIG.bladeThickness * 0.5);
  graphics.fillCircle(bladeX, bladeY, STICK_CONFIG.bladeThickness * 0.48);
}
