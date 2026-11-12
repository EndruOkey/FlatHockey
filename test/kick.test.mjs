// Přikopnutí puku do jízdy (Q) — sdílená simulace match-core (offline i online). Deterministicky.
// Rubrika předem (2026-11-12): okno 80–300 ms; rychlý puk (≥ 450 px/s), který hokejkou čistě nejde, Q v okně zpracuje;
// Q mimo okno nezabere a zamkne se; čerstvou ránu soupeře Q nechytí; bez Q se nic nemění.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-kick.db');
const { createMatch, stepMatch, makeInput, applyClientInput, faceoff, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
let ok = 0, fail = 0; const chk = (n, c) => { console.log((c ? 'OK   ' : 'FAIL ') + n); c ? ok++ : fail++; };

// hráč stojí na (400, 228), puk letí zleva po ose y = 228 + off rychlostí v; qAt = tik stisku Q (null = bez Q)
function run(v, off, qAt, opts = {}) {
  const m = createMatch(11, {}); const p = new Player('h0', 'home', makeInput()); m.players.set('h0', p); m.inputs.set('h0', p.input); m.world.entities.push(p);
  faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false;
  p.x = 400; p.y = 228; p.vx = p.vy = 0; p.aimAngle = Math.PI;   // kouká proti puku
  const P = m.puck; P.x = 400 - 90; P.y = 228 + off; P.z = 0; P.vx = v; P.vy = 0; P.vz = 0; P.faceoffTimer = 0; P._carrier = null; P.ownerId = null;
  if (opts.oppShot) { P._shot = { id: 'a0', team: 'away' }; P._shotAge = 0; }
  let got = -1, cdAfter = 0;
  for (let t = 0; t < 40; t++) {
    applyClientInput(p.input, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq: qAt === t, aim: Math.PI, aimDist: 60 });
    stepMatch(m);
    if (t === qAt) cdAfter = p._kickCd || 0;
    if (p.hasPuck && got < 0) got = t;
  }
  return { got, kick: (p._kickN || 0) > 0, cd: cdAfter };
}
// okno: ve kterých ticích stisk Q vede k převzetí přikopnutím
function windowMs(v, off) { const ts = []; for (let q = 0; q < 40; q++) { const r = run(v, off, q); if (r.kick) ts.push(q); } return { n: ts.length, ms: ts.length * DT * 1000, first: ts[0] }; }

for (const v of [300, 450, 600]) for (const off of [0, 15, 24]) {
  const base = run(v, off, null), w = windowMs(v, off);
  console.log(`info v=${v} px/s, odstup ${off} px: bez Q převzetí ${base.got >= 0 ? 'ANO' : 'ne'} · okno Q ${w.ms.toFixed(0)} ms (${w.n} tiků)`);
}
const w450 = windowMs(450, 0), w600 = windowMs(600, 15);
chk(`okno pro puk 450 px/s je 80–300 ms (${w450.ms.toFixed(0)} ms)`, w450.ms >= 80 && w450.ms <= 300);
chk(`rychlý puk 600 px/s: bez Q nejde (${run(600, 15, null).got < 0}), Q v okně ano (${w600.n > 0})`, run(600, 15, null).got < 0 && w600.n > 0);
const early = run(450, 0, 0);
chk(`Q moc brzy (puk 90 px daleko) nezabere a zamkne se na 0,4 s (zámek ${early.cd.toFixed(2)} s)`, !early.kick && early.cd > 0.3 - 1e-9);
const wo = []; for (let q = 0; q < 40; q++) if (run(450, 0, q, { oppShot: true }).kick) wo.push(q);
chk(`čerstvou ránu soupeře Q nechytí (zabraných tiků ${wo.length})`, wo.length === 0);
chk('daleko (odstup 40 px) Q nezabere', windowMs(450, 40).n === 0);
const a = JSON.stringify([run(450, 0, w450.first), run(600, 15, w600.first)]), b = JSON.stringify([run(450, 0, w450.first), run(600, 15, w600.first)]);
chk('deterministické', a === b);
console.log(`\n${ok}/${ok + fail} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
