// Překryv těl: fyzikální (dist < 2×radius) a vizuální (dist < 2×nakreslená ramena 1.25×radius). 6 botů, deterministické.
// node scripts/body_overlap.mjs [seed=1] [kroků=7200]
import { createMatch, stepMatch, rebuildEntities, faceoff, makeInput } from '../public/js/match-core.js';
import { Player } from '../public/js/entities/Player.js';
import { makeBotBrain } from '../public/js/bot.js';
import { PLAYER } from '../public/js/constants.js';
const seed = +(process.argv[2] || 1), N = +(process.argv[3] || 7200);
const m = createMatch(seed, {}); m.rules = false; m.minutes = 5; m.periods = 1; m.period = 1; m.clock = 300;
let i = 0; for (const team of ['home', 'away']) for (let k = 0; k < 3; k++) { const id = `bot:${team}:${i}`; const p = new Player(id, team, makeInput()); p.isBot = true; p.brain = makeBotBrain(seed * 31 + i++); m.players.set(id, p); m.inputs.set(id, p.input); }
rebuildEntities(m); faceoff(m);
const R = PLAYER.radius, VIS = 2 * R * 1.25;
let pairs = 0, phys = 0, vis = 0, maxPhys = 0;
for (let s = 0; s < N; s++) { stepMatch(m); if (m.world._goalLock) continue;
  const ps = [...m.players.values()];
  for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) { const d = Math.hypot(ps[a].x - ps[b].x, ps[a].y - ps[b].y);
    if (d > 30) continue; pairs++; if (d < 2 * PLAYER.bodyRadius - 0.5) { phys++; maxPhys = Math.max(maxPhys, 2 * PLAYER.bodyRadius - d); } if (d < VIS) vis++; } }
console.log(JSON.stringify({ seed, blizkePary: pairs, fyzPrekryvPct: +(100 * phys / pairs).toFixed(1), maxFyzHloubka: +maxPhys.toFixed(1), vizPrekryvPct: +(100 * vis / pairs).toFixed(1) }));
