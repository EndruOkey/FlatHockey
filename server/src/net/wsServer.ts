import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';
import type { ServerMessage } from '@flathockey/shared';
import { parseWsPayload } from './protocol';
import { MOVEMENT_DEFAULTS } from '@flathockey/shared/tuning/movement.defaults';

// runtime flag; default false unless explicitly enabled via env var
const ALLOW_TUNING_SYNC =
  process.env.ALLOW_TUNING_SYNC === '1' ||
  process.env.ALLOW_TUNING_SYNC === 'true' ||
  false;

let nextClientId = 1;

function randomName() {
  return `Player${Math.floor(Math.random() * 1000)}`;
}

export function createWsServer(server: Server, roomManager: RoomManager) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

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
          console.log(`[WS] JOIN forcing room client=${clientId} requested=${msg.room} forced=${room.id}`);
        }

        const roomAny = room as any;
        const countCandidates: number[] = [];
        if (typeof roomAny.getClientCount === 'function') {
          const n = Number(roomAny.getClientCount());
          if (Number.isFinite(n)) countCandidates.push(n);
        }
        if (roomAny.clients?.size != null) countCandidates.push(Number(roomAny.clients.size));
        if (roomAny.players?.size != null) countCandidates.push(Number(roomAny.players.size));
        if (roomAny.sockets?.size != null) countCandidates.push(Number(roomAny.sockets.size));
        const count = countCandidates.find((n) => Number.isFinite(n)) ?? 0;
        if (count >= 20) {
          const reject: ServerMessage = {
            type: 'join:reject',
            reason: `room_full:${count}/20`
          };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reject));
          console.warn(`[WS] JOIN rejected full client=${clientId} room=${room.id} count=${count}`);
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
        // crash-harden: nothing should ever call a missing method
        if (!ALLOW_TUNING_SYNC) {
          // quietly drop, maybe log in dev
          if (process.env.NODE_ENV !== 'production') {
            console.log('[WS] tuning-sync message dropped (gate disabled)');
          }
          return;
        }

        if (typeof (room as any).setMovementTuning !== 'function') {
          console.warn('[WS] received tuning message but room lacks setter, ignoring');
          return;
        }

        if (process.env.NODE_ENV === 'production') {
          console.warn('[WS] ignoring tuning message from client in production');
          return;
        }

        // Allowed: apply patch to room tuning
        try {
          (room as any).setMovementTuning(msg.config || {});
          // broadcast updated tuning to clients in dev for UI verification
          const updated: ServerMessage = {
            type: 'welcome',
            clientId,
            roomId: room.id,
            serverTick: room.serverTick,
            movementTuning: {
              ...MOVEMENT_DEFAULTS,
              ...(room as any).movementTuning || {}
            },
            allowTuningSync: true
          };
          for (const ws2 of room.sockets.values()) {
            if (ws2.readyState === WebSocket.OPEN) {
              ws2.send(JSON.stringify(updated));
            }
          }
        } catch (err) {
          console.error('[WS] failed to apply tuning patch', err);
        }
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
