import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { RoomManager } from '../game/roomManager';
import type { ServerMessage } from '@flathockey/shared';
import { parseWsPayload } from './protocol';

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

    const welcome: ServerMessage = {
      type: 'welcome',
      clientId,
      roomId: room.id,
      serverTick: room.serverTick
    };

    ws.send(JSON.stringify(welcome));
    console.log(`[WS] connect client=${clientId} room=${room.id} ip=${req.socket.remoteAddress ?? 'unknown'}`);

    ws.on('message', (buf) => {
      const msg = parseWsPayload(buf.toString());
      if (!msg) return;
      if (msg.type === 'input') room.enqueueInput(clientId, msg);
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
