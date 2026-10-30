// Kontrola rubriky balancu (viz test/balance-metrics.mjs). Spusteni: npm run test:balance  (exit 1 = mimo rubriku)
const { runAll, check } = await import('./balance-metrics.mjs');
const S = runAll();
let bad = 0;
for (const r of check(S)) {
  if (!r.ok) bad++;
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.k.padEnd(32) + String(r.v).padStart(7) + `  [${r.lo}..${r.hi}]`);
}
console.log(bad ? `\n${bad} mimo rubriku` : '\nVse v rubrice');
process.exit(bad ? 1 : 0);
