import Phaser from 'phaser';

export class PlayerView {
  readonly id: string;
  readonly team: 'A' | 'B';
  private root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private debugGfx: Phaser.GameObjects.Graphics;
  private debugDrawEnabled = false;

  x = 0;
  y = 0;
  rot = 0;
  aimRot = 0;
  speed = 0;

  private static readonly SPRITE_FORWARD_OFFSET_RAD = Math.PI / 2;

  constructor(scene: Phaser.Scene, id: string, team: 'A' | 'B') {
    this.id = id;
    this.team = team;
    PlayerView.ensureAvatarTexture(scene);

    this.root = scene.add.container(0, 0);
    this.body = scene.add.image(0, 0, 'playerHuman');
    this.body.setOrigin(0.5, 0.5);
    this.debugGfx = scene.add.graphics();
    this.root.add([this.body, this.debugGfx]);
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
    aimRot?: number,
    speed?: number
  ) {
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.aimRot = typeof aimRot === 'number' ? aimRot : rot;
    this.speed = typeof speed === 'number' && Number.isFinite(speed) ? Math.max(0, speed) : 0;
  }

  setDebugDrawEnabled(enabled: boolean) {
    this.debugDrawEnabled = enabled;
  }

  getStickBaseWorld(_aimRot: number, _stickOffsetX: number, _stickOffsetY: number) {
    // Stick was removed from visuals; gameplay anchor is player root.
    return { x: this.x, y: this.y };
  }

  draw(_dtSec = 1 / 60) {
    this.root.setPosition(this.x, this.y);
    this.body.rotation = this.rot + PlayerView.SPRITE_FORWARD_OFFSET_RAD;

    if (!this.debugDrawEnabled) {
      this.debugGfx.clear();
      return;
    }

    this.debugGfx.clear();
    this.debugGfx.lineStyle(1.5, 0xffffff, 0.8);
    this.debugGfx.lineBetween(0, 0, Math.cos(this.body.rotation) * 26, Math.sin(this.body.rotation) * 26);
  }

  getStickRotation() {
    return this.aimRot;
  }

  getStickWorldAngle() {
    return this.aimRot;
  }

  getDebugWorldAnchors() {
    return {
      rootX: this.root.x,
      rootY: this.root.y,
      bodyRigWorldX: this.root.x,
      bodyRigWorldY: this.root.y,
      stickWorldX: this.root.x,
      stickWorldY: this.root.y
    };
  }

  getAimRotation() {
    return this.aimRot;
  }

  destroy() {
    this.root.destroy();
  }
}
