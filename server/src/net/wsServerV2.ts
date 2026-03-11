import {
  NET_PROTOCOL_VERSION,
  sanitizeMovementAxis,
  sanitizeRuntimeEnvironment,
  type InputMsg,
  type RuntimeEnvironment,
  type ServerFeature
} from '@flathockey/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';

type JsonRecord = Record<string, unknown>;

type ClientHelloV2 = {
  type: 'hello';
  proto: number;
  clientBuild?: string;
  name?: string;
};

type ClientJoinV2 = {
  type: 'join';
  mode?: string;
  room: string;
};

type ClientInputV2 = {
  type: 'input';
  seq: number;
  moveX?: -1 | 0 | 1;
  moveY?: -1 | 0 | 1;
  aimAngle?: number;
  shoot?: boolean;
  stop?: boolean;
  reorient?: boolean;
  pointer?: {
    aim?: number;
  };
  keys?: {
    w?: boolean;
    a?: boolean;
    s?: boolean;
    d?: boolean;
    e?: boolean;
    space?: boolean;
    ctrl?: boolean;
  };
};

type ClientPingV2 = {
  type: 'ping';
  t: number;
};

type ClientLeaveV2 = {
  type: 'leave';
};

type ClientMessageV2 = ClientHelloV2 | ClientJoinV2 | ClientInputV2 | ClientPingV2 | ClientLeaveV2;

type Session = {
  clientId: string;
  ws: WebSocket;
  name: string;
  roomId: string | null;
  helloReceived: boolean;
  lastSeenAtMs: number;
  inputWindowStartMs: number;
  inputCountInWindow: number;
  inputRateLimitedInWindow: boolean;
};

type V2Config = {
  snapshotRate: number;
  tickRate: number;
  maxPlayers: number;
  inputRateLimitPerSec: number;
  heartbeatTimeoutMs: number;
  heartbeatSweepMs: number;
  allowedOrigins: string[];
  protocolVersion: number;
  runtimeEnv: RuntimeEnvironment;
  serverBuild?: string;
  features: ServerFeature[];
};

const DEFAULT_ROOM = 'pond-1';
const DEFAULT_CONFIG: V2Config = {
  snapshotRate: Number(process.env.SNAPSHOT_RATE ?? 20),
  tickRate: Number(process.env.TICK_RATE ?? 60),
  maxPlayers: Number(process.env.MAX_PLAYERS ?? 32),
  inputRateLimitPerSec: Number(process.env.INPUT_RATE_LIMIT ?? 120),
  heartbeatTimeoutMs: Number(process.env.HEARTBEAT_TIMEOUT_MS ?? 10_000),
  heartbeatSweepMs: Number(process.env.HEARTBEAT_SWEEP_MS ?? 5_000),
  allowedOrigins: String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  protocolVersion: NET_PROTOCOL_VERSION,
  runtimeEnv: sanitizeRuntimeEnvironment(process.env.RUNTIME_ENV),
  serverBuild: process.env.BUILD_VERSION ?? process.env.GITHUB_SHA ?? 'unknown',
  features: ['player-state-v2', 'locomotion-v1', 'puck-state-v1']
};

let nextClientId = 1;

function safeParse(raw: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function bool(v: unknown): boolean {
  return v === true;
}

function keyAxis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return negative ? -1 : 1;
}

function send(ws: WebSocket, payload: JsonRecord) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function parseV2Message(obj: JsonRecord): ClientMessageV2 | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type === 'hello') {
    if (typeof obj.proto !== 'number') return null;
    return {
      type,
      proto: obj.proto,
      clientBuild: typeof obj.clientBuild === 'string' ? obj.clientBuild : undefined,
      name: typeof obj.name === 'string' ? obj.name : undefined
    };
  }

  if (type === 'join') {
    if (typeof obj.room !== 'string' || !obj.room.trim()) return null;
    return {
      type,
      mode: typeof obj.mode === 'string' ? obj.mode : undefined,
      room: obj.room.trim()
    };
  }

  if (type === 'input') {
    if (typeof obj.seq !== 'number' || !Number.isFinite(obj.seq)) return null;
    const pointer = isObject(obj.pointer) ? obj.pointer : undefined;
    const keys = isObject(obj.keys) ? obj.keys : undefined;
    const moveX = sanitizeMovementAxis(
      typeof obj.moveX === 'number' && Number.isFinite(obj.moveX)
        ? obj.moveX
        : keyAxis(bool(keys?.a), bool(keys?.d))
    );
    const moveY = sanitizeMovementAxis(
      typeof obj.moveY === 'number' && Number.isFinite(obj.moveY)
        ? obj.moveY
        : keyAxis(bool(keys?.w), bool(keys?.s))
    );
    const aimAngle =
      typeof obj.aimAngle === 'number' && Number.isFinite(obj.aimAngle)
        ? obj.aimAngle
        : typeof pointer?.aim === 'number' && Number.isFinite(pointer.aim)
          ? pointer.aim
          : undefined;
    const shoot = typeof obj.shoot === 'boolean' ? obj.shoot : bool(keys?.e);
    const stop = typeof obj.stop === 'boolean' ? obj.stop : bool(keys?.space);
    const reorient = typeof obj.reorient === 'boolean' ? obj.reorient : bool(keys?.ctrl);
    return {
      type,
      seq: Math.max(0, Math.floor(obj.seq)),
      moveX,
      moveY,
      aimAngle,
      shoot,
      stop,
      reorient,
      pointer,
      keys
    };
  }

  if (type === 'ping') {
    if (typeof obj.t !== 'number' || !Number.isFinite(obj.t)) return null;
    return { type, t: obj.t };
  }

  if (type === 'leave') {
    return { type };
  }

  return null;
}

function toInputMsg(clientId: string, msg: ClientInputV2, fallbackAim: number): InputMsg {
  return {
    type: 'input',
    clientId,
    seq: msg.seq,
    moveX: msg.moveX ?? 0,
    moveY: msg.moveY ?? 0,
    shoot: msg.shoot ? 1 : 0,
    aimAngle: typeof msg.aimAngle === 'number' ? msg.aimAngle : fallbackAim,
    stop: msg.stop ? 1 : 0,
    reorient: msg.reorient ? 1 : 0
  };
}

export function createWsServerV2(server: Server, roomManager: RoomManager, cfg: Partial<V2Config> = {}) {
  const config: V2Config = { ...DEFAULT_CONFIG, ...cfg };
  const wss = new WebSocketServer({ server, path: '/ws2' });
  const sessions = new Map<WebSocket, Session>();

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now - session.lastSeenAtMs <= config.heartbeatTimeoutMs) continue;
      console.warn(`[WS2] heartbeat timeout client=${session.clientId} room=${session.roomId ?? '-'}`);
      try {
        session.ws.terminate();
      } catch {}
    }
  }, config.heartbeatSweepMs);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  wss.on('connection', (ws, req) => {
    const clientId = `v2c${nextClientId++}`;
    const ts = new Date().toISOString();
    const origin = req.headers.origin ?? '-';
    const remoteIp = req.socket.remoteAddress ?? 'unknown';
    const reqUrl = req.url ?? '/ws2';

    const session: Session = {
      clientId,
      ws,
      name: `player-${clientId}`,
      roomId: null,
      helloReceived: false,
      lastSeenAtMs: Date.now(),
      inputWindowStartMs: Date.now(),
      inputCountInWindow: 0,
      inputRateLimitedInWindow: false
    };
    sessions.set(ws, session);
    console.log(`[WS2] CONNECT ts=${ts} client=${clientId} ip=${remoteIp} origin=${origin} url=${reqUrl}`);

    if (config.allowedOrigins.length > 0 && origin !== '-' && !config.allowedOrigins.includes(origin)) {
      console.warn(`[WS2] origin rejected client=${clientId} origin=${origin}`);
      send(ws, { type: 'error', code: 'ORIGIN_FORBIDDEN', message: origin });
      try {
        ws.close(1008, 'origin_forbidden');
      } catch {}
      return;
    }

    ws.on('message', (buf) => {
      const active = sessions.get(ws);
      if (!active) return;
      active.lastSeenAtMs = Date.now();

      const raw = typeof buf === 'string' ? buf : buf.toString();
      const obj = safeParse(raw);
      if (!obj) {
        send(ws, { type: 'error', code: 'BAD_PAYLOAD', message: 'invalid_json' });
        return;
      }

      const parsed = parseV2Message(obj);
      if (!parsed) {
        send(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: `unsupported_type:${String(obj.type ?? 'unknown')}` });
        return;
      }

      if (parsed.type === 'hello') {
        if (parsed.proto !== config.protocolVersion) {
          send(ws, {
            type: 'error',
            code: 'UNSUPPORTED_PROTO',
            message: `expected_proto_${config.protocolVersion}`,
            proto: config.protocolVersion,
            serverBuild: config.serverBuild,
            runtime: config.runtimeEnv,
            features: config.features
          });
          try {
            ws.close(1002, 'unsupported_proto');
          } catch {}
          return;
        }

        active.helloReceived = true;
        if (parsed.name && parsed.name.trim()) active.name = parsed.name.trim().slice(0, 32);
        send(ws, {
          type: 'welcome',
          proto: config.protocolVersion,
          clientId: active.clientId,
          roomId: active.roomId ?? DEFAULT_ROOM,
          serverTick: 0,
          serverBuild: config.serverBuild,
          runtime: config.runtimeEnv,
          features: config.features
        });
        return;
      }

      if (parsed.type === 'ping') {
        send(ws, { type: 'pong', t: parsed.t });
        return;
      }

      if (!active.helloReceived) {
        send(ws, { type: 'error', code: 'HELLO_REQUIRED', message: 'send_hello_before_join_or_input' });
        return;
      }

      if (parsed.type === 'join') {
        const mode = parsed.mode ?? 'pond';
        if (mode !== 'pond') {
          send(ws, { type: 'error', code: 'MODE_UNSUPPORTED', message: `mode:${mode}` });
          return;
        }

        const roomId = parsed.room || DEFAULT_ROOM;
        const room = roomManager.getOrCreateRoom(roomId);
        const alreadyInside = room.players.has(active.clientId);
        if (!alreadyInside && room.players.size >= config.maxPlayers) {
          send(ws, { type: 'error', code: 'ROOM_FULL', message: `room:${roomId}` });
          return;
        }

        if (active.roomId && active.roomId !== roomId) {
          const prevRoom = roomManager.getOrCreateRoom(active.roomId);
          prevRoom.removeClient(active.clientId);
          if (prevRoom.players.size === 0) roomManager.removeRoom(prevRoom.id);
        }

        if (!alreadyInside) {
          room.addClient(active.clientId, ws, active.name);
        }

        active.roomId = roomId;
        console.log(`[WS2] JOIN ok client=${active.clientId} room=${roomId} players=${room.players.size}`);
        send(ws, {
          type: 'join:ok',
          room: roomId,
          tickRate: config.tickRate,
          snapshotRate: config.snapshotRate,
          proto: config.protocolVersion,
          serverBuild: config.serverBuild,
          runtime: config.runtimeEnv,
          features: config.features
        });
        return;
      }

      if (parsed.type === 'input') {
        if (!active.roomId) {
          send(ws, { type: 'error', code: 'JOIN_REQUIRED', message: 'send_join_before_input' });
          return;
        }

        const now = Date.now();
        if (now - active.inputWindowStartMs >= 1000) {
          active.inputWindowStartMs = now;
          active.inputCountInWindow = 0;
          active.inputRateLimitedInWindow = false;
        }
        active.inputCountInWindow += 1;
        if (active.inputCountInWindow > config.inputRateLimitPerSec) {
          if (!active.inputRateLimitedInWindow) {
            active.inputRateLimitedInWindow = true;
            console.warn(
              `[WS2] RATE_LIMIT drop client=${active.clientId} room=${active.roomId ?? '-'} count=${active.inputCountInWindow} limit=${config.inputRateLimitPerSec}`
            );
          }
          return;
        }

        const room = roomManager.getOrCreateRoom(active.roomId);
        const existing = room.players.get(active.clientId);
        const fallbackAim = existing?.aimAngle ?? 0;
        room.enqueueInput(active.clientId, toInputMsg(active.clientId, parsed, fallbackAim));
        return;
      }

      if (parsed.type === 'leave') {
        if (!active.roomId) return;
        const room = roomManager.getOrCreateRoom(active.roomId);
        room.removeClient(active.clientId);
        console.log(`[WS2] LEAVE client=${active.clientId} room=${active.roomId}`);
        if (room.players.size === 0) roomManager.removeRoom(room.id);
        active.roomId = null;
        send(ws, { type: 'leave:ok' });
      }
    });

    ws.on('close', (code, reason) => {
      const active = sessions.get(ws);
      if (!active) return;
      if (active.roomId) {
        const room = roomManager.getOrCreateRoom(active.roomId);
        room.removeClient(active.clientId);
        if (room.players.size === 0) roomManager.removeRoom(room.id);
      }
      sessions.delete(ws);
      console.log(`[WS2] DISCONNECT client=${active.clientId} room=${active.roomId ?? '-'} code=${code} reason=${reason.toString()}`);
    });

    ws.on('error', (err) => {
      const active = sessions.get(ws);
      console.error(`[WS2] ERROR client=${active?.clientId ?? 'unknown'}`, err);
    });
  });

  return {
    wss,
    getStats: () => ({
      clients: sessions.size,
      rooms: roomManager.roomCount(),
      players: roomManager.playerCount()
    })
  };
}
