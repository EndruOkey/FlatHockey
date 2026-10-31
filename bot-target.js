// Kolik hráčů (lidé + boti) má mít každý tým — ryzí funkce, ať jde deterministicky testovat.
//
// Nastavení: settings.botsPerTeam = kolik botů přidat do KAŽDÉHO týmu (0–5, 0 = bez botů).
// Cíl na tým = lidé v tom týmu + botsPerTeam, oříznuto na max 5 bruslařů na tým.
// Počet skutečně nasazených botů = max(0, cíl - lidé v tom týmu).
const MAX_PER_TEAM = 5;

export function clampBots(n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_PER_TEAM, n));
}

export function botTarget(humans, settings) {
  const per = clampBots((settings || {}).botsPerTeam);
  const h = humans.home | 0, a = humans.away | 0;
  return {
    home: Math.min(MAX_PER_TEAM, h + per),
    away: Math.min(MAX_PER_TEAM, a + per),
  };
}
