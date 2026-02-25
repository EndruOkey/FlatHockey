import Matter from 'matter-js';
import type { Room } from '../room';
import { RINK } from '../world';

export function applyCreaseDamping(room: Room) {
  const puck = room.puck.body;
  const nearLeftCrease = puck.position.x < RINK.left + RINK.creaseDepth + 15 && Math.abs(puck.position.y) < RINK.goalHalfHeight * 1.1;
  const nearRightCrease = puck.position.x > RINK.right - RINK.creaseDepth - 15 && Math.abs(puck.position.y) < RINK.goalHalfHeight * 1.1;

  if (nearLeftCrease || nearRightCrease) {
    Matter.Body.setVelocity(puck, { x: puck.velocity.x * 0.91, y: puck.velocity.y * 0.91 });
  }
}

export function detectGoal(room: Room): 'A' | 'B' | null {
  if (room.match.phase !== 'PLAYING') return null;

  const puck = room.puck.body;
  const inGoalY = Math.abs(puck.position.y) <= RINK.goalHalfHeight;
  if (!inGoalY) return null;

  if (puck.position.x <= RINK.left - 8) return 'B';
  if (puck.position.x >= RINK.right + 8) return 'A';
  return null;
}
