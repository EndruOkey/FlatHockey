import type { InputMsg } from '@flathockey/shared';
import { applyMovementStep, type MovementStepConfig, type MovementStepState } from '@flathockey/shared/sim/movementStep';
import { getTuning } from '../tuning/movementTuning';
import type { PredictedPlayerState } from './predictionState.types';

export type { PredictedPlayerState } from './predictionState.types';

export const CLIENT_FIXED_DT = 1 / 60;

let aimInputRateLimited = false;

export function setAimInputRateLimited(flag: boolean) {
  aimInputRateLimited = !!flag;
}

export function getAimInputRateLimited() {
  return aimInputRateLimited;
}

function toStepState(state: PredictedPlayerState): MovementStepState {
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    speed: Number.isFinite(state.speed) ? state.speed : Math.hypot(state.vx, state.vy),
    heading: Number.isFinite(state.heading) ? state.heading : state.angle,
    headingOmega: Number.isFinite(state.headingOmega) ? state.headingOmega : 0,
    moveAngle: Number.isFinite(state.moveAngle) ? state.moveAngle : state.angle,
    aimAngle: Number.isFinite(state.aimAngle) ? state.aimAngle : state.angle,
    stamina: Number.isFinite(state.stamina) ? state.stamina! : 1,
    reverseState: state.reverseState === 'REVERSING' ? 'REVERSING' : 'FORWARD'
  };
}

function fromStepState(state: PredictedPlayerState, sim: MovementStepState) {
  state.x = sim.x;
  state.y = sim.y;
  state.vx = sim.vx;
  state.vy = sim.vy;
  state.speed = sim.speed;
  state.heading = sim.heading;
  state.headingOmega = sim.headingOmega;
  state.moveAngle = sim.moveAngle;
  state.aimAngle = sim.aimAngle;
  state.stamina = sim.stamina;
  state.reverseState = sim.reverseState;
  state.angle = sim.heading;
}

export function applyPredictedInput(state: PredictedPlayerState, input: InputMsg, dt = CLIENT_FIXED_DT) {
  const tuning = getTuning();
  const config: MovementStepConfig = { ...tuning };
  const simState = toStepState(state);

  applyMovementStep(
    simState,
    {
      throttle: input.throttle,
      steer: input.steer,
      brake: !!input.brake,
      shoot: !!input.shoot,
      aimAngle: Number.isFinite(input.aimAngle) ? input.aimAngle : simState.aimAngle
    },
    dt,
    config
  );

  fromStepState(state, simState);
}
