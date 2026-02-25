import Matter from 'matter-js';
import type { Room } from '../room';
import type { ServerPlayer } from '../entities/player';

const CONTROL_RADIUS = 38;
const PASS_SPEED = 14;
const CHARGE_TICKS_MAX = 42;

function playerStickPoint(player: ServerPlayer) {
  const ox = Math.cos(player.aimAngle) * 28;
  const oy = Math.sin(player.aimAngle) * 28;
  return { x: player.body.position.x + ox, y: player.body.position.y + oy };
}

export function updatePuckCarrier(room: Room) {
  const puck = room.puck;
  const pBody = puck.body;

  let best: ServerPlayer | null = null;
  let bestDist = Infinity;
  const pSpeed = Math.hypot(pBody.velocity.x, pBody.velocity.y);

  for (const player of room.players.values()) {
    const tip = playerStickPoint(player);
    const d = Math.hypot(tip.x - pBody.position.x, tip.y - pBody.position.y);
    if (d < CONTROL_RADIUS && d < bestDist && pSpeed < 9) {
      best = player;
      bestDist = d;
    }
  }

  puck.carrierPlayerId = best?.id ?? null;
  if (best) {
    best.puckTouchScore += 1;
    best.lastTouchTick = room.serverTick;
    puck.lastTouchPlayerId = best.id;

    const tip = playerStickPoint(best);
    const dx = tip.x - pBody.position.x;
    const dy = tip.y - pBody.position.y;
    const k = 16;
    const followVx = dx * k + best.body.velocity.x;
    const followVy = dy * k + best.body.velocity.y;
    Matter.Body.setVelocity(pBody, { x: followVx, y: followVy });
  }
}

export function applyShootingAndPassing(room: Room, player: ServerPlayer) {
  const isCarrier = room.puck.carrierPlayerId === player.id;

  if (!isCarrier && player.chargingSinceTick !== null) {
    player.chargingSinceTick = null;
    return;
  }

  const q = player.inputQueue;
  let startCharge = false;
  let releaseCharge = false;
  let cancelCharge = false;
  let requestPass = false;

  for (const msg of q) {
    if (msg.buttons.lmbDown) startCharge = true;
    if (msg.buttons.lmbUp) releaseCharge = true;
    if ((msg.buttons.rmbDown || msg.buttons.rmbUp) && player.chargingSinceTick !== null) cancelCharge = true;
    if ((msg.buttons.rmbUp || msg.buttons.rmbDown) && player.chargingSinceTick === null) requestPass = true;
  }

  if (!isCarrier) return;

  if (startCharge && player.chargingSinceTick === null) {
    player.chargingSinceTick = room.serverTick;
  }

  if (cancelCharge) {
    player.chargingSinceTick = null;
    return;
  }

  if (releaseCharge) {
    const chargeTicks = player.chargingSinceTick === null ? 0 : Math.max(0, room.serverTick - player.chargingSinceTick);
    const charge01 = Math.min(1, chargeTicks / CHARGE_TICKS_MAX);
    const speed = 8 + 18 * charge01;
    const dirX = Math.cos(player.aimAngle);
    const dirY = Math.sin(player.aimAngle);
    Matter.Body.setVelocity(room.puck.body, { x: dirX * speed, y: dirY * speed });
    room.puck.lastTouchPlayerId = player.id;
    room.puck.carrierPlayerId = null;
    player.chargingSinceTick = null;
    return;
  }

  if (requestPass && player.chargingSinceTick === null) {
    const dirX = Math.cos(player.aimAngle);
    const dirY = Math.sin(player.aimAngle);
    Matter.Body.setVelocity(room.puck.body, { x: dirX * PASS_SPEED, y: dirY * PASS_SPEED });
    room.puck.lastTouchPlayerId = player.id;
    room.puck.carrierPlayerId = null;
  }
}
