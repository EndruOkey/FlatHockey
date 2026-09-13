import { GAMEPLAY_DEFAULTS, getPlayerMovementDebugState, resolvePlayerMovementConfig, stepPlayerMovement, type InputMsg, type ServerMessage, type SnapshotMsg } from '@flathockey/shared';
import { WebSocket } from 'ws';
import type { GameplayConfig } from '@flathockey/shared/tuning/gameplayConfig.types';
import { createInitialPuckState, ensureTrainingDummy, resolveCrosscheckConfig, stepRoomGameplay } from './roomSystems';
import { type BodyCollisionDebugState, type BufferedInput, type PlayerState, type RoomPuckState, ZERO_INPUT } from './room.types';

const MOVEMENT_DEBUG_ENABLED = process.env.FLATHOCKEY_DEBUG_MOVEMENT === '1';
const MOVEMENT_DEBUG_EVERY_TICKS = resolveMovementDebugEveryTicks();

export class Room {
  readonly id: string;
  readonly players = new Map<string, PlayerState>();
  readonly sockets = new Map<string, WebSocket>();
  readonly puck: RoomPuckState = createInitialPuckState(GAMEPLAY_DEFAULTS.puckRadius ?? 8);
  readonly pendingServerMessages: ServerMessage[] = [];
  serverTick = 0;
  gameplayConfig: Partial<GameplayConfig> = {};

  constructor(id: string) {
    this.id = id;
  }

  setGameplayConfig(patch: Partial<GameplayConfig>) {
    if (!patch || typeof patch !== 'object') return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      (this.gameplayConfig as any)[k] = v;
    }
  }

  addClient(clientId: string, ws: WebSocket, name = 'Player') {
    const offset = this.players.size * 64;
    this.players.set(clientId, {
      id: clientId,
      name,
      handedness: 'right',
      x: -220 + offset,
      y: -120 + offset * 0.35,
      vx: 0,
      vy: 0,
      angle: 0,
      travelHeading: 0,
      steeringHeading: 0,
      inputHeading: 0,
      intentBoostTimer: 0,
      lastIntentAngle: null,
      aimAngle: 0,
      desiredHeading: 0,
      locomotionState: 'idle',
      stopTimerSec: 0,
      stopRecoveryTimerSec: 0,
      stopBlend: 0,
      stopSide: 0,
      stopTravelHeading: 0,
      prevStopInput: 0,
      angularVelocity: 0,
      lastProcessedSeq: 0,
      lastInputState: { ...ZERO_INPUT },
      inputBuffer: [],
      inputGapTicks: 0,
      bodyCollisionStaggerTimerSec: 0,
      bodyCollisionDebug: null,
      hasPuck: false,
      crosscheckPhase: 'idle',
      crosscheckTimerSec: 0,
      crosscheckConsumed: false,
      crosscheckResult: 'idle',
      crosscheckImpactTimerSec: 0,
      crosscheckImpactSerial: 0,
      crosscheckImpactContactX: 0,
      crosscheckImpactContactY: 0,
      crosscheckImpactDirX: 0,
      crosscheckImpactDirY: 0,
      crosscheckImpactBarDirX: 0,
      crosscheckImpactBarDirY: 0,
      crosscheckImpactMagnitude: 0,
      crosscheckImpactStripped: false,
      crosscheckImpactSeparated: false,
      crosscheckImpactTargetId: null,
      crosscheckImpactTargetIsDummy: false,
      puckPickupLockTimerSec: 0,
      shotChargeTimerSec: 0,
      shotChargeStartRelativeAngle: null,
      prevShootInput: 0,
      prevPassInput: 0,
      prevDropInput: 0,
      dummyResetTimerSec: 0
    });
    this.sockets.set(clientId, ws);
    ensureTrainingDummy(this);
  }

  removeClient(clientId: string) {
    this.players.delete(clientId);
    this.sockets.delete(clientId);
    if (![...this.players.values()].some((player) => !player.isTrainingDummy)) {
      for (const [id, player] of this.players.entries()) {
        if (player.isTrainingDummy) this.players.delete(id);
      }
      this.puck.ownerId = null;
    }
  }

  enqueueInput(clientId: string, input: InputMsg) {
    try {
      const player = this.players.get(clientId);
      if (!player) return;
      if (input.clientId !== clientId) return;
      if (input.seq <= player.lastProcessedSeq) return;

      const buffered: BufferedInput = {
        seq: input.seq,
        state: {
          moveX: input.moveX ?? 0,
          moveY: input.moveY ?? 0,
          aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : player.aimAngle,
          shoot: input.shoot ? 1 : 0,
          pass: input.pass ? 1 : 0,
          drop: input.drop ? 1 : 0,
          stop: input.stop ? 1 : 0
        }
      };

      player.inputBuffer.push(buffered);
      player.inputBuffer.sort((a, b) => a.seq - b.seq);
      if (player.inputBuffer.length > 256) {
        player.inputBuffer.splice(0, player.inputBuffer.length - 256);
      }
    } catch (error) {
      console.error('[ROOM_INPUT_ERROR]', {
        ts: new Date().toISOString(),
        room: this.id,
        clientId,
        seq: input.seq,
        stack: error instanceof Error ? error.stack : String(error)
      });
    }
  }

  step(dt: number) {
    try {
      this.serverTick += 1;
      const movementConfig = resolvePlayerMovementConfig(this.gameplayConfig);
      const crosscheckConfig = resolveCrosscheckConfig(this.gameplayConfig);

      for (const player of this.players.values()) {
        if (player.isTrainingDummy) continue;
        const next = this.consumeNextInput(player);
        if (next) {
          player.lastInputState = next.state;
          player.lastProcessedSeq = next.seq;
          player.inputGapTicks = 0;
        }

        const movementInput = player.bodyCollisionStaggerTimerSec > 0
          ? { ...player.lastInputState, moveX: 0, moveY: 0, stop: 0 }
          : player.lastInputState;
        const movement = stepPlayerMovement(player, movementInput, dt, movementConfig);
        player.vx = movement.vx;
        player.vy = movement.vy;

        this.logMovementDebug(player, movement);
      }

      stepRoomGameplay(this, dt, crosscheckConfig);
      while (this.pendingServerMessages.length > 0) {
        const message = this.pendingServerMessages.shift();
        if (message) this.broadcast(message);
      }
    } catch (error) {
      console.error('[ROOM_STEP_ERROR]', {
        ts: new Date().toISOString(),
        room: this.id,
        serverTick: this.serverTick,
        players: [...this.players.values()].map((player) => ({
          id: player.id,
          x: player.x,
          y: player.y,
          lastProcessedSeq: player.lastProcessedSeq,
          crosscheckPhase: player.crosscheckPhase
        })),
        stack: error instanceof Error ? error.stack : String(error)
      });
    }
  }

  broadcastSnapshot() {
    try {
      const ack: Record<string, number> = {};
      for (const p of this.players.values()) ack[p.id] = p.lastProcessedSeq;

      const msg: SnapshotMsg = {
        type: 'snapshot',
        tick: this.serverTick,
        serverTick: this.serverTick,
        ack,
        players: [...this.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          handedness: p.handedness,
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          angle: p.angle,
          travelHeading: p.travelHeading,
          intentBoostTimer: p.intentBoostTimer,
          lastIntentAngle: p.lastIntentAngle,
          aimAngle: p.aimAngle,
          desiredHeading: p.desiredHeading,
          locomotionState: p.locomotionState,
          stopBlend: p.stopBlend,
          stopSide: p.stopSide,
          bodyCollisionStaggerTimerSec: p.bodyCollisionStaggerTimerSec,
          bodyCollisionDebug: serializeBodyCollisionDebug(p.bodyCollisionDebug),
          hasPuck: p.hasPuck,
          isTrainingDummy: p.isTrainingDummy,
          crosscheckPhase: p.crosscheckPhase,
          crosscheckTimerSec: p.crosscheckTimerSec,
          crosscheckConsumed: p.crosscheckConsumed,
          crosscheckResult: p.crosscheckResult,
          crosscheckImpactTimerSec: p.crosscheckImpactTimerSec,
          crosscheckImpactSerial: p.crosscheckImpactSerial,
          crosscheckImpactContactX: p.crosscheckImpactContactX,
          crosscheckImpactContactY: p.crosscheckImpactContactY,
          crosscheckImpactDirX: p.crosscheckImpactDirX,
          crosscheckImpactDirY: p.crosscheckImpactDirY,
          crosscheckImpactBarDirX: p.crosscheckImpactBarDirX,
          crosscheckImpactBarDirY: p.crosscheckImpactBarDirY,
          crosscheckImpactMagnitude: p.crosscheckImpactMagnitude,
          crosscheckImpactStripped: p.crosscheckImpactStripped,
          crosscheckImpactSeparated: p.crosscheckImpactSeparated,
          crosscheckImpactTargetId: p.crosscheckImpactTargetId,
          crosscheckImpactTargetIsDummy: p.crosscheckImpactTargetIsDummy,
          dummyResetTimerSec: p.dummyResetTimerSec
        })),
        puck: {
          state: this.puck.kind,
          kind: this.puck.kind,
          x: this.puck.x,
          y: this.puck.y,
          vx: this.puck.vx,
          vy: this.puck.vy,
          spin: this.puck.spin,
          radius: this.puck.radius,
          ownerId: this.puck.ownerId,
          possessionId: this.puck.possessionId,
          shotId: this.puck.shot?.shotId ?? null,
          releaseSerial: this.puck.releaseSerial,
          releaseOwnerId: this.puck.releaseOwnerId,
          releaseKind: this.puck.releaseKind
        }
      };
      this.broadcast(msg);
    } catch (error) {
      console.error('[ROOM_SNAPSHOT_ERROR]', {
        ts: new Date().toISOString(),
        room: this.id,
        serverTick: this.serverTick,
        playerCount: this.players.size,
        stack: error instanceof Error ? error.stack : String(error)
      });
    }
  }

  private logMovementDebug(player: PlayerState, movement: ReturnType<typeof stepPlayerMovement>) {
    if (!MOVEMENT_DEBUG_ENABLED) return;
    if (this.serverTick % MOVEMENT_DEBUG_EVERY_TICKS !== 0) return;

    const debug = getPlayerMovementDebugState(player, movement);
    console.debug(
      `[MOVE] room=${this.id} player=${player.id} speed=${debug.speed.toFixed(2)} ` +
        `vx=${debug.velocityX.toFixed(2)} vy=${debug.velocityY.toFixed(2)} ` +
        `heading=${debug.heading.toFixed(3)} travelHeading=${debug.travelHeading.toFixed(3)} desiredHeading=${debug.desiredHeading.toFixed(3)} ` +
        `state=${debug.locomotionState} stop=${debug.stopActive ? 1 : 0} stopBlend=${debug.stopBlend.toFixed(2)} stopSide=${debug.stopSide}`
    );
  }

  private consumeNextInput(player: PlayerState): BufferedInput | null {
    if (player.inputBuffer.length === 0) return null;

    while (player.inputBuffer.length > 0 && player.inputBuffer[0].seq <= player.lastProcessedSeq) {
      player.inputBuffer.shift();
    }
    if (player.inputBuffer.length === 0) return null;
    if (player.inputBuffer[0].seq === player.lastProcessedSeq + 1) {
      return player.inputBuffer.shift() ?? null;
    }
    if (player.lastProcessedSeq === 0) {
      return player.inputBuffer.shift() ?? null;
    }
    player.inputGapTicks += 1;
    if (player.inputGapTicks >= 10) {
      return player.inputBuffer.shift() ?? null;
    }
    return null;
  }

  private broadcast(message: ServerMessage) {
    const raw = JSON.stringify(message);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }

  get playerRadius() {
    return Math.max(0, this.gameplayConfig.playerRadius ?? GAMEPLAY_DEFAULTS.playerRadius ?? 18);
  }

  queueServerMessage(message: ServerMessage) {
    this.pendingServerMessages.push(message);
  }
}

function serializeBodyCollisionDebug(debug: BodyCollisionDebugState | null) {
  if (!debug || debug.timerSec <= 0) return null;
  return { ...debug };
}

function resolveMovementDebugEveryTicks() {
  const raw = Number(process.env.FLATHOCKEY_DEBUG_MOVEMENT_EVERY_TICKS ?? 15);
  if (!Number.isFinite(raw) || raw < 1) return 15;
  return Math.floor(raw);
}
