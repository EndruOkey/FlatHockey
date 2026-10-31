// Deterministický test výpočtu botů. Spusť: node scripts/test_bot_target.mjs
import { botTarget, clampBots } from '../bot-target.js';

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${g}, exp ${e}`); }
}
// target = cílový počet hráčů v týmu; botů = target - lidé
function bots(humans, settings) {
  const t = botTarget(humans, settings);
  return { home: t.home - humans.home, away: t.away - humans.away };
}

// 0 botů = žádní boti
eq('0 botů target', botTarget({home:1,away:0}, {botsPerTeam:0}), {home:1,away:0});
eq('0 botů boti',   bots({home:1,away:0}, {botsPerTeam:0}),       {home:0,away:0});
eq('chybí pole',    botTarget({home:1,away:0}, {}),               {home:1,away:0});   // default 0

// 2 boti na tým, sólo → domácí 1+2, hosté 0+2
eq('2/tým sólo target', botTarget({home:1,away:0}, {botsPerTeam:2}), {home:3,away:2});
eq('2/tým sólo boti',   bots({home:1,away:0}, {botsPerTeam:2}),       {home:2,away:2});

// 3 boti na tým, prázdné lobby → 3 vs 3 botů
eq('3/tým prázdno', botTarget({home:0,away:0}, {botsPerTeam:3}), {home:3,away:3});

// boti se přidávají nad lidi v každém týmu zvlášť
eq('nerovní lidé', botTarget({home:2,away:1}, {botsPerTeam:1}), {home:3,away:2});

// strop 5 bruslařů na tým
eq('strop 5', botTarget({home:4,away:0}, {botsPerTeam:3}), {home:5,away:3});   // 4+3→5 (ořez), 0+3→3

// clampBots: ořez a sanitizace
eq('clamp 9', clampBots(9), 5);
eq('clamp -2', clampBots(-2), 0);
eq('clamp "3"', clampBots("3"), 3);
eq('clamp NaN', clampBots('x'), 0);
eq('clamp 2.6', clampBots(2.6), 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
