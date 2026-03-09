import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';
import type { ServerMessage } from '@flathockey/shared';
import { parseWsPayload } from './protocol';
import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';

const ALLOW_TUNING_SYNC = true;

let nextClientId = 1;

function randomName() {
  return `Player${Math.floor(Math.random() * 1000)}`;
}

export function createWsServer(server: Server, roomManager: RoomManager) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ts = new Date().toISOString();
    const origin = req.headers.origin ?? '-';
    const remoteIp = req.socket.remoteAddress ?? 'unknown';
    const reqUrl = req.url ?? '/ws';
    const clientId = `c${nextClientId++}`;
    const room = roomManager.getOrCreateRoom('pond-1');
    room.addClient(clientId, ws, randomName());

    // compute effective tuning to send; start from movement defaults
    const effectiveTuning = {
      ...MOVEMENT_DEFAULTS,
      ...(room as any).movementTuning || {}
    };

    const welcome: ServerMessage = {
      type: 'welcome',
      clientId,
      roomId: room.id,
      serverTick: room.serverTick,
      movementTuning: effectiveTuning,
      allowTuningSync: ALLOW_TUNING_SYNC
    };

    ws.send(JSON.stringify(welcome));
    console.log(`[WS] CONNECT ts=${ts} client=${clientId} room=${room.id} ip=${remoteIp} origin=${origin} url=${reqUrl}`);
    console.log(`[WS] WELCOME sent client=${clientId} room=${room.id}`);

    ws.on('message', (buf) => {
      const raw = typeof buf === 'string' ? buf : buf.toString();
      const preview = raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
      console.log(`[WS] MESSAGE client=${clientId} preview="${preview}"`);
      let parsedType: string | null = null;
      try {
        const parsed = JSON.parse(raw) as { type?: unknown };
        if (typeof parsed?.type === 'string') {
          parsedType = parsed.type;
          console.log(`[WS] MESSAGE type=${parsed.type} client=${clientId}`);
        } else {
          console.log(`[WS] MESSAGE non-typed-json client=${clientId}`);
        }
      } catch {
        console.log(`[WS] MESSAGE non-json/binary client=${clientId}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', reason: 'bad_payload' }));
        }
        return;
      }

      const msg = parseWsPayload(raw);
      if (!msg) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              reason: 'unknown_type',
              got: parsedType ?? 'unknown'
            })
          );
        }
        return;
      }
      if (msg.type === 'net:ping') {
        const pong: ServerMessage = { type: 'net:pong', nonce: msg.nonce };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pong));
      } else if (msg.type === 'input') {
        room.enqueueInput(clientId, msg);
      } else if (msg.type === 'join') {
        console.log(`[WS] JOIN received client=${clientId} payload=${JSON.stringify(msg)}`);
        if (msg.room !== room.id) {
          const reject: ServerMessage = {
            type: 'join:reject',
            reason: `room_not_found:${msg.room}`
          };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reject));
          console.warn(`[WS] JOIN rejected client=${clientId} room=${msg.room}`);
          return;
        }

        const rewelcome: ServerMessage = {
          type: 'net:welcome',
          clientId,
          roomId: room.id,
          serverTick: room.serverTick,
          movementTuning: {
            ...MOVEMENT_DEFAULTS,
            ...(room as any).movementTuning || {}
          },
          allowTuningSync: ALLOW_TUNING_SYNC
        };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(rewelcome));
        console.log(`[WS] JOIN accepted clientId=${clientId} room=${room.id}`);
      } else if (msg.type === 'debug:setMovementTuning') {
        if (!ALLOW_TUNING_SYNC) return;
        room.setMovementTuning(msg.config ?? {});
        return;
      }
    });

    ws.on('close', (code, reason) => {
      room.removeClient(clientId);
      console.log(`[WS] disconnect client=${clientId} room=${room.id} code=${code} reason=${reason.toString()}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] error client=${clientId}`, err);
    });
  });

  return wss;
}
