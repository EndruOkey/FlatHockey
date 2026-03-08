import type { InputMsg, ServerMessage, SnapshotMsg } from '@flathockey/shared';
import { CLIENT_FIXED_DT } from '../net/prediction';
import { reconcilePrediction } from '../net/reconciliation';
import { getTuning } from '../debug/movementTuning';

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
        scene.localBuffer.push({ x: p.x, y: p.y, rot: p.angle, aimRot: p.aimAngle, moveRot: p.moveAngle, baseRot: p.baseBodyAngle ?? p.angle }, now);
      } else {
        reconcilePrediction(scene.predicted, p, scene.ackSeq, scene.pendingInputs);
        scene.localBuffer.push({
          x: scene.predicted.x,
          y: scene.predicted.y,
          rot: scene.predicted.angle,
          aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
          moveRot: scene.predicted.moveAngle ?? scene.predicted.angle,
          baseRot: scene.predicted.baseBodyAngle ?? scene.predicted.angle
        }, now);
      }
    } else {
      const lastTick = scene.remoteLastSnapshotTick.get(p.id);
      if (typeof lastTick === 'number' && snapshot.serverTick <= lastTick) {
        scene.droppedSnapshots += 1;
        continue;
      }
      scene.remoteLastSnapshotTick.set(p.id, snapshot.serverTick);
      scene.remoteInterpolators.get(p.id)?.push({ x: p.x, y: p.y, rot: p.angle, aimRot: p.aimAngle, moveRot: p.moveAngle, baseRot: p.baseBodyAngle ?? p.angle }, serverTimeMs);
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
  const moveX = ((scene.keys.D.isDown ? 1 : 0) - (scene.keys.A.isDown ? 1 : 0)) as -1 | 0 | 1;
  const moveY = ((scene.keys.S.isDown ? 1 : 0) - (scene.keys.W.isDown ? 1 : 0)) as -1 | 0 | 1;
  scene.lastInputVector = { x: moveX, y: moveY };
  const moveLen = Math.hypot(moveX, moveY);
  if (moveLen > 0.0001) scene.lastMoveAngle = Math.atan2(moveY / moveLen, moveX / moveLen);
  const aimAngle = scene.computeMouseAimAngle(CLIENT_FIXED_DT, tuning);
  if (typeof aimAngle === 'number' && Number.isFinite(aimAngle)) {
    scene.lastAimAngle = aimAngle;
    scene.lastDesiredHeading = aimAngle;
  } else {
    scene.lastDesiredHeading = scene.lastMoveAngle;
  }

  return {
    type: 'input',
    clientId: scene.clientId ?? '',
    seq: ++scene.seq,
    moveX,
    moveY,
    sprint: scene.input.activePointer.rightButtonDown() ? 1 : 0,
    brake: scene.keys.SPACE.isDown ? 1 : 0,
    shoot: (scene.keys.E.isDown || scene.input.activePointer.leftButtonDown()) ? 1 : 0,
    aimAngle,
    aimAngleRaw: aimAngle,
    aimDistance01: scene.aimDistance01,
    bodyTurn: 0
  };
}
