import { getTuning } from '../tuning/gameplayConfig';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';
import { computeSemiPhysicalStickPose } from '@flathockey/shared';

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

function playerCarryTargetWorld(scene: any, playerId: string | null) {
  if (!playerId) return null;
  // Primary: use the view's already-computed world-space stick pose (set during draw()).
  // This guarantees the puck world position matches the visual blade center exactly at any camera scale.
  const view = scene.players?.get(playerId);
  if (view) return view.getCarryAnchorWorld();
  // Fallback: view not yet created — compute from world state directly.
  const state = scene.playerRenderWorldStates?.get(playerId);
  if (!state) return null;
  const tuning = getTuning();
  const pose = computeSemiPhysicalStickPose({
    playerX: state.x,
    playerY: state.y,
    bodyAngle: state.rot,
    aimAngle: state.aimRot ?? state.rot,
    playerRadius: Math.max(12, tuning.playerRadius ?? 18),
    handedness: state.handedness ?? 'right',
    state: state.stickState,
    shotCharge: state.shotCharge ?? 0,
    stateTimerSec: state.stickTimer ?? 0
  });
  return {
    x: pose.bladeCenterX,
    y: pose.bladeCenterY
  };
}

export function updateAndDrawPuck(scene: any, dtSec: number, remoteTargetServerTime: number) {
  const tuning = puckStickTuningStore.get();
  const puckRadius = tuning.puckRadius * Math.max(1, scene.cameraWorldScale ?? 1);
  const turnoverPulseSec = Math.max(0, scene.puckReadabilityPulseSec ?? 0);
  scene.puckReadabilityPulseSec = Math.max(0, turnoverPulseSec - dtSec);
  const puckWorld = scene.samplePuckWorld(remoteTargetServerTime);
  const visualOwnerId = typeof scene.getVisualPuckOwnerId === 'function' ? scene.getVisualPuckOwnerId() : scene.puckSnapshot.ownerId;
  const visualHeld = scene.puckSnapshot.state === 'HELD' && !!visualOwnerId;

  if (!visualHeld) {
    scene.puckRender.x = puckWorld.x;
    scene.puckRender.y = puckWorld.y;
    scene.puckRender.vx = puckWorld.vx;
    scene.puckRender.vy = puckWorld.vy;
    scene.puckRender.state = 'FREE';
    scene.puckRender.ownerId = null;
    if (scene.puckSnapshot.state === 'HELD' && scene.puckSnapshot.ownerId === scene.clientId) {
      if (scene.clientId) {
        const target = playerCarryTargetWorld(scene, scene.clientId);
        if (target) {
          scene.puckRender.x = target.x;
          scene.puckRender.y = target.y;
          scene.puckRender.vx = (scene.predicted?.vx ?? puckWorld.vx) * 0.35;
          scene.puckRender.vy = (scene.predicted?.vy ?? puckWorld.vy) * 0.35;
        }
      }
    }
  } else {
    scene.puckRender.state = 'HELD';
    scene.puckRender.ownerId = visualOwnerId;
    const target = playerCarryTargetWorld(scene, visualOwnerId);
    if (target) {
      scene.puckRender.x = target.x;
      scene.puckRender.y = target.y;
      scene.puckRender.vx = scene.puckSnapshot.vx;
      scene.puckRender.vy = scene.puckSnapshot.vy;
    } else {
      scene.puckRender.x = puckWorld.x;
      scene.puckRender.y = puckWorld.y;
      scene.puckRender.vx = puckWorld.vx;
      scene.puckRender.vy = puckWorld.vy;
    }
  }

  const puckScreen = scene.worldToScreen(scene.puckRender.x, scene.puckRender.y);
  scene.puckGraphics.clear();
  if (visualHeld) {
    scene.puckGraphics.fillStyle(0xf2fbff, 0.1);
    scene.puckGraphics.fillCircle(puckScreen.x, puckScreen.y, puckRadius + 1.8);
  }
  scene.puckGraphics.fillStyle(0x111111, 1);
  scene.puckGraphics.fillCircle(puckScreen.x, puckScreen.y, puckRadius);
  scene.puckGraphics.lineStyle(visualHeld ? 1.8 : 1, visualHeld ? 0xf6fbff : 0xffffff, visualHeld ? 0.52 : 0.25);
  scene.puckGraphics.strokeCircle(puckScreen.x, puckScreen.y, puckRadius);
  if (turnoverPulseSec > 0) {
    const pulseAlpha = Math.min(0.34, turnoverPulseSec / 0.14);
    const pulseRadius = puckRadius + 2 + (1 - pulseAlpha / 0.34) * 4;
    scene.puckGraphics.lineStyle(2, 0xf4fbff, pulseAlpha);
    scene.puckGraphics.strokeCircle(puckScreen.x, puckScreen.y, pulseRadius);
  }
}

export function updateOverlay(_scene: any) {
  void _scene;
}

export function updateHud(scene: any, dtSec: number) {
  if (!scene.wsConnected) return;
  scene.hudAcc += dtSec;
  if (scene.hudAcc < 0.25) return;
  scene.hudAcc = 0;
  const next = '';
  if (next !== scene.lastHudText) {
    scene.lastHudText = next;
    scene.hud.setText(next);
  }
}
