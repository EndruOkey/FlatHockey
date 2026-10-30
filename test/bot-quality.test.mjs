// Kvalita botů (headless, deterministické): npm run test:botq   (exit 1 = cíl nesplněn)
// (1) 3v3 boti, seedy 1..20, 90 s: seedy s gólem, góly, dokončené přihrávky
// (2) 1v1 bot vs stojící člověk, seedy 1..10, 60 s: posun člověka (px), kontakty/min, góly bota
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4151';
process.env.DB_PATH = join(tmpdir(), `fh-botq-${process.pid}.db`);
const { __test } = await import('../server.js');
const { botThink, makeBotBrain, hashSeed } = await import('../bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

// Základ = naměřeno původním botem (commit před úpravou), stejný harness
const BASELINE = { seedsWithGoal: 4, goals: 4, passes: 62, disp: 5371, cpm: 3.33, botGoals: 16 };

function setup(id, seed, humans, bots3) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }),
              members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < humans; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  if (bots3) for (let i = 0; i < 3; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);
  return { l, m };
}
const locked = m => m.setup || m.stoppage || m.world._goalLock;

function sim3v3(seed) {
  const { l, m } = setup('Q3_' + seed, seed, 3, true);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let passes = 0, owner = null;
  for (let t = 0; t < 90 * 60; t++) {
    stepMatch(m);
    let cur = null;
    for (const [id, p] of m.players) if (p.hasPuck) cur = p;
    if (cur && owner && cur !== owner && cur.team === owner.team) passes++;
    if (cur) owner = cur;
  }
  lobbies.delete(l.id);
  return { goals: m.score.home + m.score.away, passes };
}

function sim1v1(seed) {
  const { l, m } = setup('Q1_' + seed, seed, 1, false);
  const human = m.players.get('h0');
  const bot = [...m.players.values()].find(p => p.isBot);
  let disp = 0, contacts = 0, inC = false, px = human.x, py = human.y, lockedTicks = 0;
  for (let t = 0; t < 60 * 60; t++) {
    stepMatch(m);
    if (locked(m)) { px = human.x; py = human.y; lockedTicks++; inC = false; continue; }
    disp += Math.hypot(human.x - px, human.y - py); px = human.x; py = human.y;
    const c = Math.hypot(human.x - bot.x, human.y - bot.y) < human.radius + bot.radius + 2;
    if (c && !inC) contacts++;
    inC = c;
  }
  lobbies.delete(l.id);
  return { disp, contacts, live: (3600 - lockedTicks) / 3600, botGoals: m.score.away };
}

const A = { seedsWithGoal: 0, goals: 0, passes: 0 };
for (let s = 1; s <= 20; s++) { const r = sim3v3(s); if (r.goals > 0) A.seedsWithGoal++; A.goals += r.goals; A.passes += r.passes; }
const B = { disp: 0, contacts: 0, live: 0, botSeeds: 0, botGoals: 0 };
for (let s = 1; s <= 10; s++) { const r = sim1v1(s); B.disp += r.disp; B.contacts += r.contacts; B.live += r.live; B.botGoals += r.botGoals; if (r.botGoals > 0) B.botSeeds++; }
const cpm = B.contacts / B.live;   // kontakty za minutu živé hry (10 seedů × 1 min × podíl živé hry)
console.log('3v3 :', JSON.stringify(A), ' baseline', JSON.stringify({ s: BASELINE.seedsWithGoal, g: BASELINE.goals, p: BASELINE.passes }));
console.log('1v1 :', JSON.stringify({ disp: Math.round(B.disp), cpm: +cpm.toFixed(2), botSeeds: B.botSeeds, botGoals: B.botGoals }),
  ' baseline', JSON.stringify({ disp: BASELINE.disp, cpm: BASELINE.cpm }));
const results = [];
const check = (ok, n) => { results.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + n); };
check(A.seedsWithGoal >= 12, `3v3: >=12/20 seedů s gólem (${A.seedsWithGoal})`);
check(B.disp <= BASELINE.disp * 0.5, `1v1: posun <= 50 % základu (${Math.round(B.disp)} vs ${BASELINE.disp})`);
check(cpm <= BASELINE.cpm * 0.5, `1v1: kontakty/min <= 50 % základu (${cpm.toFixed(2)} vs ${BASELINE.cpm})`);
check(B.botSeeds >= 8, `1v1: bot skóruje v >=8/10 (${B.botSeeds})`);
process.exit(results.includes(false) ? 1 : 0);
