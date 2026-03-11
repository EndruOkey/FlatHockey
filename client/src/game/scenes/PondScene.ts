import Phaser from 'phaser';
import type { InputMsg, RuntimeEnvironment, ServerMessage } from '@flathockey/shared';
import { WsClient } from '../net/wsClient';
import { Interpolator, lerpPlayer, type LerpPlayer } from '../net/interpolation';
import { type PredictedPlayerState, setAimInputRateLimited } from '../net/prediction';
import { getServerHandshakeMismatch } from '../net/serverCompatibility';
import { getTuning } from '../tuning/gameplayConfig';
import { PlayerView } from '../entities/playerView';
import { ENV } from '../../config/env';
import { BUILD_TIME, BUILD_VERSION } from '../../config/version';
import { buildClientInput, handleServerMessage } from './PondSceneNetOps';
import {
  updateAndDrawPuck as updateAndDrawPuckOp,
  updateCrosshairAndCursor as updateCrosshairAndCursorOp,
  updateHud as updateHudOp,
  updateOverlay as updateOverlayOp
} from './PondSceneRenderOps';
import { runPondSceneUpdate } from './PondSceneUpdateLoop';
import { wrapToPi } from '../util/math';

const REMOTE_INTERP_DELAY_DEFAULT_MS = 120;

export function resolveWsUrl(): string {
  const host = window.location.hostname;
  const requireDevWsUrl = () => {
    if (ENV.WS_DEV) return ENV.WS_DEV;
    throw new Error('VITE_WS_DEV is not configured');
  };

  if (host === 'localhost' || host === '127.0.0.1') {
    return ENV.WS_LOCAL;
  }

  if (ENV.DEV_BUILD) {
    return requireDevWsUrl();
  }

  if (host.includes('flathockey-dev')) {
    return requireDevWsUrl();
  }

  return ENV.WS_PROD;
}

export class PondScene extends Phaser.Scene {
  private ws = new WsClient();
  private clientId: string | null = null;
  private roomId: string | null = null;
  private wsConnected = false;
  private protocolMismatchReason: string | null = null;
  private expectedRuntime: RuntimeEnvironment = 'unknown';

  private players = new Map<string, PlayerView>();
  private remoteInterpolators = new Map<string, Interpolator<LerpPlayer>>();
  private localBuffer = new Interpolator<LerpPlayer>(256);
  private puckFreeBuffer = new Interpolator<{ x: number; y: number; vx: number; vy: number }>(180);
  private puckRender = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE' as 'FREE' | 'HELD', ownerId: null as string | null };
  private puckSnapshot = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE' as 'FREE' | 'HELD', ownerId: null as string | null };
  private puckGraphics!: Phaser.GameObjects.Graphics;

  private predicted: PredictedPlayerState | null = null;
  private pendingInputs: InputMsg[] = [];
  private seq = 0;
  private ackSeq = 0;

  private simAccumulatorMs = 0;
  private renderClockMs = 0;
  private lastFrameTimeMs = 0;

  private hasReceivedFirstSnapshot = false;
  private pendingResyncReason: string | null = null;
  private needsResync = false;

  private newestSnapshotServerMs = 0;
  private serverTimeOffsetMs = 0;
  private hasServerClock = false;
  private remoteLastSnapshotTick = new Map<string, number>();
  private remoteInterpDelayMs = REMOTE_INTERP_DELAY_DEFAULT_MS;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private recorderToggleKey!: Phaser.Input.Keyboard.Key;
  private replayToggleKey!: Phaser.Input.Keyboard.Key;
  private hud!: Phaser.GameObjects.Text;
  private lastHudText = '';
  private hudAcc = 0;
  private crosshairGraphics!: Phaser.GameObjects.Graphics;
  private inputRecorderEnabled = false;
  private replayEnabled = false;
  private replayIndex = 0;
  private recordedInputs: Array<{ tMs: number; input: InputMsg }> = [];
  private readonly inputRecordWindowMs = 20_000;
  private localRenderState: LerpPlayer | null = null;

  constructor() {
    super('PondScene');
  }

  private resetPendingInputState(resetSeq = false) {
    this.pendingInputs = [];
    this.localRenderState = null;
    if (resetSeq) {
      this.seq = 0;
      this.ackSeq = 0;
      return;
    }
    this.ackSeq = this.seq;
  }

  create() {
    this.drawBackground();

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,CTRL,F9,F10') as Record<string, Phaser.Input.Keyboard.Key>;
    this.recorderToggleKey = this.keys.F9;
    this.replayToggleKey = this.keys.F10;

    this.hud = this.add
      .text(12, 12, 'Connecting...', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#d7f4ff'
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.puckGraphics = this.add.graphics().setDepth(900);
    this.crosshairGraphics = this.add.graphics().setDepth(1300);

    this.input.on('pointerdown', () => this.game.canvas?.focus());
    if (this.game.canvas) this.game.canvas.tabIndex = 1;

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      this.puckGraphics?.destroy();
      this.crosshairGraphics?.destroy();
      if (this.game.canvas) this.game.canvas.style.cursor = '';
    });

    let buildStampWsUrl = 'unresolved';
    try {
      const wsUrl = resolveWsUrl();
      buildStampWsUrl = wsUrl;
      this.connect(wsUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.hud.setText(`Offline (config)\n${msg}`);
    }

    const now = performance.now();
    this.lastFrameTimeMs = now;
    this.renderClockMs = now;
    this.simAccumulatorMs = 0;
    this.needsResync = true;
    this.pendingResyncReason = 'startup';
    console.info('[BUILD_STAMP]', {
      commit: BUILD_VERSION || 'unknown',
      buildTime: BUILD_TIME || 'unknown',
      wsUrl: buildStampWsUrl
    });
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
    this.protocolMismatchReason = null;
    this.expectedRuntime = this.resolveExpectedRuntime(wsUrl);

    this.ws.onStatus((state: 'connecting' | 'connected' | 'disconnected') => {
      if (this.protocolMismatchReason) return;
      if (state === 'connecting') this.hud.setText('Connecting...');
      if (state === 'connected') this.wsConnected = true;
      if (state === 'disconnected') {
        this.wsConnected = false;
        this.resetPendingInputState();
        this.hud.setText('Offline (retrying...)');
      }
    });
    this.ws.onOpen(() => {
      if (this.protocolMismatchReason) return;
      this.wsConnected = true;
      this.resetPendingInputState(true);
      if (!this.roomId) this.roomId = 'pond-1';
    });

    this.ws.onClose(() => {
      if (this.protocolMismatchReason) return;
      this.wsConnected = false;
      this.resetPendingInputState();
      this.hud.setText('Offline (retrying...)');
    });

    this.ws.onMessage((msg: ServerMessage | { type?: string; [key: string]: unknown }) => this.onServerMessage(msg));
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
    const view = new PlayerView(this);
    view.setDebugDrawEnabled(false);
    this.players.set(id, view);
    this.remoteInterpolators.set(id, new Interpolator<LerpPlayer>(120));
    return view;
  }

  private applyWelcomeLike(msg: { clientId: string; roomId?: string; room?: string }) {
    this.resetPendingInputState(true);
    this.clientId = msg.clientId;
    this.roomId = msg.roomId ?? msg.room ?? this.roomId ?? 'pond-1';
    this.predicted = null;
    this.hasReceivedFirstSnapshot = false;
  }

  private clearWorldState() {
    for (const view of this.players.values()) {
      view.destroy();
    }
    this.players.clear();
    this.remoteInterpolators.clear();
    this.remoteLastSnapshotTick.clear();
    this.localBuffer.clear();
    this.puckFreeBuffer.clear();
    this.localRenderState = null;
    this.predicted = null;
    this.clientId = null;
    this.roomId = null;
    this.hasReceivedFirstSnapshot = false;
    this.hasServerClock = false;
    this.newestSnapshotServerMs = 0;
    this.serverTimeOffsetMs = 0;
    this.needsResync = false;
    this.pendingResyncReason = 'protocol-mismatch';
    this.puckSnapshot = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE', ownerId: null };
    this.puckRender = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE', ownerId: null };
    this.puckGraphics?.clear();
  }

  failProtocolMismatch(reason: string) {
    this.protocolMismatchReason = reason;
    this.wsConnected = false;
    this.resetPendingInputState(true);
    this.clearWorldState();
    this.hudAcc = 0;
    this.lastHudText = '';
    this.hud.setText(
      [
        'Offline (protocol mismatch)',
        reason,
        `Client build: ${BUILD_VERSION || 'unknown'}`,
        `Expected runtime: ${this.expectedRuntime}`
      ].join('\n')
    );
    this.ws.disconnect(true);
  }

  private onServerMessage(msg: ServerMessage | { type?: string; [key: string]: unknown }) {
    const mismatch = getServerHandshakeMismatch(msg, this.expectedRuntime);
    if (mismatch) {
      this.failProtocolMismatch(mismatch);
      return;
    }
    handleServerMessage(this, msg);
  }

  private buildInput(): InputMsg {
    return buildClientInput(this);
  }

  private cloneInput(input: InputMsg): InputMsg {
    return {
      ...input,
      clientId: this.clientId ?? '',
      seq: ++this.seq
    };
  }

  private recordInputSample(input: InputMsg, nowMs: number) {
    if (!this.inputRecorderEnabled || this.replayEnabled) return;
    this.recordedInputs.push({
      tMs: nowMs,
      input: {
        ...input,
        clientId: '',
        seq: 0
      }
    });
    const cutoff = nowMs - this.inputRecordWindowMs;
    while (this.recordedInputs.length > 0 && this.recordedInputs[0].tMs < cutoff) {
      this.recordedInputs.shift();
    }
  }

  private startReplay() {
    if (this.recordedInputs.length === 0) return;
    this.replayEnabled = true;
    this.replayIndex = 0;
    this.inputRecorderEnabled = false;
  }

  private stopReplay() {
    this.replayEnabled = false;
    this.replayIndex = 0;
  }

  private nextReplayInput(): InputMsg | null {
    if (!this.replayEnabled) return null;
    if (this.replayIndex >= this.recordedInputs.length) {
      this.stopReplay();
      return null;
    }
    const sample = this.recordedInputs[this.replayIndex++];
    return this.cloneInput(sample.input);
  }

  private worldToScreen(x: number, y: number) {
    return { x: x + this.scale.width / 2, y: y + this.scale.height / 2 };
  }

  private screenToWorld(x: number, y: number) {
    return { x: x - this.scale.width / 2, y: y - this.scale.height / 2 };
  }

  private sampleInterpolated(interpolator: Interpolator<LerpPlayer>, targetTime: number): LerpPlayer | null {
    const oldest = interpolator.oldestTime();
    const newest = interpolator.newestTime();
    if (oldest === null || newest === null) return null;

    const sampleTime = Math.max(oldest, Math.min(newest, targetTime));
    return interpolator.sample(sampleTime, lerpPlayer) ?? interpolator.latest()?.value ?? null;
  }

  private estimateServerNowMs(nowMs: number): number {
    if (this.hasServerClock) {
      return nowMs - this.serverTimeOffsetMs;
    }
    return this.newestSnapshotServerMs;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    const d = wrapToPi(b - a);
    return wrapToPi(a + d * t);
  }

  private computeMouseAimAngle(_dtSec: number, tuning = getTuning()): number | undefined {
    if (!tuning.aimEnabled || !this.predicted) {
      setAimInputRateLimited(false);
      return undefined;
    }
    const pointer = this.input.activePointer;
    const mouseWorld = this.screenToWorld(pointer.x, pointer.y);
    const deadzone = Math.max(0, tuning.aimDeadzonePx ?? 32);
    const dx = mouseWorld.x - this.predicted.x;
    const dy = mouseWorld.y - this.predicted.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= deadzone) {
      setAimInputRateLimited(false);
      return Number.isFinite(this.predicted.aimAngle) ? this.predicted.aimAngle : undefined;
    }

    const rawTarget = Math.atan2(mouseWorld.y - this.predicted.y, mouseWorld.x - this.predicted.x);
    setAimInputRateLimited(false);
    return rawTarget;
  }

  private updateCrosshairAndCursor() {
    updateCrosshairAndCursorOp(this);
  }

  private updateAndDrawPuck(dtSec: number, remoteTargetServerTime: number) {
    updateAndDrawPuckOp(this, dtSec, remoteTargetServerTime);
  }

  private updateOverlay() {
    updateOverlayOp(this);
  }

  private updateHud(dtSec: number) {
    updateHudOp(this, dtSec);
  }

  update(_time: number, _deltaMs: number) {
    runPondSceneUpdate(this);
  }

  private resolveExpectedRuntime(wsUrl: string): RuntimeEnvironment {
    if (wsUrl.startsWith('ws://localhost') || wsUrl.startsWith('ws://127.0.0.1')) {
      return 'local';
    }
    if (ENV.DEV_BUILD || window.location.hostname.includes('flathockey-dev')) {
      return 'dev';
    }
    return 'prod';
  }
}
