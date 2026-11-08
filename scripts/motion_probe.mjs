// Deterministická sonda pohybu/pacingu: potvrdí nebo vyvrátí "všichni full speed, žádný prostor".
// Měří: rozdělení rychlosti bruslařů, % času ≥90 % top speed, jak často stojí/zpomalují,
// a odstup nosiče od nejbližšího soupeře (prostor na kličku/střelu). Spuštění: node scripts/motion_probe.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4623';
process.env.DB_PATH = join(tmpdir(), `fh-motion-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { PLAYER, TEMPO } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const HZ = 60, TOP = PLAYER.speed * TEMPO;

function setup(id, seed) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < 3; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < 3; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id2, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id2)); }
  return { l, m };
}
const live = m => !(m.setup || m.stoppage || m.world._goalLock);

const SEEDS = [1,2,3,4,5,6,7,8,9,10];
let nSpeed = 0, sumSpeed = 0, full = 0, slow = 0, stopped = 0;         // rychlosti bruslařů
let nCarr = 0, sumGap = 0, tight = 0, open = 0;                        // odstup nosiče od soupeře
const hist = [0,0,0,0,0];  // koše 0-20,20-40,40-60,60-80,80-100 % top
for (const s of SEEDS) {
  const { l, m } = setup('M' + s, s);
  for (let t = 0; t < 5 * 60 * HZ; t++) {
    stepMatch(m);
    if (!live(m)) continue;
    let carrier = null;
    for (const p of m.players.values()) {
      const sp = Math.hypot(p.vx, p.vy), frac = sp / TOP;
      nSpeed++; sumSpeed += sp;
      if (frac >= 0.90) full++; if (frac < 0.25) slow++; if (sp < 5) stopped++;
      hist[Math.min(4, Math.floor(frac * 5))]++;
      if (p.hasPuck) carrier = p;
    }
    if (carrier) {
      let bd = Infinity;
      for (const o of m.players.values()) if (o.team !== carrier.team) { const d = Math.hypot(o.x - carrier.x, o.y - carrier.y); if (d < bd) bd = d; }
      if (Number.isFinite(bd)) { nCarr++; sumGap += bd; if (bd < 22) tight++; if (bd > 60) open++; }
    }
  }
  lobbies.delete(l.id);
}
const pct = (a, b) => (100 * a / b).toFixed(1);
console.log(`top speed = ${TOP.toFixed(0)} px/s (PLAYER.speed × TEMPO ${TEMPO})`);
console.log(`prům. rychlost bruslaře: ${(sumSpeed/nSpeed).toFixed(0)} px/s = ${pct(sumSpeed/nSpeed, TOP)} % top`);
console.log(`čas ≥90 % top:  ${pct(full, nSpeed)} %   |  <25 % top: ${pct(slow, nSpeed)} %   |  skoro stojí (<5px/s): ${pct(stopped, nSpeed)} %`);
console.log(`rozdělení rychlosti (koše 0-20/20-40/40-60/60-80/80-100 %): ${hist.map(h => pct(h, nSpeed)).join(' / ')} %`);
console.log(`nosič puku — odstup nejbližšího soupeře: prům. ${(sumGap/nCarr).toFixed(0)} px  |  pod tlakem (<22px): ${pct(tight, nCarr)} %  |  volno (>60px): ${pct(open, nCarr)} %`);
process.exit(0);
