// Základ fyziky: kolik „škubnutí" (stejná metrika jako stutter_probe) má samotná simulace po krocích 60 Hz.
// node scripts/sim_hitch.mjs [seed=1] [kroků=3600]
import { createMatch, stepMatch, rebuildEntities, faceoff, makeInput } from '../public/js/match-core.js';
import { Player } from '../public/js/entities/Player.js';
import { makeBotBrain } from '../public/js/bot.js';
const seed = +(process.argv[2] || 1), N = +(process.argv[3] || 3600), dt = 1 / 60;
const m = createMatch(seed, {}); m.rules = false; m.minutes = 5; m.periods = 1; m.period = 1; m.clock = 300;
let i = 0; for (const team of ['home', 'away']) for (let k = 0; k < 3; k++) { const id = `bot:${team}:${i}`; const p = new Player(id, team, makeInput()); p.isBot = true; p.brain = makeBotBrain(seed * 31 + i++); m.players.set(id, p); m.inputs.set(id, p.input); }
rebuildEntities(m); faceoff(m);
const prev = new Map(), vavg = new Map(); const H = {}; let hitch = 0, samples = 0;
for (let s = 0; s < N; s++) { stepMatch(m);
  for (const [id, p] of m.players) { const q = prev.get(id); if (q) { const v = Math.hypot(p.x - q.x, p.y - q.y) / dt, a = vavg.get(id) ?? v;
    if (a > 80) { samples++; const r = v / a; if (r < 0.4 || r > 1.8) { hitch++; const k = (r > 1.8 ? 'skok+' : 'stop-') + ':' + (p._botMode || '?') + (p.hasPuck ? ':puk' : '') + (m.world._goalLock ? ':lock' : ''); H[k] = (H[k] || 0) + 1; } } vavg.set(id, a * 0.8 + v * 0.2); } prev.set(id, { x: p.x, y: p.y }); } }
console.log(JSON.stringify({ seed, steps: N, samples, hitchPct: +(100 * hitch / samples).toFixed(2) }));
if (process.env.BREAK) console.log(Object.entries(H).sort((a, b) => b[1] - a[1]).slice(0, 15));
