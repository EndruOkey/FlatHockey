// Jen stall test z rubriky (rychlý sweep): node scripts/stall_only.mjs  (env FH_* platí)
const { stallTest } = await import('../test/balance-metrics.mjs');
const st = stallTest(1, 120); console.log('stall_possession_pct', (100 * st.held / st.liveT).toFixed(1));
process.exit(0);
