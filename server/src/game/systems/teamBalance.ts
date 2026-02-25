import type { Room } from '../room';
import type { ServerPlayer } from '../entities/player';

function chooseCandidate(players: ServerPlayer[]): ServerPlayer {
  const sorted = [...players].sort((a, b) => {
    if (a.puckTouchScore !== b.puckTouchScore) return a.puckTouchScore - b.puckTouchScore;
    return b.joinTick - a.joinTick;
  });
  return sorted[0];
}

export function rebalanceTeams(room: Room): { movedPlayerId: string; newTeam: 'A' | 'B' } | null {
  const teamA = [...room.players.values()].filter((p) => p.team === 'A');
  const teamB = [...room.players.values()].filter((p) => p.team === 'B');
  const diff = teamA.length - teamB.length;
  if (Math.abs(diff) <= 1) return null;

  const source = diff > 0 ? teamA : teamB;
  const targetTeam: 'A' | 'B' = diff > 0 ? 'B' : 'A';
  const picked = chooseCandidate(source);
  picked.team = targetTeam;
  return { movedPlayerId: picked.id, newTeam: targetTeam };
}
