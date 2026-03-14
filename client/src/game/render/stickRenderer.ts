import Phaser from 'phaser';
import type { SemiPhysicalStickPose } from '@flathockey/shared';
import type { PlayerBodyRig } from '../entities/playerBodyRig';

const SHAFT_COLOR = 0x2d333b;
const SHAFT_WRAP_COLOR = 0xcfd9e2;
const BLADE_COLOR = 0xe9ecef;
const SHAFT_THICKNESS = 5;
const BLADE_THICKNESS = 6;

export type StickRenderLayers = {
  back: Phaser.GameObjects.Graphics;
  front: Phaser.GameObjects.Graphics;
};

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

function offset(point: { x: number; y: number }, axis: { x: number; y: number }, amount: number) {
  return {
    x: point.x + axis.x * amount,
    y: point.y + axis.y * amount
  };
}

export function renderStick(
  layers: StickRenderLayers,
  pose: SemiPhysicalStickPose,
  rig: PlayerBodyRig,
  playerWorldX: number,
  playerWorldY: number,
  renderScale: number,
  options: {
    hasPuck?: boolean;
  } = {}
) {
  const back = layers.back;
  const front = layers.front;

  // Rig anchors are container-local pixels. Pose points are world units.
  const shaftAnchor = {
    x: (pose.shaftAnchorX - playerWorldX) * renderScale,
    y: (pose.shaftAnchorY - playerWorldY) * renderScale
  };
  const rawGrip = {
    x: (pose.gripX - playerWorldX) * renderScale,
    y: (pose.gripY - playerWorldY) * renderScale
  };
  const bladeBaseX = (pose.bladeBaseX - playerWorldX) * renderScale;
  const bladeBaseY = (pose.bladeBaseY - playerWorldY) * renderScale;
  const bladeCenterX = (pose.bladeCenterX - playerWorldX) * renderScale;
  const bladeCenterY = (pose.bladeCenterY - playerWorldY) * renderScale;
  const bladeTipX = (pose.bladeTipX - playerWorldX) * renderScale;
  const bladeTipY = (pose.bladeTipY - playerWorldY) * renderScale;
  const gripHand = rig.gripHand === 'left' ? rig.leftHandSocket : rig.rightHandSocket;
  const guideHand = rig.guideHand === 'left' ? rig.leftHandSocket : rig.rightHandSocket;
  const underBodyDir = normalize(rawGrip.x - shaftAnchor.x, rawGrip.y - shaftAnchor.y);
  const gripBridge = lerpPoint(shaftAnchor, rawGrip, 0.86);
  const guideGrip = lerpPoint(rawGrip, { x: bladeBaseX, y: bladeBaseY }, 0.34);
  const buttEnd = offset(shaftAnchor, underBodyDir, -rig.ringRadius * 0.1);
  const gripWrapA = lerpPoint(rawGrip, { x: bladeBaseX, y: bladeBaseY }, 0.1);
  const gripWrapB = lerpPoint(rawGrip, { x: bladeBaseX, y: bladeBaseY }, 0.24);
  const guideWrap = lerpPoint(rawGrip, { x: bladeBaseX, y: bladeBaseY }, 0.38);

  back.lineStyle(SHAFT_THICKNESS + 3, 0x091118, 0.16);
  back.lineBetween(buttEnd.x, buttEnd.y, rawGrip.x, rawGrip.y);
  back.lineStyle(SHAFT_THICKNESS + 1, SHAFT_COLOR, 0.7);
  back.lineBetween(shaftAnchor.x, shaftAnchor.y, rawGrip.x, rawGrip.y);
  back.fillStyle(0x0b151d, 0.2);
  back.fillCircle(shaftAnchor.x, shaftAnchor.y, SHAFT_THICKNESS * 1.05);

  front.lineStyle(SHAFT_THICKNESS + 1.8, 0x11161c, 0.18);
  front.lineBetween(gripHand.x, gripHand.y, gripBridge.x, gripBridge.y);
  front.lineBetween(guideHand.x, guideHand.y, guideGrip.x, guideGrip.y);
  front.lineStyle(SHAFT_THICKNESS - 0.6, SHAFT_COLOR, 0.98);
  front.lineBetween(gripHand.x, gripHand.y, gripBridge.x, gripBridge.y);
  front.lineBetween(guideHand.x, guideHand.y, guideGrip.x, guideGrip.y);

  front.lineStyle(SHAFT_THICKNESS + 2.4, 0x11161c, 0.22);
  front.lineBetween(rawGrip.x, rawGrip.y, bladeBaseX, bladeBaseY);
  front.lineStyle(SHAFT_THICKNESS, SHAFT_COLOR, 1);
  front.lineBetween(rawGrip.x, rawGrip.y, bladeBaseX, bladeBaseY);
  front.fillStyle(SHAFT_COLOR, 1);
  front.fillCircle(rawGrip.x, rawGrip.y, SHAFT_THICKNESS * 0.72);
  front.fillCircle(guideGrip.x, guideGrip.y, SHAFT_THICKNESS * 0.58);
  front.fillCircle(bladeBaseX, bladeBaseY, SHAFT_THICKNESS * 0.58);

  front.lineStyle(SHAFT_THICKNESS * 0.62, SHAFT_WRAP_COLOR, 0.92);
  front.lineBetween(gripWrapA.x, gripWrapA.y, gripWrapB.x, gripWrapB.y);
  front.lineStyle(SHAFT_THICKNESS * 0.48, SHAFT_WRAP_COLOR, 0.72);
  front.lineBetween(guideGrip.x, guideGrip.y, guideWrap.x, guideWrap.y);

  front.lineStyle(BLADE_THICKNESS + 2, 0x11161c, 0.18);
  front.lineBetween(bladeBaseX, bladeBaseY, bladeTipX, bladeTipY);
  front.lineStyle(BLADE_THICKNESS, BLADE_COLOR, 1);
  front.lineBetween(bladeBaseX, bladeBaseY, bladeTipX, bladeTipY);
  front.fillStyle(BLADE_COLOR, 1);
  front.fillCircle(bladeBaseX, bladeBaseY, BLADE_THICKNESS * 0.56);
  front.fillCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 0.48);
  front.fillCircle(bladeTipX, bladeTipY, BLADE_THICKNESS * 0.54);

  if (options.hasPuck) {
    front.fillStyle(0xf4fbff, 0.18);
    front.fillCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 1.05);
    front.lineStyle(1.2, 0xffffff, 0.32);
    front.strokeCircle(bladeCenterX, bladeCenterY, BLADE_THICKNESS * 0.82);
  }
}
