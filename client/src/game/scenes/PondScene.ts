import Phaser from 'phaser';
import { SIM_HZ, type InputMsg, PlayerStateMsg, ServerMessage, SnapshotMsg, wrapToPi } from '@flathockey/shared';
import { WsClient } from '../net/wsClient';
import { Interpolator, lerpPlayer, type LerpPlayer } from '../net/interpolation';
import { applyPredictedInput, CLIENT_FIXED_DT, type PredictedPlayerState, lastTelemetry, setAimInputRateLimited } from '../net/prediction';
import { getTuning, getTuningApplyCount, setTuningKey, usedTuning } from '../debug/movementTuning';
import { NetDebugOverlay } from '../debug/netDebugOverlay';
import { setNetDebugMetrics } from '../debug/netDebugState';
import { setMovementDebugMetrics } from '../debug/devPanelTelemetryState';
import { reconcilePrediction } from '../net/reconciliation';
import { PlayerView } from '../entities/playerView';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';
import { ENV } from '../../config/env';
import { BUILD_VERSION } from '../../config/version';
import { applySnapshot, buildClientInput, handleServerMessage } from './PondSceneNetOps';
import { drawMovementDebugVectors as drawMovementDebugVectorsOp, updateAndDrawPuck as updateAndDrawPuckOp, updateCrosshairAndCursor as updateCrosshairAndCursorOp, updateHud as updateHudOp, updateOverlay as updateOverlayOp } from './PondSceneRenderOps';
import { runPondSceneUpdate } from './PondSceneUpdateLoop';

const CLIENT_SIM_HZ = 60;
const FIXED_STEP_MS = 1000 / CLIENT_SIM_HZ;
const MAX_SIM_STEPS_PER_FRAME = 3;
const DT_CLAMP_MS = 34;
const HITCH_MS = 150;
const INTERP_DELAY_MS = 180;
const SERVER_TICK_MS = 1000 / SIM_HZ;
const REMOTE_INTERP_DELAY_DEFAULT_MS = 120;

type DebugSample = { t: number; dtMs: number };

export function resolveWsUrl(): string {
  const host = window.location.hostname;

  if (host === 'localhost' || host === '127.0.0.1') {
    return ENV.WS_LOCAL;
  }

  if (ENV.DEV_BUILD) {
    return ENV.WS_DEV;
  }

  if (host.includes('flathockey-dev')) {
    return ENV.WS_DEV;
  }

  return ENV.WS_PROD;
}

export class PondScene extends Phaser.Scene {
  private ws = new WsClient();
  private clientId: string | null = null;
  private roomId: string | null = null;
  private wsConnected = false;
  private allowTuningSync = false;

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
  private newestSnapshotServerMs = 0;
  private serverTimeOffsetMs = 0;
  private hasServerClock = false;
  private droppedSnapshots = 0;
  private remoteLastSnapshotTick = new Map<string, number>();
  private remoteInterpDelayMs = REMOTE_INTERP_DELAY_DEFAULT_MS;
  private latestServerTick = 0;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private debugToggleKey!: Phaser.Input.Keyboard.Key;
  private recorderToggleKey!: Phaser.Input.Keyboard.Key;
  private replayToggleKey!: Phaser.Input.Keyboard.Key;
  private modelToggleKey!: Phaser.Input.Keyboard.Key;
  private debugEnabled = true;
  private debugOverlay!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private lastHudText = '';
  private hudAcc = 0;
  private perfSamples: DebugSample[] = [];
  private crosshairGraphics!: Phaser.GameObjects.Graphics;
  private motionDebugGraphics!: Phaser.GameObjects.Graphics;
  private netDebugOverlay: NetDebugOverlay | null = null;
  private aimCurrentAngle = 0;
  private aimTargetAngle = 0;
  private aimAngleDiff = 0;
  private hasAimState = false;
  private lastDesiredHeading = 0;
  private lastMoveAngle = 0;
  private lastAimAngle = 0;
  private aimDistance01 = 1;
  
  // telemetry for debug
  private debugCurrentSpeed = 0;
  private debugSteeringStrength = 0;
  private debugSpeedRatio = 0;
  private lastTuningVersion = 0;
  private tuningApplySampleLastTs = performance.now();
  private tuningApplySampleLastCount = 0;
  private tuningApplyCountPerSec = 0;
  private inputsSentTimesMs: number[] = [];
  private lastInputVector = { x: 0, y: 0 };
  private lastPointerVector = { x: 0, y: 0 };
  private lastTurnRateDeg = 0;
  private lastPredictedAngle = 0;
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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,F3,F8,F9,F10') as Record<string, Phaser.Input.Keyboard.Key>;
    this.debugToggleKey = this.keys.F3;
    this.modelToggleKey = this.keys.F8;
    this.recorderToggleKey = this.keys.F9;
    this.replayToggleKey = this.keys.F10;

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
    this.puckGraphics = this.add.graphics().setDepth(900);
    this.crosshairGraphics = this.add.graphics().setDepth(1300);
    this.motionDebugGraphics = this.add.graphics().setDepth(1250);
    this.netDebugOverlay = new NetDebugOverlay(this);

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
      this.motionDebugGraphics?.destroy();
      this.netDebugOverlay?.destroy();
      this.netDebugOverlay = null;
      if (this.game.canvas) this.game.canvas.style.cursor = '';
    });

    try {
      const wsUrl = resolveWsUrl();
      this.connect(wsUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.hud.setText(`Offline (config)\n${msg}`);
    }

    const now = performance.now();
    this.lastFrameTimeMs = now;
    this.renderClockMs = now;
    this.simAccumulatorMs = 0;
    this.needsResync = true; // one-shot startup resync — handled in update() so same path as focus/visibility
    this.pendingResyncReason = 'startup';
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
    this.ws.onStatus((state: 'connecting' | 'connected' | 'disconnected') => {
      if (state === 'connecting') this.hud.setText('Connecting...');
      if (state === 'connected') this.wsConnected = true;
      if (state === 'disconnected') {
        this.wsConnected = false;
        this.resetPendingInputState();
        this.hud.setText('Offline (retrying...)');
      }
    });
    this.ws.onOpen(() => {
      this.wsConnected = true;
      this.resetPendingInputState(true);
      if (!this.roomId) this.roomId = 'pond-1';
    });

    this.ws.onClose(() => {
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
    const team = this.clientId && id === this.clientId ? 'A' : 'B';
    const view = new PlayerView(this, id, team);
    view.setDebugDrawEnabled(this.debugEnabled);
    this.players.set(id, view);
    this.remoteInterpolators.set(id, new Interpolator<LerpPlayer>(120));
    return view;
  }

  private applyWelcomeLike(msg: { clientId: string; roomId?: string; room?: string; movementTuning?: unknown; allowTuningSync?: boolean }) {
    this.resetPendingInputState(true);
    this.clientId = msg.clientId;
    this.roomId = msg.roomId ?? msg.room ?? this.roomId ?? 'pond-1';
    this.allowTuningSync = !!msg.allowTuningSync;
    const serverTuning = msg.movementTuning as Record<string, unknown> | undefined;
    const core = typeof serverTuning?.movementCoreModel === 'string' ? serverTuning.movementCoreModel : undefined;
    const model = typeof serverTuning?.movementModel === 'string' ? serverTuning.movementModel : undefined;
    const normalized = core === 'SKATE_STEERING' || model === 'skateSteering'
      ? { movementCoreModel: 'SKATE_STEERING' as const, movementModel: 'skateSteering' as const }
      : { movementCoreModel: 'DESIRED_HEADING_TRACTION' as const, movementModel: 'desiredHeadingTraction' as const };
    setTuningKey('movementCoreModel', normalized.movementCoreModel);
    setTuningKey('movementModel', normalized.movementModel);
  }

  private onServerMessage(msg: ServerMessage | { type?: string; [key: string]: unknown }) {
    handleServerMessage(this, msg);
  }

  private consumeSnapshot(snapshot: SnapshotMsg) {
    applySnapshot(this, snapshot);
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

    const clamped = Math.max(oldest, Math.min(newest, targetTime));
    return interpolator.sample(clamped, lerpPlayer) ?? interpolator.latest()?.value ?? null;
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

  private clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  private computeMouseAimAngle(_dtSec: number, tuning = getTuning()): number | undefined {
    if (!tuning.aimEnabled || !this.predicted) {
      this.hasAimState = false;
      this.aimDistance01 = 1;
      setAimInputRateLimited(false);
      return undefined;
    }
    const pointer = this.input.activePointer;
    const mouseWorld = this.screenToWorld(pointer.x, pointer.y);
    const deadzone = Math.max(0, tuning.aimDeadzonePx ?? 32);
    const dx = mouseWorld.x - this.predicted.x;
    const dy = mouseWorld.y - this.predicted.y;
    this.lastPointerVector = { x: dx, y: dy };
    const dist = Math.hypot(dx, dy);
    this.aimDistance01 = 1;
    if (dist <= deadzone) {
      setAimInputRateLimited(false);
      return Number.isFinite(this.predicted.aimAngleRaw) ? this.predicted.aimAngleRaw : (Number.isFinite(this.predicted.aimAngle) ? this.predicted.aimAngle : undefined);
    }

    const handedness = tuning.handedness === 'L' ? 'L' : 'R';
    const handPivot = PlayerView.getActiveHandWorldFromPose(
      this.predicted.x,
      this.predicted.y,
      Number.isFinite(this.predicted.baseBodyAngle) ? this.predicted.baseBodyAngle! : this.predicted.angle,
      handedness
    );
    const rawTarget = Math.atan2(mouseWorld.y - handPivot.y, mouseWorld.x - handPivot.x);
    if (!this.hasAimState) {
      this.hasAimState = true;
      this.aimCurrentAngle = rawTarget;
      this.aimTargetAngle = rawTarget;
    }
    this.aimCurrentAngle = rawTarget;
    this.aimTargetAngle = rawTarget;
    this.aimAngleDiff = 0;
    setAimInputRateLimited(false);
    return rawTarget;
  }

  private updateCrosshairAndCursor() {
    updateCrosshairAndCursorOp(this);
  }

  private drawMovementDebugVectors() {
    drawMovementDebugVectorsOp(this);
  }

  private stickTargetScreen(view: PlayerView) {
    const tuning = puckStickTuningStore.get();
    return view.getStickBaseWorld(view.aimRot, tuning.stickOffsetX, tuning.stickOffsetY);
  }

  private updateAndDrawPuck(dtSec: number, remoteTargetServerTime: number) {
    updateAndDrawPuckOp(this, dtSec, remoteTargetServerTime);
  }

  private getPerfStats() {
    return { fps: 0, dtMax: 0 };
  }

  private updateOverlay() {
    updateOverlayOp(this);
  }

  private updateHud(dtSec: number) {
    updateHudOp(this, dtSec);
  }

  cycleMovementModel() {
    const current = getTuning().movementCoreModel === 'SKATE_STEERING' ? 'SKATE_STEERING' : 'DESIRED_HEADING_TRACTION';
    const next = current === 'SKATE_STEERING' ? 'DESIRED_HEADING_TRACTION' : 'SKATE_STEERING';
    setTuningKey('movementCoreModel', next);
    setTuningKey('movementModel', next === 'SKATE_STEERING' ? 'skateSteering' : 'desiredHeadingTraction');
    if (this.allowTuningSync) {
      this.ws.send({
        type: 'debug:setMovementTuning',
        config: {
          movementCoreModel: next,
          movementModel: next === 'SKATE_STEERING' ? 'skateSteering' : 'desiredHeadingTraction'
        }
      });
    } else {
      console.warn('[MOVEMENT_MODEL] server does not allow tuning sync; switched locally only');
    }
    console.log(`[MOVEMENT_MODEL] switched to ${next}`);
  }
  
  update(_time: number, _deltaMs: number) {
    runPondSceneUpdate(this);
  }
}

