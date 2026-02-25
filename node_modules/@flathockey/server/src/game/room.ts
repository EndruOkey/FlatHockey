import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { WebSocket } from 'ws';

type InputState = {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: 0 | 1;
  brake: 0 | 1;
  aimAngle: number;
};

type BufferedInput = {
  seq: number;
  state: InputState;
};

type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  lastProcessedSeq: number;
  lastInputState: InputState;
  inputBuffer: BufferedInput[];
};

const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  sprint: 0,
  brake: 0,
  aimAngle: 0
};

const ACCEL = 1900;
const SPRINT_ACCEL = 2500;
const BRAKE_DRAG = 7.5;
const DRAG = 3.2;
const MAX_SPEED = 560;

export class Room {
  readonly id: string;
  readonly players = new Map<string, PlayerState>();
  readonly sockets = new Map<string, WebSocket>();
  serverTick = 0;

  constructor(id: string) {
    this.id = id;
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
      lastProcessedSeq: 0,
      lastInputState: { ...ZERO_INPUT },
      inputBuffer: []
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
        moveX: input.moveX < 0 ? -1 : input.moveX > 0 ? 1 : 0,
        moveY: input.moveY < 0 ? -1 : input.moveY > 0 ? 1 : 0,
        sprint: input.sprint ? 1 : 0,
        brake: input.brake ? 1 : 0,
        aimAngle: typeof input.aimAngle === 'number' ? input.aimAngle : player.angle
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
      const next = this.consumeNextInput(player);
      if (next) {
        player.lastInputState = next.state;
        player.lastProcessedSeq = next.seq;
      }

      applyMovementStep(player, player.lastInputState, dt);
    }
  }

  broadcastSnapshot() {
    const ack: Record<string, number> = {};
    for (const p of this.players.values()) ack[p.id] = p.lastProcessedSeq;

    const msg: SnapshotMsg = {
      type: 'snapshot',
      serverTick: this.serverTick,
      ack,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle
      }))
    };

    this.broadcast(msg);
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

    return null;
  }

  private broadcast(message: ServerMessage) {
    const raw = JSON.stringify(message);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }
}

function applyMovementStep(player: PlayerState, input: InputState, dt: number) {
  let dirX = input.moveX;
  let dirY = input.moveY;
  const len = Math.hypot(dirX, dirY);
  if (len > 0) {
    dirX /= len;
    dirY /= len;
  }

  const accel = input.sprint ? SPRINT_ACCEL : ACCEL;
  player.vx += dirX * accel * dt;
  player.vy += dirY * accel * dt;

  const dragFactor = Math.max(0, 1 - (input.brake ? BRAKE_DRAG : DRAG) * dt);
  player.vx *= dragFactor;
  player.vy *= dragFactor;

  const speed = Math.hypot(player.vx, player.vy);
  if (speed > MAX_SPEED) {
    const k = MAX_SPEED / speed;
    player.vx *= k;
    player.vy *= k;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  if (Number.isFinite(input.aimAngle)) {
    player.angle = input.aimAngle;
  } else if (speed > 1) {
    player.angle = Math.atan2(player.vy, player.vx);
  }
}
