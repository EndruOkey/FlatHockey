import Phaser from 'phaser';
import { SIM_HZ, type InputMsg, PlayerStateMsg, ServerMessage, SnapshotMsg, wrapToPi } from '@flathockey/shared';
import { WsClient } from '../net/wsClient';
import { Interpolator, lerpPlayer, type LerpPlayer } from '../net/interpolation';
import { applyPredictedInput, CLIENT_FIXED_DT, type PredictedPlayerState, lastTelemetry, setAimInputRateLimited } from '../net/prediction';
import { getTuning, getTuningApplyCount, usedTuning } from '../debug/movementTuning';
import { NetDebugOverlay } from '../debug/netDebugOverlay';
import { setNetDebugMetrics } from '../debug/netDebugState';
import { setMovementDebugMetrics } from '../debug/devPanelTelemetryState';
import { reconcilePrediction } from '../net/reconciliation';
import { PlayerView } from '../entities/playerView';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';
import { ENV } from '../../config/env';
import { BUILD_VERSION } from '../../config/version';

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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,F3,F9,F10') as Record<string, Phaser.Input.Keyboard.Key>;
    this.debugToggleKey = this.keys.F3;
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

  private applyWelcomeLike(msg: { clientId: string; roomId?: string; room?: string; movementTuning?: unknown }) {
    this.resetPendingInputState(true);
    this.clientId = msg.clientId;
    this.roomId = msg.roomId ?? msg.room ?? this.roomId ?? 'pond-1';
  }

  private onServerMessage(msg: ServerMessage | { type?: string; [key: string]: unknown }) {
    const m = msg as {
      type?: string;
      room?: string;
      reason?: string;
      code?: string;
      message?: string;
      clientId?: string;
      roomId?: string;
      movementTuning?: unknown;
    };

    if (m.type === 'welcome') {
      this.applyWelcomeLike({
        clientId: String(m.clientId ?? ''),
        roomId: typeof m.roomId === 'string' ? m.roomId : undefined,
        room: typeof m.room === 'string' ? m.room : undefined,
        movementTuning: m.movementTuning
      });
      return;
    }

    if (m.type === 'join:ok') {
      const room = typeof m.room === 'string' ? m.room : 'pond-1';
      this.roomId = room;
      return;
    }

    if (m.type === 'join:reject') {
      this.hud.setText(`Offline (join rejected)\n${m.reason ?? 'unknown'}`);
      this.wsConnected = false;
      this.resetPendingInputState();
      return;
    }

    if (m.type === 'error') {
      const reason = typeof m.code === 'string'
        ? `${m.code}: ${m.message ?? 'unknown'}`
        : String(m.reason ?? 'unknown');
      this.hud.setText(`Offline (ws error)\n${reason}`);
      this.wsConnected = false;
      this.resetPendingInputState();
      return;
    }

    if (m.type === 'snapshot') {
      this.consumeSnapshot(m as SnapshotMsg);
    }
  }

  private consumeSnapshot(snapshot: SnapshotMsg) {
    const now = performance.now();
    const serverTimeMs = snapshot.serverTick * SERVER_TICK_MS;
    this.latestServerTick = snapshot.serverTick;
    this.latestSnapshotAtMs = now;
    this.newestSnapshotServerMs = Math.max(this.newestSnapshotServerMs, serverTimeMs);
    this.snapshotReceiveTimes.push(now);
    this.snapshotReceiveTimes = this.snapshotReceiveTimes.filter((t) => t >= now - 1000);
    const observedOffset = now - serverTimeMs;
    if (!this.hasServerClock) {
      this.serverTimeOffsetMs = observedOffset;
      this.hasServerClock = true;
    } else {
      this.serverTimeOffsetMs = this.serverTimeOffsetMs * 0.9 + observedOffset * 0.1;
    }

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
          this.localBuffer.push({ x: p.x, y: p.y, rot: p.angle, aimRot: p.aimAngle, moveRot: p.moveAngle, baseRot: p.baseBodyAngle ?? p.angle }, now);
        } else {
          reconcilePrediction(this.predicted, p, this.ackSeq, this.pendingInputs);
          this.localBuffer.push({
            x: this.predicted.x,
            y: this.predicted.y,
            rot: this.predicted.angle,
            aimRot: this.predicted.aimAngle ?? this.predicted.angle,
            moveRot: this.predicted.moveAngle ?? this.predicted.angle,
            baseRot: this.predicted.baseBodyAngle ?? this.predicted.angle
          }, now);
        }
      } else {
        const lastTick = this.remoteLastSnapshotTick.get(p.id);
        if (typeof lastTick === 'number' && snapshot.serverTick <= lastTick) {
          this.droppedSnapshots += 1;
          continue;
        }
        this.remoteLastSnapshotTick.set(p.id, snapshot.serverTick);
        this.remoteInterpolators.get(p.id)?.push({ x: p.x, y: p.y, rot: p.angle, aimRot: p.aimAngle, moveRot: p.moveAngle, baseRot: p.baseBodyAngle ?? p.angle }, serverTimeMs);
      }
    }

    if (snapshot.puck) {
      this.puckSnapshot = {
        x: snapshot.puck.x,
        y: snapshot.puck.y,
        vx: snapshot.puck.vx,
        vy: snapshot.puck.vy,
        state: snapshot.puck.state,
        ownerId: snapshot.puck.ownerId
      };
      if (snapshot.puck.state === 'FREE') {
        this.puckFreeBuffer.push(
          { x: snapshot.puck.x, y: snapshot.puck.y, vx: snapshot.puck.vx, vy: snapshot.puck.vy },
          serverTimeMs
        );
      }
    }
  }

  private buildInput(): InputMsg {
    const tuning = getTuning();
    const moveX = ((this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0)) as -1 | 0 | 1;
    const moveY = ((this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0)) as -1 | 0 | 1;
    this.lastInputVector = { x: moveX, y: moveY };
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 0.0001) this.lastMoveAngle = Math.atan2(moveY / moveLen, moveX / moveLen);
    const aimAngle = this.computeMouseAimAngle(CLIENT_FIXED_DT, tuning);
    if (typeof aimAngle === 'number' && Number.isFinite(aimAngle)) {
      this.lastAimAngle = aimAngle;
      this.lastDesiredHeading = aimAngle;
    } else {
      this.lastDesiredHeading = this.lastMoveAngle;
    }

    return {
      type: 'input',
      clientId: this.clientId ?? '',
      seq: ++this.seq,
      moveX,
      moveY,
      sprint: this.input.activePointer.rightButtonDown() ? 1 : 0,
      brake: this.keys.SPACE.isDown ? 1 : 0,
      shoot: (this.keys.E.isDown || this.input.activePointer.leftButtonDown()) ? 1 : 0,
      aimAngle,
      aimAngleRaw: aimAngle,
      aimDistance01: this.aimDistance01,
      bodyTurn: 0
    };
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
    const tuning = getTuning();
    const pointer = this.input.activePointer;
    const canvas = this.game.canvas;
    const within = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= this.scale.width && pointer.y <= this.scale.height;
    if (canvas) {
      canvas.style.cursor = (tuning.hideSystemCursor && within) ? 'none' : '';
    }

    this.crosshairGraphics.clear();
    if (!tuning.crosshairEnabled || !within) return;
    const size = Math.max(1, tuning.crosshairSize ?? 16);
    const thick = Math.max(1, tuning.crosshairThickness ?? 2);
    const gap = Math.max(0, tuning.crosshairCenterGap ?? 4);
    const x = pointer.x;
    const y = pointer.y;
    this.crosshairGraphics.lineStyle(thick, 0xe8f5ff, 0.9);
    this.crosshairGraphics.lineBetween(x - size, y, x - gap, y);
    this.crosshairGraphics.lineBetween(x + gap, y, x + size, y);
    this.crosshairGraphics.lineBetween(x, y - size, x, y - gap);
    this.crosshairGraphics.lineBetween(x, y + gap, x, y + size);
    this.crosshairGraphics.fillStyle(0xe8f5ff, 0.85);
    this.crosshairGraphics.fillCircle(x, y, 1.5);
  }

  private drawMovementDebugVectors() {
    const tuning = getTuning();
    this.motionDebugGraphics.clear();
    if (!this.debugEnabled) return;
    if (!this.predicted || !(tuning.drawVectors || tuning.debugDrawVectors || tuning.drawVelComponents || tuning.drawMoveVector || tuning.drawBodyVector || tuning.drawAimVector || tuning.drawAimVectorRaw || tuning.drawAimVectorClamped)) return;
    const p = this.worldToScreen(this.predicted.x, this.predicted.y);
    const speed = Math.hypot(this.predicted.vx, this.predicted.vy);
    const velScale = 0.18;
    const headingLen = 36;
    const desiredLen = 30;
    const moveAngle = Number.isFinite(this.predicted.moveAngle) ? this.predicted.moveAngle! : (Number.isFinite(this.predicted.heading) ? this.predicted.heading! : this.predicted.angle);
    const aimAngle = Number.isFinite(this.predicted.aimAngle) ? this.predicted.aimAngle! : this.lastAimAngle;
    const aimAngleRaw = Number.isFinite(this.predicted.aimAngleRaw) ? this.predicted.aimAngleRaw! : aimAngle;
    const bodyAngle = this.predicted.angle;
    const heading = moveAngle;

    if (tuning.drawMoveVector || tuning.drawVectors || tuning.debugDrawVectors) {
      this.motionDebugGraphics.lineStyle(2, 0x4cc9a8, 0.85);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(moveAngle) * headingLen,
        p.y + Math.sin(moveAngle) * headingLen
      );
    }

    this.motionDebugGraphics.lineStyle(2, 0x67b6ff, 0.85);
    this.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + this.predicted.vx * velScale,
      p.y + this.predicted.vy * velScale
    );

    if (tuning.drawAimVector || tuning.drawVectors || tuning.debugDrawVectors) {
      this.motionDebugGraphics.lineStyle(2, 0xf0d776, 0.9);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(aimAngle) * desiredLen,
        p.y + Math.sin(aimAngle) * desiredLen
      );
    }
    if (tuning.drawBodyVector) {
      this.motionDebugGraphics.lineStyle(2, 0x8ed7ff, 0.9);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(bodyAngle) * desiredLen,
        p.y + Math.sin(bodyAngle) * desiredLen
      );
    }
    if (tuning.drawAimVectorRaw) {
      this.motionDebugGraphics.lineStyle(2, 0xff9f70, 0.9);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(aimAngleRaw) * desiredLen,
        p.y + Math.sin(aimAngleRaw) * desiredLen
      );
    }
    if (tuning.drawAimVectorClamped) {
      this.motionDebugGraphics.lineStyle(2, 0xfee06a, 0.95);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(aimAngle) * (desiredLen + 8),
        p.y + Math.sin(aimAngle) * (desiredLen + 8)
      );
    }

    if (tuning.drawVelComponents) {
      const telemetry = (lastTelemetry || {}) as Record<string, any>;
      const forward = Number(telemetry.velForward ?? 0);
      const side = Number(telemetry.velSide ?? 0);
      const compScale = 0.18;
      this.motionDebugGraphics.lineStyle(2, 0x70f5d0, 0.9);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + Math.cos(heading) * forward * compScale,
        p.y + Math.sin(heading) * forward * compScale
      );
      const rightX = -Math.sin(heading);
      const rightY = Math.cos(heading);
      this.motionDebugGraphics.lineStyle(2, 0xff8ab8, 0.9);
      this.motionDebugGraphics.lineBetween(
        p.x,
        p.y,
        p.x + rightX * side * compScale,
        p.y + rightY * side * compScale
      );
    }

    if (tuning.debugDrawArcPreview) {
      const preview = this.worldToScreen(
        this.predicted.x + this.predicted.vx * 0.2,
        this.predicted.y + this.predicted.vy * 0.2
      );
      this.motionDebugGraphics.fillStyle(0xfff3a0, 0.9);
      this.motionDebugGraphics.fillCircle(preview.x, preview.y, 2.5);
      this.motionDebugGraphics.lineStyle(1, 0xfff3a0, 0.6);
      this.motionDebugGraphics.lineBetween(p.x, p.y, preview.x, preview.y);
    }

    if (tuning.drawAimLine) {
      const pointer = this.input.activePointer;
      this.motionDebugGraphics.lineStyle(1.5, 0xfff67a, 0.8);
      this.motionDebugGraphics.lineBetween(p.x, p.y, pointer.x, pointer.y);
    }

    if (speed < 0.001) {
      this.motionDebugGraphics.fillStyle(0x67b6ff, 0.9);
      this.motionDebugGraphics.fillCircle(p.x, p.y, 1.5);
    }
  }

  private stickTargetScreen(view: PlayerView) {
    const tuning = puckStickTuningStore.get();
    return view.getStickBaseWorld(view.aimRot, tuning.stickOffsetX, tuning.stickOffsetY);
  }

  private updateAndDrawPuck(dtSec: number, remoteTargetServerTime: number) {
    const tuning = puckStickTuningStore.get();
    const puckRadius = tuning.puckRadius;
    const holdSpringK = tuning.holdSpringK;
    const holdDampingC = tuning.holdDampingC;
    const holdMaxError = tuning.holdMaxError;

    if (this.puckSnapshot.state === 'FREE') {
      const sample = this.puckFreeBuffer.sample(remoteTargetServerTime, (a, b, t) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        vx: a.vx + (b.vx - a.vx) * t,
        vy: a.vy + (b.vy - a.vy) * t
      })) ?? this.puckFreeBuffer.latest()?.value ?? this.puckSnapshot;
      const s = this.worldToScreen(sample.x, sample.y);
      this.puckRender.x = s.x;
      this.puckRender.y = s.y;
      this.puckRender.vx = sample.vx;
      this.puckRender.vy = sample.vy;
      this.puckRender.state = 'FREE';
      this.puckRender.ownerId = null;
    } else {
      this.puckRender.state = 'HELD';
      this.puckRender.ownerId = this.puckSnapshot.ownerId;
      const owner = this.puckRender.ownerId ? this.players.get(this.puckRender.ownerId) : null;
      const serverScreen = this.worldToScreen(this.puckSnapshot.x, this.puckSnapshot.y);
      if (owner) {
        const target = this.stickTargetScreen(owner);
        const dx = target.x - this.puckRender.x;
        const dy = target.y - this.puckRender.y;
        this.puckRender.vx += (dx * holdSpringK - this.puckRender.vx * holdDampingC) * dtSec;
        this.puckRender.vy += (dy * holdSpringK - this.puckRender.vy * holdDampingC) * dtSec;
        this.puckRender.x += this.puckRender.vx * dtSec;
        this.puckRender.y += this.puckRender.vy * dtSec;
        const corrDx = serverScreen.x - this.puckRender.x;
        const corrDy = serverScreen.y - this.puckRender.y;
        const corrDist = Math.hypot(corrDx, corrDy);
        if (corrDist > holdMaxError * 1.4) {
          this.puckRender.x = serverScreen.x;
          this.puckRender.y = serverScreen.y;
          this.puckRender.vx = this.puckSnapshot.vx;
          this.puckRender.vy = this.puckSnapshot.vy;
        } else {
          this.puckRender.x += corrDx * 0.12;
          this.puckRender.y += corrDy * 0.12;
        }
      } else {
        this.puckRender.x = serverScreen.x;
        this.puckRender.y = serverScreen.y;
      }
    }

    this.puckGraphics.clear();
    this.puckGraphics.fillStyle(0x111111, 1);
    this.puckGraphics.fillCircle(this.puckRender.x, this.puckRender.y, puckRadius);
    this.puckGraphics.lineStyle(1, 0xffffff, 0.25);
    this.puckGraphics.strokeCircle(this.puckRender.x, this.puckRender.y, puckRadius);

    if (tuning.drawPuckVelocity) {
      this.puckGraphics.lineStyle(2, 0xffe279, 0.8);
      this.puckGraphics.lineBetween(
        this.puckRender.x,
        this.puckRender.y,
        this.puckRender.x + this.puckRender.vx * 0.08,
        this.puckRender.y + this.puckRender.vy * 0.08
      );
    }

    if (this.debugEnabled && (tuning.drawStickTarget || tuning.drawStickHitbox || tuning.drawPickupRadius || tuning.drawMagnetRadius)) {
      for (const view of this.players.values()) {
        const t = this.stickTargetScreen(view);
        if (tuning.drawStickTarget) {
          this.puckGraphics.fillStyle(0x59d1ff, 0.8);
          this.puckGraphics.fillCircle(t.x, t.y, 3);
        }
        if (tuning.drawStickHitbox) {
          this.puckGraphics.lineStyle(1, 0x59d1ff, 0.5);
          this.puckGraphics.strokeCircle(t.x, t.y, tuning.stickTipRadius);
        }
      }
    }

    if (this.debugEnabled && tuning.drawPickupRadius && this.clientId) {
      const local = this.players.get(this.clientId);
      if (local) {
        const t = this.stickTargetScreen(local);
        this.puckGraphics.lineStyle(1, 0x8cffb7, 0.45);
        this.puckGraphics.strokeCircle(t.x, t.y, tuning.pickupRadius);
      }
    }
    if (this.debugEnabled && tuning.drawMagnetRadius && this.clientId) {
      const local = this.players.get(this.clientId);
      if (local) {
        const t = this.stickTargetScreen(local);
        this.puckGraphics.lineStyle(1, 0x67a5ff, 0.35);
        this.puckGraphics.strokeCircle(t.x, t.y, tuning.magnetRadius);
      }
    }
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
    this.debugOverlay.setVisible(this.debugEnabled);
    const perf = this.getPerfStats();
    const now = performance.now();
    const applyNow = getTuningApplyCount();
    const applyDtSec = Math.max(0.001, (now - this.tuningApplySampleLastTs) / 1000);
    const applyDelta = Math.max(0, applyNow - this.tuningApplySampleLastCount);
    this.tuningApplyCountPerSec = applyDelta / applyDtSec;
    this.tuningApplySampleLastTs = now;
    this.tuningApplySampleLastCount = applyNow;
    const rttMs = this.ws.getRttMs();
    const latestSnapshotAge = this.latestSnapshotAtMs > 0 ? now - this.latestSnapshotAtMs : -1;
    const snapshotRate = this.snapshotReceiveTimes.length;
    let remoteBufferLenAvg = 0;
    let remoteBufferCount = 0;
    for (const [id, interp] of this.remoteInterpolators.entries()) {
      if (this.clientId && id === this.clientId) continue;
      remoteBufferLenAvg += interp.size();
      remoteBufferCount += 1;
    }
    remoteBufferLenAvg = remoteBufferCount > 0 ? remoteBufferLenAvg / remoteBufferCount : 0;

    const tuning = getTuning();
    const puckStick = puckStickTuningStore.get();
    const used = usedTuning;
    const telemetry = (lastTelemetry || {}) as Record<string, any>;
    const localView = this.clientId ? this.players.get(this.clientId) : null;

    const puckStateLine = puckStick.drawPuckState ? `puckState=${this.puckSnapshot.state} owner=${this.puckSnapshot.ownerId ?? '-'}` : null;
    const stickTargetLine = (() => {
      if (!puckStick.drawStickTarget || !this.clientId) return null;
      const local = this.players.get(this.clientId);
      if (!local) return null;
      const t = this.stickTargetScreen(local);
      const wx = t.x - this.scale.width / 2;
      const wy = t.y - this.scale.height / 2;
      return `stickTarget=(${wx.toFixed(1)}, ${wy.toFixed(1)})`;
    })();
    const pickupRadiusLine = puckStick.drawPickupRadius ? `pickupRadius=${puckStick.pickupRadius.toFixed(1)}` : null;
    const showTarget = Boolean(tuning.showTargetAngle ?? tuning.drawTargetAngle);
    const showHeading = Boolean(tuning.showHeading ?? false);
    const headingLine = showHeading && this.predicted
      ? `bodyWorld=${(this.predicted.angle * 180 / Math.PI).toFixed(1)} move=${((this.predicted.moveAngle ?? this.predicted.heading ?? 0) * 180 / Math.PI).toFixed(1)} aim=${((this.predicted.aimAngle ?? 0) * 180 / Math.PI).toFixed(1)}`
      : null;
    const targetAngleLine = showTarget
      ? `aim cur=${(this.aimCurrentAngle * 180 / Math.PI).toFixed(1)} target=${(this.aimTargetAngle * 180 / Math.PI).toFixed(1)} diff=${(this.aimAngleDiff * 180 / Math.PI).toFixed(1)}`
      : null;
    const vectorsLine = (tuning.drawVectors || tuning.debugDrawVectors)
      ? `vectors move=${Number(telemetry.moveAngle ?? this.lastMoveAngle).toFixed(2)} body=${Number(this.predicted?.angle ?? 0).toFixed(2)} aimRaw=${Number(telemetry.aimAngleRaw ?? this.lastAimAngle).toFixed(2)} aim=${Number(telemetry.aimAngle ?? this.lastAimAngle).toFixed(2)}`
      : null;
    const anglesLine = tuning.showAngles
      ? `angles desiredMove=${(Number(telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle) * 180 / Math.PI).toFixed(1)} actualMove=${(Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle) * 180 / Math.PI).toFixed(1)} baseBody=${(Number(telemetry.baseBodyAngle ?? this.predicted?.baseBodyAngle ?? this.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} body=${(Number(this.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} aimRaw=${(Number(telemetry.aimAngleRaw ?? this.lastAimAngle) * 180 / Math.PI).toFixed(1)} aim=${(Number(telemetry.aimAngle ?? this.lastAimAngle) * 180 / Math.PI).toFixed(1)}`
      : null;
    const angleDiffLine = tuning.showAngleDiff
      ? `angleDiff raw=${(Number(telemetry.aimDiffRaw ?? 0) * 180 / Math.PI).toFixed(1)} clamped=${(Number(telemetry.aimDiffClamped ?? 0) * 180 / Math.PI).toFixed(1)} velVsDesired=${Number(telemetry.velocityDesiredDeltaDeg ?? 0).toFixed(1)}`
      : null;
    const stickRuntimeLine = tuning.showAngleDiff
      ? `stick target=${(Number(telemetry.targetAimAngle ?? telemetry.aimAngle ?? this.lastAimAngle) * 180 / Math.PI).toFixed(1)} simActual=${(Number(telemetry.aimAngle ?? this.lastAimAngle) * 180 / Math.PI).toFixed(1)} renderActual=${(Number(localView?.getStickRotation() ?? (telemetry.aimAngle ?? this.lastAimAngle)) * 180 / Math.PI).toFixed(1)} deltaDeg=${Number(telemetry.stickDeltaDeg ?? 0).toFixed(1)} angVelDeg=${Number(telemetry.stickAngVelDeg ?? 0).toFixed(1)} mode=${String(telemetry.stickMode ?? 'APPROACH')}`
      : null;
    const bodyYawLine = tuning.showAngleDiff
      ? `bodyYaw base=${(Number(telemetry.baseBodyAngle ?? this.predicted?.baseBodyAngle ?? this.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} offset=${(Number(telemetry.bodyYawOffset ?? this.predicted?.bodyYawOffset ?? 0) * 180 / Math.PI).toFixed(1)} final=${(Number(this.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)}`
      : null;
    const stickLimitLine = tuning.showAngleDiff
      ? `stick angVelClamped=${telemetry.stickAngVelClamped ? 'on' : 'off'} targetSlewActive=${telemetry.targetSlewActive ? 'on' : 'off'} aimInputRateLimited=${telemetry.aimInputRateLimited ? 'on' : 'off'} rotSpace=${PlayerView.getStickRotationSpace()} spriteOffsetDeg=${PlayerView.getStickSpriteForwardOffsetDeg().toFixed(1)}`
      : null;
    const snapLine = tuning.showSnapFactor ? `snapFactor=${Number(telemetry.snapFactor ?? 0).toFixed(2)}` : null;
    const brakeAssistLine = tuning.showBrakeActive ? `brakeAssist=${telemetry.brakeAssistActive ? 'on' : 'off'}` : null;
    const startModeLine = tuning.showStartMode
      ? `startMode=${telemetry.startModeActive ? 'on' : 'off'} brake=${telemetry.brakeApplied > 0 ? 'on' : 'off'} charge=${telemetry.chargeActive ? 'on' : 'off'} turnRateApplied=${Number(telemetry.turnRateAppliedDeg ?? 0).toFixed(1)} fwd=${Number(telemetry.velForward ?? 0).toFixed(1)} side=${Number(telemetry.velSide ?? 0).toFixed(1)}`
      : null;
    const v4StabilityLine = tuning.showAngleDiff
      ? `phase=${String(telemetry.movementPhase ?? 'GLIDE')} lowSteerOff=${telemetry.lowSpeedSteeringDisabled ? 'on' : 'off'} lowStart=${telemetry.lowSpeedStartupActive ? 'on' : 'off'} latch=${telemetry.startupLatchActive ? 'on' : 'off'} latchIgn=${telemetry.latchedInputIgnored ? 'on' : 'off'} latchRel=${(Number(telemetry.startupReleaseTimer ?? 0) * 1000).toFixed(0)}ms travelLock=${telemetry.travelDirLocked ? 'on' : 'off'} minSteer=${Number(telemetry.minSteerSpeed ?? 0).toFixed(1)} startCommit=${telemetry.startCommitActive ? 'on' : 'off'} startTimer=${(Number(telemetry.startCommitTimer ?? 0) * 1000).toFixed(0)}ms startDir=(${Number(telemetry.startDirX ?? 0).toFixed(2)}, ${Number(telemetry.startDirY ?? 0).toFixed(2)}) effStart=(${Number(telemetry.effectiveStartDirX ?? 0).toFixed(2)}, ${Number(telemetry.effectiveStartDirY ?? 0).toFixed(2)}) carveLock=${(Number(telemetry.carveLockTimer ?? 0) * 1000).toFixed(0)}ms carveSide=${Number(telemetry.carveSide ?? 0)} signed=${(Number(telemetry.signedInputVsVelocityAngle ?? 0) * 180 / Math.PI).toFixed(1)}deg commit=${(Number(telemetry.commitTimer ?? 0) * 1000).toFixed(0)}ms hold=${(Number(telemetry.oppositeHoldTimer ?? 0) * 1000).toFixed(0)}ms steerDir=(${Number(telemetry.steerDirX ?? 0).toFixed(2)}, ${Number(telemetry.steerDirY ?? 0).toFixed(2)})`
      : null;

    if (this.debugEnabled) {
      this.debugOverlay.setText([
        'DEBUG [F3]',
        `RTT=${rttMs >= 0 ? rttMs.toFixed(1) : '-'}ms snapRate=${snapshotRate}/s interpDelay=${this.remoteInterpDelayMs.toFixed(0)}ms`,
        `snapshotAgeMs=${latestSnapshotAge.toFixed(1)} bufferLenAvg=${remoteBufferLenAvg.toFixed(1)} droppedSnapshots=${this.droppedSnapshots}`,
        `FPS=${perf.fps.toFixed(1)} dtMax1s=${perf.dtMax.toFixed(2)}ms`,
        `devApplyCountPerSec=${this.tuningApplyCountPerSec.toFixed(1)}`,
        `seq=${this.seq} ack=${this.ackSeq} pending=${this.pendingInputs.length}`,
        `recorder=${this.replayEnabled ? 'replaying' : this.inputRecorderEnabled ? 'recording' : 'idle'} frames=${this.recordedInputs.length}`,
        `simStepsThisFrame=${this.simStepsThisFrame} capHitCount=${this.simCapHitCount}`,
        `hitchCount=${this.hitchCount} lastHitchMs=${this.lastHitchMs.toFixed(1)} needsResync=${this.needsResync}`,
        `resyncCount=${this.resyncCount} lastResyncReason=${this.lastResyncReason ?? '-'} resyncAtMs=${this.lastResyncAtMs.toFixed(1)}`,
        ...(puckStateLine ? [puckStateLine] : []),
        ...(stickTargetLine ? [stickTargetLine] : []),
        ...(pickupRadiusLine ? [pickupRadiusLine] : []),
        ...(headingLine ? [headingLine] : []),
        ...(targetAngleLine ? [targetAngleLine] : []),
        ...(vectorsLine ? [vectorsLine] : []),
        ...(anglesLine ? [anglesLine] : []),
        ...(angleDiffLine ? [angleDiffLine] : []),
        ...(stickRuntimeLine ? [stickRuntimeLine] : []),
        ...(bodyYawLine ? [bodyYawLine] : []),
        ...(stickLimitLine ? [stickLimitLine] : []),
        ...(v4StabilityLine ? [v4StabilityLine] : []),
        ...(snapLine ? [snapLine] : []),
        ...(brakeAssistLine ? [brakeAssistLine] : []),
        ...(startModeLine ? [startModeLine] : []),
        `speed=${this.debugCurrentSpeed.toFixed(1)} drift=${(telemetry.driftAngle||0).toFixed(2)} speedRatio=${(this.debugSpeedRatio*100).toFixed(0)}%`,
        `tuningVersion=${tuning.__version ?? 0} accel=${tuning.accel} maxSpeed=${tuning.maxSpeed} dragMove=${tuning.dragMove} dragIdle=${tuning.dragIdle} lateralGrip=${tuning.lateralGrip}`,
        `USED speed=${(telemetry.currentSpeed ?? '-')} lat=${(telemetry.lateralSpeed ?? '-')} fwd=${(telemetry.forwardSpeed ?? '-')}`
      ].join('\n'));
    }

    setNetDebugMetrics({
      pingMs: rttMs,
      serverTick: this.latestServerTick,
      snapshotRate,
      players: this.players.size,
      snapshotDelayMs: Math.max(0, latestSnapshotAge),
      inputDelayMs: this.pendingInputs.length * CLIENT_FIXED_DT * 1000,
      inputRate: this.inputsSentTimesMs.length,
      pendingInputs: this.pendingInputs.length,
      clientFps: perf.fps
    });

    const velX = this.predicted?.vx ?? 0;
    const velY = this.predicted?.vy ?? 0;
    const currentSpeed = Math.hypot(velX, velY);
    const velocityAngle = currentSpeed > 0.001
      ? Math.atan2(velY, velX)
      : Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle);
    const localAimRot = localView?.getAimRotation() ?? (this.predicted?.aimAngle ?? this.lastAimAngle);
    const localStickRot = localView?.getStickRotation() ?? localAimRot;
    const localStickWorldAngle = localView?.getStickWorldAngle() ?? localAimRot;
    setMovementDebugMetrics({
      currentSpeed,
      velocityX: velX,
      velocityY: velY,
      velocityVector: `(${velX.toFixed(2)}, ${velY.toFixed(2)})`,
      turnRate: this.lastTurnRateDeg,
      turnRateAppliedDeg: Number(telemetry.turnRateAppliedDeg ?? 0),
      inputVector: `(${this.lastInputVector.x}, ${this.lastInputVector.y})`,
      rawInputVector: `(${Number(telemetry.rawInputX ?? this.lastInputVector.x).toFixed(2)}, ${Number(telemetry.rawInputY ?? this.lastInputVector.y).toFixed(2)})`,
      filteredInputVector: `(${Number(telemetry.filteredInputX ?? telemetry.desiredInputX ?? 0).toFixed(2)}, ${Number(telemetry.filteredInputY ?? telemetry.desiredInputY ?? 0).toFixed(2)})`,
      desiredInputVector: `(${Number(telemetry.desiredInputX ?? 0).toFixed(2)}, ${Number(telemetry.desiredInputY ?? 0).toFixed(2)})`,
      pointerVector: `(${this.lastPointerVector.x.toFixed(1)}, ${this.lastPointerVector.y.toFixed(1)})`,
      aimAngle: localAimRot,
      bodyWorldAngle: Number(this.predicted?.angle ?? 0),
      targetAimAngle: Number(telemetry.targetAimAngle ?? this.aimTargetAngle ?? localAimRot),
      stickRotation: localStickRot,
      actualStickAngle: localStickWorldAngle,
      stickAngularSpeed: Number(telemetry.stickAngVelDeg ?? 0) * Math.PI / 180,
      angleDelta: Number(telemetry.stickDeltaDeg ?? 0) * Math.PI / 180,
      stickAngleDeltaToTarget: wrapToPi(Number(telemetry.targetAimAngle ?? this.aimTargetAngle ?? localAimRot) - localStickWorldAngle),
      stickSpriteForwardOffsetDeg: PlayerView.getStickSpriteForwardOffsetDeg(),
      stickRotationSpace: PlayerView.getStickRotationSpace(),
      desiredMoveAngle: Number(telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle),
      turnIntentAngle: Number(telemetry.turnIntentAngle ?? telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle),
      actualMoveAngle: Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? this.lastMoveAngle),
      velocityAngle,
      forwardVelocity: Number(telemetry.velForward ?? 0),
      lateralVelocity: Number(telemetry.velSide ?? 0),
      velocityDesiredDeltaDeg: Number(telemetry.velocityDesiredDeltaDeg ?? 0),
      turnResistance: Number(telemetry.turnResistance ?? 0),
      redirectAccelScale: Number(telemetry.redirectAccelScale ?? 1),
      antiFlipActive: Boolean(telemetry.antiFlipActive ?? false),
      appliedForwardForce: Number(telemetry.appliedForwardForce ?? 0),
      appliedLateralForce: Number(telemetry.appliedLateralForce ?? 0),
      edgeFactor: Number(telemetry.edgeFactor ?? 0),
      commitTimer: Number(telemetry.commitTimer ?? 0),
      oppositeHoldTimer: Number(telemetry.oppositeHoldTimer ?? 0),
      steerDir: `(${Number(telemetry.steerDirX ?? 0).toFixed(2)}, ${Number(telemetry.steerDirY ?? 0).toFixed(2)})`,
      movementPhase: String(telemetry.movementPhase ?? 'GLIDE'),
      carveLockTimer: Number(telemetry.carveLockTimer ?? 0),
      carveSide: Number(telemetry.carveSide ?? 0),
      signedInputVsVelocityAngle: Number(telemetry.signedInputVsVelocityAngle ?? 0),
      minSteerSpeed: Number(telemetry.minSteerSpeed ?? 0),
      lowSpeedSteeringDisabled: Boolean(telemetry.lowSpeedSteeringDisabled ?? false),
      lowSpeedStartupActive: Boolean(telemetry.lowSpeedStartupActive ?? false),
      travelDirLocked: Boolean(telemetry.travelDirLocked ?? false),
      startupLatchActive: Boolean(telemetry.startupLatchActive ?? false),
      latchedInputIgnored: Boolean(telemetry.latchedInputIgnored ?? false),
      startupReleaseTimer: Number(telemetry.startupReleaseTimer ?? 0),
      startCommitActive: Boolean(telemetry.startCommitActive ?? false),
      startCommitTimer: Number(telemetry.startCommitTimer ?? 0),
      startDir: `(${Number(telemetry.startDirX ?? 0).toFixed(2)}, ${Number(telemetry.startDirY ?? 0).toFixed(2)})`,
      effectiveStartDir: `(${Number(telemetry.effectiveStartDirX ?? 0).toFixed(2)}, ${Number(telemetry.effectiveStartDirY ?? 0).toFixed(2)})`,
      brakeActive: Number(telemetry.brakeApplied ?? 0) > 0.0001,
      chargeActive: Boolean(telemetry.chargeActive ?? this.predicted?.chargeActive ?? false),
      baseBodyAngle: Number(this.predicted?.baseBodyAngle ?? telemetry.baseBodyAngle ?? this.predicted?.angle ?? 0),
      bodyYawOffset: Number(this.predicted?.bodyYawOffset ?? telemetry.bodyYawOffset ?? 0),
      currentBodyAngle: Number(this.predicted?.angle ?? 0),
      bodyTurnInput: Number(telemetry.bodyTurnInput ?? 0),
      activeBodyModel: String(telemetry.activeBodyModel ?? 'B'),
      recorderState: this.replayEnabled ? 'replaying' : this.inputRecorderEnabled ? 'recording' : 'idle',
      recordedFrames: this.recordedInputs.length
    });
  }

  private updateHud(dtSec: number) {
    if (!this.wsConnected) return;

    this.hudAcc += dtSec;
    if (this.hudAcc < 0.25) return;
    this.hudAcc = 0;

    const next = [
      `Room: ${this.roomId ?? '-'}`,
      `Client: ${this.clientId ?? '-'}`,
      `Build: ${BUILD_VERSION || 'dev-local'}`,
      `Seq/Ack: ${this.seq}/${this.ackSeq}`,
      `Pending: ${this.pendingInputs.length}`,
      'WASD move | SPACE brake | RMB charge/crosscheck | E/LMB shoot'
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
      for (const view of this.players.values()) view.setDebugDrawEnabled(this.debugEnabled);
    }

    if (Phaser.Input.Keyboard.JustDown(this.recorderToggleKey)) {
      if (this.inputRecorderEnabled) {
        this.inputRecorderEnabled = false;
      } else {
        this.stopReplay();
        this.recordedInputs = [];
        this.inputRecorderEnabled = true;
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.replayToggleKey)) {
      if (this.replayEnabled) this.stopReplay();
      else this.startReplay();
    }

    if (this.needsResync) {
      // one-shot clock reset to avoid dt spike after blur/visibility changes
      this.needsResync = false;

      const t = performance.now();
      this.lastFrameTimeMs = t;
      this.renderClockMs = t;
      this.simAccumulatorMs = 0;

      this.input.keyboard?.resetKeys();

      // keep remote buffers on server-time axis; do not rewrite with local-time timestamps
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

      if (this.clientId && this.predicted && this.wsConnected) {
        let input = this.nextReplayInput();
        if (!input) input = this.buildInput();

        this.pendingInputs.push(input);
        if (this.pendingInputs.length > 240) {
          this.pendingInputs.splice(0, this.pendingInputs.length - 240);
        }
        this.recordInputSample(input, simStepTime);

        const telemetry = applyPredictedInput(this.predicted, input, CLIENT_FIXED_DT) as unknown as Record<string, any>;
        if (telemetry) {
          this.debugCurrentSpeed = telemetry.currentSpeed ?? this.debugCurrentSpeed;
          // map driftAngle to steeringStrength for legacy display
          this.debugSteeringStrength = telemetry.driftAngle ?? this.debugSteeringStrength;
          this.debugSpeedRatio = telemetry.speedRatio ?? this.debugSpeedRatio;
        }
        if (Number.isFinite(this.predicted.angle)) {
          const diff = wrapToPi(this.predicted.angle - this.lastPredictedAngle);
          this.lastTurnRateDeg = (diff / CLIENT_FIXED_DT) * 180 / Math.PI;
          this.lastPredictedAngle = this.predicted.angle;
        }
        // push the predicted state using the per-step timestamp so the
        // interpolator sees properly spaced samples
        this.localBuffer.push({
          x: this.predicted.x,
          y: this.predicted.y,
          rot: this.predicted.angle,
          aimRot: this.predicted.aimAngle ?? this.predicted.angle,
          moveRot: this.predicted.moveAngle ?? this.predicted.angle,
          baseRot: this.predicted.baseBodyAngle ?? this.predicted.angle
        }, simStepTime);
        this.ws.send(input);
        this.inputsSentTimesMs.push(simStepTime);
        const cutoff = simStepTime - 1000;
        this.inputsSentTimesMs = this.inputsSentTimesMs.filter((t) => t >= cutoff);
      }
    }
    this.simStepsThisFrame = steps;

    if (this.simAccumulatorMs >= FIXED_STEP_MS) {
      this.simCapHitCount += 1;
      this.simAccumulatorMs = Math.min(this.simAccumulatorMs, FIXED_STEP_MS);
    }

    const remoteTargetServerTime = this.estimateServerNowMs(now) - this.remoteInterpDelayMs;
    const tuning = getTuning();
    for (const [id, view] of this.players.entries()) {
      let state: LerpPlayer | null = null;
      if (this.clientId && id === this.clientId) {
        // Render local player from latest predicted state to keep mouse aim/stick responsive.
        state = this.localBuffer.latest()?.value ?? null;
        if (!state && this.predicted) {
          state = {
            x: this.predicted.x,
            y: this.predicted.y,
            rot: this.predicted.angle,
            aimRot: this.predicted.aimAngle ?? this.predicted.angle,
            moveRot: this.predicted.moveAngle ?? this.predicted.angle,
            baseRot: this.predicted.baseBodyAngle ?? this.predicted.angle
          };
        }
        if (state) {
          if (!this.localRenderState) {
            this.localRenderState = { ...state };
          } else {
            // Smooth only render-space pose to avoid visible 60 Hz stepping on high refresh displays.
            const tauMs = 24;
            const alpha = 1 - Math.exp(-Math.max(0, clampedDtMs) / Math.max(1, tauMs));
            this.localRenderState.x += (state.x - this.localRenderState.x) * alpha;
            this.localRenderState.y += (state.y - this.localRenderState.y) * alpha;
            this.localRenderState.rot = this.lerpAngle(this.localRenderState.rot, state.rot, alpha);
            this.localRenderState.aimRot = this.lerpAngle(this.localRenderState.aimRot ?? state.aimRot ?? state.rot, state.aimRot ?? state.rot, alpha);
            this.localRenderState.moveRot = this.lerpAngle(this.localRenderState.moveRot ?? state.moveRot ?? state.rot, state.moveRot ?? state.rot, alpha);
            this.localRenderState.baseRot = this.lerpAngle(this.localRenderState.baseRot ?? state.baseRot ?? state.rot, state.baseRot ?? state.rot, alpha);
          }
          state = this.localRenderState;
        }
      } else {
        const interp = this.remoteInterpolators.get(id);
        if (interp) state = this.sampleInterpolated(interp, remoteTargetServerTime);
      }

      if (!state) continue;
      const s = this.worldToScreen(state.x, state.y);
      view.setState(s.x, s.y, state.rot, state.aimRot ?? state.rot, state.moveRot ?? state.rot, state.baseRot ?? state.rot);
      view.setVisualLeanConfig({
        enabled: Boolean(tuning.visualLeanEnabled ?? true),
        maxPx: Number(tuning.visualLeanMaxPx ?? 6),
        tauMs: Number(tuning.visualLeanTauMs ?? 120),
        dampingRatio: Number(tuning.visualLeanDampingRatio ?? 1.0),
        maxAngleDeg: Number(tuning.visualLeanMaxAngleDeg ?? 60)
      });
      if (this.clientId && id === this.clientId) {
        const handedness = tuning.handedness === 'L' ? 'L' : 'R';
        view.setHandedness(handedness);
      } else {
        view.setHandedness('R');
      }
      view.setDebugDrawEnabled(this.debugEnabled);
      view.draw(clampedDtMs / 1000);
    }
    this.updateAndDrawPuck(clampedDtMs / 1000, remoteTargetServerTime);
    this.drawMovementDebugVectors();
    this.updateCrosshairAndCursor();

    this.perfSamples.push({ t: this.renderClockMs, dtMs: frameDtMs });
    this.updateOverlay();
    this.netDebugOverlay?.update();
    this.updateHud(clampedDtMs / 1000);
  }
}
