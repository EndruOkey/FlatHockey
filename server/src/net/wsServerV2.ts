import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';
import type { InputMsg } from '@flathockey/shared';

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
  dt?: number;
  pointer?: {
    x?: number;
    y?: number;
    aim?: number;
  };
  keys?: {
    w?: boolean;
    a?: boolean;
    s?: boolean;
    d?: boolean;
    shift?: boolean;
    space?: boolean;
    e?: boolean;
    c?: boolean;
    v?: boolean;
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
};

const DEFAULT_ROOM = 'pond-1';
const V2_PROTO = 2;
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
    .filter(Boolean)
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function bool(v: unknown): boolean {
  return v === true;
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
    return {
      type,
      seq: Math.max(0, Math.floor(obj.seq)),
      dt: typeof obj.dt === 'number' && Number.isFinite(obj.dt) ? obj.dt : undefined,
      pointer: pointer
        ? {
            x: typeof pointer.x === 'number' && Number.isFinite(pointer.x) ? pointer.x : undefined,
            y: typeof pointer.y === 'number' && Number.isFinite(pointer.y) ? pointer.y : undefined,
            aim: typeof pointer.aim === 'number' && Number.isFinite(pointer.aim) ? pointer.aim : undefined
          }
        : undefined,
      keys: keys
        ? {
            w: bool(keys.w),
            a: bool(keys.a),
            s: bool(keys.s),
            d: bool(keys.d),
            shift: bool(keys.shift),
            space: bool(keys.space),
            e: bool(keys.e),
            c: bool(keys.c),
            v: bool(keys.v)
          }
        : undefined
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
  const keys = msg.keys ?? {};
  const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const moveY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
  const shoot = keys.e ? 1 : 0;
  return {
    type: 'input',
    clientId,
    seq: msg.seq,
    moveX: moveX < 0 ? -1 : moveX > 0 ? 1 : 0,
    moveY: moveY < 0 ? -1 : moveY > 0 ? 1 : 0,
    sprint: keys.shift ? 1 : 0,
    brake: keys.space ? 1 : 0,
    shoot,
    aimAngleRaw: typeof msg.pointer?.aim === 'number' ? msg.pointer.aim : fallbackAim,
    aimAngle: typeof msg.pointer?.aim === 'number' ? msg.pointer.aim : fallbackAim,
    aimDistance01: 1,
    bodyTurn: 0
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
        if (parsed.proto !== V2_PROTO) {
          send(ws, {
            type: 'error',
            code: 'UNSUPPORTED_PROTO',
            message: `expected_proto_${V2_PROTO}`
          });
          return;
        }

        active.helloReceived = true;
        if (parsed.name && parsed.name.trim()) active.name = parsed.name.trim().slice(0, 32);
        send(ws, {
          type: 'welcome',
          proto: V2_PROTO,
          clientId: active.clientId,
          serverTime: Date.now(),
          room: active.roomId ?? DEFAULT_ROOM
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
          snapshotRate: config.snapshotRate
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
        const fallbackAim = existing?.aimAngleRaw ?? existing?.aimAngle ?? 0;
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
