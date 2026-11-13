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
// NÁPŘAH (2026-11-13, Ondřej: „při chargování se jde až moc otáčet, mělo by jít méně"):
//  C1 švih o 90° s nápřahem (s pukem, nabíjí 0,2 s předem) → tělo i hůl do 10° od cíle aspoň 2× déle než bez nápřahu.
//  C2 kroužení 2 ot/s s nápřahem (one-timer bez puku, nabití drží) → tělo v s 1–3 ≤ 1,5 rad/s.
const flick90 = (lmb) => { const { m, h, ih } = setup('c1' + lmb, true); ih.lmb = lmb; for (let t = 0; t < 12; t++) stepMatch(m);
  ih.aim = Math.PI / 2; let nb = -1, ns = -1;
  for (let t = 0; t < 120; t++) { stepMatch(m); const tol = 10 * Math.PI / 180;
    if (nb < 0 && Math.abs(angleDiff(h.bodyAngle, ih.aim)) < tol) nb = t + 1; if (ns < 0 && Math.abs(angleDiff(h.carryAngle, ih.aim)) < tol) ns = t + 1; }
  lobbies.delete('c1' + lmb); return { nb, ns }; };
{ const a = flick90(false), b = flick90(true); res.C1_telo_ticku = `${a.nb}→${b.nb}`; res.C1_hul_ticku = `${a.ns}→${b.ns}`;
  res._c1ok = a.nb > 0 && a.ns > 0 && (b.nb < 0 || b.nb >= 2 * a.nb) && (b.ns < 0 || b.ns >= 2 * a.ns); }
{ const { m, h, ih } = setup('c2', false); ih.lmb = true; let prev = h.bodyAngle, turn = 0;
  for (let t = 0; t < 180; t++) { ih.aim = Math.atan2(Math.sin(t * DT * 4 * Math.PI), Math.cos(t * DT * 4 * Math.PI)); stepMatch(m);
    const d = angleDiff(h.bodyAngle, prev); prev = h.bodyAngle; if (t >= 60) turn += Math.abs(d); }
  res.C2_napr_rad_s = +(turn / 2).toFixed(2); lobbies.delete('c2'); }
console.log(JSON.stringify(res));
const ok = res.H1_bez_puku_rad_s <= 3 && res.H1_s_pukem_rad_s <= 3 && res.H2_flick180_ticku > 0 && res.H2_flick180_ticku <= BASE_FLICK + 1 && res.H3_tam_zpet_max_ticku <= 14
  && res._c1ok && res.C2_napr_rad_s <= 1.5;
console.log(ok ? 'OK' : 'NEPROŠLO'); process.exit(ok ? 0 : 1);
