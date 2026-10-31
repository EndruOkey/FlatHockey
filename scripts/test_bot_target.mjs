// Deterministický test výpočtu botů. Spusť: node scripts/test_bot_target.mjs
import { botTarget, clampBots } from '../bot-target.js';

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${g}, exp ${e}`); }
}
// botů v týmu = cíl − lidé
function bots(humans, settings) {
  const t = botTarget(humans, settings);
  return { home: t.home - humans.home, away: t.away - humans.away };
}

// Vyp (0) = žádní boti
eq('off target', botTarget({home:2,away:1}, {botFill:0}), {home:2,away:1});
eq('off boti',   bots({home:2,away:1}, {botFill:0}),       {home:0,away:0});

// Chybí pole → default (server dá 1); samotná funkce bez pole = 0 (vyp)
eq('no field',   botTarget({home:1,away:0}, {}),           {home:1,away:0});

// Doplň na 3, sólo → plné 3v3 (1 člověk + 2 boti vs 3 boti)
eq('fill3 sólo target', botTarget({home:1,away:0}, {botFill:3}), {home:3,away:3});
eq('fill3 sólo boti',   bots({home:1,away:0}, {botFill:3}),       {home:2,away:3});

// Doplň na 1, sólo → 1v1 (zachování původního auto-dorovnání)
eq('fill1 sólo', botTarget({home:1,away:0}, {botFill:1}), {home:1,away:1});

// Víc lidí než N → dorovná na plnější tým, ne zpět na N
eq('overfull', botTarget({home:4,away:1}, {botFill:3}), {home:4,away:4});

// Strop 5 na tým
eq('cap5', botTarget({home:0,away:0}, {botFill:9 /*ořez na 5*/}), {home:5,away:5});

// clampBots
eq('clamp 9', clampBots(9), 5);
eq('clamp -2', clampBots(-2), 0);
eq('clamp "3"', clampBots("3"), 3);
eq('clamp NaN', clampBots('x'), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
