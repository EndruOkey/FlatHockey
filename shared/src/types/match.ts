export type MatchPhase = 'PLAYING' | 'GOAL' | 'RESET';

export interface MatchSnapshot {
  phase: MatchPhase;
  scoreA: number;
  scoreB: number;
  setTarget: number;
  phaseEndsAtTick?: number;
}
