// Přikopnutí puku do jízdy (Q) — sdílená simulace match-core (offline i online). Deterministicky.
// Rubrika předem (2026-11-13, „pod nohama"): okno stisku 60–200 ms pro puk 300–450 px/s (jen puk mířící pod nohy);
// při zabrání je puk ≤ 12 px od středu těla (= ≤ 12 px od brusle) a puk 13 / 20 / 24 px od těla Q nikdy nevezme;
// rychlý puk (600 px/s), který hokejkou čistě nejde, Q pod nohama zpracuje; Q moc brzy nezabere a zamkne se;
// čerstvou ránu soupeře Q nechytí; animace: přikopnutí běží 0,25–0,4 s a puk dojede na čepel za 0,1–0,15 s plynule
// (žádný skok > 40 % dráhy za tik), minutí = máchnutí naprázdno; deterministické.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-kick.db');
const { createMatch, stepMatch, makeInput, applyClientInput, faceoff, DT } = await import('../public/js/match-core.js');
const { Player, KICK, kickPuckU, kickAnimW } = await import('../public/js/entities/Player.js');
let ok = 0, fail = 0; const chk = (n, c) => { console.log((c ? 'OK   ' : 'FAIL ') + n); c ? ok++ : fail++; };

// hráč stojí na (400, 228), puk letí zleva po ose y = 228 + off rychlostí v; qAt = tik stisku Q (null = bez Q)
function run(v, off, qAt, opts = {}) {
  const m = createMatch(11, {}); const p = new Player('h0', 'home', makeInput()); m.players.set('h0', p); m.inputs.set('h0', p.input); m.world.entities.push(p);
  faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false;
  p.x = 400; p.y = 228; p.vx = p.vy = 0; p.aimAngle = Math.PI;   // kouká proti puku
  const P = m.puck; P.x = 400 - 90; P.y = 228 + off; P.z = 0; P.vx = v; P.vy = 0; P.vz = 0; P.faceoffTimer = 0; P._carrier = null; P.ownerId = null;
  if (opts.oppShot) { P._shot = { id: 'a0', team: 'away' }; P._shotAge = 0; }
  let got = -1, cdAfter = 0, dKick = null, sw = 0; const o = p._doKick.bind(p); p._doKick = pk => { dKick = Math.hypot(pk.x - p.x, pk.y - p.y); return o(pk); };
  for (let t = 0; t < 40; t++) {
    applyClientInput(p.input, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq: qAt === t, aim: Math.PI, aimDist: 60 });
    stepMatch(m);
    if (t === qAt) { cdAfter = p._kickCd || 0; sw = p._kickSwN || 0; }
    if (p.hasPuck && got < 0) got = t;
  }
  return { got, kick: (p._kickN || 0) > 0, cd: cdAfter, dKick, sw };
}
// okno: ve kterých ticích stisk Q vede k převzetí přikopnutím
function windowMs(v, off) { const ts = [], ds = []; for (let q = 0; q < 40; q++) { const r = run(v, off, q); if (r.kick) { ts.push(q); ds.push(r.dKick); } } return { n: ts.length, ms: ts.length * DT * 1000, first: ts[0], dMax: ds.length ? Math.max(...ds) : 0 }; }

for (const v of [300, 450, 600]) for (const off of [0, 8, 13, 20, 24]) {
  const base = run(v, off, null), w = windowMs(v, off);
  console.log(`info v=${v} px/s, odstup ${off} px: bez Q převzetí ${base.got >= 0 ? 'ANO' : 'ne'} · okno Q ${w.ms.toFixed(0)} ms (${w.n} tiků) · puk od středu ≤ ${w.dMax.toFixed(1)} px`);
}
// okno 60–200 ms pro puk 300–450 px/s mířící pod nohy (u 300 px/s na střed bere puk hokejka sama → měříme s odstupem 8 px)
const wins = [[300, 8], [450, 0], [450, 8]].map(([v, off]) => ({ v, off, ...windowMs(v, off) }));
for (const w of wins) chk(`okno puk ${w.v} px/s, odstup ${w.off} px: 60–200 ms (${w.ms.toFixed(0)} ms)`, w.ms >= 60 && w.ms <= 200);
const all = []; for (const v of [300, 450, 600]) for (const off of [0, 4, 8, 10]) all.push(windowMs(v, off).dMax);
chk(`při zabrání puk ≤ 12 px od středu těla (max ${Math.max(...all).toFixed(1)} px)`, Math.max(...all) <= 12);
for (const off of [13, 20, 24]) { let n = 0; for (const v of [300, 450, 600]) n += windowMs(v, off).n; chk(`puk ${off} px od těla Q nikdy nevezme (zabraných tiků ${n})`, n === 0); }
const w600 = windowMs(600, 8);
chk(`rychlý puk 600 px/s: bez Q nejde (${run(600, 8, null).got < 0}), Q pod nohama ano (${w600.n > 0})`, run(600, 8, null).got < 0 && w600.n > 0);
const early = run(450, 0, 0);
chk(`Q moc brzy (puk 90 px daleko) nezabere a zamkne se na 0,4 s (zámek ${early.cd.toFixed(2)} s) a brusle máchne naprázdno (${early.sw})`, !early.kick && early.cd > 0.3 - 1e-9 && early.sw > 0);
const wo = []; for (let q = 0; q < 40; q++) if (run(450, 0, q, { oppShot: true }).kick) wo.push(q);
chk(`čerstvou ránu soupeře Q nechytí (zabraných tiků ${wo.length})`, wo.length === 0);
// animace: časová osa ze simulace (KICK.FX) a plynulost dojezdu puku na čepel po tikách 1/60 s
{ let t0 = null, t1 = null, maxStep = 0, prev = 0;
  for (let e = 0; e <= KICK.FX + 1e-9; e += DT) { const u = kickPuckU(e); if (u > 0 && t0 == null) t0 = e - DT; if (u >= 1 && t1 == null) t1 = e; maxStep = Math.max(maxStep, u - prev); prev = u; }
  const mv = t1 - t0;
  chk(`přikopnutí trvá 0,25–0,4 s (${KICK.FX} s), noha na konci zpět (váha ${kickAnimW(KICK.FX).toFixed(2)})`, KICK.FX >= 0.25 && KICK.FX <= 0.4 && kickAnimW(KICK.FX) < 0.01);
  chk(`puk dojede na čepel za 0,1–0,15 s (${mv.toFixed(3)} s), největší skok ${(maxStep * 100).toFixed(0)} % dráhy za tik`, mv >= 0.1 - 1e-9 && mv <= 0.15 + 1e-9 && maxStep <= 0.4); }
{ const p = new Player('x', 'home', makeInput()); p.x = 0; p.y = 0; p.bodyAngle = 0; const P = { x: 200, y: 0, vx: 0, vy: 0, z: 0, isAirborne: false, faceoffTimer: 0 };
  p.trySkateKick(P); chk(`minutí: máchnutí naprázdno ${KICK.SW} s (spuštěno ${p._kickSw > 0}), bez přikopnutí (${!(p._kickFx > 0)})`, p._kickSw > 0 && !(p._kickFx > 0)); }
const w450 = wins[1], a = JSON.stringify([run(450, 0, w450.first), run(600, 8, w600.first)]), b = JSON.stringify([run(450, 0, w450.first), run(600, 8, w600.first)]);
chk('deterministické', a === b);
console.log(`\n${ok}/${ok + fail} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
