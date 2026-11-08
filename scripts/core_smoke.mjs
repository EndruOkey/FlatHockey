// Ověří, že sdílené jádro match-core.js běží samostatně (bez serveru/sítě) a je deterministické.
// To je základ pro klientský lokální režim. Spuštění: node scripts/core_smoke.mjs
import { createMatch, stepMatch, makeInput, faceoff, rebuildEntities } from '../public/js/match-core.js';
import { Player } from '../public/js/entities/Player.js';
import { makeBotBrain, hashSeed } from '../bot.js';

function buildBotMatch(seed, tag) {
  const m = createMatch(seed, {});           // žádné hooky — čistá simulace, skóre v m.score
  m.rules = true; m.minutes = 5; m.periods = 1; m.period = 1; m.clock = m.minutes * 60;
  for (const team of ['home', 'away']) for (let i = 0; i < 3; i++) {
    const id = `bot:${team}:${i}`;
    const p = new Player(id, team, makeInput());
    p.isBot = true; p.num = 10 + i;
    p.brain = makeBotBrain(hashSeed(tag + id));
    m.players.set(id, p); m.inputs.set(id, p.input);
  }
  rebuildEntities(m);
  faceoff(m);
  return m;
}

function hashMatch(m) {
  let h = 0x811c9dc5;
  const push = v => { const s = String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
  push(m.tick); push(m.score.home); push(m.score.away);
  for (const p of m.players.values()) { push(Math.round(p.x * 100)); push(Math.round(p.y * 100)); }
  push(Math.round(m.puck.x * 100)); push(Math.round(m.puck.y * 100));
  return (h >>> 0).toString(16);
}

function run(seed) {
  const m = buildBotMatch(seed, 'S' + seed);
  let bad = null;
  for (let t = 0; t < 5 * 60 * 60 && !m.ended; t++) {
    stepMatch(m);
    if (!bad && [m.puck.x, m.puck.y].some(v => !Number.isFinite(v))) bad = `NaN puk tick ${m.tick}`;
    for (const p of m.players.values()) if (!bad && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) bad = `NaN hráč ${p.id} tick ${m.tick}`;
  }
  return { score: { ...m.score }, ended: m.ended, tick: m.tick, bad, hash: hashMatch(m) };
}

let fail = 0;
const SEEDS = [1, 2, 3, 4, 5, 6];
console.log('seed  skóre   ended  tick    hash');
let goals = 0;
for (const s of SEEDS) {
  const r = run(s);
  if (r.bad) { console.log(`${s}: CHYBA ${r.bad}`); fail++; continue; }
  goals += r.score.home + r.score.away;
  console.log(`${String(s).padStart(4)}  ${r.score.home}:${r.score.away}    ${r.ended ? 'ano ' : 'NE  '}  ${String(r.tick).padStart(6)}  ${r.hash}`);
}
// Determinismus: stejný seed dvakrát → stejný hash
const a = run(1), b = run(1);
if (a.hash !== b.hash) { console.log(`FAIL determinismus: ${a.hash} != ${b.hash}`); fail++; }
else console.log(`\nOK determinismus (seed 1 dvakrát → ${a.hash})`);
const avg = goals / SEEDS.length;
console.log(`průměr gólů/zápas: ${avg.toFixed(1)}  (čekáme ~3–10 jako balance rubrika)`);
if (avg < 3 || avg > 12) { console.log('FAIL góly mimo rozumné pásmo'); fail++; }
console.log(fail ? `\n${fail} CHYB` : '\nvše prošlo — jádro běží samostatně a deterministicky');
process.exit(fail ? 1 : 0);
