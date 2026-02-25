import Phaser from 'phaser';
import { movementTuning, getTuning, setTuning, resetTuning, exportTuning, DEFAULTS } from './movementTuning';
import { lastTelemetry } from '../net/prediction';

export default class DebugUIScene extends Phaser.Scene {
  private container!: Phaser.GameObjects.Container;
  private bg!: Phaser.GameObjects.Rectangle;
  private sliders: Array<{ key: keyof ReturnType<typeof getTuning>; track: Phaser.GameObjects.Rectangle; handle: Phaser.GameObjects.Rectangle; min: number; max: number; }> = [];
  private diagBox!: Phaser.GameObjects.Rectangle;
  private metricsText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'DebugUIScene' });
  }

  create() {
    // ensure the scene has a UI camera that stays at 0,0 and covers the viewport
    try {
      const cam = this.cameras.main;
      cam.setScroll(0, 0);
      cam.setViewport(0, 0, this.scale.width, this.scale.height);
      cam.setName('ui');
    } catch {}

    // telemetry: report creation
    const sceneKey = this.scene.key;
    const logX = this.scale.width - 340 - 12;
    const logY = 12;
    console.log('[DEV PANEL] created', sceneKey, logX, logY, 99999, true, 0.66, `${this.scale.width}x${this.scale.height}`);
    setTimeout(() => {
      const exists = !!this.scene.get('DebugUIScene');
      const visible = !!(this.container && this.container.visible);
      console.log('[DEV PANEL] stillAlive', { exists, visible });
    }, 1000);

    const w = 340;
    const h = 260;
    const pad = 12;

    const x = this.scale.width - w - 12;
    const y = 12;

    // restore saved panel position if any
    try {
      const raw = localStorage.getItem('tuningPanelPos_v1');
      if (raw) {
        const pos = JSON.parse(raw) as { x: number; y: number };
        // clamp to viewport
        pos.x = Phaser.Math.Clamp(pos.x, 0, Math.max(0, this.scale.width - w));
        pos.y = Phaser.Math.Clamp(pos.y, 0, Math.max(0, this.scale.height - h));
        this.container = this.add.container(pos.x, pos.y).setScrollFactor(0).setDepth(999999);
      } else {
        this.container = this.add.container(x, y).setScrollFactor(0).setDepth(999999);
      }
    } catch {
      this.container = this.add.container(x, y).setScrollFactor(0).setDepth(999999);
    }
    this.bg = this.add.rectangle(0, 0, w, h, 0x000000, 0.66).setOrigin(0, 0);
    // consume pointer events so clicks inside the panel don't pass to game
    this.bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer, x2: number, y2: number, e: any) => { e.stopPropagation(); });
    this.container.add(this.bg);

    // header (drag handle)
    const headerH = 30;
    const header = this.add.rectangle(0, 0, w, headerH, 0x1b1f23, 1).setOrigin(0, 0).setDepth(2);
    header.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, headerH), Phaser.Geom.Rectangle.Contains);
    const title = this.add.text(pad, 6, 'TUNING PANEL (DEV)', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(0, 0).setDepth(3);
    const help = this.add.text(w - 120, 8, 'F3: toggle', { fontFamily: 'monospace', fontSize: '12px', color: '#cccccc' }).setOrigin(0, 0).setDepth(3);
    this.container.add([header, title, help]);
    // drag state
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    header.on('pointerdown', (p: Phaser.Input.Pointer, x2: number, y2: number, e: any) => {
      e.stopPropagation();
      dragOffsetX = p.x - this.container.x;
      dragOffsetY = p.y - this.container.y;
      this.container.setData('dragging', true);
    });
    this.input.on('pointerup', () => {
      if (this.container.getData('dragging')) {
        this.container.removeData('dragging');
        // persist
        try {
          localStorage.setItem('tuningPanelPos_v1', JSON.stringify({ x: this.container.x, y: this.container.y }));
        } catch {}
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.container.getData('dragging')) {
        const nx = Phaser.Math.Clamp(p.x - dragOffsetX, 0, Math.max(0, this.scale.width - w));
        const ny = Phaser.Math.Clamp(p.y - dragOffsetY, 0, Math.max(0, this.scale.height - h));
        this.container.x = nx;
        this.container.y = ny;
        p.event.stopPropagation();
      }
    });

    // --- HARD-CODED BRUTAL TEST SLIDER (no config) ---
    // must be relative to container (offset inside container)
    const testX = 30;
    const testY = 120;
    const trackW = 260;
    const trackH = 10;
    const knobRadius = 10;

    // create track as Graphics (explicit draw)
    const sliderTrack = this.add.graphics();
    sliderTrack.clear();
    sliderTrack.fillStyle(0x333333, 1);
    sliderTrack.fillRect(testX, testY, trackW, trackH);
    sliderTrack.setDepth(10);
    this.container.add(sliderTrack);

    // knob as circle
    const sliderKnob = this.add.circle(testX + Math.floor(trackW / 2), testY + Math.floor(trackH / 2), knobRadius, 0xffcc00).setDepth(11);
    this.container.add(sliderKnob);

    // value text
    const sliderText = this.add.text(testX + trackW + 12, testY - 4, 'TEST 1.00', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setOrigin(0, 0).setDepth(12);
    this.container.add(sliderText);

    // interactive hit zone for knob
    const knobHit = this.add.rectangle(sliderKnob.x, sliderKnob.y, knobRadius * 3, knobRadius * 3, 0xffffff, 0.001).setOrigin(0.5, 0.5).setDepth(13);
    this.container.add(knobHit);
    knobHit.setInteractive(new Phaser.Geom.Rectangle(-knobRadius*1.5, -knobRadius*1.5, knobRadius*3, knobRadius*3), Phaser.Geom.Rectangle.Contains);
    knobHit.on('pointerdown', (p: Phaser.Input.Pointer, x2: number, y2: number, e: any) => { e.stopPropagation(); knobHit.setData('dragging', true); });
    this.input.on('pointerup', () => { knobHit.setData('dragging', false); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (knobHit.getData('dragging')) {
        const localX = Phaser.Math.Clamp(p.x - (this.container.x + testX), 0, trackW);
        sliderKnob.x = testX + localX;
        knobHit.x = sliderKnob.x; knobHit.y = sliderKnob.y;
        sliderText.setText(`TEST ${(localX / trackW).toFixed(2)}`);
        p.event.stopPropagation();
      }
    });

    console.log('[SLIDER TEST] added', sliderTrack, sliderKnob);
    setTimeout(() => {
      console.log('[SLIDER TEST] visible:', sliderTrack.visible, sliderKnob.visible);
      if (!sliderTrack.visible || !sliderKnob.visible) {
        console.log('[SLIDER TEST] panel sceneKey=', this.scene.key);
        console.log('[SLIDER TEST] container list length=', this.container.list.length);
      }
    }, 500);

    let yy = pad + 48;

    const addSlider = (label: string, key: keyof ReturnType<typeof getTuning>, min: number, max: number) => {
      const lbl = this.add.text(pad, yy, label, { fontFamily: 'monospace', fontSize: '12px', color: '#dfefff' }).setOrigin(0, 0);
      const track = this.add.rectangle(pad, yy + 18, 220, 8, 0x333333).setOrigin(0, 0).setInteractive();
      const handle = this.add.rectangle(pad, yy + 22, 12, 18, 0xffcc00).setOrigin(0.5, 0.5).setInteractive();
      this.container.add([lbl, track, handle]);
      this.sliders.push({ key, track, handle, min, max });

      track.on('pointerdown', (p: any) => { p.event.stopPropagation(); });
      handle.on('pointerdown', (p: any) => { p.event.stopPropagation(); handle.setData('dragging', true); });
      this.input.on('pointerup', () => { handle.setData('dragging', false); });
      this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (handle.getData('dragging')) {
          const localX = Phaser.Math.Clamp(p.x - (this.container.x + track.x), 0, track.width);
          const t = localX / track.width;
          const val = min + (max - min) * t;
          handle.x = track.x + localX;
          // write directly to singleton object so all code sees the change immediately
          (movementTuning as any)[key] = Number(val);
          movementTuning.__version = (movementTuning.__version ?? 0) + 1;
          try { localStorage.setItem('movementTuning_v1', JSON.stringify(movementTuning)); } catch {}
        }
      });

      yy += 40;
    };

    addSlider('Accel', 'accel', 100, 5000);
    addSlider('Max Speed', 'maxSpeed', 50, 2000);
    addSlider('Drag Move', 'dragMove', 0, 5);
    addSlider('Drag Idle', 'dragIdle', 0.9, 1);
    addSlider('Lateral Grip', 'lateralGrip', 0, 10);
    addSlider('Reverse Brake', 'reverseBrake', 0, 20);
    addSlider('Turn Assist', 'turnAssist', 0, 5);
    addSlider('Min Speed For Grip', 'minSpeedForGrip', 0, 30);
    addSlider('Brake Drag', 'brakeDrag', 0, 40);

    const diagLabel = this.add.text(pad, yy, 'Diagonal Normalize', { fontFamily: 'monospace', fontSize: '12px', color: '#dfefff' }).setOrigin(0, 0);
    this.diagBox = this.add.rectangle(pad + 200, yy + 6, 16, 16, 0xffffff).setOrigin(0, 0).setInteractive();
    this.container.add([diagLabel, this.diagBox]);
    this.diagBox.on('pointerdown', () => {
      const current = getTuning().diagonalNormalize;
      setTuning({ diagonalNormalize: !current });
      this.updateFromModel();
    });
    yy += 36;

    const presetA = this.add.text(pad, yy, '[A] Snappy', { fontFamily: 'monospace', fontSize: '12px', color: '#aaffaa' }).setInteractive();
    const presetB = this.add.text(pad + 110, yy, '[B] Hybrid (default)', { fontFamily: 'monospace', fontSize: '12px', color: '#ffd27f' }).setInteractive();
    const presetC = this.add.text(pad + 260, yy, '[C] Arcade', { fontFamily: 'monospace', fontSize: '12px', color: '#ffaaff' }).setInteractive();
    this.container.add([presetA, presetB, presetC]);
    presetA.on('pointerdown', () => { setTuning({ maxSpeed: 560, accel: 2600, dragMove: 0.9, dragIdle: 0.995, lateralGrip: 6.0, reverseBrake: 8, brakeDrag: 12, turnAssist: 0.2 }); this.updateFromModel(); });
    presetB.on('pointerdown', () => { setTuning(DEFAULTS as any); this.updateFromModel(); });
    presetC.on('pointerdown', () => { setTuning({ maxSpeed: 720, accel: 3000, dragMove: 0.7, dragIdle: 0.995, lateralGrip: 2.0, reverseBrake: 4, brakeDrag: 6, turnAssist: 0.0 }); this.updateFromModel(); });

    yy += 28;
    const toolReset = this.add.text(pad, yy, 'Reset', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setInteractive();
    const toolLog = this.add.text(pad + 80, yy, 'Log JSON', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setInteractive();
    const toolClear = this.add.text(pad + 180, yy, 'Clear', { fontFamily: 'monospace', fontSize: '12px', color: '#ff8080' }).setInteractive();
    this.container.add([toolReset, toolLog, toolClear]);
    toolReset.on('pointerdown', () => { resetTuning(); this.updateFromModel(); });
    toolLog.on('pointerdown', () => { console.log(exportTuning()); });
    toolClear.on('pointerdown', () => { localStorage.removeItem('movementTuning_v1'); resetTuning(); this.updateFromModel(); });

    // initial state
    this.updateFromModel();

    // metrics display
    this.metricsText = this.add.text(pad, h - 64, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' }).setOrigin(0, 0).setDepth(20);
    this.container.add(this.metricsText);

    // listen for toggle events
    this.game.events.on('debug:toggle', (on: boolean) => {
      this.container.setVisible(on);
      // bring to top when turning on
      if (on) {
        try { this.scene.bringToTop('DebugUIScene'); } catch {}
      }
    });

    // ensure positioned on resize and update camera viewport
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      try { this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height); } catch {}
      this.container.x = gameSize.width - w - 12;
      this.container.y = 12;
    });
  }

  updateFromModel() {
    const t = getTuning();
    for (const s of this.sliders) {
      const val = (t as any)[s.key] as number;
      const pct = (val - s.min) / (s.max - s.min);
      s.handle.x = s.track.x + Phaser.Math.Clamp(pct * s.track.width, 0, s.track.width);
    }
    this.diagBox.fillColor = getTuning().diagonalNormalize ? 0x00ff00 : 0xffffff;
  }

  update() {
    try {
      const t: any = lastTelemetry || {};
      const speed = (t.currentSpeed || 0);
      const lat = (t.lateralSpeed || 0);
      const fwd = (t.forwardSpeed || 0);
      const driftDeg = ((t.driftAngle || 0) * 180 / Math.PI).toFixed(1);
      const grip = Math.round((t.gripApplied || 0) * 100);
      const brake = Math.round((t.brakeApplied || 0) * 100);
      const lines = [`spd:${speed.toFixed(1)} lat:${lat.toFixed(1)} fwd:${fwd.toFixed(1)}`, `drift:${driftDeg}° grip:${grip}% brake:${brake}%`];
      this.metricsText.setText(lines);
    } catch {}
  }
}
