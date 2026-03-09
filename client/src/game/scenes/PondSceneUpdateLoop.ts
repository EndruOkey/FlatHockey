import Phaser from 'phaser';
import { wrapToPi } from '@flathockey/shared';
import { getTuning } from '../tuning/movementTuning';
import { applyPredictedInput, CLIENT_FIXED_DT, lastStepTrace } from '../net/prediction';
import { lastReconcileTrace } from '../net/reconciliation';

const FIXED_STEP_MS = 1000 / 60;
const MAX_SIM_STEPS_PER_FRAME = 3;
const DT_CLAMP_MS = 34;
const HITCH_MS = 150;
const VISUAL_STANDSTILL_EPS = 60;

function isStandstillSteerOnly(isLocalPlayer: boolean, speed: number, input: any): boolean {
  if (!isLocalPlayer || !input) return false;
  return speed <= VISUAL_STANDSTILL_EPS
    && (input.throttle ?? 0) === 0
    && (input.brake ?? 0) === 0
    && Math.abs(input.steer ?? 0) > 0;
}

export function runPondSceneUpdate(scene: any) {
  const now = performance.now();
  if (scene.lastFrameTimeMs === 0) {
    scene.lastFrameTimeMs = now;
    scene.renderClockMs = now;
    scene.simAccumulatorMs = 0;
    return;
  }

  let frameDtMs = now - scene.lastFrameTimeMs;
  scene.lastFrameTimeMs = now;

  if (Phaser.Input.Keyboard.JustDown(scene.recorderToggleKey)) {
    if (scene.inputRecorderEnabled) {
      scene.inputRecorderEnabled = false;
    } else {
      scene.stopReplay();
      scene.recordedInputs = [];
      scene.inputRecorderEnabled = true;
    }
  }

  if (Phaser.Input.Keyboard.JustDown(scene.replayToggleKey)) {
    if (scene.replayEnabled) scene.stopReplay();
    else scene.startReplay();
  }
  if (scene.needsResync) {
    scene.needsResync = false;
    const t = performance.now();
    scene.lastFrameTimeMs = t;
    scene.renderClockMs = t;
    scene.simAccumulatorMs = 0;
    scene.input.keyboard?.resetKeys();
    const localLatest = scene.localBuffer.latest();
    if (localLatest) scene.localBuffer.push(localLatest.value, t);
    scene.resyncCount += 1;
    scene.lastResyncReason = scene.pendingResyncReason ?? scene.lastResyncReason ?? 'resync';
    scene.pendingResyncReason = null;
    scene.lastResyncAtMs = t;
    frameDtMs = 0;
  }

  if (frameDtMs > HITCH_MS) {
    scene.hitchCount += 1;
    scene.lastHitchMs = frameDtMs;
    scene.simAccumulatorMs = 0;
    frameDtMs = 0;
  }

  const clampedDtMs = Math.min(frameDtMs, DT_CLAMP_MS);
  scene.renderClockMs += clampedDtMs;
  scene.simAccumulatorMs += clampedDtMs;

  let steps = 0;
  let simStepTime = scene.renderClockMs - scene.simAccumulatorMs;
  while (scene.simAccumulatorMs >= FIXED_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
    simStepTime += FIXED_STEP_MS;
    scene.simAccumulatorMs -= FIXED_STEP_MS;
    steps += 1;

    if (scene.clientId && scene.predicted && scene.wsConnected) {
      let input = scene.nextReplayInput();
      if (!input) input = scene.buildInput();
      scene.lastInputForRender = input;
      scene.pendingInputs.push(input);
      if (scene.pendingInputs.length > 240) {
        scene.pendingInputs.splice(0, scene.pendingInputs.length - 240);
      }
      scene.recordInputSample(input, simStepTime);
      const telemetry = applyPredictedInput(scene.predicted, input, CLIENT_FIXED_DT) as unknown as Record<string, any>;
      void telemetry;
      if (Number.isFinite(scene.predicted.angle)) {
        const diff = wrapToPi(scene.predicted.angle - scene.lastPredictedAngle);
        scene.lastTurnRateDeg = (diff / CLIENT_FIXED_DT) * 180 / Math.PI;
        scene.lastPredictedAngle = scene.predicted.angle;
      }
      scene.localBuffer.push({
        x: scene.predicted.x,
        y: scene.predicted.y,
        rot: scene.predicted.angle,
        aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
        moveRot: scene.predicted.moveAngle ?? scene.predicted.angle,
        baseRot: scene.predicted.baseBodyAngle ?? scene.predicted.angle,
        speed: Math.hypot(scene.predicted.vx ?? 0, scene.predicted.vy ?? 0)
      }, simStepTime);
      scene.ws.send(input);
      scene.inputsSentTimesMs.push(simStepTime);
      const cutoff = simStepTime - 1000;
      scene.inputsSentTimesMs = scene.inputsSentTimesMs.filter((t: number) => t >= cutoff);
    }
  }
  scene.simStepsThisFrame = steps;

  if (scene.simAccumulatorMs >= FIXED_STEP_MS) {
    scene.simCapHitCount += 1;
    scene.simAccumulatorMs = Math.min(scene.simAccumulatorMs, FIXED_STEP_MS);
  }

  const remoteTargetServerTime = scene.estimateServerNowMs(now) - scene.remoteInterpDelayMs;
  const tuning = getTuning();
  for (const [id, view] of scene.players.entries()) {
    let state: any = null;
    if (scene.clientId && id === scene.clientId) {
      const lastInput = scene.lastInputForRender;
      state = scene.localBuffer.latest()?.value ?? null;
      if (!state && scene.predicted) {
        state = {
          x: scene.predicted.x,
          y: scene.predicted.y,
          rot: scene.predicted.angle,
          aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
          moveRot: scene.predicted.moveAngle ?? scene.predicted.angle,
          baseRot: scene.predicted.baseBodyAngle ?? scene.predicted.angle,
          speed: Math.hypot(scene.predicted.vx ?? 0, scene.predicted.vy ?? 0)
        };
      }
      if (state) {
        const stateSpeed = Math.max(0, state.speed ?? 0);
        const standstillSteerLock = isStandstillSteerOnly(true, stateSpeed, lastInput);
        if (!scene.localRenderState) {
          scene.localRenderState = { ...state };
        } else {
          const tauMs = 24;
          const alpha = 1 - Math.exp(-Math.max(0, clampedDtMs) / Math.max(1, tauMs));
          if (standstillSteerLock) {
            // Hard visual lock at standstill steer-only: no positional interpolation tail.
            scene.localRenderState.x = state.x;
            scene.localRenderState.y = state.y;
          } else {
            scene.localRenderState.x += (state.x - scene.localRenderState.x) * alpha;
            scene.localRenderState.y += (state.y - scene.localRenderState.y) * alpha;
          }
          scene.localRenderState.rot = scene.lerpAngle(scene.localRenderState.rot, state.rot, alpha);
          scene.localRenderState.aimRot = scene.lerpAngle(scene.localRenderState.aimRot ?? state.aimRot ?? state.rot, state.aimRot ?? state.rot, alpha);
          scene.localRenderState.moveRot = scene.lerpAngle(scene.localRenderState.moveRot ?? state.moveRot ?? state.rot, state.moveRot ?? state.rot, alpha);
          scene.localRenderState.baseRot = scene.lerpAngle(scene.localRenderState.baseRot ?? state.baseRot ?? state.rot, state.baseRot ?? state.rot, alpha);
          scene.localRenderState.speed = (scene.localRenderState.speed ?? 0) + ((state.speed ?? 0) - (scene.localRenderState.speed ?? 0)) * alpha;
        }
        if (standstillSteerLock) {
          scene.localRenderState.speed = 0;
          (scene.localRenderState as any).standstillSteerLock = true;
        } else {
          (scene.localRenderState as any).standstillSteerLock = false;
        }
        state = scene.localRenderState;
      }
    } else {
      const interp = scene.remoteInterpolators.get(id);
      if (interp) state = scene.sampleInterpolated(interp, remoteTargetServerTime);
    }
    if (!state) continue;
    const s = scene.worldToScreen(state.x, state.y);
    view.setState(
      s.x,
      s.y,
      state.rot,
      state.aimRot ?? state.rot,
      state.moveRot ?? state.rot,
      state.baseRot ?? state.rot,
      state.speed ?? 0,
      !!(state as any).standstillSteerLock
    );
    view.setVisualLeanConfig({
      enabled: Boolean(tuning.visualLeanEnabled ?? true),
      maxPx: Number(tuning.visualLeanMaxPx ?? 6),
      tauMs: Number(tuning.visualLeanTauMs ?? 120),
      dampingRatio: Number(tuning.visualLeanDampingRatio ?? 1.0),
      maxAngleDeg: Number(tuning.visualLeanMaxAngleDeg ?? 60)
    });
    if (scene.clientId && id === scene.clientId) {
      const handedness = tuning.handedness === 'L' ? 'L' : 'R';
      view.setHandedness(handedness);
    } else {
      view.setHandedness('R');
    }
    view.setDebugDrawEnabled(false);
    view.draw(clampedDtMs / 1000);
    if (scene.standstillTrace && scene.clientId && id === scene.clientId) {
      const input = scene.lastInputForRender;
      const speed = Math.hypot(scene.predicted?.vx ?? 0, scene.predicted?.vy ?? 0);
      const steerOnlyNoBrake = isStandstillSteerOnly(true, speed, input);
      if (steerOnlyNoBrake) {
        scene.standstillTraceTick += 1;
        if (scene.standstillTraceTick % 6 === 0) {
          const anchors = view.getDebugWorldAnchors();
          const physicsRootX = scene.worldToScreen(scene.predicted?.x ?? 0, scene.predicted?.y ?? 0).x;
          const physicsRootY = scene.worldToScreen(scene.predicted?.x ?? 0, scene.predicted?.y ?? 0).y;
          console.log('[TRACE_STANDSTILL]', {
            input: {
              throttle: input?.throttle ?? 0,
              steer: input?.steer ?? 0,
              brake: input?.brake ?? 0
            },
            preStep: {
              x: lastStepTrace.preStepX,
              y: lastStepTrace.preStepY,
              vx: lastStepTrace.preStepVx,
              vy: lastStepTrace.preStepVy
            },
            postStep: {
              x: lastStepTrace.postStepX,
              y: lastStepTrace.postStepY,
              vx: lastStepTrace.postStepVx,
              vy: lastStepTrace.postStepVy,
              deltaPos: lastStepTrace.deltaPos
            },
            postReconcile: lastReconcileTrace,
            physicsRoot: { x: physicsRootX, y: physicsRootY },
            renderRoot: { x: state.x, y: state.y },
            bodyRigWorld: { x: anchors.bodyRigWorldX, y: anchors.bodyRigWorldY },
            stickWorld: { x: anchors.stickWorldX, y: anchors.stickWorldY },
            heading: scene.predicted?.heading ?? 0,
            moveAngle: scene.predicted?.moveAngle ?? 0,
            speed
          });
        }
      }
    }
  }

  scene.updateAndDrawPuck(clampedDtMs / 1000, remoteTargetServerTime);
  scene.updateCrosshairAndCursor();
  scene.perfSamples.push({ t: scene.renderClockMs, dtMs: frameDtMs });
  scene.updateOverlay();
  scene.updateHud(clampedDtMs / 1000);
}
