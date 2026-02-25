import { clamp } from '../util/clamp';
import type { ServerPlayer } from '../entities/player';

const DRAIN = 0.38;
const REGEN = 0.23;

export function updateStamina(player: ServerPlayer, dt: number, hasPuck: boolean) {
  const sprinting = player.latestInput.buttons.sprint;
  if (sprinting) {
    const drainMul = hasPuck ? 1.2 : 1;
    player.stamina = clamp(player.stamina - DRAIN * drainMul * dt, 0, 1);
  } else {
    player.stamina = clamp(player.stamina + REGEN * dt, 0, 1);
  }
}
