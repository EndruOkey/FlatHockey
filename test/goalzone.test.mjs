// Místo gólu: strana × výška (public/js/goalzone.js) + skutečný průlet puku čárou (Puck.js ukládá _goalEntryY/_goalEntryZ).
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-gz.db');
const { goalZone, ZONE_HI } = await import('../public/js/goalzone.js');
const { RINK, PUCK } = await import('../public/js/constants.js');
const { Puck } = await import('../public/js/entities/Puck.js');
let ok = 0, fail = 0; const chk = (n, c) => { console.log((c ? 'OK   ' : 'FAIL ') + n); c ? ok++ : fail++; };
const top = RINK.goalY + 4, mid = RINK.goalY + RINK.goalH / 2, bot = RINK.goalY + RINK.goalH - 4;
chk('po ledě k horní tyči = PO LEDĚ · LAPAČKA (dřív „horní roh")', goalZone(top, 0) === 'PO LEDĚ · LAPAČKA');
chk('vysoko k horní tyči = HORNÍ ROH · LAPAČKA', goalZone(top, 18) === 'HORNÍ ROH · LAPAČKA');
chk('vysoko k dolní tyči = HORNÍ ROH · VYRÁŽEČKA', goalZone(bot, 18) === 'HORNÍ ROH · VYRÁŽEČKA');
chk('po ledě středem = PĚTKA', goalZone(mid, 0) === 'PĚTKA');
chk('vysoko středem = POD BŘEVNO', goalZone(mid, 19) === 'POD BŘEVNO');
chk('střední výška do strany', goalZone(bot, 9) === 'DO STRANY · VYRÁŽEČKA');
chk('anglicky', goalZone(top, 18, 'en') === 'TOP CORNER · GLOVE');
// skutečný let: zvednutá rána do horního rohu u dolní tyče → Puck uloží výšku při průletu čárou
const W = { authoritative: true, players: [], onGoal() {}, whistle() {} };
function fly(y, vz) { const p = new Puck(); p.x = RINK.goalLineRight - 60; p.y = y; p.z = 0; p.vx = 420; p.vy = 0; p.vz = vz; p.faceoffTimer = 0;
  for (let t = 0; t < 60 && !p._inNet; t++) { p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z; p.update(1 / 60, W); } return p; }
const hi = fly(bot, 160), lo = fly(top, 0);
chk(`zvednutá rána: uložená výška ${hi._goalEntryZ?.toFixed(1)} px → ${goalZone(hi._goalEntryY, hi._goalEntryZ)}`, hi._inNet && hi._goalEntryZ >= ZONE_HI && goalZone(hi._goalEntryY, hi._goalEntryZ).startsWith('HORNÍ ROH'));
chk(`rána po ledě: uložená výška ${lo._goalEntryZ?.toFixed(1)} px → ${goalZone(lo._goalEntryY, lo._goalEntryZ)}`, lo._inNet && goalZone(lo._goalEntryY, lo._goalEntryZ).startsWith('PO LEDĚ'));
console.log(`
${ok}/${ok + fail} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
