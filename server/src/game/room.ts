import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { WebSocket } from 'ws';
import type { GameplayConfig } from '@flathockey/shared/tuning/gameplayConfig.types';
import { updatePuck } from './roomSystems';
import { type BufferedInput, type PlayerState, type PuckState, ZERO_INPUT } from './room.types';

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
      speed: 0,
      angle: 0,
      aimAngle: 0,
      stamina: 1,
      prevShoot: false,
      shotCharge: 0,
      lastProcessedSeq: 0,
      lastInputState: { ...ZERO_INPUT },
      inputBuffer: [],
      inputGapTicks: 0,
      chargeActive: false,
      hitCooldownLeft: 0,
      stunLeft: 0
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
        shoot: input.shoot ? 1 : 0,
        aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : player.aimAngle
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

    for (const player of this.players.values()) {
      player.hitCooldownLeft = Math.max(0, player.hitCooldownLeft - dt);
      player.stunLeft = Math.max(0, player.stunLeft - dt);

      const next = this.consumeNextInput(player);
      if (next) {
        player.lastInputState = next.state;
        player.lastProcessedSeq = next.seq;
        player.inputGapTicks = 0;
      }
      player.vx = 0;
      player.vy = 0;
      player.speed = 0;
      if (Number.isFinite(player.lastInputState.aimAngle)) {
        player.aimAngle = player.lastInputState.aimAngle;
        player.angle = player.lastInputState.aimAngle;
      }
      player.chargeActive = false;
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
        speed: p.speed,
        angle: p.angle,
        aimAngle: p.aimAngle,
        chargeActive: p.chargeActive,
        stunLeft: p.stunLeft
      }))
    };
    this.broadcast(msg);
  }

  private updatePuck(dt: number) {
    updatePuck(this, dt);
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
