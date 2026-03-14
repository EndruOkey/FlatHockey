import Phaser from 'phaser';
import { DEFAULTS, getTuning } from '../tuning/gameplayConfig';
import { computeSemiPhysicalStickPose, type SemiPhysicalStickPose, type StickState } from '@flathockey/shared';
import {
  createPlayerCosmeticSlots,
  derivePlayerBodyRig,
  type Handedness,
  type HandSocketSide,
  type PlayerBodyRig,
  type PlayerCosmeticSlots
} from './playerBodyRig';
import {
  clearPlayerBodyLayers,
  renderPlayerBody,
  type PlayerBodyRenderLayers,
  type PlayerBodyRenderOptions
} from '../render/playerBodyRenderer';
import { renderStick } from '../render/stickRenderer';
import { lerpAngle, wrapToPi } from '../util/math';

const DEBUG_COLORS = {
  ring: 0xff6bd6,
  body: 0x4fd6ff,
  facing: 0xffffff,
  chest: 0xffbc52,
  head: 0x82f5ff,
  lowerBody: 0x8fa8ff,
  shoulder: 0x7dfc96,
  hand: 0xfff07a,
  nameTag: 0xd89cff
} as const;

type PlayerViewOptions = {
  handedness?: Handedness;
  displayName?: string;
};

export class PlayerView {
  private root: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Graphics;
  private hitboxRing: Phaser.GameObjects.Graphics;
  private lowerBody: Phaser.GameObjects.Graphics;
  private torso: Phaser.GameObjects.Graphics;
  private shoulders: Phaser.GameObjects.Graphics;
  private stick: Phaser.GameObjects.Graphics;
  private head: Phaser.GameObjects.Graphics;
  private nameTag: Phaser.GameObjects.Text;
  private debugGfx: Phaser.GameObjects.Graphics;
  private bodyLayers: PlayerBodyRenderLayers;
  private debugDrawEnabled = false;
  private displayRot = 0;
  private hasDisplayRot = false;
  private bodyRig: PlayerBodyRig | null = null;
  private stickPose: SemiPhysicalStickPose | null = null;
  private handedness: Handedness;
  private displayName: string;
  private readonly cosmeticSlots: PlayerCosmeticSlots;
  private stickState: StickState = 'neutral';
  private stickTimer = 0;
  private shotCharge = 0;
  private hasPuck = false;
  private isLocalPlayer = false;
  private renderScale = 1;

  x = 0;
  y = 0;
  worldX = 0;
  worldY = 0;
  rot = 0;
  aimRot = 0;

  constructor(scene: Phaser.Scene, options: PlayerViewOptions = {}) {
    this.handedness = options.handedness ?? 'left';
    this.displayName = options.displayName ?? '';
    this.cosmeticSlots = createPlayerCosmeticSlots();

    this.root = scene.add.container(0, 0);
    this.shadow = scene.add.graphics();
    this.hitboxRing = scene.add.graphics();
    this.lowerBody = scene.add.graphics();
    this.torso = scene.add.graphics();
    this.shoulders = scene.add.graphics();
    this.stick = scene.add.graphics();
    this.head = scene.add.graphics();
    this.nameTag = scene.add
      .text(0, 0, this.displayName, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#dcefff',
        stroke: '#091218',
        strokeThickness: 2
      })
      .setOrigin(0.5, 1)
      .setVisible(this.displayName.length > 0);
    this.debugGfx = scene.add.graphics();
    this.bodyLayers = {
      shadow: this.shadow,
      ring: this.hitboxRing,
      lowerBody: this.lowerBody,
      torso: this.torso,
      shoulders: this.shoulders,
      head: this.head,
      nameTag: this.nameTag
    };
    this.root.add([
      this.shadow,
      this.hitboxRing,
      this.lowerBody,
      this.torso,
      this.shoulders,
      this.stick,
      this.head,
      this.nameTag,
      this.debugGfx
    ]);
  }

  setState(x: number, y: number, worldX: number, worldY: number, rot: number, aimRot?: number) {
    this.x = x;
    this.y = y;
    this.worldX = worldX;
    this.worldY = worldY;
    this.rot = rot;
    this.aimRot = typeof aimRot === 'number' ? aimRot : rot;
    this.bodyRig = null;
    this.stickPose = null;
  }

  setDebugDrawEnabled(enabled: boolean) {
    this.debugDrawEnabled = enabled;
  }

  setRenderScale(renderScale: number) {
    const nextScale = Math.max(0.75, renderScale);
    if (Math.abs(this.renderScale - nextScale) < 0.0001) return;
    this.renderScale = nextScale;
    this.bodyRig = null;
    this.stickPose = null;
  }

  setStickVisualState(state: StickState | undefined, shotCharge = 0, stickTimer = 0, hasPuck = false) {
    this.stickState = state ?? (hasPuck ? 'control' : 'neutral');
    this.shotCharge = Math.max(0, shotCharge);
    this.stickTimer = Math.max(0, stickTimer);
    this.hasPuck = hasPuck;
    this.stickPose = null;
  }

  setPresentationState(isLocalPlayer: boolean, hasPuck: boolean) {
    this.isLocalPlayer = isLocalPlayer;
    this.hasPuck = hasPuck;
  }

  setHandedness(handedness: Handedness) {
    if (this.handedness === handedness) return;
    this.handedness = handedness;
    this.bodyRig = null;
  }

  getHandedness() {
    return this.handedness;
  }

  setDisplayName(displayName: string) {
    this.displayName = displayName;
    this.nameTag.setText(displayName);
    this.nameTag.setVisible(displayName.length > 0);
  }

  getCosmeticSlots() {
    return this.cosmeticSlots;
  }

  getBodyRig() {
    return this.resolveBodyRig();
  }

  getCarryAnchorWorld() {
    const pose = this.resolveStickPose();
    if (pose) {
      // pose is computed in world space — bladeCenterX/Y are world coords
      return {
        x: pose.bladeCenterX,
        y: pose.bladeCenterY
      };
    }
    // fallback: player world center (bodyCenter offset is zero in body space)
    return {
      x: this.worldX,
      y: this.worldY
    };
  }

  getHandSocketWorld(side: HandSocketSide) {
    const rig = this.resolveBodyRig();
    const socket = side === 'left' ? rig.leftHandSocket : rig.rightHandSocket;
    return {
      x: this.x + socket.x,
      y: this.y + socket.y
    };
  }

  getStickPose() {
    return this.resolveStickPose();
  }

  getStickBladeWorld() {
    const pose = this.resolveStickPose();
    if (!pose) return this.getCarryAnchorWorld();
    return {
      x: pose.bladeTipX,
      y: pose.bladeTipY
    };
  }

  getStickReachWorld() {
    const pose = this.resolveStickPose();
    if (!pose) return this.getCarryAnchorWorld();
    return {
      x: pose.assistX,
      y: pose.assistY
    };
  }

  getStickBaseWorld(_aimRot?: number, _stickOffsetX?: number, _stickOffsetY?: number) {
    const pose = this.resolveStickPose();
    if (!pose) return this.getCarryAnchorWorld();
    return {
      x: pose.gripX,
      y: pose.gripY
    };
  }

  draw(dtSec = 1 / 60) {
    this.root.setPosition(this.x, this.y);
    if (!this.hasDisplayRot) {
      this.displayRot = this.rot;
      this.hasDisplayRot = true;
    } else {
      const angularDelta = Math.abs(wrapToPi(this.rot - this.displayRot));
      const tauSec = angularDelta > 0.5 ? 0.014 : 0.028;
      const alpha = 1 - Math.exp(-Math.max(0, dtSec) / Math.max(0.001, tauSec));
      this.displayRot = lerpAngle(this.displayRot, this.rot, alpha);
    }

    this.bodyRig = this.createBodyRig(this.hasDisplayRot ? this.displayRot : this.rot);
    this.stickPose = this.createStickPose(this.bodyRig, this.hasDisplayRot ? this.displayRot : this.rot);
    clearPlayerBodyLayers(this.bodyLayers);
    const renderOptions: PlayerBodyRenderOptions = {
      isLocalPlayer: this.isLocalPlayer,
      hasPuck: this.hasPuck
    };
    renderPlayerBody(this.bodyLayers, this.bodyRig, this.displayName, renderOptions);
    this.stick.clear();
    if (this.stickPose) {
      renderStick(this.stick, this.stickPose, this.bodyRig, this.worldX, this.worldY, this.renderScale, {
        hasPuck: this.hasPuck
      });
    }

    if (!this.debugDrawEnabled) {
      this.debugGfx.clear();
      return;
    }

    this.renderDebug(this.bodyRig);
  }

  destroy() {
    this.root.destroy();
  }

  private resolveBodyRig() {
    if (!this.bodyRig) {
      const facingAngle = this.hasDisplayRot ? this.displayRot : this.rot;
      this.bodyRig = this.createBodyRig(facingAngle);
    }
    return this.bodyRig;
  }

  private resolveStickPose() {
    if (!this.stickPose) {
      const bodyRig = this.resolveBodyRig();
      const facingAngle = this.hasDisplayRot ? this.displayRot : this.rot;
      this.stickPose = this.createStickPose(bodyRig, facingAngle);
    }
    return this.stickPose;
  }

  private createBodyRig(facingAngle: number) {
    const tuning = getTuning();
    const ringRadius = Math.max(12, (tuning.playerRadius ?? DEFAULTS.playerRadius ?? 18) * this.renderScale);
    return derivePlayerBodyRig({
      facingAngle,
      handedness: this.handedness,
      ringRadius
    });
  }

  private createStickPose(bodyRig: PlayerBodyRig, facingAngle: number) {
    const resolvedState =
      !this.hasPuck && (this.stickState === 'control' || this.stickState === 'turning' || this.stickState === 'charge')
        ? 'neutral'
        : this.stickState;

    // Compute pose in world space so all distances are world units.
    // renderStick converts to container-local via (worldPoint - worldPlayer) * renderScale.
    const worldRadius = bodyRig.ringRadius / Math.max(0.001, this.renderScale);
    return computeSemiPhysicalStickPose({
      playerX: this.worldX,
      playerY: this.worldY,
      bodyAngle: facingAngle,
      aimAngle: this.aimRot,
      playerRadius: worldRadius,
      state: resolvedState,
      shotCharge: this.shotCharge,
      stateTimerSec: this.stickTimer
    });
  }

  private renderDebug(rig: PlayerBodyRig) {
    this.debugGfx.clear();
    this.drawDebugMasses(rig);
    this.drawDebugCircle(rig.ringCenter, rig.ringRadius, DEBUG_COLORS.ring, 0.72, 1.15);
    this.drawDebugLine(rig.ringCenter, this.offsetAnchor(rig.ringCenter, rig.right, rig.ringRadius), DEBUG_COLORS.ring, 0.66, 1);
    this.drawDebugOrientedEllipse(rig.bodyCenter, rig.right, rig.forward, rig.bodyWidth, rig.bodyHeight, DEBUG_COLORS.body, 0.68, 1.15);
    this.drawDebugLine(rig.leftShoulderAnchor, rig.rightShoulderAnchor, DEBUG_COLORS.shoulder, 0.82, 1.5);
    this.drawDebugLine(rig.chestAnchor, rig.headAnchor, DEBUG_COLORS.chest, 0.82, 1.4);
    this.drawDebugLine(rig.chestAnchor, rig.leftHandSocket, DEBUG_COLORS.hand, 0.74, 1.2);
    this.drawDebugLine(rig.chestAnchor, rig.rightHandSocket, DEBUG_COLORS.hand, 0.74, 1.2);
    this.drawDebugArrow(rig.bodyCenter, rig.forward, rig.ringRadius + 13, DEBUG_COLORS.facing, 0.88, 1.6);

    this.drawDebugCross(rig.ringCenter, DEBUG_COLORS.ring, 4);
    this.drawDebugAnchor(rig.bodyCenter, DEBUG_COLORS.body, 2.8);
    this.drawDebugAnchor(rig.chestAnchor, DEBUG_COLORS.chest, 2.8);
    this.drawDebugAnchor(rig.headAnchor, DEBUG_COLORS.head, 2.7);
    this.drawDebugAnchor(rig.lowerBodyAnchor, DEBUG_COLORS.lowerBody, 2.6);
    this.drawDebugAnchor(rig.leftShoulderAnchor, DEBUG_COLORS.shoulder, 2.5);
    this.drawDebugAnchor(rig.rightShoulderAnchor, DEBUG_COLORS.shoulder, 2.5);
    this.drawDebugAnchor(rig.leftHandSocket, DEBUG_COLORS.hand, 2.5);
    this.drawDebugAnchor(rig.rightHandSocket, DEBUG_COLORS.hand, 2.5);
    this.drawDebugAnchor(rig.nameTagAnchor, DEBUG_COLORS.nameTag, 2.3);
  }

  private drawDebugMasses(rig: PlayerBodyRig) {
    const shoulderCenter = {
      x: (rig.leftShoulderAnchor.x + rig.rightShoulderAnchor.x) * 0.5,
      y: (rig.leftShoulderAnchor.y + rig.rightShoulderAnchor.y) * 0.5
    };

    this.drawDebugFilledOrientedEllipse(
      rig.lowerBodyAnchor,
      rig.right,
      rig.forward,
      rig.lowerBodyWidth,
      rig.lowerBodyHeight,
      DEBUG_COLORS.lowerBody,
      0.16,
      0.44
    );
    this.drawDebugFilledOrientedEllipse(
      rig.chestAnchor,
      rig.right,
      rig.forward,
      rig.torsoWidth,
      rig.torsoHeight,
      DEBUG_COLORS.chest,
      0.14,
      0.48
    );
    this.drawDebugFilledOrientedEllipse(
      shoulderCenter,
      rig.right,
      rig.forward,
      rig.shoulderWidth,
      rig.shoulderHeight,
      DEBUG_COLORS.shoulder,
      0.18,
      0.54
    );
    this.drawDebugFilledCircle(rig.headAnchor, rig.headRadius, DEBUG_COLORS.head, 0.22, 0.58);
  }

  private drawDebugAnchor(anchor: { x: number; y: number }, color: number, radius: number) {
    this.debugGfx.lineStyle(1, 0x071017, 0.92);
    this.debugGfx.fillStyle(color, 0.96);
    this.debugGfx.fillCircle(anchor.x, anchor.y, radius);
    this.debugGfx.strokeCircle(anchor.x, anchor.y, radius + 0.7);
  }

  private drawDebugCross(anchor: { x: number; y: number }, color: number, halfSize: number) {
    this.debugGfx.lineStyle(1.4, color, 0.92);
    this.debugGfx.lineBetween(anchor.x - halfSize, anchor.y, anchor.x + halfSize, anchor.y);
    this.debugGfx.lineBetween(anchor.x, anchor.y - halfSize, anchor.x, anchor.y + halfSize);
  }

  private drawDebugCircle(anchor: { x: number; y: number }, radius: number, color: number, alpha: number, lineWidth: number) {
    this.debugGfx.lineStyle(lineWidth, color, alpha);
    this.debugGfx.strokeCircle(anchor.x, anchor.y, radius);
  }

  private drawDebugFilledCircle(
    anchor: { x: number; y: number },
    radius: number,
    color: number,
    fillAlpha: number,
    strokeAlpha: number
  ) {
    this.debugGfx.fillStyle(color, fillAlpha);
    this.debugGfx.fillCircle(anchor.x, anchor.y, radius);
    this.debugGfx.lineStyle(1.1, color, strokeAlpha);
    this.debugGfx.strokeCircle(anchor.x, anchor.y, radius);
  }

  private drawDebugLine(
    start: { x: number; y: number },
    end: { x: number; y: number },
    color: number,
    alpha: number,
    lineWidth: number
  ) {
    this.debugGfx.lineStyle(lineWidth, color, alpha);
    this.debugGfx.lineBetween(start.x, start.y, end.x, end.y);
  }

  private drawDebugArrow(
    origin: { x: number; y: number },
    direction: { x: number; y: number },
    length: number,
    color: number,
    alpha: number,
    lineWidth: number
  ) {
    const end = this.offsetAnchor(origin, direction, length);
    const normal = { x: -direction.y, y: direction.x };
    const headLength = Math.max(4, length * 0.18);
    const headWidth = Math.max(3, headLength * 0.55);
    const leftHead = {
      x: end.x - direction.x * headLength + normal.x * headWidth,
      y: end.y - direction.y * headLength + normal.y * headWidth
    };
    const rightHead = {
      x: end.x - direction.x * headLength - normal.x * headWidth,
      y: end.y - direction.y * headLength - normal.y * headWidth
    };

    this.drawDebugLine(origin, end, color, alpha, lineWidth);
    this.drawDebugLine(end, leftHead, color, alpha, lineWidth);
    this.drawDebugLine(end, rightHead, color, alpha, lineWidth);
  }

  private drawDebugOrientedEllipse(
    center: { x: number; y: number },
    right: { x: number; y: number },
    forward: { x: number; y: number },
    width: number,
    height: number,
    color: number,
    alpha: number,
    lineWidth: number
  ) {
    const rx = width * 0.5;
    const ry = height * 0.5;
    const segments = 24;

    this.debugGfx.lineStyle(lineWidth, color, alpha);
    this.debugGfx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const x = center.x + right.x * cosT * rx + forward.x * sinT * ry;
      const y = center.y + right.y * cosT * rx + forward.y * sinT * ry;
      if (i === 0) {
        this.debugGfx.moveTo(x, y);
      } else {
        this.debugGfx.lineTo(x, y);
      }
    }
    this.debugGfx.strokePath();
  }

  private drawDebugFilledOrientedEllipse(
    center: { x: number; y: number },
    right: { x: number; y: number },
    forward: { x: number; y: number },
    width: number,
    height: number,
    color: number,
    fillAlpha: number,
    strokeAlpha: number
  ) {
    const rx = width * 0.5;
    const ry = height * 0.5;
    const segments = 24;

    this.debugGfx.fillStyle(color, fillAlpha);
    this.debugGfx.beginPath();
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const x = center.x + right.x * cosT * rx + forward.x * sinT * ry;
      const y = center.y + right.y * cosT * rx + forward.y * sinT * ry;
      if (i === 0) {
        this.debugGfx.moveTo(x, y);
      } else {
        this.debugGfx.lineTo(x, y);
      }
    }
    this.debugGfx.fillPath();
    this.drawDebugOrientedEllipse(center, right, forward, width, height, color, strokeAlpha, 1.05);
  }

  private offsetAnchor(anchor: { x: number; y: number }, axis: { x: number; y: number }, amount: number) {
    return {
      x: anchor.x + axis.x * amount,
      y: anchor.y + axis.y * amount
    };
  }
}
