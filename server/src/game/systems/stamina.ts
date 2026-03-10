import { clamp } from '../util/clamp';
import type { ServerPlayer } from '../entities/player';

export function updateStamina(player: ServerPlayer, dt: number, _hasPuck: boolean) {
  // Sprint is not implemented yet; stamina only regenerates.
  const REGEN = 0.23;
  player.stamina = clamp(player.stamina + REGEN * dt, 0, 1);
}
