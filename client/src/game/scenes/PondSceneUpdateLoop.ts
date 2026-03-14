import Phaser from 'phaser';
import { applyPredictedInput, CLIENT_FIXED_DT } from '../net/prediction';

const FIXED_STEP_MS = 1000 / 60;
const MAX_SIM_STEPS_PER_FRAME = 3;
const DT_CLAMP_MS = 34;
const HITCH_MS = 150;

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

  if (Phaser.Input.Keyboard.JustDown(scene.playerRigDebugToggleKey)) {
    scene.playerRigDebugEnabled = !scene.playerRigDebugEnabled;
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
    scene.pendingResyncReason = null;
    frameDtMs = 0;
  }

  if (frameDtMs > HITCH_MS) {
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
      scene.pendingInputs.push(input);
      if (scene.pendingInputs.length > 240) {
        scene.pendingInputs.splice(0, scene.pendingInputs.length - 240);
      }
      scene.recordInputSample(input, simStepTime);
      applyPredictedInput(scene.predicted, input, CLIENT_FIXED_DT);
      scene.localBuffer.push({
        x: scene.predicted.x,
        y: scene.predicted.y,
        rot: scene.predicted.angle,
        aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
        stickState: scene.predicted.stickState,
        stickTimer: scene.predicted.stickTimer,
        shotCharge: scene.predicted.shotCharge
      }, simStepTime);
      scene.ws.send(input);
    }
  }

  if (scene.simAccumulatorMs >= FIXED_STEP_MS) {
    scene.simAccumulatorMs = Math.min(scene.simAccumulatorMs, FIXED_STEP_MS);
  }

  const remoteTargetServerTime = scene.estimateServerNowMs(now) - scene.remoteInterpDelayMs;
  const visualPuckOwnerId =
    typeof scene.getVisualPuckOwnerId === 'function' ? scene.getVisualPuckOwnerId() : scene.puckSnapshot.ownerId;
  scene.updateHybridCamera(clampedDtMs / 1000, remoteTargetServerTime);
  scene.playerRenderWorldStates.clear();
  for (const [id, view] of scene.players.entries()) {
    let state: any = null;
    if (scene.clientId && id === scene.clientId) {
      state = scene.localBuffer.latest()?.value ?? null;
      if (!state && scene.predicted) {
        state = {
          x: scene.predicted.x,
          y: scene.predicted.y,
          rot: scene.predicted.angle,
          aimRot: scene.predicted.aimAngle ?? scene.predicted.angle,
          stickState: scene.predicted.stickState,
          stickTimer: scene.predicted.stickTimer,
          shotCharge: scene.predicted.shotCharge
        };
      }
      if (state) {
        if (!scene.localRenderState) {
          scene.localRenderState = { ...state };
        } else {
          const tauMs = 24;
          const alpha = 1 - Math.exp(-Math.max(0, clampedDtMs) / Math.max(1, tauMs));
          // Keep visuals locked to predicted physics position. Only orientation is smoothed.
          scene.localRenderState.x = state.x;
          scene.localRenderState.y = state.y;
          scene.localRenderState.rot = scene.lerpAngle(scene.localRenderState.rot, state.rot, alpha);
          // Keep local stick aim locked to current mouse-driven intent instead of visual body smoothing.
          scene.localRenderState.aimRot = state.aimRot ?? state.rot;
        }
        scene.localRenderState.stickState = state.stickState;
        scene.localRenderState.stickTimer = state.stickTimer;
        scene.localRenderState.shotCharge = state.shotCharge;
        state = scene.localRenderState;
      }
    } else {
      const interp = scene.remoteInterpolators.get(id);
      if (interp) state = scene.sampleInterpolated(interp, remoteTargetServerTime);
    }
    if (!state) continue;
    scene.playerRenderWorldStates.set(id, {
      x: state.x,
      y: state.y,
      rot: state.rot,
      aimRot: state.aimRot ?? state.rot,
      stickState: state.stickState,
      stickTimer: state.stickTimer,
      shotCharge: state.shotCharge
    });
    view.setRenderScale(scene.cameraWorldScale);
    const s = scene.worldToScreen(state.x, state.y);
    view.setState(
      s.x,
      s.y,
      state.x,
      state.y,
      state.rot,
      state.aimRot ?? state.rot
    );
    view.setStickVisualState(
      state.stickState,
      state.shotCharge ?? 0,
      state.stickTimer ?? 0,
      visualPuckOwnerId === id
    );
    view.setPresentationState(scene.clientId === id, visualPuckOwnerId === id);
    view.setDebugDrawEnabled(scene.playerRigDebugEnabled);
    view.draw(clampedDtMs / 1000);
  }

  scene.updateAndDrawPuck(clampedDtMs / 1000, remoteTargetServerTime);
  scene.updateCrosshairAndCursor();
  scene.updateOverlay();
  scene.updateHud(clampedDtMs / 1000);
}
