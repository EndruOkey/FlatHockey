import Phaser from 'phaser';
import type { PlayerBodyRig } from '../entities/playerBodyRig';

const COLORS = {
  shadow: 0x07141a,
  ringFill: 0x0e2430,
  ringStroke: 0x8dc6db,
  lowerBody: 0x2b4e63,
  lowerBodyShade: 0x173142,
  torso: 0xe7f0fb,
  torsoShade: 0xcfddeb,
  shoulders: 0xd8e5f3,
  shouldersShade: 0xb9cadb,
  gloves: 0x133342,
  gloveCuff: 0x35586c,
  gloveHighlight: 0x295167,
  helmet: 0xf4d24b,
  helmetTrim: 0x19242d,
  visor: 0xa8bacb,
  outline: 0x0d1720
} as const;

export type PlayerBodyRenderLayers = {
  shadow: Phaser.GameObjects.Graphics;
  ring: Phaser.GameObjects.Graphics;
  lowerBody: Phaser.GameObjects.Graphics;
  torso: Phaser.GameObjects.Graphics;
  shoulders: Phaser.GameObjects.Graphics;
  hands: Phaser.GameObjects.Graphics;
  head: Phaser.GameObjects.Graphics;
  nameTag: Phaser.GameObjects.Text;
};

export type PlayerBodyRenderOptions = {
  isLocalPlayer?: boolean;
  hasPuck?: boolean;
};

export function clearPlayerBodyLayers(layers: PlayerBodyRenderLayers) {
  layers.shadow.clear();
  layers.ring.clear();
  layers.lowerBody.clear();
  layers.torso.clear();
  layers.shoulders.clear();
  layers.hands.clear();
  layers.head.clear();
}

export function renderPlayerBody(
  layers: PlayerBodyRenderLayers,
  rig: PlayerBodyRig,
  displayName: string,
  options: PlayerBodyRenderOptions = {}
) {
  renderShadow(layers.shadow, rig, options);
  renderRing(layers.ring, rig, options);
  renderLowerBody(layers.lowerBody, rig);
  renderTorso(layers.torso, rig);
  renderShoulders(layers.shoulders, rig);
  renderHands(layers.hands, rig);
  renderHead(layers.head, rig);
  renderNameTag(layers.nameTag, rig, displayName);
}

function renderShadow(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig, options: PlayerBodyRenderOptions) {
  const alpha = options.hasPuck ? 0.22 : options.isLocalPlayer ? 0.18 : 0.16;
  graphics.fillStyle(COLORS.shadow, alpha);
  graphics.fillEllipse(
    rig.ringCenter.x,
    rig.ringCenter.y + rig.ringRadius * 0.52,
    rig.bodyWidth * 1.02,
    rig.lowerBodyHeight * 1.15
  );
}

function renderRing(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig, options: PlayerBodyRenderOptions) {
  const fillAlpha = options.hasPuck ? 0.26 : options.isLocalPlayer ? 0.18 : 0.12;
  const strokeAlpha = options.hasPuck ? 0.78 : options.isLocalPlayer ? 0.46 : 0.34;
  const outerStrokeAlpha = options.hasPuck ? 0.3 : options.isLocalPlayer ? 0.14 : 0;
  graphics.fillStyle(COLORS.ringFill, fillAlpha);
  graphics.fillCircle(rig.ringCenter.x, rig.ringCenter.y, rig.ringRadius);
  if (outerStrokeAlpha > 0) {
    graphics.lineStyle(3, COLORS.ringStroke, outerStrokeAlpha);
    graphics.strokeCircle(rig.ringCenter.x, rig.ringCenter.y, rig.ringRadius + 2.5);
  }
  graphics.lineStyle(2, COLORS.ringStroke, strokeAlpha);
  graphics.strokeCircle(rig.ringCenter.x, rig.ringCenter.y, rig.ringRadius);
  if (options.hasPuck) {
    graphics.lineStyle(1.5, 0xf2fbff, 0.18);
    graphics.strokeCircle(rig.ringCenter.x, rig.ringCenter.y, rig.ringRadius - 3);
  }
}

function renderLowerBody(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig) {
  drawOrientedEllipse(graphics, rig.lowerBodyAnchor, rig.right, rig.forward, rig.lowerBodyWidth + 2.4, rig.lowerBodyHeight + 2.4, COLORS.outline, 0.92);
  drawOrientedEllipse(graphics, rig.lowerBodyAnchor, rig.right, rig.forward, rig.lowerBodyWidth, rig.lowerBodyHeight, COLORS.lowerBody, 1);
  graphics.lineStyle(Math.max(1, rig.lowerBodyHeight * 0.12), COLORS.lowerBodyShade, 0.78);
  graphics.lineBetween(
    rig.lowerBodyAnchor.x - rig.right.x * rig.lowerBodyWidth * 0.34,
    rig.lowerBodyAnchor.y - rig.right.y * rig.lowerBodyWidth * 0.34,
    rig.lowerBodyAnchor.x + rig.right.x * rig.lowerBodyWidth * 0.34,
    rig.lowerBodyAnchor.y + rig.right.y * rig.lowerBodyWidth * 0.34
  );
}

function renderTorso(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig) {
  drawOrientedEllipse(graphics, rig.chestAnchor, rig.right, rig.forward, rig.torsoWidth + 2.4, rig.torsoHeight + 2.4, COLORS.outline, 0.96);
  drawOrientedEllipse(graphics, rig.chestAnchor, rig.right, rig.forward, rig.torsoWidth, rig.torsoHeight, COLORS.torso, 1);
  drawOrientedEllipse(
    graphics,
    offset(rig.chestAnchor, rig.right, -rig.torsoWidth * 0.08),
    rig.right,
    rig.forward,
    rig.torsoWidth * 0.5,
    rig.torsoHeight * 0.7,
    COLORS.torsoShade,
    0.65
  );
}

function renderShoulders(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig) {
  const shoulderCenter = midpoint(rig.leftShoulderAnchor, rig.rightShoulderAnchor);
  drawOrientedEllipse(
    graphics,
    shoulderCenter,
    rig.right,
    rig.forward,
    rig.shoulderWidth + 2.2,
    rig.shoulderHeight + 2.2,
    COLORS.outline,
    0.96
  );
  drawOrientedEllipse(graphics, shoulderCenter, rig.right, rig.forward, rig.shoulderWidth, rig.shoulderHeight, COLORS.shoulders, 1);
  drawOrientedEllipse(
    graphics,
    offset(shoulderCenter, rig.forward, -rig.shoulderHeight * 0.04),
    rig.right,
    rig.forward,
    rig.shoulderWidth * 0.74,
    rig.shoulderHeight * 0.48,
    COLORS.shouldersShade,
    0.62
  );
}

function renderHands(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig) {
  drawGlove(graphics, rig, rig.leftHandSocket, -1);
  drawGlove(graphics, rig, rig.rightHandSocket, 1);
}

function renderHead(graphics: Phaser.GameObjects.Graphics, rig: PlayerBodyRig) {
  graphics.fillStyle(COLORS.outline, 0.98);
  graphics.fillCircle(rig.headAnchor.x, rig.headAnchor.y, rig.headRadius + 1.2);
  graphics.fillStyle(COLORS.helmet, 1);
  graphics.fillCircle(rig.headAnchor.x, rig.headAnchor.y, rig.headRadius);
  const visorCenter = offset(rig.headAnchor, rig.forward, rig.headRadius * 0.22);
  const visorHalfWidth = rig.headRadius * 0.52;
  graphics.lineStyle(Math.max(1.2, rig.headRadius * 0.24), COLORS.visor, 0.92);
  graphics.lineBetween(
    visorCenter.x - rig.right.x * visorHalfWidth,
    visorCenter.y - rig.right.y * visorHalfWidth,
    visorCenter.x + rig.right.x * visorHalfWidth,
    visorCenter.y + rig.right.y * visorHalfWidth
  );
  graphics.lineStyle(Math.max(1, rig.headRadius * 0.16), COLORS.helmetTrim, 0.7);
  graphics.lineBetween(
    rig.headAnchor.x - rig.right.x * rig.headRadius * 0.65,
    rig.headAnchor.y - rig.right.y * rig.headRadius * 0.65,
    rig.headAnchor.x + rig.right.x * rig.headRadius * 0.65,
    rig.headAnchor.y + rig.right.y * rig.headRadius * 0.65
  );
}

function renderNameTag(label: Phaser.GameObjects.Text, rig: PlayerBodyRig, displayName: string) {
  label.setPosition(rig.nameTagAnchor.x, rig.nameTagAnchor.y);
  label.setText(displayName);
  label.setVisible(displayName.length > 0);
}

function drawGlove(
  graphics: Phaser.GameObjects.Graphics,
  rig: PlayerBodyRig,
  anchor: { x: number; y: number },
  sideSign: number
) {
  const gloveWidth = Math.max(8, rig.ringRadius * 0.34);
  const gloveHeight = Math.max(6, rig.ringRadius * 0.26);
  const cuffCenter = offset(offset(anchor, rig.forward, -gloveHeight * 0.08), rig.right, sideSign * gloveWidth * 0.08);
  const palmCenter = offset(offset(anchor, rig.forward, gloveHeight * 0.06), rig.right, sideSign * gloveWidth * 0.04);

  drawOrientedEllipse(
    graphics,
    cuffCenter,
    rig.right,
    rig.forward,
    gloveWidth + 2.6,
    gloveHeight + 2.6,
    COLORS.outline,
    0.96
  );
  drawOrientedEllipse(graphics, cuffCenter, rig.right, rig.forward, gloveWidth, gloveHeight, COLORS.gloves, 1);
  drawOrientedEllipse(
    graphics,
    palmCenter,
    rig.right,
    rig.forward,
    gloveWidth * 0.58,
    gloveHeight * 0.56,
    COLORS.gloveHighlight,
    0.94
  );
  drawOrientedEllipse(
    graphics,
    offset(cuffCenter, rig.forward, -gloveHeight * 0.26),
    rig.right,
    rig.forward,
    gloveWidth * 0.58,
    gloveHeight * 0.42,
    COLORS.gloveCuff,
    0.96
  );
  graphics.lineStyle(Math.max(1, rig.ringRadius * 0.06), 0xf3f9ff, 0.32);
  graphics.lineBetween(
    anchor.x - rig.right.x * gloveWidth * 0.26,
    anchor.y - rig.right.y * gloveWidth * 0.26,
    anchor.x + rig.right.x * gloveWidth * 0.26,
    anchor.y + rig.right.y * gloveWidth * 0.26
  );
}

function drawOrientedEllipse(
  graphics: Phaser.GameObjects.Graphics,
  center: { x: number; y: number },
  right: { x: number; y: number },
  forward: { x: number; y: number },
  width: number,
  height: number,
  color: number,
  alpha: number
) {
  const points = ellipsePoints(center, right, forward, width, height);
  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    graphics.lineTo(points[i].x, points[i].y);
  }
  graphics.lineTo(points[0].x, points[0].y);
  graphics.fillPath();
}

function offset(anchor: { x: number; y: number }, axis: { x: number; y: number }, amount: number) {
  return {
    x: anchor.x + axis.x * amount,
    y: anchor.y + axis.y * amount
  };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5
  };
}

function ellipsePoints(
  center: { x: number; y: number },
  right: { x: number; y: number },
  forward: { x: number; y: number },
  width: number,
  height: number
) {
  const points: Array<{ x: number; y: number }> = [];
  const radiusX = width * 0.5;
  const radiusY = height * 0.5;
  const steps = 24;

  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    points.push({
      x: center.x + right.x * cosT * radiusX + forward.x * sinT * radiusY,
      y: center.y + right.y * cosT * radiusX + forward.y * sinT * radiusY
    });
  }

  return points;
}
