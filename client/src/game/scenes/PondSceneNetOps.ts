import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { wrapToPi } from '@flathockey/shared';
import { CLIENT_FIXED_DT } from '../net/prediction';
import { reconcilePrediction } from '../net/reconciliation';
import { getTuning } from '../tuning/movementTuning';

const SERVER_TICK_MS = 1000 / 20;

export function handleServerMessage(scene: any, msg: ServerMessage | { type?: string; [key: string]: unknown }) {
  const m = msg as {
    type?: string;
    room?: string;
    reason?: string;
    code?: string;
    message?: string;
    clientId?: string;
    roomId?: string;
    movementTuning?: unknown;
    allowTuningSync?: unknown;
  };

  if (m.type === 'welcome' || m.type === 'net:welcome') {
    scene.applyWelcomeLike({
      clientId: String(m.clientId ?? ''),
      roomId: typeof m.roomId === 'string' ? m.roomId : undefined,
      room: typeof m.room === 'string' ? m.room : undefined,
      movementTuning: m.movementTuning,
      allowTuningSync: !!m.allowTuningSync
    });
    return;
  }

  if (m.type === 'join:ok') {
    const room = typeof m.room === 'string' ? m.room : 'pond-1';
    scene.roomId = room;
    return;
  }

  if (m.type === 'join:reject') {
    scene.hud.setText(`Offline (join rejected)\n${m.reason ?? 'unknown'}`);
    scene.wsConnected = false;
    scene.resetPendingInputState();
    return;
  }

  if (m.type === 'error') {
    const reason = typeof m.code === 'string'
      ? `${m.code}: ${m.message ?? 'unknown'}`
      : String(m.reason ?? 'unknown');
    scene.hud.setText(`Offline (ws error)\n${reason}`);
    scene.wsConnected = false;
    scene.resetPendingInputState();
    return;
  }

  if (m.type === 'snapshot') {
    applySnapshot(scene, m as SnapshotMsg);
  }
}

export function applySnapshot(scene: any, snapshot: SnapshotMsg) {
  const now = performance.now();
  const serverTimeMs = snapshot.serverTick * SERVER_TICK_MS;
  scene.latestServerTick = snapshot.serverTick;
  scene.latestSnapshotAtMs = now;
  scene.newestSnapshotServerMs = Math.max(scene.newestSnapshotServerMs, serverTimeMs);
  scene.snapshotReceiveTimes.push(now);
  scene.snapshotReceiveTimes = scene.snapshotReceiveTimes.filter((t: number) => t >= now - 1000);
  const observedOffset = now - serverTimeMs;
  if (!scene.hasServerClock) {
    scene.serverTimeOffsetMs = observedOffset;
    scene.hasServerClock = true;
  } else {
    scene.serverTimeOffsetMs = scene.serverTimeOffsetMs * 0.9 + observedOffset * 0.1;
  }

  if (!scene.hasReceivedFirstSnapshot) {
    scene.hasReceivedFirstSnapshot = true;
    scene.needsResync = true;
    scene.pendingResyncReason = scene.pendingResyncReason ?? 'first-snapshot';
  }

  for (const p of snapshot.players) {
    scene.ensurePlayerView(p.id);
    if (scene.clientId && p.id === scene.clientId) {
      scene.ackSeq = snapshot.ack[scene.clientId] ?? 0;
      if (!scene.predicted) {
        scene.predicted = { ...p };
        scene.pendingInputs = [];
        scene.localBuffer.clear();
        scene.localBuffer.push({
          x: p.x,
          y: p.y,
          rot: p.angle,
          aimRot: p.aimAngle,
          moveRot: p.moveAngle,
          baseRot: p.heading ?? p.angle,
          speed: Math.hypot(p.vx ?? 0, p.vy ?? 0)
        }, now);
      } else {
        reconcilePrediction(scene.predicted, p, scene.ackSeq, scene.pendingInputs);
        scene.localBuffer.push({
          x: scene.predicted.x,
          y: scene.predicted.y,
          rot: scene.predicted.angle,
          aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
          moveRot: scene.predicted.moveAngle ?? scene.predicted.angle,
          baseRot: scene.predicted.heading ?? scene.predicted.angle,
          speed: Math.hypot(scene.predicted.vx ?? 0, scene.predicted.vy ?? 0)
        }, now);
      }
    } else {
      const lastTick = scene.remoteLastSnapshotTick.get(p.id);
      if (typeof lastTick === 'number' && snapshot.serverTick <= lastTick) {
        scene.droppedSnapshots += 1;
        continue;
      }
      scene.remoteLastSnapshotTick.set(p.id, snapshot.serverTick);
      scene.remoteInterpolators.get(p.id)?.push({
        x: p.x,
        y: p.y,
        rot: p.angle,
        aimRot: p.aimAngle,
        moveRot: p.moveAngle,
        baseRot: p.heading ?? p.angle,
        speed: Math.hypot(p.vx ?? 0, p.vy ?? 0)
      }, serverTimeMs);
    }
  }

  if (snapshot.puck) {
    scene.puckSnapshot = {
      x: snapshot.puck.x,
      y: snapshot.puck.y,
      vx: snapshot.puck.vx,
      vy: snapshot.puck.vy,
      state: snapshot.puck.state,
      ownerId: snapshot.puck.ownerId
    };
    if (snapshot.puck.state === 'FREE') {
      scene.puckFreeBuffer.push(
        { x: snapshot.puck.x, y: snapshot.puck.y, vx: snapshot.puck.vx, vy: snapshot.puck.vy },
        serverTimeMs
      );
    }
  }
}

export function buildClientInput(scene: any): InputMsg {
  const tuning = getTuning();

  // Inicializace headingu z predicted state při prvním volání
  if (!Number.isFinite(scene._localHeading)) {
    scene._localHeading =
      Number.isFinite(scene.predicted?.heading) ? scene.predicted.heading :
      Number.isFinite(scene.predicted?.angle)   ? scene.predicted.angle   : 0;
  }

  // A/D točí heading hráče
  const turnRate = 4.2; // rad/s
  if (scene.keys.A.isDown) scene._localHeading -= turnRate * CLIENT_FIXED_DT;
  if (scene.keys.D.isDown) scene._localHeading += turnRate * CLIENT_FIXED_DT;
  scene._localHeading = wrapToPi(scene._localHeading);

  // W = vpřed, S nebo SPACE = brzda
  const throttle: -1 | 0 | 1 = scene.keys.W.isDown ? 1 : 0;
  const brake = (scene.keys.S.isDown || scene.keys.SPACE.isDown) ? 1 : 0;

  const aimAngle = scene.computeMouseAimAngle(CLIENT_FIXED_DT, tuning);
  if (typeof aimAngle === 'number' && Number.isFinite(aimAngle)) {
    scene.lastAimAngle = aimAngle;
  }

  return {
    type: 'input',
    clientId: scene.clientId ?? '',
    seq: ++scene.seq,
    throttle,
    steer: 0,
    brake,
    shoot: 0,
    aimAngle,
    _heading: scene._localHeading,
  };
}