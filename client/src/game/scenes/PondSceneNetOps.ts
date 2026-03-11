import { NET_PROTOCOL_VERSION, type InputMsg, type ServerMessage, type SnapshotMsg } from '@flathockey/shared';
import { CLIENT_FIXED_DT } from '../net/prediction';
import { reconcilePrediction } from '../net/reconciliation';
import { getSnapshotPlayerStateMismatch } from '../net/serverCompatibility';
import { getTuning } from '../tuning/gameplayConfig';

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
  };

  if (m.type === 'welcome' || m.type === 'net:welcome') {
    scene.applyWelcomeLike({
      clientId: String(m.clientId ?? ''),
      roomId: typeof m.roomId === 'string' ? m.roomId : undefined,
      room: typeof m.room === 'string' ? m.room : undefined
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
    if (m.code === 'UNSUPPORTED_PROTO') {
      const detail = typeof m.message === 'string' ? m.message : 'server rejected client protocol';
      scene.failProtocolMismatch(`server rejected client protocol ${NET_PROTOCOL_VERSION} (${detail})`);
      return;
    }

    const reason = typeof m.code === 'string' ? `${m.code}: ${m.message ?? 'unknown'}` : String(m.reason ?? 'unknown');
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
  if (!Number.isFinite(snapshot.serverTick) || !Array.isArray(snapshot.players)) {
    scene.failProtocolMismatch('snapshot payload is missing required fields');
    return;
  }

  const now = performance.now();
  const serverTimeMs = snapshot.serverTick * SERVER_TICK_MS;
  scene.newestSnapshotServerMs = Math.max(scene.newestSnapshotServerMs, serverTimeMs);
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
    const mismatch = getSnapshotPlayerStateMismatch(p);
    if (mismatch) {
      scene.failProtocolMismatch(mismatch);
      return;
    }

    scene.ensurePlayerView(p.id);
    if (scene.clientId && p.id === scene.clientId) {
      scene.ackSeq = snapshot.ack[scene.clientId] ?? 0;
      if (!scene.predicted) {
        scene.predicted = { ...p };
        scene.pendingInputs = [];
        scene.localBuffer.clear();
        scene.localBuffer.push(
          {
            x: p.x,
            y: p.y,
            rot: p.angle,
            aimRot: p.aimAngle
          },
          now
        );
      } else {
        reconcilePrediction(scene.predicted, p, scene.ackSeq, scene.pendingInputs);
        scene.localBuffer.push(
          {
            x: scene.predicted.x,
            y: scene.predicted.y,
            rot: scene.predicted.angle ?? 0,
            aimRot: scene.predicted.aimAngle ?? scene.predicted.angle ?? 0
          },
          now
        );
      }
    } else {
      const lastTick = scene.remoteLastSnapshotTick.get(p.id);
      if (typeof lastTick === 'number' && snapshot.serverTick <= lastTick) {
        continue;
      }
      scene.remoteLastSnapshotTick.set(p.id, snapshot.serverTick);
      scene.remoteInterpolators.get(p.id)?.push(
        {
          x: p.x,
          y: p.y,
          rot: p.angle,
          aimRot: p.aimAngle
        },
        serverTimeMs
      );
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
  const aimAngle = scene.computeMouseAimAngle(CLIENT_FIXED_DT, tuning);
  const moveX = (scene.keys.D.isDown ? 1 : 0) - (scene.keys.A.isDown ? 1 : 0);
  const moveY = (scene.keys.S.isDown ? 1 : 0) - (scene.keys.W.isDown ? 1 : 0);

  return {
    type: 'input',
    clientId: scene.clientId ?? '',
    seq: ++scene.seq,
    moveX: moveX > 0 ? 1 : moveX < 0 ? -1 : 0,
    moveY: moveY > 0 ? 1 : moveY < 0 ? -1 : 0,
    shoot: scene.keys.E.isDown ? 1 : 0,
    stop: scene.keys.SPACE.isDown ? 1 : 0,
    backwards: scene.keys.C.isDown ? 1 : 0,
    aimAngle
  };
}
