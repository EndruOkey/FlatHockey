import { getPlayerMovementDebugState, resolvePlayerMovementConfig, stepPlayerMovement, type InputMsg, type ServerMessage, type SnapshotMsg } from '@flathockey/shared';
import { WebSocket } from 'ws';
import type { GameplayConfig } from '@flathockey/shared/tuning/gameplayConfig.types';
import { updatePuck } from './roomSystems';
import { type BufferedInput, type PlayerState, type PuckState, ZERO_INPUT } from './room.types';

const MOVEMENT_DEBUG_ENABLED = process.env.FLATHOCKEY_DEBUG_MOVEMENT === '1';
const MOVEMENT_DEBUG_EVERY_TICKS = resolveMovementDebugEveryTicks();

export class Room {
  readonly id: string;
  readonly players = new Map<string, PlayerState>();
  readonly sockets = new Map<string, WebSocket>();
  serverTick = 0;
  gameplayConfig: Partial<GameplayConfig> = {};
  puck: PuckState = {
    state: 'FREE',
    ownerId: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    pickupCooldownMs: 0
  };

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
      x: -220 + offset,
      y: -120 + offset * 0.35,
      vx: 0,
      vy: 0,
      angle: 0,
      travelHeading: 0,
      aimAngle: 0,
      desiredHeading: 0,
      locomotionState: 'idle',
      backwards: false,
      prevShoot: false,
      shotCharge: 0,
      lastProcessedSeq: 0,
      lastInputState: { ...ZERO_INPUT },
      inputBuffer: [],
      inputGapTicks: 0
    });
    this.sockets.set(clientId, ws);
  }

  removeClient(clientId: string) {
    this.players.delete(clientId);
    this.sockets.delete(clientId);
  }

  enqueueInput(clientId: string, input: InputMsg) {
    const player = this.players.get(clientId);
    if (!player) return;
    if (input.clientId !== clientId) return;
    if (input.seq <= player.lastProcessedSeq) return;

    const buffered: BufferedInput = {
      seq: input.seq,
      state: {
        moveX: input.moveX ?? 0,
        moveY: input.moveY ?? 0,
        shoot: input.shoot ? 1 : 0,
        aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : player.aimAngle,
        stop: input.stop ? 1 : 0,
        backwards: input.backwards ? 1 : 0
      }
    };

    player.inputBuffer.push(buffered);
    player.inputBuffer.sort((a, b) => a.seq - b.seq);
    if (player.inputBuffer.length > 256) {
      player.inputBuffer.splice(0, player.inputBuffer.length - 256);
    }
  }

  step(dt: number) {
    this.serverTick += 1;
    const movementConfig = resolvePlayerMovementConfig(this.gameplayConfig);

    for (const player of this.players.values()) {
      const next = this.consumeNextInput(player);
      if (next) {
        player.lastInputState = next.state;
        player.lastProcessedSeq = next.seq;
        player.inputGapTicks = 0;
      }
      const movement = stepPlayerMovement(player, player.lastInputState, dt, movementConfig);
      player.vx = movement.vx;
      player.vy = movement.vy;
      this.logMovementDebug(player, movement);
    }
    this.updatePuck(dt);
  }

  broadcastSnapshot() {
    const ack: Record<string, number> = {};
    for (const p of this.players.values()) ack[p.id] = p.lastProcessedSeq;

    const msg: SnapshotMsg = {
      type: 'snapshot',
      tick: this.serverTick,
      serverTick: this.serverTick,
      ack,
      puck: {
        state: this.puck.state,
        ownerId: this.puck.ownerId,
        x: this.puck.x,
        y: this.puck.y,
        vx: this.puck.vx,
        vy: this.puck.vy
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle,
        travelHeading: p.travelHeading,
        aimAngle: p.aimAngle,
        desiredHeading: p.desiredHeading,
        locomotionState: p.locomotionState,
        backwards: p.backwards
      }))
    };
    this.broadcast(msg);
  }

  private updatePuck(dt: number) {
    updatePuck(this, dt);
  }

  private logMovementDebug(player: PlayerState, movement: ReturnType<typeof stepPlayerMovement>) {
    if (!MOVEMENT_DEBUG_ENABLED) return;
    if (this.serverTick % MOVEMENT_DEBUG_EVERY_TICKS !== 0) return;

    const debug = getPlayerMovementDebugState(player, movement);
    console.debug(
      `[MOVE] room=${this.id} player=${player.id} speed=${debug.speed.toFixed(2)} ` +
        `vx=${debug.velocityX.toFixed(2)} vy=${debug.velocityY.toFixed(2)} ` +
        `heading=${debug.heading.toFixed(3)} travelHeading=${debug.travelHeading.toFixed(3)} desiredHeading=${debug.desiredHeading.toFixed(3)} ` +
        `state=${debug.locomotionState} stop=${debug.stopActive ? 1 : 0} backwards=${debug.backwardsActive ? 1 : 0}`
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
}

function resolveMovementDebugEveryTicks() {
  const raw = Number(process.env.FLATHOCKEY_DEBUG_MOVEMENT_EVERY_TICKS ?? 15);
  if (!Number.isFinite(raw) || raw < 1) return 15;
  return Math.floor(raw);
}
