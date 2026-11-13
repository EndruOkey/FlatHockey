// Crosscheck na jedoucího bota s pukem: člověk najíždí z různých úhlů s držením pravého tlačítka.
// Měří: zásah (bot ztratil puk) a „bot má puk 0,5 s po zásahu“. node test/crosscheck.test.mjs
// Práh: zásah ≥ 5/24 (dřív 0 — bot puk v tomtéž ticku sebral zpět), po zásahu puk 0×.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4677';
process.env.DB_PATH = join(tmpdir(), `fh-cct-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let hits = 0, kept = 0, contacts = 0; const N = 24;
for (let k = 0; k < N; k++) {
  const id = 'cct' + k;
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'H' }, 'home')); l.members.set('a0', makeMember({ name: 'A' }, 'away'));
  lobbies.set(id, l); startMatch(l); const m = l.match; clearInterval(m.loop); while (m.setup) stepMatch(m);
  const h = m.players.get('h0'), a = m.players.get('a0');
  for (const p of m.players.values()) if (p !== h && p !== a) { p.x = 30; p.y = 30; p.isBot = false; }
  a.isBot = true; a.brain = makeBotBrain(hashSeed(id));
  a.x = RINK.centerX + 60; a.y = RINK.h / 2; a.hasPuck = true; a._possT = 99; m.puck.x = a.x - 12; m.puck.y = a.y; m.puck.faceoffTimer = 0;
  const ang = (k / N) * Math.PI * 2; h.x = a.x + Math.cos(ang) * 90; h.y = Math.max(30, Math.min(RINK.h - 30, a.y + Math.sin(ang) * 90));
  const ih = m.inputs.get('h0'); let hitT = -1, contact = false;
  for (let t = 0; t < 180; t++) {
    const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy) || 1;
    ih.dx = Math.abs(dx) / d > 0.38 ? Math.sign(dx) : 0; ih.dy = Math.abs(dy) / d > 0.38 ? Math.sign(dy) : 0;
    ih.rmb = d < 45; ih.aim = Math.atan2(dy, dx);   // jako člověk: crosscheck až zblízka ih.aimDist = 40; ih._stamp = 0;
    const had = a.hasPuck; stepMatch(m);
    if (d < 30) contact = true;
    if (hitT < 0 && had && !a.hasPuck && h._crossCheckCool > 0.4) hitT = t;
    if (hitT >= 0 && t === hitT + 30) { if (a.hasPuck) kept++; break; }
  }
  if (contact) contacts++; if (hitT >= 0) hits++;
  lobbies.delete(id);
}
console.log(JSON.stringify({ kontakt: contacts, zasah_crosscheck: hits, bot_ma_puk_po_0_5s: kept, z: N }));
// Případ 2 (2026-11-13): RMB podržené s pukem (nadzvednutý pas) → soupeř puk obere → crosscheck NE, dokud RMB nepustí.
let ccHeld = 0, ccFresh = 0;
{
  const id = 'cct-hold';
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'H' }, 'home')); l.members.set('a0', makeMember({ name: 'A' }, 'away'));
  lobbies.set(id, l); startMatch(l); const m = l.match; clearInterval(m.loop); while (m.setup) stepMatch(m);
  const h = m.players.get('h0'); for (const p of m.players.values()) if (p !== h) { p.x = 30; p.y = 30; p.isBot = false; }
  h.x = RINK.centerX; h.y = RINK.h / 2; h.hasPuck = true; h._possT = 99; m.puck.faceoffTimer = 0;
  const ih = m.inputs.get('h0'); ih.dx = 0; ih.dy = 0; ih.aim = 0; ih.aimDist = 40;
  ih.rmb = true; for (let t = 0; t < 4; t++) stepMatch(m);          // drží RMB s pukem
  h.hasPuck = false; m.puck.x = h.x + 80; m.puck.vx = 0; m.puck.vy = 0;   // obrání (puk pryč)
  for (let t = 0; t < 20; t++) { stepMatch(m); if (h.crossCheck) ccHeld++; }
  ih.rmb = false; stepMatch(m); ih.rmb = true;                      // pustí a znovu stiskne
  for (let t = 0; t < 5; t++) { stepMatch(m); if (h.crossCheck) ccFresh++; }
  lobbies.delete(id);
}
console.log(JSON.stringify({ crosscheck_pri_drzeni_po_ztrate: ccHeld, crosscheck_po_novem_stisku: ccFresh }));
const pass = hits >= 5 && kept === 0 && ccHeld === 0 && ccFresh > 0; console.log(pass ? 'OK' : 'NEPROŠLO'); process.exit(pass ? 0 : 1);
