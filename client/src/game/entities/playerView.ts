import Phaser from 'phaser';
import { renderStick } from '../render/stickRenderer';
import { computeStickPose, resolveStickMode, type StickMode, type StickPose } from '../stick/stickRig';
import { lerpAngle, wrapToPi } from '../util/math';

export class PlayerView {
  private root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private stickBehind: Phaser.GameObjects.Graphics;
  private stickFront: Phaser.GameObjects.Graphics;
  private debugGfx: Phaser.GameObjects.Graphics;
  private debugDrawEnabled = false;
  private displayRot = 0;
  private hasDisplayRot = false;
  private stickPose: StickPose | null = null;
  private stickMode: StickMode = 'idle';
  private stickModeOverride: StickMode | null = null;

  x = 0;
  y = 0;
  rot = 0;
  aimRot = 0;

  private static readonly SPRITE_FORWARD_OFFSET_RAD = Math.PI / 2;

  constructor(scene: Phaser.Scene) {
    PlayerView.ensureAvatarTexture(scene);

    this.root = scene.add.container(0, 0);
    this.stickBehind = scene.add.graphics();
    this.body = scene.add.image(0, 0, 'playerHuman');
    this.stickFront = scene.add.graphics();
    this.body.setOrigin(0.5, 0.5);
    this.debugGfx = scene.add.graphics();
    this.root.add([this.stickBehind, this.body, this.stickFront, this.debugGfx]);
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

    g.fillStyle(outline, 1);
    g.fillRoundedRect(cx - shoulderW / 2 - 1, cy - torsoH / 2 - 2, shoulderW + 2, shoulderH + 2, 5);
    g.fillStyle(shoulder, 1);
    g.fillRoundedRect(cx - shoulderW / 2, cy - torsoH / 2 - 1, shoulderW, shoulderH, 5);

    g.fillStyle(outline, 1);
    g.fillRoundedRect(cx - torsoW / 2 - 1, cy - torsoH / 2 - 1, torsoW + 2, torsoH + 2, 8);
    g.fillStyle(torso, 1);
    g.fillRoundedRect(cx - torsoW / 2, cy - torsoH / 2, torsoW, torsoH, 8);
    g.fillStyle(0xd3deee, 0.85);
    g.fillRoundedRect(cx - torsoW / 2, cy + 1, torsoW, torsoH / 2, 6);

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

  setState(
    x: number,
    y: number,
    rot: number,
    aimRot?: number
  ) {
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.aimRot = typeof aimRot === 'number' ? aimRot : rot;
    this.stickPose = null;
  }

  setDebugDrawEnabled(enabled: boolean) {
    this.debugDrawEnabled = enabled;
  }

  setStickMode(mode: StickMode | null) {
    this.stickModeOverride = mode;
    this.stickPose = null;
  }

  getStickMode() {
    return this.stickMode;
  }

  getStickPose(): StickPose | null {
    if (!this.stickPose) {
      this.stickPose = this.resolveStickPose();
    }
    return this.stickPose;
  }

  getStickBladeWorld() {
    const pose = this.getStickPose();
    if (!pose) return null;
    return { x: pose.bladeTipX, y: pose.bladeTipY };
  }

  getStickReachWorld() {
    const pose = this.getStickPose();
    if (!pose) return null;
    return { x: pose.reachCenterX, y: pose.reachCenterY };
  }

  getStickBaseWorld(_aimRot?: number, _stickOffsetX?: number, _stickOffsetY?: number) {
    return this.getStickBladeWorld();
  }

  draw(_dtSec = 1 / 60) {
    this.root.setPosition(this.x, this.y);
    if (!this.hasDisplayRot) {
      this.displayRot = this.rot;
      this.hasDisplayRot = true;
    } else {
      const angularDelta = Math.abs(wrapToPi(this.rot - this.displayRot));
      const tauSec = angularDelta > 0.5 ? 0.014 : 0.028;
      const alpha = 1 - Math.exp(-Math.max(0, _dtSec) / Math.max(0.001, tauSec));
      this.displayRot = lerpAngle(this.displayRot, this.rot, alpha);
    }

    this.body.rotation = this.displayRot + PlayerView.SPRITE_FORWARD_OFFSET_RAD;
    this.stickPose = this.resolveStickPose();
    this.stickBehind.clear();
    this.stickFront.clear();
    renderStick(
      this.stickPose.behindBody ? this.stickBehind : this.stickFront,
      this.stickPose,
      this.x,
      this.y
    );

    if (!this.debugDrawEnabled) {
      this.debugGfx.clear();
      return;
    }

    this.debugGfx.clear();
    this.debugGfx.lineStyle(1.5, 0xffffff, 0.8);
    this.debugGfx.lineBetween(0, 0, Math.cos(this.body.rotation) * 26, Math.sin(this.body.rotation) * 26);
  }

  destroy() {
    this.root.destroy();
  }

  private resolveStickPose(): StickPose {
    const bodyFacingAngle = this.hasDisplayRot ? this.displayRot : this.rot;
    this.stickMode = this.stickModeOverride ?? resolveStickMode(bodyFacingAngle, this.aimRot);
    return computeStickPose({
      playerX: this.x,
      playerY: this.y,
      bodyFacingAngle,
      desiredAimAngle: this.aimRot,
      mode: this.stickMode
    });
  }
}
