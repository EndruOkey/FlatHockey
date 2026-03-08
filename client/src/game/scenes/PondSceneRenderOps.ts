import { wrapToPi } from '@flathockey/shared';
import { PlayerView } from '../entities/playerView';
import { setMovementDebugMetrics } from '../debug/devPanelTelemetryState';
import { setNetDebugMetrics } from '../debug/netDebugState';
import { getTuning, getTuningApplyCount } from '../debug/movementTuning';
import { lastTelemetry, CLIENT_FIXED_DT } from '../net/prediction';
import { puckStickTuningStore } from '../tuning/puckStickTuningStore';
import { BUILD_VERSION } from '../../config/version';

export function updateCrosshairAndCursor(scene: any) {
  const tuning = getTuning();
  const pointer = scene.input.activePointer;
  const canvas = scene.game.canvas;
  const within = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= scene.scale.width && pointer.y <= scene.scale.height;
  if (canvas) {
    canvas.style.cursor = (tuning.hideSystemCursor && within) ? 'none' : '';
  }

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

export function drawMovementDebugVectors(scene: any) {
  const tuning = getTuning();
  scene.motionDebugGraphics.clear();
  if (!scene.debugEnabled) return;
  if (!scene.predicted || !(tuning.drawVectors || tuning.debugDrawVectors || tuning.drawVelComponents || tuning.drawMoveVector || tuning.drawBodyVector || tuning.drawAimVector || tuning.drawAimVectorRaw || tuning.drawAimVectorClamped)) return;
  const p = scene.worldToScreen(scene.predicted.x, scene.predicted.y);
  const speed = Math.hypot(scene.predicted.vx, scene.predicted.vy);
  const velScale = 0.18;
  const headingLen = 36;
  const desiredLen = 30;
  const moveAngle = Number.isFinite(scene.predicted.moveAngle) ? scene.predicted.moveAngle! : (Number.isFinite(scene.predicted.heading) ? scene.predicted.heading! : scene.predicted.angle);
  const aimAngle = Number.isFinite(scene.predicted.aimAngle) ? scene.predicted.aimAngle! : scene.lastAimAngle;
  const aimAngleRaw = Number.isFinite(scene.predicted.aimAngleRaw) ? scene.predicted.aimAngleRaw! : aimAngle;
  const bodyAngle = scene.predicted.angle;
  const heading = moveAngle;

  if (tuning.drawMoveVector || tuning.drawVectors || tuning.debugDrawVectors) {
    scene.motionDebugGraphics.lineStyle(2, 0x4cc9a8, 0.85);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(moveAngle) * headingLen,
      p.y + Math.sin(moveAngle) * headingLen
    );
  }

  scene.motionDebugGraphics.lineStyle(2, 0x67b6ff, 0.85);
  scene.motionDebugGraphics.lineBetween(
    p.x,
    p.y,
    p.x + scene.predicted.vx * velScale,
    p.y + scene.predicted.vy * velScale
  );

  if (tuning.drawAimVector || tuning.drawVectors || tuning.debugDrawVectors) {
    scene.motionDebugGraphics.lineStyle(2, 0xf0d776, 0.9);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(aimAngle) * desiredLen,
      p.y + Math.sin(aimAngle) * desiredLen
    );
  }
  if (tuning.drawBodyVector) {
    scene.motionDebugGraphics.lineStyle(2, 0x8ed7ff, 0.9);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(bodyAngle) * desiredLen,
      p.y + Math.sin(bodyAngle) * desiredLen
    );
  }
  if (tuning.drawAimVectorRaw) {
    scene.motionDebugGraphics.lineStyle(2, 0xff9f70, 0.9);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(aimAngleRaw) * desiredLen,
      p.y + Math.sin(aimAngleRaw) * desiredLen
    );
  }
  if (tuning.drawAimVectorClamped) {
    scene.motionDebugGraphics.lineStyle(2, 0xfee06a, 0.95);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(aimAngle) * (desiredLen + 8),
      p.y + Math.sin(aimAngle) * (desiredLen + 8)
    );
  }

  if (tuning.drawVelComponents) {
    const telemetry = (lastTelemetry || {}) as Record<string, any>;
    const forward = Number(telemetry.velForward ?? 0);
    const side = Number(telemetry.velSide ?? 0);
    const compScale = 0.18;
    scene.motionDebugGraphics.lineStyle(2, 0x70f5d0, 0.9);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + Math.cos(heading) * forward * compScale,
      p.y + Math.sin(heading) * forward * compScale
    );
    const rightX = -Math.sin(heading);
    const rightY = Math.cos(heading);
    scene.motionDebugGraphics.lineStyle(2, 0xff8ab8, 0.9);
    scene.motionDebugGraphics.lineBetween(
      p.x,
      p.y,
      p.x + rightX * side * compScale,
      p.y + rightY * side * compScale
    );
  }

  if (tuning.debugDrawArcPreview) {
    const preview = scene.worldToScreen(
      scene.predicted.x + scene.predicted.vx * 0.2,
      scene.predicted.y + scene.predicted.vy * 0.2
    );
    scene.motionDebugGraphics.fillStyle(0xfff3a0, 0.9);
    scene.motionDebugGraphics.fillCircle(preview.x, preview.y, 2.5);
    scene.motionDebugGraphics.lineStyle(1, 0xfff3a0, 0.6);
    scene.motionDebugGraphics.lineBetween(p.x, p.y, preview.x, preview.y);
  }

  if (tuning.drawAimLine) {
    const pointer = scene.input.activePointer;
    scene.motionDebugGraphics.lineStyle(1.5, 0xfff67a, 0.8);
    scene.motionDebugGraphics.lineBetween(p.x, p.y, pointer.x, pointer.y);
  }

  if (speed < 0.001) {
    scene.motionDebugGraphics.fillStyle(0x67b6ff, 0.9);
    scene.motionDebugGraphics.fillCircle(p.x, p.y, 1.5);
  }
}

function stickTargetScreen(scene: any, view: PlayerView) {
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
      const target = stickTargetScreen(scene, owner);
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

  if (tuning.drawPuckVelocity) {
    scene.puckGraphics.lineStyle(2, 0xffe279, 0.8);
    scene.puckGraphics.lineBetween(
      scene.puckRender.x,
      scene.puckRender.y,
      scene.puckRender.x + scene.puckRender.vx * 0.08,
      scene.puckRender.y + scene.puckRender.vy * 0.08
    );
  }

  if (scene.debugEnabled && (tuning.drawStickTarget || tuning.drawStickHitbox || tuning.drawPickupRadius || tuning.drawMagnetRadius)) {
    for (const view of scene.players.values()) {
      const t = stickTargetScreen(scene, view);
      if (tuning.drawStickTarget) {
        scene.puckGraphics.fillStyle(0x59d1ff, 0.8);
        scene.puckGraphics.fillCircle(t.x, t.y, 3);
      }
      if (tuning.drawStickHitbox) {
        scene.puckGraphics.lineStyle(1, 0x59d1ff, 0.5);
        scene.puckGraphics.strokeCircle(t.x, t.y, tuning.stickTipRadius);
      }
    }
  }

  if (scene.debugEnabled && tuning.drawPickupRadius && scene.clientId) {
    const local = scene.players.get(scene.clientId);
    if (local) {
      const t = stickTargetScreen(scene, local);
      scene.puckGraphics.lineStyle(1, 0x8cffb7, 0.45);
      scene.puckGraphics.strokeCircle(t.x, t.y, tuning.pickupRadius);
    }
  }
  if (scene.debugEnabled && tuning.drawMagnetRadius && scene.clientId) {
    const local = scene.players.get(scene.clientId);
    if (local) {
      const t = stickTargetScreen(scene, local);
      scene.puckGraphics.lineStyle(1, 0x67a5ff, 0.35);
      scene.puckGraphics.strokeCircle(t.x, t.y, tuning.magnetRadius);
    }
  }
}

function getPerfStats(scene: any) {
  scene.perfSamples = scene.perfSamples.filter((s: any) => s.t >= scene.renderClockMs - 1000);
  if (scene.perfSamples.length === 0) return { fps: 0, dtMax: 0 };
  let dtSum = 0;
  let dtMax = 0;
  for (const sample of scene.perfSamples) {
    dtSum += sample.dtMs;
    dtMax = Math.max(dtMax, sample.dtMs);
  }
  const avg = dtSum / scene.perfSamples.length;
  return { fps: avg > 0 ? 1000 / avg : 0, dtMax };
}

export function updateOverlay(scene: any) {
  scene.debugOverlay.setVisible(scene.debugEnabled);
  const perf = getPerfStats(scene);
  const now = performance.now();
  const applyNow = getTuningApplyCount();
  const applyDtSec = Math.max(0.001, (now - scene.tuningApplySampleLastTs) / 1000);
  const applyDelta = Math.max(0, applyNow - scene.tuningApplySampleLastCount);
  scene.tuningApplyCountPerSec = applyDelta / applyDtSec;
  scene.tuningApplySampleLastTs = now;
  scene.tuningApplySampleLastCount = applyNow;
  const rttMs = scene.ws.getRttMs();
  const latestSnapshotAge = scene.latestSnapshotAtMs > 0 ? now - scene.latestSnapshotAtMs : -1;
  const snapshotRate = scene.snapshotReceiveTimes.length;
  let remoteBufferLenAvg = 0;
  let remoteBufferCount = 0;
  for (const [id, interp] of scene.remoteInterpolators.entries()) {
    if (scene.clientId && id === scene.clientId) continue;
    remoteBufferLenAvg += interp.size();
    remoteBufferCount += 1;
  }
  remoteBufferLenAvg = remoteBufferCount > 0 ? remoteBufferLenAvg / remoteBufferCount : 0;
  const tuning = getTuning();
  const puckStick = puckStickTuningStore.get();
  const telemetry = (lastTelemetry || {}) as Record<string, any>;
  const localView = scene.clientId ? scene.players.get(scene.clientId) : null;
  const puckStateLine = puckStick.drawPuckState ? `puckState=${scene.puckSnapshot.state} owner=${scene.puckSnapshot.ownerId ?? '-'}` : null;
  const stickTargetLine = (() => {
    if (!puckStick.drawStickTarget || !scene.clientId) return null;
    const local = scene.players.get(scene.clientId);
    if (!local) return null;
    const t = stickTargetScreen(scene, local);
    const wx = t.x - scene.scale.width / 2;
    const wy = t.y - scene.scale.height / 2;
    return `stickTarget=(${wx.toFixed(1)}, ${wy.toFixed(1)})`;
  })();
  const pickupRadiusLine = puckStick.drawPickupRadius ? `pickupRadius=${puckStick.pickupRadius.toFixed(1)}` : null;
  const showTarget = Boolean(tuning.showTargetAngle ?? tuning.drawTargetAngle);
  const showHeading = Boolean(tuning.showHeading ?? false);
  const headingLine = showHeading && scene.predicted
    ? `bodyWorld=${(scene.predicted.angle * 180 / Math.PI).toFixed(1)} move=${((scene.predicted.moveAngle ?? scene.predicted.heading ?? 0) * 180 / Math.PI).toFixed(1)} aim=${((scene.predicted.aimAngle ?? 0) * 180 / Math.PI).toFixed(1)}`
    : null;
  const targetAngleLine = showTarget
    ? `aim cur=${(scene.aimCurrentAngle * 180 / Math.PI).toFixed(1)} target=${(scene.aimTargetAngle * 180 / Math.PI).toFixed(1)} diff=${(scene.aimAngleDiff * 180 / Math.PI).toFixed(1)}`
    : null;
  const vectorsLine = (tuning.drawVectors || tuning.debugDrawVectors)
    ? `vectors move=${Number(telemetry.moveAngle ?? scene.lastMoveAngle).toFixed(2)} body=${Number(scene.predicted?.angle ?? 0).toFixed(2)} aimRaw=${Number(telemetry.aimAngleRaw ?? scene.lastAimAngle).toFixed(2)} aim=${Number(telemetry.aimAngle ?? scene.lastAimAngle).toFixed(2)}`
    : null;
  const anglesLine = tuning.showAngles
    ? `angles desiredMove=${(Number(telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle) * 180 / Math.PI).toFixed(1)} actualMove=${(Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle) * 180 / Math.PI).toFixed(1)} baseBody=${(Number(telemetry.baseBodyAngle ?? scene.predicted?.baseBodyAngle ?? scene.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} body=${(Number(scene.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} aimRaw=${(Number(telemetry.aimAngleRaw ?? scene.lastAimAngle) * 180 / Math.PI).toFixed(1)} aim=${(Number(telemetry.aimAngle ?? scene.lastAimAngle) * 180 / Math.PI).toFixed(1)}`
    : null;
  const angleDiffLine = tuning.showAngleDiff
    ? `angleDiff raw=${(Number(telemetry.aimDiffRaw ?? 0) * 180 / Math.PI).toFixed(1)} clamped=${(Number(telemetry.aimDiffClamped ?? 0) * 180 / Math.PI).toFixed(1)} velVsDesired=${Number(telemetry.velocityDesiredDeltaDeg ?? 0).toFixed(1)}`
    : null;
  const stickRuntimeLine = tuning.showAngleDiff
    ? `stick target=${(Number(telemetry.targetAimAngle ?? telemetry.aimAngle ?? scene.lastAimAngle) * 180 / Math.PI).toFixed(1)} simActual=${(Number(telemetry.aimAngle ?? scene.lastAimAngle) * 180 / Math.PI).toFixed(1)} renderActual=${(Number(localView?.getStickRotation() ?? (telemetry.aimAngle ?? scene.lastAimAngle)) * 180 / Math.PI).toFixed(1)} deltaDeg=${Number(telemetry.stickDeltaDeg ?? 0).toFixed(1)} angVelDeg=${Number(telemetry.stickAngVelDeg ?? 0).toFixed(1)} mode=${String(telemetry.stickMode ?? 'APPROACH')}`
    : null;
  const bodyYawLine = tuning.showAngleDiff
    ? `bodyYaw base=${(Number(telemetry.baseBodyAngle ?? scene.predicted?.baseBodyAngle ?? scene.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)} offset=${(Number(telemetry.bodyYawOffset ?? scene.predicted?.bodyYawOffset ?? 0) * 180 / Math.PI).toFixed(1)} final=${(Number(scene.predicted?.angle ?? 0) * 180 / Math.PI).toFixed(1)}`
    : null;
  const stickLimitLine = tuning.showAngleDiff
    ? `stick angVelClamped=${telemetry.stickAngVelClamped ? 'on' : 'off'} targetSlewActive=${telemetry.targetSlewActive ? 'on' : 'off'} aimInputRateLimited=${telemetry.aimInputRateLimited ? 'on' : 'off'} rotSpace=${PlayerView.getStickRotationSpace()} spriteOffsetDeg=${PlayerView.getStickSpriteForwardOffsetDeg().toFixed(1)}`
    : null;
  const snapLine = tuning.showSnapFactor ? `snapFactor=${Number(telemetry.snapFactor ?? 0).toFixed(2)}` : null;
  const brakeAssistLine = tuning.showBrakeActive ? `brakeAssist=${telemetry.brakeAssistActive ? 'on' : 'off'}` : null;
  const startModeLine = tuning.showStartMode
    ? `startMode=${telemetry.startModeActive ? 'on' : 'off'} brake=${telemetry.brakeApplied > 0 ? 'on' : 'off'} charge=${telemetry.chargeActive ? 'on' : 'off'} turnRateApplied=${Number(telemetry.turnRateAppliedDeg ?? 0).toFixed(1)} fwd=${Number(telemetry.velForward ?? 0).toFixed(1)} side=${Number(telemetry.velSide ?? 0).toFixed(1)}`
    : null;
  const v4StabilityLine = tuning.showAngleDiff
    ? `phase=${String(telemetry.movementPhase ?? 'GLIDE')} lowSteerOff=${telemetry.lowSpeedSteeringDisabled ? 'on' : 'off'} lowStart=${telemetry.lowSpeedStartupActive ? 'on' : 'off'} latch=${telemetry.startupLatchActive ? 'on' : 'off'} latchIgn=${telemetry.latchedInputIgnored ? 'on' : 'off'} latchRel=${(Number(telemetry.startupReleaseTimer ?? 0) * 1000).toFixed(0)}ms travelLock=${telemetry.travelDirLocked ? 'on' : 'off'} minSteer=${Number(telemetry.minSteerSpeed ?? 0).toFixed(1)} startCommit=${telemetry.startCommitActive ? 'on' : 'off'} startTimer=${(Number(telemetry.startCommitTimer ?? 0) * 1000).toFixed(0)}ms startDir=(${Number(telemetry.startDirX ?? 0).toFixed(2)}, ${Number(telemetry.startDirY ?? 0).toFixed(2)}) effStart=(${Number(telemetry.effectiveStartDirX ?? 0).toFixed(2)}, ${Number(telemetry.effectiveStartDirY ?? 0).toFixed(2)}) carveLock=${(Number(telemetry.carveLockTimer ?? 0) * 1000).toFixed(0)}ms carveSide=${Number(telemetry.carveSide ?? 0)} signed=${(Number(telemetry.signedInputVsVelocityAngle ?? 0) * 180 / Math.PI).toFixed(1)}deg commit=${(Number(telemetry.commitTimer ?? 0) * 1000).toFixed(0)}ms hold=${(Number(telemetry.oppositeHoldTimer ?? 0) * 1000).toFixed(0)}ms steerDir=(${Number(telemetry.steerDirX ?? 0).toFixed(2)}, ${Number(telemetry.steerDirY ?? 0).toFixed(2)})`
    : null;

  if (scene.debugEnabled) {
    scene.debugOverlay.setText([
      'DEBUG [F3]',
      `RTT=${rttMs >= 0 ? rttMs.toFixed(1) : '-'}ms snapRate=${snapshotRate}/s interpDelay=${scene.remoteInterpDelayMs.toFixed(0)}ms`,
      `snapshotAgeMs=${latestSnapshotAge.toFixed(1)} bufferLenAvg=${remoteBufferLenAvg.toFixed(1)} droppedSnapshots=${scene.droppedSnapshots}`,
      `FPS=${perf.fps.toFixed(1)} dtMax1s=${perf.dtMax.toFixed(2)}ms`,
      `devApplyCountPerSec=${scene.tuningApplyCountPerSec.toFixed(1)}`,
      `seq=${scene.seq} ack=${scene.ackSeq} pending=${scene.pendingInputs.length}`,
      `recorder=${scene.replayEnabled ? 'replaying' : scene.inputRecorderEnabled ? 'recording' : 'idle'} frames=${scene.recordedInputs.length}`,
      `simStepsThisFrame=${scene.simStepsThisFrame} capHitCount=${scene.simCapHitCount}`,
      `hitchCount=${scene.hitchCount} lastHitchMs=${scene.lastHitchMs.toFixed(1)} needsResync=${scene.needsResync}`,
      `resyncCount=${scene.resyncCount} lastResyncReason=${scene.lastResyncReason ?? '-'} resyncAtMs=${scene.lastResyncAtMs.toFixed(1)}`,
      ...(puckStateLine ? [puckStateLine] : []),
      ...(stickTargetLine ? [stickTargetLine] : []),
      ...(pickupRadiusLine ? [pickupRadiusLine] : []),
      ...(headingLine ? [headingLine] : []),
      ...(targetAngleLine ? [targetAngleLine] : []),
      ...(vectorsLine ? [vectorsLine] : []),
      ...(anglesLine ? [anglesLine] : []),
      ...(angleDiffLine ? [angleDiffLine] : []),
      ...(stickRuntimeLine ? [stickRuntimeLine] : []),
      ...(bodyYawLine ? [bodyYawLine] : []),
      ...(stickLimitLine ? [stickLimitLine] : []),
      ...(v4StabilityLine ? [v4StabilityLine] : []),
      ...(snapLine ? [snapLine] : []),
      ...(brakeAssistLine ? [brakeAssistLine] : []),
      ...(startModeLine ? [startModeLine] : []),
      `speed=${scene.debugCurrentSpeed.toFixed(1)} drift=${(telemetry.driftAngle || 0).toFixed(2)} speedRatio=${(scene.debugSpeedRatio * 100).toFixed(0)}%`,
      `tuningVersion=${tuning.__version ?? 0} accel=${tuning.accel} maxSpeed=${tuning.maxSpeed} dragMove=${tuning.dragMove} dragIdle=${tuning.dragIdle} lateralGrip=${tuning.lateralGrip}`,
      `USED speed=${(telemetry.currentSpeed ?? '-')} lat=${(telemetry.lateralSpeed ?? '-')} fwd=${(telemetry.forwardSpeed ?? '-')}`
    ].join('\n'));
  }

  setNetDebugMetrics({
    pingMs: rttMs,
    serverTick: scene.latestServerTick,
    snapshotRate,
    players: scene.players.size,
    snapshotDelayMs: Math.max(0, latestSnapshotAge),
    inputDelayMs: scene.pendingInputs.length * CLIENT_FIXED_DT * 1000,
    inputRate: scene.inputsSentTimesMs.length,
    pendingInputs: scene.pendingInputs.length,
    clientFps: perf.fps
  });

  const velX = scene.predicted?.vx ?? 0;
  const velY = scene.predicted?.vy ?? 0;
  const currentSpeed = Math.hypot(velX, velY);
  const velocityAngle = currentSpeed > 0.001
    ? Math.atan2(velY, velX)
    : Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle);
  const localAimRot = localView?.getAimRotation() ?? (scene.predicted?.aimAngle ?? scene.lastAimAngle);
  const localStickRot = localView?.getStickRotation() ?? localAimRot;
  const localStickWorldAngle = localView?.getStickWorldAngle() ?? localAimRot;
  setMovementDebugMetrics({
    currentSpeed,
    velocityX: velX,
    velocityY: velY,
    velocityVector: `(${velX.toFixed(2)}, ${velY.toFixed(2)})`,
    turnRate: scene.lastTurnRateDeg,
    turnRateAppliedDeg: Number(telemetry.turnRateAppliedDeg ?? 0),
    inputVector: `(${scene.lastInputVector.x}, ${scene.lastInputVector.y})`,
    rawInputVector: `(${Number(telemetry.rawInputX ?? scene.lastInputVector.x).toFixed(2)}, ${Number(telemetry.rawInputY ?? scene.lastInputVector.y).toFixed(2)})`,
    filteredInputVector: `(${Number(telemetry.filteredInputX ?? telemetry.desiredInputX ?? 0).toFixed(2)}, ${Number(telemetry.filteredInputY ?? telemetry.desiredInputY ?? 0).toFixed(2)})`,
    desiredInputVector: `(${Number(telemetry.desiredInputX ?? 0).toFixed(2)}, ${Number(telemetry.desiredInputY ?? 0).toFixed(2)})`,
    pointerVector: `(${scene.lastPointerVector.x.toFixed(1)}, ${scene.lastPointerVector.y.toFixed(1)})`,
    aimAngle: localAimRot,
    bodyWorldAngle: Number(scene.predicted?.angle ?? 0),
    targetAimAngle: Number(telemetry.targetAimAngle ?? scene.aimTargetAngle ?? localAimRot),
    stickRotation: localStickRot,
    actualStickAngle: localStickWorldAngle,
    stickAngularSpeed: Number(telemetry.stickAngVelDeg ?? 0) * Math.PI / 180,
    angleDelta: Number(telemetry.stickDeltaDeg ?? 0) * Math.PI / 180,
    stickAngleDeltaToTarget: wrapToPi(Number(telemetry.targetAimAngle ?? scene.aimTargetAngle ?? localAimRot) - localStickWorldAngle),
    stickSpriteForwardOffsetDeg: PlayerView.getStickSpriteForwardOffsetDeg(),
    stickRotationSpace: PlayerView.getStickRotationSpace(),
    desiredMoveAngle: Number(telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle),
    turnIntentAngle: Number(telemetry.turnIntentAngle ?? telemetry.desiredMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle),
    actualMoveAngle: Number(telemetry.actualMoveAngle ?? telemetry.moveAngle ?? scene.lastMoveAngle),
    velocityAngle,
    forwardVelocity: Number(telemetry.velForward ?? 0),
    lateralVelocity: Number(telemetry.velSide ?? 0),
    velocityDesiredDeltaDeg: Number(telemetry.velocityDesiredDeltaDeg ?? 0),
    turnResistance: Number(telemetry.turnResistance ?? 0),
    redirectAccelScale: Number(telemetry.redirectAccelScale ?? 1),
    antiFlipActive: Boolean(telemetry.antiFlipActive ?? false),
    appliedForwardForce: Number(telemetry.appliedForwardForce ?? 0),
    appliedLateralForce: Number(telemetry.appliedLateralForce ?? 0),
    edgeFactor: Number(telemetry.edgeFactor ?? 0),
    commitTimer: Number(telemetry.commitTimer ?? 0),
    oppositeHoldTimer: Number(telemetry.oppositeHoldTimer ?? 0),
    steerDir: `(${Number(telemetry.steerDirX ?? 0).toFixed(2)}, ${Number(telemetry.steerDirY ?? 0).toFixed(2)})`,
    movementPhase: String(telemetry.movementPhase ?? 'GLIDE'),
    carveLockTimer: Number(telemetry.carveLockTimer ?? 0),
    carveSide: Number(telemetry.carveSide ?? 0),
    signedInputVsVelocityAngle: Number(telemetry.signedInputVsVelocityAngle ?? 0),
    minSteerSpeed: Number(telemetry.minSteerSpeed ?? 0),
    lowSpeedSteeringDisabled: Boolean(telemetry.lowSpeedSteeringDisabled ?? false),
    lowSpeedStartupActive: Boolean(telemetry.lowSpeedStartupActive ?? false),
    travelDirLocked: Boolean(telemetry.travelDirLocked ?? false),
    startupLatchActive: Boolean(telemetry.startupLatchActive ?? false),
    latchedInputIgnored: Boolean(telemetry.latchedInputIgnored ?? false),
    startupReleaseTimer: Number(telemetry.startupReleaseTimer ?? 0),
    startCommitActive: Boolean(telemetry.startCommitActive ?? false),
    startCommitTimer: Number(telemetry.startCommitTimer ?? 0),
    startDir: `(${Number(telemetry.startDirX ?? 0).toFixed(2)}, ${Number(telemetry.startDirY ?? 0).toFixed(2)})`,
    effectiveStartDir: `(${Number(telemetry.effectiveStartDirX ?? 0).toFixed(2)}, ${Number(telemetry.effectiveStartDirY ?? 0).toFixed(2)})`,
    brakeActive: Number(telemetry.brakeApplied ?? 0) > 0.0001,
    chargeActive: Boolean(telemetry.chargeActive ?? scene.predicted?.chargeActive ?? false),
    baseBodyAngle: Number(scene.predicted?.baseBodyAngle ?? telemetry.baseBodyAngle ?? scene.predicted?.angle ?? 0),
    bodyYawOffset: Number(scene.predicted?.bodyYawOffset ?? telemetry.bodyYawOffset ?? 0),
    currentBodyAngle: Number(scene.predicted?.angle ?? 0),
    bodyTurnInput: Number(telemetry.bodyTurnInput ?? 0),
    activeBodyModel: String(telemetry.activeBodyModel ?? 'B'),
    recorderState: scene.replayEnabled ? 'replaying' : scene.inputRecorderEnabled ? 'recording' : 'idle',
    recordedFrames: scene.recordedInputs.length
  });
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
    `Seq/Ack: ${scene.seq}/${scene.ackSeq}`,
    `Pending: ${scene.pendingInputs.length}`,
    'WASD move | SPACE brake | RMB charge/crosscheck | E/LMB shoot'
  ].join('\n');
  if (next !== scene.lastHudText) {
    scene.lastHudText = next;
    scene.hud.setText(next);
  }
}
