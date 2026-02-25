import Matter from 'matter-js';
import type { Room } from '../room';
import type { ServerPlayer } from '../entities/player';

const DEFENSE_REACH = 56;
const DEFENSE_COOLDOWN = 16;

export function applyDefense(room: Room, player: ServerPlayer) {
  if (room.serverTick < player.defenseCooldownUntilTick) return;
  if (room.puck.carrierPlayerId === player.id) return;

  const usedDefense = player.inputQueue.some((i) => i.buttons.rmbDown || i.buttons.rmbUp);
  if (!usedDefense) return;

  const puck = room.puck.body;
  const tipX = player.body.position.x + Math.cos(player.aimAngle) * 28;
  const tipY = player.body.position.y + Math.sin(player.aimAngle) * 28;
  const d = Math.hypot(tipX - puck.position.x, tipY - puck.position.y);
  if (d > DEFENSE_REACH) {
    player.defenseCooldownUntilTick = room.serverTick + DEFENSE_COOLDOWN;
    return;
  }

  const pSpeed = Math.hypot(puck.velocity.x, puck.velocity.y);
  if (pSpeed < 3.2) {
    room.puck.carrierPlayerId = player.id;
    room.puck.lastTouchPlayerId = player.id;
  } else {
    const nx = (puck.position.x - player.body.position.x) / Math.max(1, d);
    const ny = (puck.position.y - player.body.position.y) / Math.max(1, d);
    Matter.Body.applyForce(puck, puck.position, { x: nx * 0.008, y: ny * 0.008 });
  }

  player.defenseCooldownUntilTick = room.serverTick + DEFENSE_COOLDOWN;
}
