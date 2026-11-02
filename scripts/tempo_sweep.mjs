// Měření tempa: FH_TEMPO=0.85 node scripts/tempo_sweep.mjs → celá rubrika balancu + ukazatele chaosu (JSON na konci)
const { runAll, check } = await import('../test/balance-metrics.mjs');
const S = runAll(); const rows = check(S); const bad = rows.filter(r => !r.ok).map(r => r.k);
console.log('TEMPO', process.env.FH_TEMPO || 1, JSON.stringify({ mimo: bad, goals: S.goals_per_game_total, steals: S.steals_per_min, chaos_changes: S.chaos_team_changes_per_min, chaos_carry_s: S.chaos_avg_carry_s, stall: S.stall_possession_pct, bot1v1: S.bot_1v1_goals_of_10, bot3v3: S.bot_3v3_seeds_with_goal_of_20, conv: S.conversion_pct }));
process.exit(0);
