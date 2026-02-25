import Matter from 'matter-js';
import type { Room } from '../room';
import { RINK } from '../world';

const GOAL_PHASE_TICKS = 90;
const RESET_PHASE_TICKS = 60;
const SET_TARGET = 10;

function resetPositions(room: Room) {
  let idxA = 0;
  let idxB = 0;

  for (const p of room.players.values()) {
    const row = p.team === 'A' ? idxA++ : idxB++;
    const x = p.team === 'A' ? -400 : 400;
    const y = -180 + row * 120;
    Matter.Body.setPosition(p.body, { x, y });
    Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
    p.chargingSinceTick = null;
  }

  Matter.Body.setPosition(room.puck.body, { x: 0, y: 0 });
  Matter.Body.setVelocity(room.puck.body, { x: 0, y: 0 });
  room.puck.carrierPlayerId = null;

  // keep puck inside rink if reset after outlier collisions
  if (room.puck.body.position.x < RINK.left || room.puck.body.position.x > RINK.right) {
    Matter.Body.setPosition(room.puck.body, { x: 0, y: 0 });
  }
}

export function onGoal(room: Room, scoringTeam: 'A' | 'B') {
  if (scoringTeam === 'A') room.match.scoreA += 1;
  else room.match.scoreB += 1;

  if (room.match.scoreA >= SET_TARGET || room.match.scoreB >= SET_TARGET) {
    room.match.scoreA = 0;
    room.match.scoreB = 0;
  }

  room.match.phase = 'GOAL';
  room.match.phaseEndsAtTick = room.serverTick + GOAL_PHASE_TICKS;
  room.broadcastEvent({ type: 'GOAL', scoringTeam, scoreA: room.match.scoreA, scoreB: room.match.scoreB });
  room.broadcastEvent({ type: 'PHASE', phase: 'GOAL' });
}

export function updateMatchFlow(room: Room) {
  if (!room.match.phaseEndsAtTick) return;
  if (room.serverTick < room.match.phaseEndsAtTick) return;

  if (room.match.phase === 'GOAL') {
    room.match.phase = 'RESET';
    room.match.phaseEndsAtTick = room.serverTick + RESET_PHASE_TICKS;
    resetPositions(room);
    room.runTeamBalance();
    room.broadcastEvent({ type: 'PHASE', phase: 'RESET' });
    return;
  }

  if (room.match.phase === 'RESET') {
    room.match.phase = 'PLAYING';
    room.match.phaseEndsAtTick = undefined;
    room.broadcastEvent({ type: 'PHASE', phase: 'PLAYING' });
  }
}
