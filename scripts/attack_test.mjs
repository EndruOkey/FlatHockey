// „Dostanu se ke střele?“ — skriptovaný člověk (home) dostane puk na středu a jede rovně do slotu,
// puk drží před sebou (aimDist 40). 2 boti spoluhráči + 3 boti soupeři. Úspěch = s pukem v pozici
// ke střele (≤170 px od branky, |y od středu| < 70) do 6 s. Deterministické, 40 seedů.
// node scripts/attack_test.mjs   (env FH_* platí)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4675';
process.env.DB_PATH = join(tmpdir(), `fh-attack-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const { makeRng } = await import('../public/js/rng.js');
const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2;
let ok = 0, lost = 0, timeSum = 0; const N = 40;
for (let seed = 1; seed <= N; seed++) {
  const l = { id: 'AT' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < 3; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  while (m.setup) stepMatch(m);
  const me = m.players.get('h0');
  for (const [id, p] of m.players) if (id !== 'h0') { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  // puk do hole člověka na středu, soupeři rozestavení v obraně (deterministicky podle seedu)
  const R = makeRng(hashSeed('atk' + seed)), J = (a) => (R.next() * 2 - 1) * a;   // seedovaný rozptyl
  me.x = RINK.centerX - 40 + J(40); me.y = GY + J(90); me.vx = me.vy = 0; m.puck.x = me.x + 12; m.puck.y = me.y; m.puck.vx = m.puck.vy = 0;
  me.hasPuck = true; me._possT = 99; me.aimAngle = me.carryAngle = me.bodyAngle = 0;
  // realistické rozestavení: soupeři v obraně (pásmo u jejich branky), spoluhráči za útočníkem
  const POS = { a0: [RINK.w - 330, GY - 70], a1: [RINK.w - 330, GY + 70], a2: [RINK.w - 220, GY], h1: [RINK.centerX - 120, GY - 110], h2: [RINK.centerX - 120, GY + 110] };
  for (const [id, [x, y]] of Object.entries(POS)) { const p = m.players.get(id); p.x = x + J(40); p.y = y + J(40); p.vx = p.vy = 0; p.hasPuck = false; }
  const inp = m.inputs.get('h0'); let done = false;
  for (let t = 0; t < 6 * 60 && !done; t++) {
    let tx = GX - 150, ty = GY + ((seed % 3) - 1) * 30;            // cíl: slot (3 dráhy podle seedu)
    // jako člověk: obránce v cestě (do 90 px před tebou) objeď bokem, kde je víc místa
    { const ux = (tx - me.x), uy = (ty - me.y), ul = Math.hypot(ux, uy) || 1;
      let block = null, ba = 1e9;
      for (const o of m.players.values()) { if (o.team === 'home') continue;
        const rx = o.x - me.x, ry = o.y - me.y, al = (rx * ux + ry * uy) / ul, lat = (rx * -uy + ry * ux) / ul;
        if (al > 0 && al < 90 && Math.abs(lat) < 40 && al < ba) { ba = al; block = { lat }; } }
      if (block) { const side = block.lat > 0 ? -1 : 1; const nx = -uy / ul, ny = ux / ul;
        tx = me.x + ux / ul * 60 + nx * side * 70; ty = Math.max(30, Math.min(RINK.h - 30, me.y + uy / ul * 60 + ny * side * 70)); } }
    const dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy);
    inp.dx = Math.abs(dx) / (d || 1) > 0.38 ? Math.sign(dx) : 0; inp.dy = Math.abs(dy) / (d || 1) > 0.38 && d > 8 ? Math.sign(dy) : 0;
    inp.aim = Math.atan2(GY - me.y, GX - me.x); inp.aimDist = 40; inp.lmb = inp.rmb = inp.mmb = false; inp.space = false; inp._stamp = 0;
    stepMatch(m);
    if (!me.hasPuck) { lost++; done = true; break; }
    if (Math.hypot(GX - me.x, GY - me.y) <= 170 && Math.abs(me.y - GY) < 70) { ok++; timeSum += t / 60; done = true; }
  }
  lobbies.delete(l.id);
}
console.log(JSON.stringify({ do_strely_pct: Math.round(100 * ok / N), ztrata_puku_pct: Math.round(100 * lost / N), prumerny_cas_s: ok ? +(timeSum / ok).toFixed(2) : null }));
process.exit(0);
