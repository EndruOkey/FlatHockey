import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './game/roomManager';
import { createWsServerV2 } from './net/wsServerV2';
import { FixedLoop } from './game/loop';
import { NET_PROTOCOL_VERSION, SNAPSHOT_HZ, SERVER_FEATURES, sanitizeRuntimeEnvironment } from '@flathockey/shared';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_RATE = Number(process.env.TICK_RATE ?? 60);
const SNAPSHOT_RATE = Number(process.env.SNAPSHOT_RATE ?? SNAPSHOT_HZ);
const SERVER_BUILD = process.env.BUILD_VERSION ?? process.env.GITHUB_SHA ?? 'unknown';
const RUNTIME_ENV = resolveRuntimeEnvironment(PORT, process.env.RUNTIME_ENV);
const SERVER_PID = process.pid;
const SERVER_CWD = process.cwd();
const SERVER_APP_DIR = path.resolve(SERVER_CWD, '..');

const app = express();
const httpServer = createServer(app);
const startedAt = Date.now();

const v2RoomManager = new RoomManager();
const ws2 = createWsServerV2(httpServer, v2RoomManager, {
  tickRate: TICK_RATE,
  snapshotRate: SNAPSHOT_RATE,
  protocolVersion: NET_PROTOCOL_VERSION,
  runtimeEnv: RUNTIME_ENV,
  serverBuild: SERVER_BUILD,
  features: [...SERVER_FEATURES]
});

let tickCounter = 0;
let snapshotCounter = 0;
let lastReport = Date.now();
let snapshotAccumulatorMs = 0;
const SNAPSHOT_STEP_MS = 1000 / Math.max(1, SNAPSHOT_RATE);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    ts: Date.now(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    config: {
      protocolVersion: NET_PROTOCOL_VERSION,
      runtimeEnv: RUNTIME_ENV,
      serverBuild: SERVER_BUILD,
      features: [...SERVER_FEATURES],
      pid: SERVER_PID,
      cwd: SERVER_CWD,
      appDir: SERVER_APP_DIR,
      tickRate: TICK_RATE,
      snapshotRate: SNAPSHOT_RATE
    },
    v2: ws2.getStats()
  });
});

const loop = new FixedLoop(
  (dt) => {
    tickCounter += 1;
    for (const room of v2RoomManager.allRooms()) {
      room.step(dt);
    }
  },
  (frameDtMs) => {
    snapshotAccumulatorMs += Math.min(frameDtMs, 250);

    while (snapshotAccumulatorMs >= SNAPSHOT_STEP_MS) {
      snapshotAccumulatorMs -= SNAPSHOT_STEP_MS;
      for (const room of v2RoomManager.allRooms()) {
        if (room.players.size === 0) continue;
        room.broadcastSnapshot();
        snapshotCounter += 1;
      }
      v2RoomManager.deleteEmptyRooms();
    }

    const now = Date.now();
    if (now - lastReport >= 2000) {
      const windowSec = (now - lastReport) / 1000;
      const playersV2 = v2RoomManager.playerCount();

      console.log(
        `[PERF] ticks/s=${(tickCounter / windowSec).toFixed(1)} snapshots/s=${(snapshotCounter / windowSec).toFixed(1)} playersV2=${playersV2}`
      );

      tickCounter = 0;
      snapshotCounter = 0;
      lastReport = now;
    }
  }
);

loop.start();

httpServer.listen(PORT, () => {
  console.log(
    `[RUNTIME] pid=${SERVER_PID} build=${SERVER_BUILD} protocol=${NET_PROTOCOL_VERSION} runtime=${RUNTIME_ENV} port=${PORT} cwd=${SERVER_CWD} appDir=${SERVER_APP_DIR}`
  );
  console.log(`[HTTP] listening on :${PORT}`);
  console.log(`[WS2] endpoint ws://localhost:${PORT}/ws2`);
});

function resolveRuntimeEnvironment(port: number, explicitValue: string | undefined) {
  const runtime = sanitizeRuntimeEnvironment(explicitValue);
  if (runtime !== 'unknown') return runtime;
  if (port === 7777) return 'prod';
  if (port === 7778) return 'dev';
  if (port === 8080) return 'local';
  return 'unknown';
}
