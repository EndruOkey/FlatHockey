import Phaser from 'phaser';

export class Nameplates {
  private labels = new Map<string, Phaser.GameObjects.Text>();

  ensure(scene: Phaser.Scene, id: string) {
    if (this.labels.has(id)) return this.labels.get(id)!;
    const t = scene.add.text(0, 0, id, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#d7f4ff'
    });
    t.setOrigin(0.5, 1.2);
    this.labels.set(id, t);
    return t;
  }

  update(id: string, x: number, y: number) {
    const l = this.labels.get(id);
    if (!l) return;
    l.setPosition(x, y - 24);
  }

  remove(id: string) {
    const l = this.labels.get(id);
    if (!l) return;
    l.destroy();
    this.labels.delete(id);
  }
}
