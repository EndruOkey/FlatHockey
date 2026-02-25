import Phaser from 'phaser';
import { getTuning, setTuning, resetTuning, exportTuning, DEFAULTS } from './movementTuning';

type Slider = {
  label: Phaser.GameObjects.Text;
  track: Phaser.GameObjects.Rectangle;
  handle: Phaser.GameObjects.Rectangle;
  min: number;
  max: number;
  key: keyof ReturnType<typeof getTuning>;
  dragging: boolean;
};

export class DebugPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private sliders: Slider[] = [];
  private toggles: Record<string, Phaser.GameObjects.Rectangle> = {} as any;
  private visible = true;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const w = 260;
    const h = 240;
    const pad = 8;

    this.container = scene.add.container(scene.scale.width - w - 12, 12).setScrollFactor(0).setDepth(9999);
    this.bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.66).setOrigin(0, 0);
    this.container.add(this.bg);

    const title = scene.add.text(pad, pad, 'Movement Tuner (DEV)', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' });
    this.container.add(title);

    let y = pad + 24;

    const addSlider = (label: string, key: any, min: number, max: number) => {
      const lbl = scene.add.text(pad, y, label, { fontFamily: 'monospace', fontSize: '12px', color: '#dfefff' }).setOrigin(0, 0);
      const track = scene.add.rectangle(pad, y + 18, 180, 6, 0x666666).setOrigin(0, 0).setInteractive();
      const handle = scene.add.rectangle(pad, y + 18 + 3, 8, 16, 0xffffff).setOrigin(0.5, 0.5).setInteractive();
      this.container.add([lbl, track, handle]);
      const s: Slider = { label: lbl, track, handle, min, max, key, dragging: false };
      handle.on('pointerdown', (p: any) => { s.dragging = true; p.event.stopPropagation(); });
      scene.input.on('pointerup', () => { s.dragging = false; });
      scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!s.dragging) return;
        const localX = Phaser.Math.Clamp(p.x - (this.container.x + track.x), 0, track.width);
        const t = localX / track.width;
        const val = s.min + (s.max - s.min) * t;
        handle.x = track.x + localX;
        setTuning({ [s.key]: Number(val) } as any);
      });

      y += 36;
      this.sliders.push(s);
    };

    addSlider('Accel', 'accel', 100, 5000);
    addSlider('Max Speed', 'maxSpeed', 50, 2000);
    addSlider('Drag', 'drag', 0, 10);
    addSlider('Turn Low', 'turnLowSpeed', 0, 40);
    addSlider('Turn High', 'turnHighSpeed', 0, 40);
    addSlider('Brake Drag', 'brakeDrag', 0, 40);

    const diagLabel = scene.add.text(pad, y, 'Diagonal Normalize', { fontFamily: 'monospace', fontSize: '12px', color: '#dfefff' });
    const diagBox = scene.add.rectangle(pad + 150, y + 6, 14, 14, 0xffffff).setOrigin(0, 0).setInteractive();
    this.container.add([diagLabel, diagBox]);
    this.toggles.diagonalNormalize = diagBox;
    diagBox.on('pointerdown', () => {
      const current = getTuning().diagonalNormalize;
      setTuning({ diagonalNormalize: !current });
      this.updateFromModel();
    });

    y += 28;

    const presetA = scene.add.text(pad, y, '[A] Snappy', { fontFamily: 'monospace', fontSize: '12px', color: '#aaffaa' }).setInteractive();
    const presetB = scene.add.text(pad + 90, y, '[B] Hybrid (default)', { fontFamily: 'monospace', fontSize: '12px', color: '#ffd27f' }).setInteractive();
    const presetC = scene.add.text(pad + 200, y, '[C] Arcade', { fontFamily: 'monospace', fontSize: '12px', color: '#ffaaff' }).setInteractive();
    this.container.add([presetA, presetB, presetC]);
    presetA.on('pointerdown', () => { setTuning({ maxSpeed: 560, accel: 2600, drag: 1.2, brakeDrag: 12, turnLowSpeed: 16, turnHighSpeed: 5.0 }); this.updateFromModel(); });
    presetB.on('pointerdown', () => { setTuning(DEFAULTS as any); this.updateFromModel(); });
    presetC.on('pointerdown', () => { setTuning({ maxSpeed: 720, accel: 3000, drag: 0.8, brakeDrag: 6, turnLowSpeed: 20, turnHighSpeed: 3.0 }); this.updateFromModel(); });

    y += 22;

    const toolReset = scene.add.text(pad, y, 'Reset', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setInteractive();
    const toolLog = scene.add.text(pad + 60, y, 'Log JSON', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setInteractive();
    const toolClear = scene.add.text(pad + 140, y, 'Clear', { fontFamily: 'monospace', fontSize: '12px', color: '#ff8080' }).setInteractive();
    this.container.add([toolReset, toolLog, toolClear]);
    toolReset.on('pointerdown', () => { resetTuning(); this.updateFromModel(); });
    toolLog.on('pointerdown', () => { console.log(exportTuning()); });
    toolClear.on('pointerdown', () => { localStorage.removeItem('movementTuning_v1'); resetTuning(); this.updateFromModel(); });

    this.updateFromModel();
  }

  updateFromModel() {
    const t = getTuning();
    for (const s of this.sliders) {
      const val = (t as any)[s.key] as number;
      const pct = (val - s.min) / (s.max - s.min);
      s.handle.x = s.track.x + Phaser.Math.Clamp(pct * s.track.width, 0, s.track.width);
    }
    const diagBox = this.toggles.diagonalNormalize;
    diagBox.fillColor = getTuning().diagonalNormalize ? 0x00ff00 : 0xffffff;
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.container.setVisible(v);
  }

  destroy() {
    this.container.destroy(true);
  }
}

export default DebugPanel;
