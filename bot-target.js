// Kolik hráčů (lidé + boti) má mít každý tým — ryzí funkce, ať jde deterministicky testovat.
//
// Pravidlo:
//  - Boti vypnuti (settings.bots === false) → žádní boti; tým = jen připojení lidé.
//  - Boti zapnuti → oba týmy se dorovnají na settings.teamSize, a nikdy ne pod počet lidí
//    v plnějším týmu (aby šlo i přeplněný lidský tým a druhý se mu boty dorovnal).
//
// Vrací cílový počet na tým; počet botů = max(0, target - lidé v tom týmu).
export function botTarget(humans, settings) {
  const s = settings || {};
  if (s.bots === false) return { home: humans.home | 0, away: humans.away | 0 };
  const size = Math.max(1, Math.min(5, s.teamSize || 1));
  const t = Math.max(size, humans.home | 0, humans.away | 0);
  return { home: t, away: t };
}
