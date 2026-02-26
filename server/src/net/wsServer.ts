import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';
import type { ServerMessage } from '@flathockey/shared';
import { parseWsPayload } from './protocol';
import { BestNow } from '@flathockey/shared/tuning/movementPresets';

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
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = `c${nextClientId++}`;
    const room = roomManager.getOrCreateRoom('pond-1');
    room.addClient(clientId, ws, randomName());

    // compute effective tuning to send; start from the official best preset
    const effectiveTuning = {
      ...BestNow,
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
    console.log(`[WS] connect client=${clientId} room=${room.id} ip=${req.socket.remoteAddress ?? 'unknown'}`);

    ws.on('message', (buf) => {
      const msg = parseWsPayload(buf.toString());
      if (!msg) return;
      if (msg.type === 'input') {
        room.enqueueInput(clientId, msg);
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
              ...BestNow,
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
