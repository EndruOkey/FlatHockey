import { getTuning } from '../tuning/gameplayConfig';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';
import { BUILD_TIME, BUILD_VERSION } from '../../config/version';
import { PlayerView } from '../entities/playerView';

export function updateCrosshairAndCursor(scene: any) {
  const tuning = getTuning();
  const pointer = scene.input.activePointer;
  const canvas = scene.game.canvas;
  const within = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= scene.scale.width && pointer.y <= scene.scale.height;
  if (canvas) canvas.style.cursor = (tuning.hideSystemCursor && within) ? 'none' : '';

  scene.crosshairGraphics.clear();
  if (!tuning.crosshairEnabled || !within) return;
  const size = Math.max(1, tuning.crosshairSize ?? 16);
  const thick = Math.max(1, tuning.crosshairThickness ?? 2);
  const gap = Math.max(0, tuning.crosshairCenterGap ?? 4);
  const x = pointer.x;
  const y = pointer.y;
  scene.crosshairGraphics.lineStyle(thick, 0xe8f5ff, 0.9);
  scene.crosshairGraphics.lineBetween(x - size, y, x - gap, y);
  scene.crosshairGraphics.lineBetween(x + gap, y, x + size, y);
  scene.crosshairGraphics.lineBetween(x, y - size, x, y - gap);
  scene.crosshairGraphics.lineBetween(x, y + gap, x, y + size);
  scene.crosshairGraphics.fillStyle(0xe8f5ff, 0.85);
  scene.crosshairGraphics.fillCircle(x, y, 1.5);
}

function stickTargetScreen(view: PlayerView) {
  const tuning = puckStickTuningStore.get();
  return view.getStickBaseWorld(view.aimRot, tuning.stickOffsetX, tuning.stickOffsetY);
}

export function updateAndDrawPuck(scene: any, dtSec: number, remoteTargetServerTime: number) {
  const tuning = puckStickTuningStore.get();
  const puckRadius = tuning.puckRadius;
  const holdSpringK = tuning.holdSpringK;
  const holdDampingC = tuning.holdDampingC;
  const holdMaxError = tuning.holdMaxError;

  if (scene.puckSnapshot.state === 'FREE') {
    const sample = scene.puckFreeBuffer.sample(remoteTargetServerTime, (a: any, b: any, t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      vx: a.vx + (b.vx - a.vx) * t,
      vy: a.vy + (b.vy - a.vy) * t
    })) ?? scene.puckFreeBuffer.latest()?.value ?? scene.puckSnapshot;
    const s = scene.worldToScreen(sample.x, sample.y);
    scene.puckRender.x = s.x;
    scene.puckRender.y = s.y;
    scene.puckRender.vx = sample.vx;
    scene.puckRender.vy = sample.vy;
    scene.puckRender.state = 'FREE';
    scene.puckRender.ownerId = null;
  } else {
    scene.puckRender.state = 'HELD';
    scene.puckRender.ownerId = scene.puckSnapshot.ownerId;
    const owner = scene.puckRender.ownerId ? scene.players.get(scene.puckRender.ownerId) : null;
    const serverScreen = scene.worldToScreen(scene.puckSnapshot.x, scene.puckSnapshot.y);
    if (owner) {
      const target = stickTargetScreen(owner);
      const dx = target.x - scene.puckRender.x;
      const dy = target.y - scene.puckRender.y;
      scene.puckRender.vx += (dx * holdSpringK - scene.puckRender.vx * holdDampingC) * dtSec;
      scene.puckRender.vy += (dy * holdSpringK - scene.puckRender.vy * holdDampingC) * dtSec;
      scene.puckRender.x += scene.puckRender.vx * dtSec;
      scene.puckRender.y += scene.puckRender.vy * dtSec;
      const corrDx = serverScreen.x - scene.puckRender.x;
      const corrDy = serverScreen.y - scene.puckRender.y;
      const corrDist = Math.hypot(corrDx, corrDy);
      if (corrDist > holdMaxError * 1.4) {
        scene.puckRender.x = serverScreen.x;
        scene.puckRender.y = serverScreen.y;
        scene.puckRender.vx = scene.puckSnapshot.vx;
        scene.puckRender.vy = scene.puckSnapshot.vy;
      } else {
        scene.puckRender.x += corrDx * 0.12;
        scene.puckRender.y += corrDy * 0.12;
      }
    } else {
      scene.puckRender.x = serverScreen.x;
      scene.puckRender.y = serverScreen.y;
    }
  }

  scene.puckGraphics.clear();
  scene.puckGraphics.fillStyle(0x111111, 1);
  scene.puckGraphics.fillCircle(scene.puckRender.x, scene.puckRender.y, puckRadius);
  scene.puckGraphics.lineStyle(1, 0xffffff, 0.25);
  scene.puckGraphics.strokeCircle(scene.puckRender.x, scene.puckRender.y, puckRadius);
}

export function updateOverlay(_scene: any) {
  void _scene;
}

export function updateHud(scene: any, dtSec: number) {
  if (!scene.wsConnected) return;
  scene.hudAcc += dtSec;
  if (scene.hudAcc < 0.25) return;
  scene.hudAcc = 0;
  const next = [
    `Room: ${scene.roomId ?? '-'}`,
    `Client: ${scene.clientId ?? '-'}`,
    `Build: ${BUILD_VERSION || 'dev-local'}`,
    `BuildTime: ${BUILD_TIME || '-'}`,
    `Seq/Ack: ${scene.seq}/${scene.ackSeq}`,
    `Pending: ${scene.pendingInputs.length}`,
    'Mouse aim | E shoot'
  ].join('\n');
  if (next !== scene.lastHudText) {
    scene.lastHudText = next;
    scene.hud.setText(next);
  }
}
