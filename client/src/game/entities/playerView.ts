import Phaser from 'phaser';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';

export class PlayerView {
  readonly id: string;
  readonly team: 'A' | 'B';
  private g: Phaser.GameObjects.Graphics;
  x = 0;
  y = 0;
  rot = 0;
  aimRot = 0;
  private stickVisualRot = 0;

  constructor(scene: Phaser.Scene, id: string, team: 'A' | 'B') {
    this.id = id;
    this.team = team;
    this.g = scene.add.graphics();
  }

  setState(x: number, y: number, rot: number, aimRot?: number) {
    this.x = x;
    this.y = y;
    this.rot = rot;
    this.aimRot = typeof aimRot === 'number' ? aimRot : rot;
  }

  draw() {
    const tuning = puckStickTuningStore.get();
    const c = this.team === 'A' ? 0x6fdcff : 0xff8f7b;
    const stickLen = tuning.stickLength;
    const stickOffsetX = tuning.stickOffsetX;
    const stickOffsetY = tuning.stickOffsetY;
    const lag = Math.max(0, Math.min(1, tuning.stickVisualLag));
    const lagMaxDeg = tuning.stickVisualLagMaxDeg;
    const lagMaxRad = (lagMaxDeg * Math.PI) / 180;
    let delta = this.aimRot - this.stickVisualRot;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    delta = Math.max(-lagMaxRad, Math.min(lagMaxRad, delta));
    this.stickVisualRot += delta * (1 - lag);

    const cos = Math.cos(this.stickVisualRot);
    const sin = Math.sin(this.stickVisualRot);
    const stickBaseX = this.x + stickOffsetX * cos - stickOffsetY * sin;
    const stickBaseY = this.y + stickOffsetX * sin + stickOffsetY * cos;
    const stickTipX = stickBaseX + cos * stickLen;
    const stickTipY = stickBaseY + sin * stickLen;

    this.g.clear();
    this.g.fillStyle(c, 1);
    this.g.fillCircle(this.x, this.y, 18);
    this.g.lineStyle(3, 0xffffff, 0.35);
    this.g.lineBetween(this.x, this.y, this.x + Math.cos(this.rot) * 18, this.y + Math.sin(this.rot) * 18);
    this.g.lineStyle(5, 0x1e242b, 0.95);
    this.g.lineBetween(stickBaseX, stickBaseY, stickTipX, stickTipY);
    this.g.fillStyle(0x2d343f, 1);
    this.g.fillCircle(stickTipX, stickTipY, 5);
  }

  destroy() { this.g.destroy(); }
}
