// SONDA TEČÍ — proč teč (dorážka/tečka před brankou) nefunguje a co dělá Q. Deterministicky (match-core, seedované boty).
// A) scéna: spoluhráč pálí od modré čáry, ty ve slotu 30–90 px před brankou (test/deflect-scene.mjs)
//    stance shooter = hůl v dráze rány (pasivní teč), stance goal = kurzor na branku + Q v okně (teč na Q)
// B) zápasy botů 2v2 (server startMatch): pasivní teče / min, góly do 1 s po teči / min
// node scripts/deflect_probe.mjs [--seeds=4] [--noq]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4698';
process.env.DB_PATH = join(tmpdir(), `fh-dp-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { scene, windowTicks, ev, BASE } = await import('../test/deflect-scene.mjs');
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + ' %';
const GRID = []; for (const c of [0.2, 0.4, 0.6, 0.8, 1.0]) for (const d of [30, 50, 70, 90]) for (const sy of [-90, 0, 90]) for (const o of [-6, 0, 6]) GRID.push({ c, d, sy, o });

// A1 — pasivně (bez Q), hůl v dráze rány
{ let n = 0, defl = 0, pick = 0, goal = 0, air = 0;
  for (const g of GRID) { const r = scene({ ...g, stance: 'shooter' }); n++; if (r.passive) defl++; if (r.picked) pick++; if (r.goal) goal++; }
  console.log(`A1 pasivně, hůl v dráze (${n} ran): tečováno ${pct(defl, n)} · převzato ${pct(pick, n)} · gól ${pct(goal, n)}`); }
// A2 — pasivně, kurzor na branku (rána jde vedle tebe do ústí)
{ let n = 0, defl = 0, goal = 0;
  for (const g of GRID) { const r = scene({ ...g, stance: 'goal' }); n++; if (r.passive) defl++; if (r.goal) goal++; }
  console.log(`A2 pasivně, kurzor na branku (${n} ran): tečováno ${pct(defl, n)} · gól ${pct(goal, n)}`); }
// A3 — teč na Q: tvrdší rány (nabití 0,6–1), kurzor do rohu (±15 px); každý tik okna stejně pravděpodobný (člověk trefí okno kdekoli)
const GQ = []; for (const g of GRID) if (g.c >= 0.6) for (const ay of [-15, 15]) GQ.push({ ...g, ay });
if (!ARG.noq) { let n = 0, redir = 0, ok = 0, goal = 0, pick = 0, presses = 0, wms = [], vr = [];
  for (const g of GQ) { const w = windowTicks({ ...g, stance: 'goal' }); n++; if (!w.length) continue; wms.push(w.length * 1000 / 60);
    for (const q of w) { const r = scene({ ...g, stance: 'goal', q }); presses++; if (r.redir) redir++; if (r.aimOk) ok++; if (r.goal) goal++; if (r.picked) pick++; if (r.redir) vr.push(r.vOut / r.vIn); } }
  wms.sort((a, b) => a - b); vr.sort((a, b) => a - b);
  console.log(`A3 Q v okně (${n} ran, ${presses} stisků): rán s oknem ${pct(wms.length, n)} · okno medián ${wms[wms.length >> 1]?.toFixed(0)} ms (min ${wms[0]?.toFixed(0)}, max ${wms[wms.length - 1]?.toFixed(0)}) · do ústí ${pct(ok, presses)} · gól ${pct(goal, presses)} · ztráta rychl. ${vr[0]?.toFixed(2)}–${vr[vr.length - 1]?.toFixed(2)}×`); }

// B — zápasy botů
{ const { __test } = await import('../server.js'); const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
  const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test; const SEEDS = +(ARG.seeds || 4);
  let last = null; const _t = BASE.tryDeflect; BASE.tryDeflect = function (pk) { const r = _t.call(this, pk); if (r) last = { team: this.team, own: pk._shot && pk._shot.team === this.team, t: 0 }; return r; };
  let defl = 0, deflOwn = 0, goals = 0, dGoals = 0, ticks = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const l = { id: 'DP' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
    for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    for (let t = 0; t < 5 * 3600; t++) {
      const e0 = ev.deflect, sc = { ...m.score }; last && (last.t += 1 / 60);
      stepMatch(m); ticks++;
      if (ev.deflect > e0) { defl++; if (last?.own) deflOwn++; }
      for (const tm of ['home', 'away']) if (m.score[tm] > sc[tm]) { goals++; if (last && last.team === tm && last.t < 1) dGoals++; }
    }
    lobbies.delete(l.id);
  }
  const min = ticks / 3600;
  console.log(`B boti 2v2 (${SEEDS}× 5 min): pasivních tečí ${(defl / min).toFixed(2)}/min (z rány vlastního týmu ${(deflOwn / min).toFixed(2)}/min) · gólů ${(goals / min).toFixed(2)}/min, z toho do 1 s po teči ${(dGoals / min).toFixed(3)}/min (${pct(dGoals, goals)})`); }
process.exit(0);
