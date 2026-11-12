// SONDA: puk nad brankou / na střeše sítě (Ondřej: „puk občas lítá divně přes bránu“). Bot zápasy 2v2, deterministicky.
// Měří: přelety nad sítí, dopady na střechu, jak dlouho puk na střeše leží/klouže, brankář mimo ústí při vyjíždění za branku.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4698'; process.env.DB_PATH = join(tmpdir(), `fh-nr-${process.pid}.db`);
const { RINK } = await import('../public/js/constants.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const SEEDS = +(process.argv.find(a => a.startsWith('--seeds='))?.split('=')[1] || 12), DT = 1 / 60;
const A = { live: 0, over: 0, roofT: 0, roofEp: 0, roofMax: 0, gOut: 0, gOutRet: 0, gN: 0 };
const inFoot = (p) => { const y1 = RINK.goalY, y2 = RINK.goalY + RINK.goalH; if (p.y < y1 - 3 || p.y > y2 + 3) return 0;
  if (p.x > RINK.goalLineRight && p.x < RINK.goalLineRight + RINK.goalDepth + 3) return 1; if (p.x < RINK.goalLineLeft && p.x > RINK.goalLineLeft - RINK.goalDepth - 3) return -1; return 0; };
for (let s = 1; s <= SEEDS; s++) {
  const l = { id: 'NR' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let wasOver = false, roofRun = 0;
  for (let t = 0; t < 5 * 3600; t++) {
    stepMatch(m); if (m.setup || m.stoppage) { roofRun = 0; continue; }
    A.live++; const pk = m.puck, f = inFoot(pk), air = pk.z > 0.5 && !pk._inNet;
    const over = f && air; if (over && !wasOver) A.over++; wasOver = over;
    const onRoof = over && Math.abs(pk.vz || 0) < 5 && Math.hypot(pk.vx, pk.vy) < 120;
    if (onRoof) { A.roofT++; roofRun++; if (roofRun === 1) A.roofEp++; A.roofMax = Math.max(A.roofMax, roofRun); } else roofRun = 0;
    for (const g of [m.goalieL, m.goalieR]) { A.gN++; const out = Math.abs(g.y - (RINK.goalY + RINK.goalH / 2)) > RINK.goalH / 2; if (out) { A.gOut++; if (g._retrieving) A.gOutRet++; } }
  }
  lobbies.delete(l.id);
}
const min = A.live * DT / 60;
console.log(`přelety nad sítí za min: ${(A.over / min).toFixed(2)} · dopady na střechu: ${A.roofEp} (${(A.roofEp / min).toFixed(2)}/min) · puk na střeše ${(A.roofT * DT).toFixed(1)} s celkem, nejdéle ${(A.roofMax * DT).toFixed(2)} s`);
console.log(`brankář mimo ústí: ${(100 * A.gOut / A.gN).toFixed(2)} % času, z toho při vyjíždění pro puk ${(100 * A.gOutRet / Math.max(1, A.gOut)).toFixed(0)} %`);
process.exit(0);
