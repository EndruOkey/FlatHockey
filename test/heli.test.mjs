// HELIKOPTÉRA (2026-11-13, Ondřej: „točit se dokola jak helikoptéra pomocí myši — nepřirozená rotace pro člověka").
// node test/heli.test.mjs   (simulace jako server, bez prohlížeče, deterministicky)
// RUBRIKA (předem):
//  H1 Kroužení myší 2 ot/s po 3 s (stojící hráč, s pukem i bez) → průměrná rychlost těla v s 1–3 ≤ 3 rad/s.
//  H2 Jedno švihnutí o 180° (stojící) → tělo do 10° od cíle za ≤ BASE + 1 tick (BASE = stav před úpravou, 14 ticků).
//  H3 Švihnutí tam a zpět (±120°, 4×) se nebrzdí: každé dojede do 10° za ≤ 14 ticků.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4688';
process.env.DB_PATH = join(tmpdir(), `fh-heli-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));   // utils.angleDiff selže pro |a−b| > 3π (úhel těla není normalizovaný)
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const DT = 1 / 60, BASE_FLICK = 14;
function setup(id, puck) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'H' }, 'home')); l.members.set('a0', makeMember({ name: 'A' }, 'away'));
  lobbies.set(id, l); startMatch(l); const m = l.match; clearInterval(m.loop); while (m.setup) stepMatch(m);
  const h = m.players.get('h0'); for (const p of m.players.values()) if (p !== h) { p.x = 30; p.y = 30; p.isBot = false; }
  h.x = RINK.centerX; h.y = RINK.h / 2; h.vx = h.vy = 0; h.hasPuck = puck; h._possT = 99; m.puck.faceoffTimer = 0;
  if (!puck) { m.puck.x = 40; m.puck.y = RINK.h - 40; }
  const ih = m.inputs.get('h0'); ih.dx = 0; ih.dy = 0; ih.aimDist = 100; ih.aim = 0;
  for (let t = 0; t < 30; t++) stepMatch(m);
  return { l, m, h, ih };
}
const res = {};
for (const puck of [false, true]) {
  const { m, h, ih } = setup('heli' + puck, puck); let prev = h.bodyAngle, turn = 0;
  for (let t = 0; t < 180; t++) { ih.aim = Math.atan2(Math.sin(t * DT * 2 * 2 * Math.PI), Math.cos(t * DT * 2 * 2 * Math.PI)); stepMatch(m);
    const d = angleDiff(h.bodyAngle, prev); prev = h.bodyAngle; if (t >= 60) turn += Math.abs(d); }
  res['H1_' + (puck ? 's_pukem' : 'bez_puku') + '_rad_s'] = +(Math.abs(turn) / 2).toFixed(2);
  lobbies.delete('heli' + puck);
}
{ const { m, h, ih } = setup('flick', false); ih.aim = Math.PI - 0.001; let n = -1;
  for (let t = 0; t < 60; t++) { stepMatch(m); if (n < 0 && Math.abs(angleDiff(h.bodyAngle, ih.aim)) < 10 * Math.PI / 180) n = t + 1; }
  res.H2_flick180_ticku = n; lobbies.delete('flick'); }
{ const { m, h, ih } = setup('flick2', false); let worst = 0;
  for (let k = 0; k < 4; k++) { ih.aim = (k % 2 ? -1 : 1) * 2.1; let n = 60;
    for (let t = 0; t < 40; t++) { stepMatch(m); if (n === 60 && Math.abs(angleDiff(h.bodyAngle, ih.aim)) < 10 * Math.PI / 180) n = t + 1; }
    worst = Math.max(worst, n); }
  res.H3_tam_zpet_max_ticku = worst; lobbies.delete('flick2'); }
console.log(JSON.stringify(res));
const ok = res.H1_bez_puku_rad_s <= 3 && res.H1_s_pukem_rad_s <= 3 && res.H2_flick180_ticku > 0 && res.H2_flick180_ticku <= BASE_FLICK + 1 && res.H3_tam_zpet_max_ticku <= 14;
console.log(ok ? 'OK' : 'NEPROŠLO'); process.exit(ok ? 0 : 1);
