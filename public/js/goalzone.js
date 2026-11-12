// MÍSTO GÓLU (2026-11-12): podle STRANY (y v ústí; lapačka = horní strana obrazovky u obou brankářů) a VÝŠKY (z při průletu čárou).
// Dřív jen podle y → rána po ledě k horní tyči se hlásila jako „horní roh". Čistá funkce (test/goalzone.test.mjs).
import { RINK, PUCK } from './constants.js';
const T = {
  cs: { hiSide: s => `HORNÍ ROH · ${s}`, hiMid: 'POD BŘEVNO', loSide: s => `PO LEDĚ · ${s}`, loMid: 'PĚTKA', midSide: s => `DO STRANY · ${s}`, midMid: 'STŘEDEM', glove: 'LAPAČKA', block: 'VYRÁŽEČKA' },
  en: { hiSide: s => `TOP CORNER · ${s}`, hiMid: 'UNDER THE BAR', loSide: s => `ALONG THE ICE · ${s}`, loMid: 'FIVE-HOLE', midSide: s => `TO THE SIDE · ${s}`, midMid: 'UP THE MIDDLE', glove: 'GLOVE', block: 'BLOCKER' },
};
export const ZONE_HI = PUCK.crossbarHeight * 2 / 3, ZONE_LO = PUCK.gloveHeight;
export function goalZone(entryY, entryZ, lang = 'cs') {
  const L = T[lang] || T.cs, rel = (entryY - RINK.goalY) / RINK.goalH, z = Math.max(0, entryZ || 0);
  const side = rel < 1 / 3 ? L.glove : rel > 2 / 3 ? L.block : null;
  if (z >= ZONE_HI) return side ? L.hiSide(side) : L.hiMid;
  if (z <= ZONE_LO) return side ? L.loSide(side) : L.loMid;
  return side ? L.midSide(side) : L.midMid;
}
