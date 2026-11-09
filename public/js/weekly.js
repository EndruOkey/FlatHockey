// TÝDENNÍ PRAVIDLO (2026-11-09) — jen rychlá online hra (HRÁT). Střídá se podle ISO týdne v UTC:
// stejný týden = stejné pravidlo pro všechny (deterministicky, bez serverového stavu).
// Každé pravidlo jen přidá bonusový bod ke gólu → funguje i bez ofsajdů/icingu (rychlá hra je má vypnuté).
export const WEEK_RULES = ['combo2', 'lastmin2', 'first2'];

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
}
export const weekRuleFor = (date) => WEEK_RULES[isoWeek(date) % WEEK_RULES.length];

// Bonus ke gólu (0/1). shot = poslední střela (match._lastShot), clock = zbývající s, last = poslední třetina.
export function weekBonus(rule, { team, shot, clock, lastPeriod, goalsBefore }) {
  if (rule === 'combo2')   return shot && shot.team === team && (shot.combo || 0) >= 3 ? 1 : 0;
  if (rule === 'lastmin2') return lastPeriod && clock <= 60 ? 1 : 0;
  if (rule === 'first2')   return goalsBefore === 0 ? 1 : 0;
  return 0;
}
