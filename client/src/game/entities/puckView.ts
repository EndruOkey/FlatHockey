import Phaser from 'phaser';

export class PuckView {
  private g: Phaser.GameObjects.Graphics;
  x = 0;
  y = 0;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics();
  }

  setState(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  draw() {
    this.g.clear();
    this.g.fillStyle(0x0b0b0b, 1);
    this.g.fillCircle(this.x, this.y, 7);
    this.g.lineStyle(2, 0xffffff, 0.2);
    this.g.strokeCircle(this.x, this.y, 9);
  }

  destroy() { this.g.destroy(); }
}
