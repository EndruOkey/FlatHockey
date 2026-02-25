import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './game/roomManager';
import { createWsServer } from './net/wsServer';
import { FixedLoop } from './game/loop';
import { SNAPSHOT_HZ } from '@flathockey/shared';

const PORT = Number(process.env.PORT ?? 8080);

const app = express();
const httpServer = createServer(app);

const roomManager = new RoomManager();
createWsServer(httpServer, roomManager);

let tickCounter = 0;
let snapshotCounter = 0;
let lastReport = Date.now();
let snapshotAccumulatorMs = 0;
const SNAPSHOT_STEP_MS = 1000 / SNAPSHOT_HZ;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const loop = new FixedLoop(
  (dt) => {
    tickCounter += 1;
    for (const room of roomManager.allRooms()) {
      room.step(dt);
    }
  },
  (frameDtMs) => {
    snapshotAccumulatorMs += Math.min(frameDtMs, 250);

    while (snapshotAccumulatorMs >= SNAPSHOT_STEP_MS) {
      snapshotAccumulatorMs -= SNAPSHOT_STEP_MS;
      for (const room of roomManager.allRooms()) {
        if (room.players.size === 0) continue;
        room.broadcastSnapshot();
        snapshotCounter += 1;
      }
    }

    const now = Date.now();
    if (now - lastReport >= 2000) {
      const windowSec = (now - lastReport) / 1000;
      let players = 0;
      for (const room of roomManager.allRooms()) players += room.players.size;

      console.log(
        `[PERF] ticks/s=${(tickCounter / windowSec).toFixed(1)} snapshots/s=${(snapshotCounter / windowSec).toFixed(1)} players=${players}`
      );

      tickCounter = 0;
      snapshotCounter = 0;
      lastReport = now;
    }
  }
);

loop.start();

httpServer.listen(PORT, () => {
  console.log(`[HTTP] listening on :${PORT}`);
  console.log(`[WS] endpoint ws://localhost:${PORT}/ws`);
});
