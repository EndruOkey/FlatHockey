import Phaser from 'phaser';
import type { SemiPhysicalStickPose } from '@flathockey/shared';
import type { PlayerBodyRig } from '../entities/playerBodyRig';

const SHAFT_COLOR = 0x2d333b;
const BLADE_COLOR = 0xe9ecef;
const SHAFT_THICKNESS = 4;
const BLADE_THICKNESS = 5;

function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function normalize(dx: number, dy: number) {
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) {
    return { x: 1, y: 0 };
  }
  return {
    x: dx / length,
    y: dy / length
  };
}

export function renderStick(
  graphics: Phaser.GameObjects.Graphics,
  pose: SemiPhysicalStickPose,
  rig: PlayerBodyRig,
  playerX: number,
  playerY: number,
  options: {
    hasPuck?: boolean;
  } = {}
) {
  const leftHandX = rig.leftHandSocket.x;
  const leftHandY = rig.leftHandSocket.y;
  const rightHandX = rig.rightHandSocket.x;
  const rightHandY = rig.rightHandSocket.y;
  const rawGrip = {
    x: pose.gripX - playerX,
    y: pose.gripY - playerY
  };
  const bladeBaseX = pose.bladeBaseX - playerX;
  const bladeBaseY = pose.bladeBaseY - playerY;
  const bladeCenterX = pose.bladeCenterX - playerX;
  const bladeCenterY = pose.bladeCenterY - playerY;
  const bladeTipX = pose.bladeTipX - playerX;
  const bladeTipY = pose.bladeTipY - playerY;
  const gripHand = rig.gripHand === 'left' ? { x: leftHandX, y: leftHandY } : { x: rightHandX, y: rightHandY };
  const guideHand = rig.guideHand === 'left' ? { x: leftHandX, y: leftHandY } : { x: rightHandX, y: rightHandY };
  const gripBlend = lerpPoint(gripHand, rawGrip, 0.3);
  const shaftDir = normalize(bladeBaseX - gripBlend.x, bladeBaseY - gripBlend.y);
  const gripLead = Math.min(rig.ringRadius * 0.12, Math.hypot(bladeBaseX - gripBlend.x, bladeBaseY - gripBlend.y) * 0.1);
  const gripX = gripBlend.x + shaftDir.x * gripLead;
  const gripY = gripBlend.y + shaftDir.y * gripLead;
  const guideGrip = lerpPoint({ x: gripX, y: gripY }, { x: bladeBaseX, y: bladeBaseY }, 0.34);

  graphics.lineStyle(SHAFT_THICKNESS + 1.5, 0x11161c, 0.16);
  graphics.lineBetween(gripHand.x, gripHand.y, gripX, gripY);
  graphics.lineBetween(guideHand.x, guideHand.y, guideGrip.x, guideGrip.y);
  graphics.lineStyle(SHAFT_THICKNESS - 1, SHAFT_COLOR, 0.96);
  graphics.lineBetween(gripHand.x, gripHand.y, gripX, gripY);
  graphics.lineBetween(guideHand.x, guideHand.y, guideGrip.x, guideGrip.y);

  graphics.lineStyle(SHAFT_THICKNESS + 2, 0x11161c, 0.18);
  graphics.lineBetween(gripX, gripY, bladeBaseX, bladeBaseY);
  graphics.lineStyle(SHAFT_THICKNESS, SHAFT_COLOR, 1);
  graphics.lineBetween(gripX, gripY, bladeBaseX, bladeBaseY);
  graphics.fillStyle(SHAFT_COLOR, 1);
  graphics.fillCircle(gripX, gripY, SHAFT_THICKNESS * 0.56);
  graphics.fillCircle(guideGrip.x, guideGrip.y, SHAFT_THICKNESS * 0.46);
  graphics.fillCircle(bladeBaseX, bladeBaseY, SHAFT_THICKNESS * 0.5);

  graphics.lineStyle(BLADE_THICKNESS + 2, 0x11161c, 0.16);
  graphics.lineBetween(bladeBaseX, bladeBaseY, bladeTipX, bladeTipY);
  graphics.lineStyle(BLADE_THICKNESS, BLADE_COLOR, 1);
  graphics.lineBetween(bladeBaseX, bladeBaseY, bladeTipX, bladeTipY);
  graphics.fillStyle(BLADE_COLOR, 1);
  graphics.fillCircle(bladeBaseX, bladeBaseY, BLADE_THICKNESS * 0.5);
  graphics.fillCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 0.42);
  graphics.fillCircle(bladeTipX, bladeTipY, BLADE_THICKNESS * 0.48);

  if (options.hasPuck) {
    graphics.fillStyle(0xf4fbff, 0.18);
    graphics.fillCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 1.05);
    graphics.lineStyle(1.2, 0xffffff, 0.32);
    graphics.strokeCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 0.82);
  }
}
