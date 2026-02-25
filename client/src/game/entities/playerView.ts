import Phaser from 'phaser';

export class PlayerView {
  readonly id: string;
  readonly team: 'A' | 'B';
  private g: Phaser.GameObjects.Graphics;
  x = 0;
  y = 0;
  rot = 0;

  constructor(scene: Phaser.Scene, id: string, team: 'A' | 'B') {
    this.id = id;
    this.team = team;
    this.g = scene.add.graphics();
  }

  setState(x: number, y: number, rot: number) {
    this.x = x;
    this.y = y;
    this.rot = rot;
  }

  draw() {
    const c = this.team === 'A' ? 0x6fdcff : 0xff8f7b;
    this.g.clear();
    this.g.fillStyle(c, 1);
    this.g.fillCircle(this.x, this.y, 18);
    this.g.lineStyle(3, 0xffffff, 0.35);
    this.g.lineBetween(this.x, this.y, this.x + Math.cos(this.rot) * 18, this.y + Math.sin(this.rot) * 18);
  }

  destroy() { this.g.destroy(); }
}
