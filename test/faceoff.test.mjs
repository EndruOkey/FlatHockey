// Test buly (dojezd → příprava → vhazování QTE), pevná rubrika F1–F5 (F6 = test:determinism + opakovatelnost tady).
// npm run test:faceoff   (exit 1 = selhání). Krokuje match-core (offline) i server.js stepMatch (online cesta) bez sítě.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4637';
process.env.DB_PATH = process.env.DB_PATH || join(tmpdir(), `fh-fotest-${process.pid}.db`);
const core = await import('../public/js/match-core.js');
const { __test } = await import('../server.js');
const { Player } = await import('../public/js/entities/Player.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const HZ = 60, FO = core.FO;
const results = [];
const check = (ok, name) => { results.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + name); };

function coreMatch(seed, home, away, humans = {}) {
  const m = core.createMatch(seed, {}); m.rules = true; m.minutes = 3; m.periods = 1; m.period = 1; m.clock = 180;
  const add = (team, i) => { const id = `${humans[team] && i === humans[team].idx ? 'hum' : 'bot'}:${team}:${i}`; const p = new Player(id, team, core.makeInput());
    if (!id.startsWith('hum')) { p.isBot = true; p.brain = makeBotBrain(hashSeed('F' + seed + id)); } m.players.set(id, p); m.inputs.set(id, p.input); return p; };
  for (let i = 0; i < home; i++) add('home', i);
  for (let i = 0; i < away; i++) add('away', i);
  core.rebuildEntities(m); core.faceoff(m); return { m, step: () => core.stepMatch(m), add };
}
function serverMatch(seed, n) {
  const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
  const l = { id: 'FT' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 3, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < n; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < n; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  return { m, step: () => stepMatch(m), done: () => lobbies.delete(l.id) };
}

// Sledování všech buly v zápase (F1, F3, F5 + centr u bodu)
function auditRun(m, step, ticks, R, hook) {
  let fo = null, prevPh = -1, post = null;
  for (let t = 0; t < ticks && !m.ended; t++) {
    hook?.(m, t);
    step();
    const f = m.fo;
    if (m.setup && f && f !== fo) { fo = f; R.n++; post = null; }
    if (m.setup && f) for (const p of m.players.values()) if (p.x < 8 || p.x > RINK.w - 8 || p.y < 8 || p.y > RINK.h - 8) { R.off++; break; }
    if (f && f.ph >= 1 && prevPh === 0) {   // konec dojezdu
      const dt = (m.tick - f.t0) / HZ; R.skate.push(dt); if (dt > 1.6) R.slow++;
      for (const p of m.players.values()) { const s = f.plan.get(p.id); if (s && Math.hypot(p.x - s.x, p.y - s.y) > 0.5) { R.notPlaced++; break; } }
      let near = Infinity; for (const p of m.players.values()) near = Math.min(near, Math.hypot(p.x - f.x, p.y - f.y)); if (near > 30) R.far++;
    }
    if (f && f.ph === 4 && !post && f.end === m.tick) { post = { drop: f.drop }; if (f.win) R.qte++; else R.race++; }
    if (post) {
      const c = [...m.players.values()].find(p => p.hasPuck);
      const gh = m.goalieL.isHolding || m.goalieR.isHolding;
      if (c || gh || m.world._goalLock) { if (c) R.poss.push((m.tick - post.drop) / HZ); post = null; }
      else if (m.tick - post.drop > 3 * HZ) { R.stuck++; post = null; }
    }
    prevPh = m.setup && f ? f.ph : -1;
  }
}
const newR = () => ({ n: 0, off: 0, stuck: 0, slow: 0, notPlaced: 0, far: 0, qte: 0, race: 0, skate: [], poss: [] });
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const mx = a => a.length ? Math.max(...a) : 0;

// ── F1 / F3 / F5: boti, různé počty (i nerovné), offline jádro + serverová cesta ─────────────────
const sizes = [[1, 1], [2, 2], [3, 3], [5, 5], [2, 3], [1, 4], [6, 6]];
const R = newR();
for (const [h, a] of sizes) for (let s = 1; s <= (h + a > 6 ? 1 : 2); s++) { const { m, step } = coreMatch(s * 31 + h * 7 + a, h, a); auditRun(m, step, 100 * HZ, R); }
const RS = newR();
for (let s = 1; s <= 4; s++) { const { m, step, done } = serverMatch(s, 2 + (s % 2)); auditRun(m, step, 100 * HZ, RS); done(); }
for (const [lab, r] of [['offline', R], ['server', RS]]) {
  console.log(`${lab.padEnd(7)} buly ${r.n} | mimo hřiště ${r.off} | zaseklé >3s ${r.stuck} | dojezd max ${mx(r.skate).toFixed(2)} s (pomalé ${r.slow}, nepřesné ${r.notPlaced}) | centr >30px ${r.far} | QTE ${r.qte} / závod ${r.race} | medián drop→držení ${med(r.poss).toFixed(2)} s`);
  check(r.n > 15 && r.off === 0 && r.stuck === 0, `F1 ${lab}: 0 mimo hřiště, 0 zaseklých >3 s (${r.n} buly)`);
  check(r.slow === 0 && r.notPlaced === 0 && r.far === 0, `F3 ${lab}: všichni na místě do 1,6 s (max ${mx(r.skate).toFixed(2)} s)`);
  check(med(r.poss) <= 1.2, `F5 ${lab}: medián drop → držení ${med(r.poss).toFixed(2)} s ≤ 1,2 s`);
}

// ── F2: centr = člověk, je-li v týmu (i příchod/odchod během buly) ────────────────────────────────
{
  let tot = 0, ok = 0;
  const humanCheck = (m) => { if (!m.fo || !m.setup) return; for (const team of ['home', 'away']) {
    const hum = [...m.players.values()].some(p => p.team === team && !p.isBot); if (!hum) continue;
    if (m.fo.ph >= 1) { tot++; const c = m.players.get(m.fo.c[team]); if (c && !c.isBot) ok++; } } };
  for (const [h, a] of [[1, 1], [3, 3], [5, 4], [2, 5]]) for (let s = 1; s <= 3; s++) {
    const { m, step, add } = coreMatch(900 + s * 13 + h, h, a, { home: { idx: h - 1 }, ...(s % 2 ? { away: { idx: 0 } } : {}) });
    let joined = 0;
    for (let t = 0; t < 60 * HZ && !m.ended; t++) {
      // během dojezdu / přípravy: odejde bot, přijde člověk (pozdě příchozí) — rozestavění se musí přepočítat
      if (m.setup && m.fo && m.fo.ph <= 1 && joined < 3 && t > 300 * (joined + 1)) {
        joined++;
        const bot = [...m.players.values()].find(p => p.isBot && p.team === 'away');
        if (bot && [...m.players.values()].filter(p => p.team === 'away').length > 1) { m.players.delete(bot.id); m.inputs.delete(bot.id); }
        const id = `late:${s}:${joined}`; const p = new Player(id, 'away', core.makeInput()); p.x = RINK.w - 30; p.y = 40;
        m.players.set(id, p); m.inputs.set(id, p.input); core.rebuildEntities(m);
      }
      step(); humanCheck(m);
    }
  }
  check(tot > 0 && ok === tot, `F2 centr = člověk: ${ok}/${tot} ticků (${tot ? (100 * ok / tot).toFixed(1) : 0} %)`);
}

// ── F4: předčasný stisk vždy prohraje, spam nikdy neporazí jeden dobře načasovaný stisk ──────────
// 1v1 dva lidé (vstup řídíme ručně). Každý scénář na 40 seedů; vítěz = m.fo.win po dokončení buly.
function duel(seed, homePlan, awayPlan) {
  const { m, step } = coreMatch(5000 + seed, 2, 2, { home: { idx: 0 }, away: { idx: 0 } });
  const ih = m.inputs.get('hum:home:0'), ia = m.inputs.get('hum:away:0');
  while (m.setup) { const f = m.fo; const rel = f.ph >= 1 ? m.tick + 1 - f.drop : null;   // tick, který se právě odkrokuje, vůči dropu
    ih.lmb = homePlan(rel, f.ph); ia.lmb = awayPlan(rel, f.ph); step(); }
  return m.fo.win;
}
const press = at => (rel) => rel != null && rel >= at && rel < at + 4;                 // jedno ťuknutí v tiku drop+at
const spam = (rel, ph) => ph >= 1 && (rel & 1) === 0;                                 // stisk každý druhý tick (hrana každý 2. tick)
const spamHold = (rel, ph) => ph >= 1;                                                 // drží od přípravy
const none = () => false;
const S = 40; let early = 0, earlyN = 0, sp = 0, spN = 0, timed = 0, timedN = 0, botBeat = 0;
for (let s = 1; s <= S; s++) {
  earlyN += 2; if (duel(s, press(-3), press(25)) === 'away') early++; if (duel(s, press(-1), none) !== 'home') early++;
  spN += 3; if (duel(s, spam, press(12)) === 'away') sp++; if (duel(s, press(20), spam) === 'home') sp++; if (duel(s, spamHold, press(30)) === 'away') sp++;
  timedN++; if (duel(s, press(2), press(10)) === 'home') timed++;
}
// člověk vs bot: dobře načasovaný stisk (drop+6 ticků = 100 ms) vždy porazí bota (reakce 180–320 ms); spam proti botovi prohraje
let vb = 0, vbN = 0, spb = 0;
for (let s = 1; s <= S; s++) for (const plan of [press(6), spam]) {
  const { m, step } = coreMatch(7000 + s, 2, 2, { home: { idx: 0 } }); const ih = m.inputs.get('hum:home:0');
  while (m.setup) { const f = m.fo; ih.lmb = plan(f.ph >= 1 ? m.tick + 1 - f.drop : null, f.ph); step(); }
  if (plan === spam) { if (m.fo.win === 'away') spb++; } else { vbN++; if (m.fo.win === 'home') vb++; }
}
console.log(`F4 předčasně prohrál ${early}/${earlyN} | spam prohrál ${sp}/${spN} | dřívější platný vyhrál ${timed}/${timedN} | včas vs bot ${vb}/${vbN} | spam vs bot prohrál ${spb}/${S}`);
check(early === earlyN && sp === spN && timed === timedN && vb === vbN && spb === S, 'F4 předčasný stisk vždy prohraje, spam nikdy nevyhraje');

// ── F6 (část): opakovatelnost buly — stejný seed = stejné dropy, vítězové i pozice ───────────────
{
  const trace = () => { const { m, step } = coreMatch(4242, 3, 3); const out = [];
    for (let t = 0; t < 100 * HZ; t++) { step(); if (m.fo && m.fo.end === m.tick) out.push([m.fo.drop, m.fo.win, Math.round(m.puck.x * 100), Math.round(m.puck.y * 100)].join(',')); }
    return out.join('|'); };
  const real = Math.random; Math.random = () => { throw new Error('Math.random v simulaci'); };
  let a, b, ok = true; try { a = trace(); b = trace(); } catch (e) { ok = false; console.error(e); } finally { Math.random = real; }
  check(ok && a === b && a.split('|').length >= 3, `F6 buly opakovatelné a bez Math.random (${a ? a.split('|').length : 0} buly)`);
}

const fails = results.filter(x => !x).length;
console.log(fails ? `\n${fails} selhání` : '\nVše OK');
process.exit(fails ? 1 : 0);
