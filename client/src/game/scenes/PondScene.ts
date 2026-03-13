import Phaser from 'phaser';
import { DEFAULT_RINK_BOUNDS, type InputMsg, type LocomotionState, type RuntimeEnvironment, type ServerMessage, type StickState } from '@flathockey/shared';
import { WsClient } from '../net/wsClient';
import { Interpolator, lerpPlayer, type LerpPlayer } from '../net/interpolation';
import { type PredictedPlayerState, setAimInputRateLimited } from '../net/prediction';
import { getServerHandshakeMismatch } from '../net/serverCompatibility';
import { resolveExpectedRuntime, resolveWsUrl } from '../net/wsUrl';
import { getTuning } from '../tuning/gameplayConfig';
import { PlayerView } from '../entities/playerView';
import { PLAYER_RIG } from '../entities/playerBodyRig';
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
import {
  HYBRID_CAMERA_CONFIG,
  clampMagnitude,
  computeCameraAlpha,
  computeHybridCameraTarget,
  normalizeOrZero,
  perpendicular,
  resolveHybridCameraTuning,
  resolveResponsiveCameraFraming,
  sampleCameraImpulse,
  softClamp,
  triggerCameraImpulse,
  type CameraImpulse
} from '../camera/hybridCamera';

const REMOTE_INTERP_DELAY_DEFAULT_MS = 120;

export class PondScene extends Phaser.Scene {
  private ws = new WsClient();
  private clientId: string | null = null;
  private roomId: string | null = null;
  private wsConnected = false;
  private protocolMismatchReason: string | null = null;
  private expectedRuntime: RuntimeEnvironment = 'unknown';

  private players = new Map<string, PlayerView>();
  private playerRenderWorldStates = new Map<string, LerpPlayer>();
  private remoteInterpolators = new Map<string, Interpolator<LerpPlayer>>();
  private localBuffer = new Interpolator<LerpPlayer>(256);
  private puckFreeBuffer = new Interpolator<{ x: number; y: number; vx: number; vy: number }>(180);
  private puckRender = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE' as 'FREE' | 'HELD', ownerId: null as string | null };
  private puckSnapshot = { x: 0, y: 0, vx: 0, vy: 0, state: 'FREE' as 'FREE' | 'HELD', ownerId: null as string | null };
  private iceBaseLayer!: Phaser.GameObjects.TileSprite;
  private reflectionLayer!: Phaser.GameObjects.TileSprite;
  private fogLayer!: Phaser.GameObjects.TileSprite;
  private rinkGraphics!: Phaser.GameObjects.Graphics;
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
  private playerRigDebugToggleKey!: Phaser.Input.Keyboard.Key;
  private recorderToggleKey!: Phaser.Input.Keyboard.Key;
  private replayToggleKey!: Phaser.Input.Keyboard.Key;
  private hud!: Phaser.GameObjects.Text;
  private lastHudText = '';
  private hudAcc = 0;
  private crosshairGraphics!: Phaser.GameObjects.Graphics;
  private inputRecorderEnabled = false;
  private replayEnabled = false;
  private playerRigDebugEnabled = false;
  private replayIndex = 0;
  private recordedInputs: Array<{ tMs: number; input: InputMsg }> = [];
  private readonly inputRecordWindowMs = 20_000;
  private localRenderState: LerpPlayer | null = null;
  private cameraWorldX = 0;
  private cameraWorldY = 0;
  private cameraWorldScale = 1;
  private cameraInitialized = false;
  private stopKickImpulse: CameraImpulse = { x: 0, y: 0, timer: 0, duration: 0 };
  private shotPulseImpulse: CameraImpulse = { x: 0, y: 0, timer: 0, duration: 0 };
  private lastCameraLocomotionState: LocomotionState | null = null;
  private lastCameraStickState: StickState | null = null;
  private lastCameraShotCharge = 0;
  private lastCameraAngle: number | null = null;

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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE,F8,F9,F10') as Record<string, Phaser.Input.Keyboard.Key>;
    this.playerRigDebugToggleKey = this.keys.F8;
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
    this.input.mouse?.disableContextMenu();
    if (this.game.canvas) this.game.canvas.tabIndex = 1;

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      this.iceBaseLayer?.destroy();
      this.reflectionLayer?.destroy();
      this.fogLayer?.destroy();
      this.rinkGraphics?.destroy();
      this.puckGraphics?.destroy();
      this.crosshairGraphics?.destroy();
      if (this.game.canvas) this.game.canvas.style.cursor = '';
    });

    let buildStampWsUrl = 'unresolved';
    try {
      const wsUrl = resolveWsUrl();
      const expectedRuntime = resolveExpectedRuntime(wsUrl);
      buildStampWsUrl = wsUrl;
      console.info('[NET_BOOTSTRAP] RESOLVED', {
        ts: new Date().toISOString(),
        pageUrl: window.location.href,
        pathname: window.location.pathname,
        wsUrl,
        expectedRuntime
      });
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
    this.expectedRuntime = resolveExpectedRuntime(wsUrl);
    console.info('[NET_BOOTSTRAP] CONNECT_START', {
      ts: new Date().toISOString(),
      wsUrl,
      expectedRuntime: this.expectedRuntime
    });

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
    this.ensureBackgroundTextures();
    const w = this.scale.width;
    const h = this.scale.height;
    this.iceBaseLayer = this.add.tileSprite(0, 0, w, h, 'ice-base-layer').setOrigin(0).setDepth(-40);
    this.reflectionLayer = this.add.tileSprite(0, 0, w, h, 'ice-reflection-layer').setOrigin(0).setDepth(-39);
    this.fogLayer = this.add.tileSprite(0, 0, w, h, 'ice-fog-layer').setOrigin(0).setDepth(-38);
    this.rinkGraphics = this.add.graphics().setDepth(-20);
    this.refreshBackgroundParallax();
  }

  private ensureBackgroundTextures() {
    if (!this.textures.exists('ice-base-layer')) {
      const g = this.add.graphics();
      g.fillStyle(0x153847, 1);
      g.fillRect(0, 0, 256, 256);
      g.lineStyle(2, 0x1f5368, 0.18);
      for (let i = -64; i <= 320; i += 32) {
        g.lineBetween(i, 0, i + 96, 256);
      }
      g.lineStyle(1, 0xb9deea, 0.08);
      for (let i = 0; i <= 256; i += 32) {
        g.lineBetween(0, i, 256, i + 24);
      }
      g.generateTexture('ice-base-layer', 256, 256);
      g.destroy();
    }

    if (!this.textures.exists('ice-reflection-layer')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0);
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 7; i += 1) {
        const y = 18 + i * 34;
        g.lineStyle(10, 0xd9f3ff, 0.045);
        g.lineBetween(-24, y, 280, y + 18);
        g.lineStyle(4, 0xffffff, 0.03);
        g.lineBetween(-10, y + 8, 266, y + 22);
      }
      g.generateTexture('ice-reflection-layer', 256, 256);
      g.destroy();
    }

    if (!this.textures.exists('ice-fog-layer')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0);
      g.fillRect(0, 0, 256, 256);
      const puffs = [
        [42, 58, 26, 0.03],
        [128, 40, 34, 0.026],
        [204, 88, 24, 0.028],
        [74, 176, 30, 0.022],
        [170, 184, 38, 0.024]
      ] as const;
      for (const [x, y, radius, alpha] of puffs) {
        g.fillStyle(0xeefbff, alpha);
        g.fillCircle(x, y, radius);
      }
      g.generateTexture('ice-fog-layer', 256, 256);
      g.destroy();
    }
  }

  private refreshBackgroundParallax() {
    const w = this.scale.width;
    const h = this.scale.height;
    this.resizeTileLayer(this.iceBaseLayer, w, h);
    this.resizeTileLayer(this.reflectionLayer, w, h);
    this.resizeTileLayer(this.fogLayer, w, h);

    if (this.iceBaseLayer) {
      this.iceBaseLayer.tileScaleX = this.cameraWorldScale;
      this.iceBaseLayer.tileScaleY = this.cameraWorldScale;
      this.iceBaseLayer.tilePositionX = this.cameraWorldX * this.cameraWorldScale * 1.0;
      this.iceBaseLayer.tilePositionY = this.cameraWorldY * this.cameraWorldScale * 1.0;
    }
    if (this.reflectionLayer) {
      this.reflectionLayer.tileScaleX = this.cameraWorldScale;
      this.reflectionLayer.tileScaleY = this.cameraWorldScale;
      this.reflectionLayer.tilePositionX = this.cameraWorldX * this.cameraWorldScale * 0.96;
      this.reflectionLayer.tilePositionY = this.cameraWorldY * this.cameraWorldScale * 0.96;
    }
    if (this.fogLayer) {
      this.fogLayer.tileScaleX = this.cameraWorldScale;
      this.fogLayer.tileScaleY = this.cameraWorldScale;
      this.fogLayer.tilePositionX = this.cameraWorldX * this.cameraWorldScale * 0.92;
      this.fogLayer.tilePositionY = this.cameraWorldY * this.cameraWorldScale * 0.92;
    }

    if (!this.rinkGraphics) {
      return;
    }

    const topLeft = this.worldToScreen(DEFAULT_RINK_BOUNDS.left, DEFAULT_RINK_BOUNDS.top);
    const bottomRight = this.worldToScreen(DEFAULT_RINK_BOUNDS.right, DEFAULT_RINK_BOUNDS.bottom);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    const center = this.worldToScreen(0, 0);

    this.rinkGraphics.clear();
    this.rinkGraphics.fillStyle(0x102f3c, 0.84);
    this.rinkGraphics.fillRoundedRect(topLeft.x, topLeft.y, width, height, 28);
    this.rinkGraphics.lineStyle(3, 0xa7d4e6, 0.42);
    this.rinkGraphics.strokeRoundedRect(topLeft.x, topLeft.y, width, height, 28);
    this.rinkGraphics.lineStyle(2, 0xd8f6ff, 0.13);
    this.rinkGraphics.strokeRoundedRect(topLeft.x + 12, topLeft.y + 12, width - 24, height - 24, 22);
    this.rinkGraphics.lineStyle(2, 0xb8e1ef, 0.16);
    this.rinkGraphics.lineBetween(center.x, topLeft.y + 18, center.x, bottomRight.y - 18);
    this.rinkGraphics.strokeCircle(center.x, center.y, 66);
  }

  private resizeTileLayer(layer: Phaser.GameObjects.TileSprite | undefined, width: number, height: number) {
    if (!layer) return;
    if (layer.width !== width || layer.height !== height) {
      layer.setSize(width, height);
    }
  }

  private ensurePlayerView(id: string) {
    if (this.players.has(id)) return this.players.get(id)!;
    const view = new PlayerView(this);
    view.setDebugDrawEnabled(this.playerRigDebugEnabled);
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
    this.playerRenderWorldStates.clear();
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
    this.cameraWorldX = 0;
    this.cameraWorldY = 0;
    this.cameraWorldScale = 1;
    this.cameraInitialized = false;
    this.stopKickImpulse = { x: 0, y: 0, timer: 0, duration: 0 };
    this.shotPulseImpulse = { x: 0, y: 0, timer: 0, duration: 0 };
    this.lastCameraLocomotionState = null;
    this.lastCameraStickState = null;
    this.lastCameraShotCharge = 0;
    this.lastCameraAngle = null;
    this.refreshBackgroundParallax();
    this.puckGraphics?.clear();
  }

  failProtocolMismatch(reason: string) {
    console.error('[NET] PROTOCOL_MISMATCH', {
      ts: new Date().toISOString(),
      reason
    });
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

  private hasPendingLocalDrop() {
    if (!this.clientId) return false;
    if (this.puckSnapshot.state !== 'HELD' || this.puckSnapshot.ownerId !== this.clientId) return false;
    return this.pendingInputs.some((input) => input.seq > this.ackSeq && input.drop === 1);
  }

  private getVisualPuckOwnerId() {
    if (this.hasPendingLocalDrop()) {
      return null;
    }
    return this.puckSnapshot.ownerId;
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

  private samplePuckWorld(remoteTargetServerTime: number) {
    if (this.puckSnapshot.state === 'FREE') {
      return (
        this.puckFreeBuffer.sample(remoteTargetServerTime, (a: any, b: any, t: number) => ({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          vx: a.vx + (b.vx - a.vx) * t,
          vy: a.vy + (b.vy - a.vy) * t
        })) ??
        this.puckFreeBuffer.latest()?.value ?? {
          x: this.puckSnapshot.x,
          y: this.puckSnapshot.y,
          vx: this.puckSnapshot.vx,
          vy: this.puckSnapshot.vy
        }
      );
    }

    return {
      x: this.puckSnapshot.x,
      y: this.puckSnapshot.y,
      vx: this.puckSnapshot.vx,
      vy: this.puckSnapshot.vy
    };
  }

  private updateHybridCamera(dtSec: number, remoteTargetServerTime: number) {
    const local = this.predicted;
    if (!local) {
      this.refreshBackgroundParallax();
      return;
    }

    const puck = this.samplePuckWorld(remoteTargetServerTime);
    const puckSpeed = Math.hypot(puck.vx, puck.vy);
    const localHasPuck = this.puckSnapshot.ownerId === this.clientId;
    const remoteHasPuck = !!this.puckSnapshot.ownerId && this.puckSnapshot.ownerId !== this.clientId;
    const framing = resolveResponsiveCameraFraming({
      viewportWidth: this.scale.width,
      viewportHeight: this.scale.height,
      playerWorldHeight: this.estimateLocalPlayerWorldHeight(),
      rinkWorldWidth: DEFAULT_RINK_BOUNDS.right - DEFAULT_RINK_BOUNDS.left
    });
    this.cameraWorldScale = framing.cameraScale;
    const tuning = resolveHybridCameraTuning({
      localHasPuck,
      remoteHasPuck,
      puckSpeed,
      spanFactor: framing.spanFactor
    });
    const maxOffsetX = this.scale.width * tuning.maxOffsetViewportRatio;
    const maxOffsetY = this.scale.height * tuning.maxOffsetViewportRatio;
    const playerAnchor = {
      x: local.x,
      y: local.y - framing.anchorBiasYWorld
    };
    const target = computeHybridCameraTarget({
      playerPosition: playerAnchor,
      puckPosition: { x: puck.x, y: puck.y },
      playerVelocity: { x: local.vx, y: local.vy },
      puckInfluence: tuning.puckInfluence,
      lookAhead: tuning.lookAhead,
      maxOffsetX: maxOffsetX / this.cameraWorldScale,
      maxOffsetY: maxOffsetY / this.cameraWorldScale
    });
    const boundedTarget = this.applyCameraBounds(target.x, target.y);
    const polishOffset = this.sampleCameraPolishOffset(local, dtSec);
    const polishedTarget = this.applyCameraHardBounds(
      boundedTarget.x + polishOffset.x / Math.max(0.0001, this.cameraWorldScale),
      boundedTarget.y + polishOffset.y / Math.max(0.0001, this.cameraWorldScale)
    );

    if (!this.cameraInitialized) {
      this.cameraWorldX = polishedTarget.x;
      this.cameraWorldY = polishedTarget.y;
      this.cameraInitialized = true;
    } else {
      const alpha = computeCameraAlpha(dtSec, tuning.smoothing);
      this.cameraWorldX += (polishedTarget.x - this.cameraWorldX) * alpha;
      this.cameraWorldY += (polishedTarget.y - this.cameraWorldY) * alpha;
    }

    const clampedCamera = this.applyCameraHardBounds(this.cameraWorldX, this.cameraWorldY);
    this.cameraWorldX = clampedCamera.x;
    this.cameraWorldY = clampedCamera.y;
    this.refreshBackgroundParallax();
  }

  private estimateLocalPlayerWorldHeight() {
    const playerRadius = Math.max(12, getTuning().playerRadius ?? 18);
    const referenceExtent =
      Math.max(
        PLAYER_RIG.HEAD.forward + PLAYER_RIG.HEAD_RADIUS,
        PLAYER_RIG.CHEST.forward + PLAYER_RIG.TORSO_HEIGHT * 0.5,
        PLAYER_RIG.SHOULDER_L.forward + PLAYER_RIG.SHOULDER_HEIGHT * 0.5
      ) -
      Math.min(
        PLAYER_RIG.HIPS.forward - PLAYER_RIG.LOWER_BODY_HEIGHT * 0.5,
        PLAYER_RIG.TORSO_BASE.forward - PLAYER_RIG.TORSO_HEIGHT * 0.5
      );
    return (referenceExtent * playerRadius) / PLAYER_RIG.REFERENCE_RING_RADIUS;
  }

  private sampleCameraPolishOffset(local: PredictedPlayerState, dtSec: number) {
    this.maybeTriggerStopKick(local);
    this.maybeTriggerShotPulse(local);

    const stopKickOffset = sampleCameraImpulse(this.stopKickImpulse, dtSec);
    const shotPulseOffset = sampleCameraImpulse(this.shotPulseImpulse, dtSec);
    const turnLeanOffset = this.computeTurnLeanOffset(local, dtSec);
    const combined = clampMagnitude(
      {
        x: stopKickOffset.x + shotPulseOffset.x + turnLeanOffset.x,
        y: stopKickOffset.y + shotPulseOffset.y + turnLeanOffset.y
      },
      9
    );

    this.lastCameraLocomotionState = local.locomotionState;
    this.lastCameraStickState = local.stickState ?? null;
    this.lastCameraShotCharge = local.shotCharge ?? 0;
    this.lastCameraAngle = local.angle;
    return combined;
  }

  private maybeTriggerStopKick(local: PredictedPlayerState) {
    const speed = Math.hypot(local.vx, local.vy);
    const enteredStop = local.locomotionState === 'stopping' && this.lastCameraLocomotionState !== 'stopping';
    if (!enteredStop || speed <= 12) {
      return;
    }

    const speedRatio = Math.max(0, Math.min(1, speed / Math.max(1, getTuning().playerMoveSpeed ?? 220)));
    const amplitude =
      HYBRID_CAMERA_CONFIG.stopKick.minPixels +
      (HYBRID_CAMERA_CONFIG.stopKick.maxPixels - HYBRID_CAMERA_CONFIG.stopKick.minPixels) * speedRatio;
    this.stopKickImpulse = triggerCameraImpulse(
      {
        x: -local.vx,
        y: -local.vy
      },
      amplitude,
      HYBRID_CAMERA_CONFIG.stopKick.durationSec
    );
  }

  private maybeTriggerShotPulse(local: PredictedPlayerState) {
    const enteredRelease = local.stickState === 'release' && this.lastCameraStickState === 'charge';
    if (!enteredRelease) {
      return;
    }

    const charge = Math.max(0, Math.min(1, this.lastCameraShotCharge));
    const amplitude =
      HYBRID_CAMERA_CONFIG.shotPulse.minPixels +
      (HYBRID_CAMERA_CONFIG.shotPulse.maxPixels - HYBRID_CAMERA_CONFIG.shotPulse.minPixels) * charge;
    this.shotPulseImpulse = triggerCameraImpulse(
      {
        x: Math.cos(local.aimAngle ?? local.angle),
        y: Math.sin(local.aimAngle ?? local.angle)
      },
      amplitude,
      HYBRID_CAMERA_CONFIG.shotPulse.durationSec
    );
  }

  private computeTurnLeanOffset(local: PredictedPlayerState, dtSec: number) {
    const speed = Math.hypot(local.vx, local.vy);
    if (speed <= 14 || !Number.isFinite(this.lastCameraAngle) || dtSec <= 0) {
      return { x: 0, y: 0 };
    }

    const turnRate = wrapToPi(local.angle - (this.lastCameraAngle as number)) / Math.max(0.0001, dtSec);
    const turnFactor = Math.max(
      0,
      Math.min(1, Math.abs(turnRate) / HYBRID_CAMERA_CONFIG.turnLean.angularVelocityForMax)
    );
    const speedFactor = Math.max(0, Math.min(1, speed / Math.max(1, getTuning().playerMoveSpeed ?? 220)));
    const magnitude = HYBRID_CAMERA_CONFIG.turnLean.maxPixels * turnFactor * speedFactor;
    if (magnitude <= 0.01) {
      return { x: 0, y: 0 };
    }

    const normal = perpendicular(normalizeOrZero({ x: local.vx, y: local.vy }));
    const sign = turnRate >= 0 ? 1 : -1;
    return {
      x: normal.x * magnitude * sign,
      y: normal.y * magnitude * sign
    };
  }

  private applyCameraBounds(targetX: number, targetY: number) {
    const { minX, maxX, minY, maxY, softMarginX, softMarginY } = this.resolveCameraBounds();
    return {
      x: softClamp(targetX, minX, maxX, softMarginX),
      y: softClamp(targetY, minY, maxY, softMarginY)
    };
  }

  private applyCameraHardBounds(targetX: number, targetY: number) {
    const { minX, maxX, minY, maxY } = this.resolveCameraBounds();
    return {
      x: Math.max(minX, Math.min(maxX, targetX)),
      y: Math.max(minY, Math.min(maxY, targetY))
    };
  }

  private resolveCameraBounds() {
    const halfViewportWidth = (this.scale.width * 0.5) / Math.max(0.0001, this.cameraWorldScale);
    const halfViewportHeight = (this.scale.height * 0.5) / Math.max(0.0001, this.cameraWorldScale);
    const minX = DEFAULT_RINK_BOUNDS.left + halfViewportWidth;
    const maxX = DEFAULT_RINK_BOUNDS.right - halfViewportWidth;
    const minY = DEFAULT_RINK_BOUNDS.top + halfViewportHeight;
    const maxY = DEFAULT_RINK_BOUNDS.bottom - halfViewportHeight;

    if (minX >= maxX || minY >= maxY) {
      return {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        softMarginX: 0,
        softMarginY: 0
      };
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      softMarginX: Math.min(halfViewportWidth * 0.18, (maxX - minX) * 0.24),
      softMarginY: Math.min(halfViewportHeight * 0.18, (maxY - minY) * 0.24)
    };
  }

  private worldToScreen(x: number, y: number) {
    return {
      x: (x - this.cameraWorldX) * this.cameraWorldScale + this.scale.width / 2,
      y: (y - this.cameraWorldY) * this.cameraWorldScale + this.scale.height / 2
    };
  }

  private screenToWorld(x: number, y: number) {
    return {
      x: (x - this.scale.width / 2) / Math.max(0.0001, this.cameraWorldScale) + this.cameraWorldX,
      y: (y - this.scale.height / 2) / Math.max(0.0001, this.cameraWorldScale) + this.cameraWorldY
    };
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
}
