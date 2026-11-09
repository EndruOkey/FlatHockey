// Měří "hustotu dění" (busyness) pro různý počet hráčů na ledě. Deterministické, 20 seedů, 5 min.
// Tři čísla na minutu živé hry:
//  - prostor: průměrná vzdálenost k NEJBLIŽŠÍMU spolubruslaři (px) → vyšší = otevřenější led
//  - turnovery: změny držitele puku /min (jiný hráč převezme/sebere) → vyšší = chaos
//  - dav u puku: průměrný počet bruslařů do 120 px od puku → vyšší = nahuštěno kolem akce
// Spuštění: node scripts/density_probe.mjs
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4623';
process.env.DB_PATH = join(tmpdir(), `fh-dens-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const HZ = 60;

function setup(id, seed, perTeam) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }),
              members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < perTeam; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < perTeam; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);
  for (const [id2, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id2)); }
  return { l, m };
}
const live = m => !(m.setup || m.stoppage || m.world._goalLock);

function run(perTeam, seeds = 20) {
  let turnovers = 0, liveMin = 0, spaceSum = 0, spaceN = 0, crowdSum = 0, crowdN = 0;
  for (let s = 1; s <= seeds; s++) {
    const { l, m } = setup(`D${perTeam}_${s}`, s, perTeam);
    let liveT = 0, prevCarrier = null;
    const skaters = [...m.players.values()];
    for (let t = 0; t < 5 * 60 * HZ; t++) {
      stepMatch(m);
      if (!live(m)) continue;
      liveT++;
      // držitel puku
      let carrier = null;
      for (const p of m.players.values()) if (p.hasPuck) { carrier = p.id; break; }
      if (carrier && prevCarrier && carrier !== prevCarrier) turnovers++;
      if (carrier) prevCarrier = carrier;
      // prostor: nejbližší soused + dav u puku (vzorkuj každých 6 ticků = 10 Hz, levné)
      if (t % 6 === 0) {
        for (const a of skaters) {
          let nn = Infinity;
          for (const b of skaters) { if (a === b) continue; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < nn) nn = d; }
          if (nn < Infinity) { spaceSum += nn; spaceN++; }
        }
        const pk = m.puck; let crowd = 0;
        for (const a of skaters) if (Math.hypot(a.x - pk.x, a.y - pk.y) <= 120) crowd++;
        crowdSum += crowd; crowdN++;
      }
    }
    liveMin += liveT / HZ / 60;
    lobbies.delete(l.id);
  }
  return {
    perTeam,
    space: (spaceSum / spaceN).toFixed(0),
    turnovers: (turnovers / liveMin).toFixed(1),
    crowd: (crowdSum / crowdN).toFixed(2),
  };
}

for (const n of [2, 3]) {
  const r = run(n);
  console.log(`${n}v${n}: prostor(nejbližší soused) ${r.space} px | turnovery ${r.turnovers}/min | dav u puku ${r.crowd} bruslařů do 120px`);
}
process.exit(0);
