// Deterministický test výpočtu botů. Spusť: node scripts/test_bot_target.mjs
import { botTarget } from '../bot-target.js';

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

// 1) Default (bez teamSize/bots) = původní chování: oba týmy = max(1, lidé)
eq('default sólo target',  botTarget({home:1,away:0}, {}), {home:1,away:1});
eq('default sólo boti',    bots({home:1,away:0}, {}),       {home:0,away:1});   // 1v1 vs bot
eq('default 2-0 target',   botTarget({home:2,away:0}, {}), {home:2,away:2});   // dorovná na plnější tým
eq('default 2-0 boti',     bots({home:2,away:0}, {}),       {home:0,away:2});

// 2) Formát 3v3, boti zapnutí, sólo → plné 3v3
eq('3v3 sólo target',      botTarget({home:1,away:0}, {teamSize:3,bots:true}), {home:3,away:3});
eq('3v3 sólo boti',        bots({home:1,away:0}, {teamSize:3,bots:true}),       {home:2,away:3});

// 3) Boti vypnutí → žádní boti, týmy jen z lidí (i nevyrovnané)
eq('bots off target',      botTarget({home:2,away:1}, {bots:false,teamSize:3}), {home:2,away:1});
eq('bots off boti',        bots({home:2,away:1}, {bots:false,teamSize:3}),       {home:0,away:0});

// 4) Víc lidí než teamSize → dorovná na plnější tým, ne zpět na teamSize
eq('overfull target',      botTarget({home:4,away:1}, {teamSize:3,bots:true}), {home:4,away:4});
eq('overfull boti',        bots({home:4,away:1}, {teamSize:3,bots:true}),       {home:0,away:3});

// 5) teamSize se ořízne na 1..5
eq('clamp high',           botTarget({home:0,away:0}, {teamSize:9,bots:true}), {home:5,away:5});
eq('clamp low/zero',       botTarget({home:0,away:0}, {teamSize:0}),           {home:1,away:1});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
