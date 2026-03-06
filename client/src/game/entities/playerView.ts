import Phaser from 'phaser';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';

export class PlayerView {
  readonly id: string;
  readonly team: 'A' | 'B';
  private playerRoot: Phaser.GameObjects.Container;
  private bodyRig: Phaser.GameObjects.Container;
  private bodySprite: Phaser.GameObjects.Image;
  private stickRoot: Phaser.GameObjects.Container;
  private stickGfx: Phaser.GameObjects.Graphics;
  private leadHandSprite: Phaser.GameObjects.Arc;
  private supportHandSprite: Phaser.GameObjects.Arc;
  private g: Phaser.GameObjects.Graphics;
  private handedness: 'L' | 'R' = 'R';
  private debugDrawEnabled = false;
  x = 0;
  y = 0;
  rot = 0;
  aimRot = 0;
  moveRot = 0;
  private stickVisualRot = 0;
  private stickDrawRot = 0;
  private leanPx = 0;
  private leanVel = 0;
  private visualLeanEnabled = true;
  private visualLeanMaxPx = 6;
  private visualLeanTauMs = 120;
  private visualLeanDampingRatio = 1.0;
  private visualLeanMaxAngleDeg = 60;
  private static readonly HAND_R_SOCKET_LOCAL = { x: 10, y: -4 };
  private static readonly HAND_L_SOCKET_LOCAL = { x: 10, y: 4 };
  // Sprite art is authored "forward up", while gameplay angles use 0 rad = right.
  private static readonly SPRITE_FORWARD_OFFSET_RAD = Math.PI / 2;
  // Stick geometry is authored forward along +X, so no extra world-angle correction is needed.
  private static readonly STICK_SPRITE_OFFSET_RAD = 0;
  private static readonly STICK_ROTATION_SPACE = 'WORLD';
  private static readonly LEAD_HAND_LOCAL = { x: 0, y: 0 };
  private static readonly SUPPORT_HAND_Y_OFFSET = 0;
  private static readonly SUPPORT_HAND_DIST_RATIO = 0.55;
  private static readonly HAND_COLOR_LEAD = 0xf4f8ff;
  private static readonly HAND_COLOR_SUPPORT = 0x8ba3bf;

  private static clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
  }

  private static wrapToPi(rad: number) {
    let a = rad;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  private static approachAngle(current: number, target: number, maxStep: number) {
    const d = PlayerView.wrapToPi(target - current);
    if (Math.abs(d) <= maxStep) return target;
    return PlayerView.wrapToPi(current + Math.sign(d) * maxStep);
  }

  private static rotateLocal(localX: number, localY: number, rot: number) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
      x: localX * c - localY * s,
      y: localX * s + localY * c
    };
  }

  constructor(scene: Phaser.Scene, id: string, team: 'A' | 'B') {
    this.id = id;
    this.team = team;
    PlayerView.ensureAvatarTexture(scene);
    this.playerRoot = scene.add.container(0, 0);
    this.bodyRig = scene.add.container(0, 0);
    this.bodySprite = scene.add.image(0, 0, 'playerHuman');
    this.bodySprite.setOrigin(0.5, 0.5);
    this.bodyRig.add(this.bodySprite);
    this.stickRoot = scene.add.container(0, 0);
    this.stickGfx = scene.add.graphics();
    this.leadHandSprite = scene.add.circle(
      PlayerView.LEAD_HAND_LOCAL.x,
      PlayerView.LEAD_HAND_LOCAL.y,
      3,
      PlayerView.HAND_COLOR_LEAD,
      1
    );
    this.supportHandSprite = scene.add.circle(0, 0, 3, PlayerView.HAND_COLOR_SUPPORT, 1);
    // Layering in stick root: stick -> support hand -> lead hand.
    this.stickRoot.add([this.stickGfx, this.supportHandSprite, this.leadHandSprite]);
    this.g = scene.add.graphics();
    this.playerRoot.add([this.bodyRig, this.stickRoot, this.g]);
  }

  private static ensureAvatarTexture(scene: Phaser.Scene) {
    if (scene.textures.exists('playerHuman')) return;
    const g = scene.add.graphics();
    const outline = 0x0f1720;
    const torso = 0xeaf2ff;
    const shoulder = 0xdde7f5;
    const head = 0xffd54a;
    const face = 0x101418;
    const torsoW = 20;
    const torsoH = 24;
    const shoulderW = 30;
    const shoulderH = 10;
    const headR = 5;
    const cx = 32;
    const cy = 32;

    // Shoulders.
    g.fillStyle(outline, 1);
    g.fillRoundedRect(cx - shoulderW / 2 - 1, cy - torsoH / 2 - 2, shoulderW + 2, shoulderH + 2, 5);
    g.fillStyle(shoulder, 1);
    g.fillRoundedRect(cx - shoulderW / 2, cy - torsoH / 2 - 1, shoulderW, shoulderH, 5);

    // Torso.
    g.fillStyle(outline, 1);
    g.fillRoundedRect(cx - torsoW / 2 - 1, cy - torsoH / 2 - 1, torsoW + 2, torsoH + 2, 8);
    g.fillStyle(torso, 1);
    g.fillRoundedRect(cx - torsoW / 2, cy - torsoH / 2, torsoW, torsoH, 8);
    g.fillStyle(0xd3deee, 0.85);
    g.fillRoundedRect(cx - torsoW / 2, cy + 1, torsoW, torsoH / 2, 6);

    // Head + forward face marker.
    g.fillStyle(outline, 1);
    g.fillCircle(cx, cy - torsoH / 2 - headR + 1, headR + 1);
    g.fillStyle(head, 1);
    g.fillCircle(cx, cy - torsoH / 2 - headR + 1, headR);
    g.fillStyle(face, 1);
    g.fillCircle(cx + 2.5, cy - torsoH / 2 - headR + 0.5, 1.5);
    g.fillStyle(0xa9b8cc, 1);
    g.fillRoundedRect(cx - 5, cy - 1, 10, 3, 1);

    g.generateTexture('playerHuman', 64, 64);
    g.destroy();
  }

  setState(x: number, y: number, rot: number, aimRot?: number, moveRot?: number) {
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.aimRot = typeof aimRot === 'number' ? aimRot : rot;
    this.moveRot = typeof moveRot === 'number' ? moveRot : rot;
  }

  setHandedness(handedness: 'L' | 'R') {
    this.handedness = handedness;
  }

  setDebugDrawEnabled(enabled: boolean) {
    this.debugDrawEnabled = enabled;
    this.g.setVisible(enabled);
  }

  setVisualLeanConfig(opts: {
    enabled: boolean;
    maxPx: number;
    tauMs: number;
    dampingRatio: number;
    maxAngleDeg: number;
  }) {
    this.visualLeanEnabled = opts.enabled;
    this.visualLeanMaxPx = Math.max(0, opts.maxPx);
    this.visualLeanTauMs = Math.max(1, opts.tauMs);
    this.visualLeanDampingRatio = Math.max(0.01, opts.dampingRatio);
    this.visualLeanMaxAngleDeg = Math.max(1, opts.maxAngleDeg);
  }

  private getBodyRenderRotation() {
    return this.rot + PlayerView.SPRITE_FORWARD_OFFSET_RAD;
  }

  static getStickSpriteForwardOffsetDeg() {
    return (PlayerView.STICK_SPRITE_OFFSET_RAD * 180) / Math.PI;
  }

  static getStickRotationSpace() {
    return PlayerView.STICK_ROTATION_SPACE;
  }

  static getActiveHandWorldFromPose(x: number, y: number, bodyWorldAngle: number, handedness: 'L' | 'R') {
    const bodyRenderRot = bodyWorldAngle + PlayerView.SPRITE_FORWARD_OFFSET_RAD;
    const socket = handedness === 'L' ? PlayerView.HAND_L_SOCKET_LOCAL : PlayerView.HAND_R_SOCKET_LOCAL;
    const rotated = PlayerView.rotateLocal(socket.x, socket.y, bodyRenderRot);
    return {
      x: x + rotated.x,
      y: y + rotated.y
    };
  }

  static getStickBaseWorldFromPose(
    x: number,
    y: number,
    bodyWorldAngle: number,
    handedness: 'L' | 'R',
    aimRot: number,
    stickOffsetX: number,
    stickOffsetY: number
  ) {
    const hand = PlayerView.getActiveHandWorldFromPose(x, y, bodyWorldAngle, handedness);
    const offset = PlayerView.rotateLocal(stickOffsetX, stickOffsetY, aimRot);
    return {
      x: hand.x + offset.x,
      y: hand.y + offset.y
    };
  }

  private bodyLocalToWorld(localX: number, localY: number) {
    const r = this.getBodyRenderRotation();
    const c = Math.cos(r);
    const s = Math.sin(r);
    return {
      x: this.x + localX * c - localY * s,
      y: this.y + localX * s + localY * c
    };
  }

  private getActiveHandSocketLocal() {
    const socket = this.handedness === 'L' ? PlayerView.HAND_L_SOCKET_LOCAL : PlayerView.HAND_R_SOCKET_LOCAL;
    return { x: socket.x, y: socket.y };
  }

  getActiveHandWorld() {
    const socket = this.getActiveHandSocketLocal();
    return this.bodyLocalToWorld(socket.x, socket.y);
  }

  private getActiveHandLocalInRoot() {
    const socket = this.getActiveHandSocketLocal();
    const r = this.getBodyRenderRotation();
    const c = Math.cos(r);
    const s = Math.sin(r);
    return {
      x: socket.x * c - socket.y * s,
      y: socket.x * s + socket.y * c
    };
  }

  getStickBaseWorld(aimRot: number, stickOffsetX: number, stickOffsetY: number) {
    return PlayerView.getStickBaseWorldFromPose(
      this.x,
      this.y,
      this.rot,
      this.handedness,
      aimRot,
      stickOffsetX,
      stickOffsetY
    );
  }

  draw(dtSec = 1 / 60) {
    const tuning = puckStickTuningStore.get();
    const stickLen = tuning.stickLength;
    const stickOffsetX = tuning.stickOffsetX;
    const stickOffsetY = tuning.stickOffsetY;
    const lag = Math.max(0, Math.min(1, tuning.stickVisualLag));
    const lagMaxDeg = tuning.stickVisualLagMaxDeg;
    const lagMaxRad = (lagMaxDeg * Math.PI) / 180;
    const safeDt = PlayerView.clamp(dtSec, 1 / 240, 1 / 20);
    let delta = this.aimRot - this.stickVisualRot;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const visualDeadzone = (0.18 * Math.PI) / 180;
    if (Math.abs(delta) <= visualDeadzone) {
      this.stickVisualRot = this.aimRot;
    } else {
      const clampedDelta = Math.max(-lagMaxRad, Math.min(lagMaxRad, delta));
      const deltaNorm = PlayerView.clamp(Math.abs(clampedDelta) / Math.max(lagMaxRad, 0.0001), 0, 1);
      const adaptiveLag = lag * (1 - 0.45 * deltaNorm);
      const visualTauMs = PlayerView.clamp(28 + adaptiveLag * 120, 20, 180);
      const alpha = 1 - Math.exp(-safeDt / (visualTauMs / 1000));
      const targetVisualRot = this.stickVisualRot + clampedDelta * alpha;
      const maxVisualSpeed = ((540 + 520 * deltaNorm) * Math.PI) / 180;
      this.stickVisualRot = PlayerView.approachAngle(this.stickVisualRot, targetVisualRot, maxVisualSpeed * safeDt);
    }

    const stickWorldRot = this.stickVisualRot;
    const stickDrawRot = stickWorldRot + PlayerView.STICK_SPRITE_OFFSET_RAD;
    this.stickDrawRot = stickDrawRot;
    const edgeAngle = PlayerView.wrapToPi(this.rot - this.moveRot);
    const leanMaxAngleRad = Math.max(0.001, (this.visualLeanMaxAngleDeg * Math.PI) / 180);
    const edgeNorm = PlayerView.clamp(edgeAngle / leanMaxAngleRad, -1, 1);
    const targetLeanPx = this.visualLeanEnabled ? (edgeNorm * this.visualLeanMaxPx) : 0;
    const omega = 2 / Math.max(0.001, this.visualLeanTauMs / 1000);
    const springK = omega * omega;
    const springC = 2 * this.visualLeanDampingRatio * omega;
    const leanErr = targetLeanPx - this.leanPx;
    this.leanVel += (leanErr * springK - this.leanVel * springC) * safeDt;
    this.leanPx += this.leanVel * safeDt;

    const gripLocalBase = this.getActiveHandLocalInRoot();
    const supportDist = Math.max(6, stickLen * PlayerView.SUPPORT_HAND_DIST_RATIO);

    // Update order: player root position -> body rotation -> stick rotation.
    this.playerRoot.setPosition(this.x, this.y);
    const rightX = Math.cos(this.rot + Math.PI / 2);
    const rightY = Math.sin(this.rot + Math.PI / 2);
    const bodyLeanX = rightX * this.leanPx;
    const bodyLeanY = rightY * this.leanPx;
    this.bodyRig.setPosition(bodyLeanX, bodyLeanY);
    this.bodyRig.rotation = this.getBodyRenderRotation();
    const gripLocal = {
      x: gripLocalBase.x + bodyLeanX,
      y: gripLocalBase.y + bodyLeanY
    };
    const stickBaseLocalOffset = PlayerView.rotateLocal(stickOffsetX, stickOffsetY, stickWorldRot);
    this.stickRoot.setPosition(gripLocal.x + stickBaseLocalOffset.x, gripLocal.y + stickBaseLocalOffset.y);
    this.stickRoot.rotation = stickDrawRot;
    this.leadHandSprite.setPosition(PlayerView.LEAD_HAND_LOCAL.x - stickOffsetX, PlayerView.LEAD_HAND_LOCAL.y - stickOffsetY);
    this.supportHandSprite.setPosition(supportDist - stickOffsetX, PlayerView.SUPPORT_HAND_Y_OFFSET - stickOffsetY);

    const shaftLen = Math.max(4, stickLen);
    const shaftThickness = 4;
    const bladeLen = 12;
    const bladeThickness = 6;
    this.stickGfx.clear();
    // Shaft: grip starts exactly at local x=0 (container pivot).
    this.stickGfx.fillStyle(0x111111, 0.55);
    this.stickGfx.fillRoundedRect(0, -(shaftThickness + 2) * 0.5, shaftLen, shaftThickness + 2, 2);
    this.stickGfx.fillStyle(0xf5b000, 1);
    this.stickGfx.fillRoundedRect(0, -shaftThickness * 0.5, shaftLen, shaftThickness, 2);
    // Grip knob at pivot.
    this.stickGfx.fillStyle(0x111111, 1);
    this.stickGfx.fillCircle(0, 0, 3);
    // Blade near stick tip.
    this.stickGfx.fillStyle(0xf5b000, 1);
    this.stickGfx.fillRoundedRect(shaftLen - 2, 0, bladeLen, bladeThickness, 2);
    if (this.debugDrawEnabled) {
      // Tip debug in local stick space.
      this.stickGfx.fillStyle(0x000000, 0.5);
      this.stickGfx.fillCircle(shaftLen, 0, 6);
      this.stickGfx.fillStyle(0xffcc00, 1);
      this.stickGfx.fillCircle(shaftLen, 0, 4.5);
    }

    if (!this.debugDrawEnabled) {
      this.g.clear();
      return;
    }

    this.g.clear();
    // Debug: socket and rig pivot should overlap.
    this.g.fillStyle(0x00ff00, 1);
    this.g.fillCircle(gripLocal.x, gripLocal.y, 2);
    this.g.fillStyle(0xffff00, 1);
    this.g.fillCircle(this.stickRoot.x, this.stickRoot.y, 2);
    this.g.lineStyle(1, 0x66ffcc, 0.6);
    this.g.lineBetween(gripLocal.x, gripLocal.y, this.stickRoot.x, this.stickRoot.y);
    // Rotation clarity lines.
    const bodyLen = 26;
    const stickLenDbg = 30;
    const bodyRot = this.getBodyRenderRotation();
    this.g.lineStyle(1.5, 0xffffff, 0.8);
    this.g.lineBetween(0, 0, Math.cos(bodyRot) * bodyLen, Math.sin(bodyRot) * bodyLen);
    this.g.lineStyle(1.5, 0xffd54a, 0.9);
    this.g.lineBetween(
      this.stickRoot.x,
      this.stickRoot.y,
      this.stickRoot.x + Math.cos(stickDrawRot) * stickLenDbg,
      this.stickRoot.y + Math.sin(stickDrawRot) * stickLenDbg
    );
  }

  getStickRotation(): number {
    return this.stickDrawRot;
  }

  getStickWorldAngle(): number {
    return this.stickVisualRot;
  }

  getAimRotation(): number {
    return this.aimRot;
  }

  destroy() {
    this.playerRoot.destroy();
  }
}
