import Matter from 'matter-js';
import { applyMovementStep } from '@flathockey/shared/sim/movementStep';
import type { ServerPlayer } from '../entities/player';

export function applyPlayerMovement(player: ServerPlayer, dt: number, hasPuck: boolean) {
  const input = player.latestInput;
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
      moveX: input.moveX,
      moveY: input.moveY,
      aimAngle: input.aimAngle,
      buttons: {
        sprint: input.buttons.sprint,
        brake: input.buttons.brake
      }
    },
    dt,
    { hasPuck }
  );

  Matter.Body.setVelocity(player.body, { x: state.vx, y: state.vy });
  player.stamina = state.stamina;
  player.aimAngle = state.aimAngle;
}
