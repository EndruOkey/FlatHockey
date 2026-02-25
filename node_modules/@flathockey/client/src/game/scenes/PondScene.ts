import Phaser from 'phaser';
import type { InputMsg, PlayerStateMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { WsClient } from '../net/wsClient';
import { Interpolator, lerpPlayer, type LerpPlayer } from '../net/interpolation';
import { applyPredictedInput, CLIENT_FIXED_DT, type PredictedPlayerState, lastTelemetry } from '../net/prediction';
import { getTuning, usedTuning } from '../debug/movementTuning';
import { reconcilePrediction } from '../net/reconciliation';
import { PlayerView } from '../entities/playerView';

const CLIENT_SIM_HZ = 60;
const FIXED_STEP_MS = 1000 / CLIENT_SIM_HZ;
const MAX_SIM_STEPS_PER_FRAME = 3;
const DT_CLAMP_MS = 34;
const HITCH_MS = 150;
const INTERP_DELAY_MS = 180;

type DebugSample = { t: number; dtMs: number };

export class PondScene extends Phaser.Scene {
  private ws = new WsClient();
  private clientId: string | null = null;
  private roomId: string | null = null;
  private wsConnected = false;

  private players = new Map<string, PlayerView>();
  private remoteInterpolators = new Map<string, Interpolator<LerpPlayer>>();
  private localBuffer = new Interpolator<LerpPlayer>(256);

  private predicted: PredictedPlayerState | null = null;
  private pendingInputs: InputMsg[] = [];
  private seq = 0;
  private ackSeq = 0;

  private simAccumulatorMs = 0;
  private renderClockMs = 0;
  private lastFrameTimeMs = 0;
  private simStepsThisFrame = 0;
  private simCapHitCount = 0;

  // resync / startup helpers
  private hasReceivedFirstSnapshot = false;
  private resyncCount = 0;
  private pendingResyncReason: string | null = null;
  private lastResyncReason: string | null = null;
  private lastResyncAtMs = 0;

  private needsResync = false;
  private hitchCount = 0;
  private lastHitchMs = 0;

  private latestSnapshotAtMs = 0;
  private snapshotReceiveTimes: number[] = [];

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private debugToggleKey!: Phaser.Input.Keyboard.Key;
  private debugEnabled = true;
  private debugOverlay!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private lastHudText = '';
  private hudAcc = 0;
  private perfSamples: DebugSample[] = [];
  private movementTuner: any | null = null;
  private debugAllowed = false;
  
  // telemetry for debug
  private debugCurrentSpeed = 0;
  private debugSteeringStrength = 0;
  private debugSpeedRatio = 0;
  private lastTuningVersion = 0;

  constructor() {
    super('PondScene');
  }

  create() {
    this.drawBackground();

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT,SPACE,F3') as Record<string, Phaser.Input.Keyboard.Key>;
    this.debugToggleKey = this.keys.F3;

    this.hud = this.add.text(12, 12, 'Connecting...', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#d7f4ff'
    }).setScrollFactor(0).setDepth(1000);

    this.debugOverlay = this.add.text(12, 150, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#fff0aa'
    }).setScrollFactor(0).setDepth(1000);

    this.input.on('pointerdown', () => this.game.canvas?.focus());
    if (this.game.canvas) this.game.canvas.tabIndex = 1;

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
    });

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = import.meta.env.DEV ? `${scheme}://localhost:8080/ws` : `${scheme}://${location.host}/ws`;
    this.connect(wsUrl);

    const now = performance.now();
    this.lastFrameTimeMs = now;
    this.renderClockMs = now;
    this.simAccumulatorMs = 0;
    this.needsResync = true; // one-shot startup resync — handled in update() so same path as focus/visibility
    this.pendingResyncReason = 'startup';
    // Dev-only movement tuner: create only when allowed (DEV or ?debug=1)
    try {
      const url = new URL(location.href);
      this.debugAllowed = import.meta.env.DEV === true || url.searchParams.get('debug') === '1';
      if (this.debugAllowed) {
        // Launch the in-canvas DebugUIScene (registered in game config)
        try {
          if (!this.scene.isActive('DebugUIScene')) {
            this.scene.launch('DebugUIScene');
          }
          try { this.scene.bringToTop('DebugUIScene'); } catch {}
        } catch {}
        try { this.game.events.emit('debug:toggle', this.debugEnabled); } catch {}
      }
    } catch {}
  }

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.needsResync = true;
      this.pendingResyncReason = this.pendingResyncReason ?? 'visibilitychange';
    }
  };

  private onBlur = () => {
    this.needsResync = true;
    this.pendingResyncReason = this.pendingResyncReason ?? 'blur';
  };

  private onFocus = () => {
    this.resumeFromFocus();
  };

  private resumeFromFocus() {
    if (!this.needsResync) return;
    this.needsResync = false;

    const now = performance.now();
    this.lastFrameTimeMs = now;
    this.renderClockMs = now;
    this.simAccumulatorMs = 0;
    this.input.keyboard?.resetKeys();
  }

  private connect(wsUrl: string) {
    this.ws.onOpen(() => {
      this.wsConnected = true;
    });

    this.ws.onClose(() => {
      this.wsConnected = false;
      this.hud.setText('Disconnected');
    });

    this.ws.onMessage((msg) => this.onServerMessage(msg));
    this.ws.connect(wsUrl);
  }

  private drawBackground() {
    const g = this.add.graphics();
    const w = this.scale.width;
    const h = this.scale.height;
    g.fillStyle(0x0d2a36, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x8cc5da, 0.4);
    g.strokeRect(80, 60, w - 160, h - 120);
  }

  private ensurePlayerView(id: string) {
    if (this.players.has(id)) return this.players.get(id)!;
    const team = this.clientId && id === this.clientId ? 'A' : 'B';
    const view = new PlayerView(this, id, team);
    this.players.set(id, view);
    this.remoteInterpolators.set(id, new Interpolator<LerpPlayer>(120));
    return view;
  }

  private onServerMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      this.clientId = msg.clientId;
      this.roomId = msg.roomId;
      return;
    }

    if (msg.type === 'snapshot') {
      this.consumeSnapshot(msg);
    }
  }

  private consumeSnapshot(snapshot: SnapshotMsg) {
    const now = performance.now();
    this.latestSnapshotAtMs = now;
    this.snapshotReceiveTimes.push(now);
    this.snapshotReceiveTimes = this.snapshotReceiveTimes.filter((t) => t >= now - 1000);

    // first-snapshot safety resync: ensure clocks and buffers align when data arrives
    if (!this.hasReceivedFirstSnapshot) {
      this.hasReceivedFirstSnapshot = true;
      this.needsResync = true;
      this.pendingResyncReason = this.pendingResyncReason ?? 'first-snapshot';
    }

    for (const p of snapshot.players) {
      this.ensurePlayerView(p.id);

      if (this.clientId && p.id === this.clientId) {
        this.ackSeq = snapshot.ack[this.clientId] ?? 0;
        if (!this.predicted) {
          this.predicted = { ...p };
          this.pendingInputs = [];
          this.localBuffer.clear();
          this.localBuffer.push({ x: p.x, y: p.y, rot: p.angle }, now);
        } else {
          reconcilePrediction(this.predicted, p, this.ackSeq, this.pendingInputs);
          this.localBuffer.push({ x: this.predicted.x, y: this.predicted.y, rot: this.predicted.angle }, now);
        }
      } else {
        this.remoteInterpolators.get(p.id)?.push({ x: p.x, y: p.y, rot: p.angle }, now);
      }
    }
  }

  private buildInput(): InputMsg {
    const moveX = ((this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0)) as -1 | 0 | 1;
    const moveY = ((this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0)) as -1 | 0 | 1;

    return {
      type: 'input',
      clientId: this.clientId ?? '',
      seq: ++this.seq,
      moveX,
      moveY,
      sprint: this.keys.SHIFT.isDown ? 1 : 0,
      brake: this.keys.SPACE.isDown ? 1 : 0
    };
  }

  private worldToScreen(x: number, y: number) {
    return { x: x + this.scale.width / 2, y: y + this.scale.height / 2 };
  }

  private sampleInterpolated(interpolator: Interpolator<LerpPlayer>, targetTime: number): LerpPlayer | null {
    const oldest = interpolator.oldestTime();
    const newest = interpolator.newestTime();
    if (oldest === null || newest === null) return null;

    const clamped = Math.max(oldest, Math.min(newest, targetTime));
    return interpolator.sample(clamped, lerpPlayer) ?? interpolator.latest()?.value ?? null;
  }

  private getPerfStats() {
    this.perfSamples = this.perfSamples.filter((s) => s.t >= this.renderClockMs - 1000);
    if (this.perfSamples.length === 0) return { fps: 0, dtMax: 0 };

    let dtSum = 0;
    let dtMax = 0;
    for (const sample of this.perfSamples) {
      dtSum += sample.dtMs;
      dtMax = Math.max(dtMax, sample.dtMs);
    }

    const avg = dtSum / this.perfSamples.length;
    return { fps: avg > 0 ? 1000 / avg : 0, dtMax };
  }

  private updateOverlay() {
    if (!this.debugEnabled) {
      this.debugOverlay.setVisible(false);
      return;
    }

    this.debugOverlay.setVisible(true);
    const perf = this.getPerfStats();
    const latestSnapshotAge = this.latestSnapshotAtMs > 0 ? performance.now() - this.latestSnapshotAtMs : -1;
    const snapshotRate = this.snapshotReceiveTimes.length;
    const oldest = this.localBuffer.oldestTime();
    const newest = this.localBuffer.newestTime();
    const bufferRange = oldest !== null && newest !== null ? newest - oldest : 0;
    const targetBehindNewest = newest !== null ? Math.max(0, newest - (this.renderClockMs - INTERP_DELAY_MS)) : 0;

    const tuning = getTuning();
    const used = usedTuning;
    const telemetry = (lastTelemetry || {}) as Record<string, any>;

    this.debugOverlay.setText([
      'DEBUG [F3]',
      `FPS=${perf.fps.toFixed(1)} dtMax1s=${perf.dtMax.toFixed(2)}ms`,
      `seq=${this.seq} ack=${this.ackSeq} pending=${this.pendingInputs.length}`,
      `simStepsThisFrame=${this.simStepsThisFrame} capHitCount=${this.simCapHitCount}`,
      `lastSnapshotAge=${latestSnapshotAge.toFixed(1)}ms snapshotRate=${snapshotRate}/s`,
      `remote/local interpRange=${bufferRange.toFixed(1)}ms targetBehindNewest=${targetBehindNewest.toFixed(1)}ms`,
      `hitchCount=${this.hitchCount} lastHitchMs=${this.lastHitchMs.toFixed(1)} needsResync=${this.needsResync}`,
      `resyncCount=${this.resyncCount} lastResyncReason=${this.lastResyncReason ?? '-'} resyncAtMs=${this.lastResyncAtMs.toFixed(1)}`,
      `speed=${this.debugCurrentSpeed.toFixed(1)} drift=${(telemetry.driftAngle||0).toFixed(2)} speedRatio=${(this.debugSpeedRatio*100).toFixed(0)}%`,
      `tuningVersion=${tuning.__version ?? 0} accel=${tuning.accel} maxSpeed=${tuning.maxSpeed} dragMove=${tuning.dragMove} dragIdle=${tuning.dragIdle} lateralGrip=${tuning.lateralGrip}`,
      `USED speed=${(telemetry.currentSpeed ?? '-')} lat=${(telemetry.lateralSpeed ?? '-')} fwd=${(telemetry.forwardSpeed ?? '-')}`
    ].join('\n'));
  }

  private updateHud(dtSec: number) {
    if (!this.wsConnected) return;

    this.hudAcc += dtSec;
    if (this.hudAcc < 0.25) return;
    this.hudAcc = 0;

    const next = [
      `Room: ${this.roomId ?? '-'}`,
      `Client: ${this.clientId ?? '-'}`,
      `Seq/Ack: ${this.seq}/${this.ackSeq}`,
      `Pending: ${this.pendingInputs.length}`,
      'WASD move | SHIFT sprint | SPACE brake'
    ].join('\n');

    if (next !== this.lastHudText) {
      this.lastHudText = next;
      this.hud.setText(next);
    }
  }
  
  update(_time: number, _deltaMs: number) {
    const now = performance.now();

    if (this.lastFrameTimeMs === 0) {
      // first-frame guard: ensure all clocks share the same timebase
      this.lastFrameTimeMs = now;
      this.renderClockMs = now;
      this.simAccumulatorMs = 0;
      return;
    }

    let frameDtMs = now - this.lastFrameTimeMs;
    this.lastFrameTimeMs = now;

    if (Phaser.Input.Keyboard.JustDown(this.debugToggleKey)) {
      this.debugEnabled = !this.debugEnabled;
      const state = this.debugEnabled ? 'ON' : 'OFF';
      console.log(`[TUNING] toggle ${state}`);
      console.log(`[TUNING] sceneKey=${this.scene.key}, cam=${this.cameras?.main ? 'main' : 'none'}, scale=${this.scale.width}x${this.scale.height}`);

      // notify DebugUIScene to toggle its visibility
      if (this.debugEnabled) {
        try {
          if (!this.scene.isActive('DebugUIScene')) this.scene.launch('DebugUIScene');
          try { this.scene.bringToTop('DebugUIScene'); } catch {}
        } catch {}
      }
      this.game.events.emit('debug:toggle', this.debugEnabled);
    }

    if (this.needsResync) {
      // one-shot clock reset to avoid dt spike after blur/visibility changes
      this.needsResync = false;

      const t = performance.now();
      this.lastFrameTimeMs = t;
      this.renderClockMs = t;
      this.simAccumulatorMs = 0;

      this.input.keyboard?.resetKeys();

      // attempt to align interpolator sample ranges to the new render clock
      for (const interp of this.remoteInterpolators.values()) {
        const latest = interp.latest();
        if (latest) interp.push(latest.value, t);
      }
      const localLatest = this.localBuffer.latest();
      if (localLatest) this.localBuffer.push(localLatest.value, t);

      // instrumentation
      this.resyncCount += 1;
      this.lastResyncReason = this.pendingResyncReason ?? this.lastResyncReason ?? 'resync';
      this.pendingResyncReason = null;
      this.lastResyncAtMs = t;

      // Do NOT return — keep rendering remote players even when not focused.
      frameDtMs = 0;
    }

    if (frameDtMs > HITCH_MS) {
      this.hitchCount += 1;
      this.lastHitchMs = frameDtMs;
      this.simAccumulatorMs = 0;
      frameDtMs = 0;
    }

    const clampedDtMs = Math.min(frameDtMs, DT_CLAMP_MS);
    this.renderClockMs += clampedDtMs;
    this.simAccumulatorMs += clampedDtMs;

    let steps = 0;
    // compute the start time for the simulation window so each fixed step gets
    // its own monotonic timestamp. This prevents multiple pushes with the
    // same timestamp (which causes interpolation t=0 and visible stepping).
    let simStepTime = this.renderClockMs - this.simAccumulatorMs;
    while (this.simAccumulatorMs >= FIXED_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
      // advance simulated time by one fixed-step
      simStepTime += FIXED_STEP_MS;
      this.simAccumulatorMs -= FIXED_STEP_MS;
      steps += 1;

      if (this.clientId && this.predicted) {
        const input = this.buildInput();
        this.pendingInputs.push(input);
        if (this.pendingInputs.length > 240) {
          this.pendingInputs.splice(0, this.pendingInputs.length - 240);
        }

        const telemetry = applyPredictedInput(this.predicted, input, CLIENT_FIXED_DT) as unknown as Record<string, any>;
        if (telemetry) {
          this.debugCurrentSpeed = telemetry.currentSpeed ?? this.debugCurrentSpeed;
          // map driftAngle to steeringStrength for legacy display
          this.debugSteeringStrength = telemetry.driftAngle ?? this.debugSteeringStrength;
          this.debugSpeedRatio = telemetry.speedRatio ?? this.debugSpeedRatio;
        }
        // push the predicted state using the per-step timestamp so the
        // interpolator sees properly spaced samples
        this.localBuffer.push({ x: this.predicted.x, y: this.predicted.y, rot: this.predicted.angle }, simStepTime);
        this.ws.send(input);
      }
    }
    this.simStepsThisFrame = steps;

    if (this.simAccumulatorMs >= FIXED_STEP_MS) {
      this.simCapHitCount += 1;
      this.simAccumulatorMs = Math.min(this.simAccumulatorMs, FIXED_STEP_MS);
    }

    const targetTime = this.renderClockMs - INTERP_DELAY_MS;
    for (const [id, view] of this.players.entries()) {
      let state: LerpPlayer | null = null;
      if (this.clientId && id === this.clientId) {
        state = this.sampleInterpolated(this.localBuffer, targetTime);
        if (!state && this.predicted) state = { x: this.predicted.x, y: this.predicted.y, rot: this.predicted.angle };
      } else {
        const interp = this.remoteInterpolators.get(id);
        if (interp) state = this.sampleInterpolated(interp, targetTime);
      }

      if (!state) continue;
      const s = this.worldToScreen(state.x, state.y);
      view.setState(s.x, s.y, state.rot);
      view.draw();
    }

    this.perfSamples.push({ t: this.renderClockMs, dtMs: frameDtMs });
    this.updateOverlay();
    this.updateHud(clampedDtMs / 1000);
  }
}
