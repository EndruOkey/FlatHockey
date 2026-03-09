import Matter from 'matter-js';
import { applyMovementStep } from '@flathockey/shared/sim/movementStep';
import type { ServerPlayer } from '../entities/player';

export function applyPlayerMovement(
  player: ServerPlayer,
  dt: number,
  hasPuck: boolean,
  tuningPatch: Partial<import('@flathockey/shared/sim/movementStep').MovementStepConfig> = {}
) {
  const input = player.latestInput;
  const throttle = typeof (input as any).throttle === 'number'
    ? ((input as any).throttle < 0 ? -1 : (input as any).throttle > 0 ? 1 : 0)
    : 0;
  const steer = typeof (input as any).steer === 'number'
    ? ((input as any).steer < 0 ? -1 : (input as any).steer > 0 ? 1 : 0)
    : 0;
  const state = {
    x: player.body.position.x,
    y: player.body.position.y,
    vx: player.body.velocity.x,
    vy: player.body.velocity.y,
    stamina: player.stamina,
    aimAngle: player.aimAngle
  };

  applyMovementStep(
    state,
    {
      throttle,
      steer,
      brake: !!input.buttons.brake,
      shoot: !!input.buttons.shoot,
      aimAngle: input.aimAngle,
    },
    dt,
    { hasPuck, ...tuningPatch }
  );

  Matter.Body.setVelocity(player.body, { x: state.vx, y: state.vy });
  player.stamina = state.stamina;
  player.aimAngle = state.aimAngle;
}
