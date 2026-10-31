// Kolik hráčů (lidé + boti) má mít každý tým — ryzí funkce, ať jde deterministicky testovat.
//
// Nastavení: settings.botFill = na kolik hráčů doplnit KAŽDÝ tým boty (0–5; 0 = bez botů).
//  - 0        → žádní boti; tým = jen připojení lidé.
//  - N (1–5)  → oba týmy se dorovnají na N, a nikdy ne pod počet lidí v plnějším týmu
//               (aby šel i přeplněný lidský tým a druhý se mu boty dorovnal).
// Boti tedy doplní prázdná místa „podle připojených hráčů"; počet botů v týmu = cíl − lidé.
const MAX_PER_TEAM = 5;

export function clampBots(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_PER_TEAM, n));
}

export function botTarget(humans, settings) {
  const h = humans.home | 0, a = humans.away | 0;
  const fill = clampBots((settings || {}).botFill);
  if (fill === 0) return { home: h, away: a };          // boti vypnutí
  const t = Math.min(MAX_PER_TEAM, Math.max(fill, h, a)); // dorovnej oba týmy, strop 5
  return { home: t, away: t };
}
