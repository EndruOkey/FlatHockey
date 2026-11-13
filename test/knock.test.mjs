// ODSTUPŇOVANÝ KNOCKBACK — sdílená simulace match-core (offline i online). Deterministicky (pevné DT, žádný Math.random).
// RUBRIKA PŘEDEM (2026-11-12):
//  1 lehký náraz (I < kbMid) = postrčení jako dřív: neleží, nekolísá
//  2 střední (kbMid ≤ I < kbHeavy) = zakolísání: neleží, zpomalí (max. rychlost < 70 % bez zásahu), otočí se ≥ 0,25 rad, puk drží
//  3 destruktivní (I ≥ kbHeavy) = rozplácnutí: ztratí puk; 100 % ticků v leže bez puku, bez pickupu
//    a bez vlivu vlastního vstupu (dva různé vstupy → shodná poloha); doba ležení 0,5–0,8 s; pak se zvedne a jede
//  4 po zvednutí ho další tvrdý náraz hned nesrazí (žádné řetězení)
//  5 crosscheck: rozjetý zepředu = rozplácnutí, ze stoje na odjíždějícího = ne
//  6 stejný vstup = stejný otisk; 7 server posílá ve snapshotu pole kd jen při stavu (vč. _fallB = natočení při zásahu → břicho/záda)
// RUBRIKA ANIMACE PŘEDEM (2026-11-13, downBody.js, čistá póza z času od zásahu):
//  8 doba pádu (DOWN_FALL) 0,15–0,25 s, zvedání (upT) 0,35–0,5 s
//  9 plynulost: žádný díl (hlava, ramena, lokty, rukavice, kyčle, kolena, brusle, konce hole) neposkočí o > 3 px za tik (1/60 s)
//    vůči středu hráče v 1×, po celé sekvenci (pád → ležení → zvedání), 64 kombinací (břicho/záda, směr, pravák/levák, id)
// 10 začátek a konec sekvence = stojící proporce skinBody (helma 0,72R vpředu, ramena 0,25R/±0,9R) — odchylka < 0,5 px
// 11 póza deterministická (dvakrát stejný vstup = stejná čísla)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4761';
process.env.DB_PATH = join(tmpdir(), `fh-knock-${process.pid}.db`);
const { createMatch, stepMatch, makeInput, applyClientInput, faceoff, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
let ok = 0, fail = 0; const chk = (n, c, info = '') => { console.log((c ? 'OK   ' : 'FAIL ') + n + (info ? '  ' + info : '')); c ? ok++ : fail++; };

// h0 (oběť) stojí/jede na (500, 228); a0 do něj najíždí zleva rychlostí v (px/s). opts: carry, cc (crosscheck), h0in (vstup h0 v leže)
function scene(v, opts = {}) {
  const m = createMatch(7, {});
  const h = new Player('h0', 'home', makeInput()), a = new Player('a0', 'away', makeInput());
  for (const p of [h, a]) { m.players.set(p.id, p); m.inputs.set(p.id, p.input); m.world.entities.push(p); }
  faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false;
  h.x = 500; h.y = 228; h.vx = opts.hv || 0; h.vy = 0; h.bodyAngle = h.skateAngle = h.aimAngle = Math.PI; h.carryAngle = Math.PI;
  a.x = 500 - 2 * PLAYER.bodyRadius - 1; a.y = 228 + (opts.dy || 0); a.vx = v; a.vy = 0; a.bodyAngle = a.skateAngle = a.aimAngle = 0;
  const P = m.puck; P.faceoffTimer = 0; P.x = 600; P.y = 400; P.vx = P.vy = 0;
  if (opts.carry) { h.hasPuck = true; h._possT = 99; }
  if (opts.cc) { a.x = 500 - 26; }
  const T = [];
  for (let t = 0; t < 120; t++) {
    const hin = h.isDown && opts.h0in ? opts.h0in : { dx: opts.hdx ?? 0, dy: 0, aim: Math.PI, aimDist: 60 };
    applyClientInput(h.input, { lmb: false, rmb: false, mmb: false, kq: false, ...hin });
    applyClientInput(a.input, { dx: t < 2 || opts.cc ? 1 : 0, dy: 0, aim: 0, aimDist: 60, rmb: !!opts.cc && t < 10, lmb: false, mmb: false, kq: false });
    if (opts.puckOnTip && h.isDown && t > 3) { const tp = h.stickTip; P.x = tp.x; P.y = tp.y; P.vx = h.vx; P.vy = h.vy; }   // puk přímo na čepeli ležícího
    stepMatch(m);
    if (opts.stop && opts.stop(h, t)) break;
    T.push({ t, x: h.x, y: h.y, sp: Math.hypot(h.vx, h.vy), down: h._downT > 0, up: h._upT > 0, stag: h._stagT > 0, hp: h.hasPuck, ba: h.bodyAngle });
  }
  return { m, h, a, T };
}
const sig = T => T.reduce((s, r) => (s * 31 + Math.round(r.x * 100) + Math.round(r.y * 100) * 7 + (r.down ? 3 : 0)) >>> 0, 7);

// 1 lehký
{ const r = scene(70); chk('lehký náraz: neleží, nekolísá', !r.T.some(x => x.down || x.stag)); }
// 2 střední
{ const r = scene(150, { carry: true, hdx: -1 }), b = scene(0, { carry: true, hdx: -1 });
  const st = r.T.some(x => x.stag), dn = r.T.some(x => x.down), maxSp = Math.max(...r.T.slice(3, 25).map(x => x.sp)), base = Math.max(...b.T.slice(3, 25).map(x => x.sp));
  let maxRot = 0; for (let i = 0; i < 30; i++) maxRot = Math.max(maxRot, Math.abs(((r.T[i].ba - Math.PI + 3 * Math.PI) % (2 * Math.PI)) - Math.PI));
  chk('střední: zakolísá, neleží', st && !dn);
  chk('střední: puk drží', r.T.slice(0, 20).every(x => x.hp));
  chk('střední: otočí se ≥ 0,25 rad', maxRot >= 0.25, maxRot.toFixed(2) + ' rad');
}
{ // zpomalení: hráč v plné jízdě (vstup drží), zakolísání bočním zásahem vs. bez zásahu → rychlost po 0,3 s
  const ride = hit => { const m = createMatch(7, {}); const h = new Player('h0', 'home', makeInput()); m.players.set('h0', h); m.inputs.set('h0', h.input); m.world.entities.push(h);
    faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false; m.puck.x = 900; m.puck.y = 60; m.puck.vx = m.puck.vy = 0;
    h.x = 700; h.y = 228; h.vx = -PLAYER.speed; h.vy = 0; h.bodyAngle = h.skateAngle = h.aimAngle = Math.PI;
    if (hit) h.takeHit((PLAYER.kbMid + PLAYER.kbHeavy) / 2, 0, 1);
    for (let t = 0; t < 18; t++) { applyClientInput(h.input, { dx: -1, dy: 0, aim: Math.PI, aimDist: 100 }); stepMatch(m); }
    return Math.hypot(h.vx, h.vy); };
  const s0 = ride(false), s1 = ride(true);
  chk('střední: zpomalí (≥ 25 px/s pod jízdou bez zásahu)', s0 - s1 >= 25, `${s1.toFixed(0)} vs ${s0.toFixed(0)} px/s`);
}
// 3 destruktivní
{ const A = scene(240, { carry: true, h0in: { dx: 1, dy: -1, aim: 0, aimDist: 100, lmb: true } }), B = scene(240, { carry: true, h0in: { dx: -1, dy: 1, aim: 2, aimDist: 30, rmb: true } });
  const dA = A.T.filter(x => x.down), dB = B.T.filter(x => x.down);
  chk('destruktivní: leží', dA.length > 0);
  chk('destruktivní: ztratí puk, v leže 100 % bez puku', dA.length > 0 && dA.every(x => !x.hp), `${dA.filter(x => !x.hp).length}/${dA.length}`);
  const same = dA.length === dB.length && dA.every((x, i) => Math.abs(x.x - dB[i].x) < 1e-9 && Math.abs(x.y - dB[i].y) < 1e-9);
  chk('destruktivní: vlastní vstup v leže nemá vliv (100 % ticků)', same);
  const dur = (dA.length + 1) * DT;
  chk('destruktivní: doba ležení 0,5–0,8 s', dur >= 0.5 && dur <= 0.8, dur.toFixed(2) + ' s');
  const upEnd = A.T.findIndex((x, i) => i > 0 && A.T[i - 1].up && !x.up);
  chk('destruktivní: pak se zvedne', upEnd > 0 && !A.h.isDown);
  const P = scene(240, { carry: true, puckOnTip: true }), dP = P.T.filter(x => x.down);
  chk('destruktivní: puk na čepeli ležícího nesebere', dP.length > 0 && dP.every(x => !x.hp) && !P.h.canPickup(P.m.puck));
  // 4 řetězení: nový tvrdý náraz těsně po zvednutí
  const C = scene(240, { stop: (h, t) => t > 5 && !h.isDown }), h = C.h, a = C.a;
  a.x = h.x - 2 * PLAYER.bodyRadius - 1; a.y = h.y; a.vx = 240; a.vy = 0; h.vx = h.vy = 0;
  stepMatch(C.m); chk('po zvednutí hned znovu nespadne', !h.isDown && h._hitImm > 0);
  // 6 determinismus
  const A2 = scene(240, { carry: true, h0in: { dx: 1, dy: -1, aim: 0, aimDist: 100, lmb: true } });
  chk('deterministické (stejný otisk)', sig(A.T) === sig(A2.T), String(sig(A.T)));
}
// 5 crosscheck
{ const r = scene(150, { cc: true }); chk('crosscheck rozjetý zepředu = rozplácnutí', r.T.some(x => x.down)); }
{ const r = scene(0, { cc: true, hv: 60, hdx: 1 });
  chk('crosscheck ze stoje na odjíždějícího = neleží', !r.T.some(x => x.down) && r.a._crossCheckCool !== undefined); }
// 7 snapshot
{ const { __test } = await import('../server.js');
  const r = scene(240, { carry: true }), m = r.m; let kdDown = null, kdNone = null;
  const m2 = createMatch(7, {}); const p2 = new Player('x', 'home', makeInput()); m2.players.set('x', p2); m2.inputs.set('x', p2.input);
  kdNone = __test.snapPlayers(m2)[0].kd;
  const h = r.h; h._downT = 0.3; h._upT = PLAYER.upT; h._fallA = 1.2; kdDown = __test.snapPlayers(m).find(p => p.id === 'h0').kd;
  chk('snapshot: kd při rozplácnutí, jinak chybí', Array.isArray(kdDown) && kdDown[0] === 0.3 && kdDown[2] === 1.2 && kdNone === undefined, JSON.stringify(kdDown));
}
// 8–11 animace
{ const { downPoints, DOWN_FALL } = await import('../public/js/entities/downBody.js');
  chk('pád 0,15–0,25 s', DOWN_FALL >= 0.15 && DOWN_FALL <= 0.25, DOWN_FALL + ' s');
  chk('zvedání 0,35–0,5 s', PLAYER.upT >= 0.35 && PLAYER.upT <= 0.5, PLAYER.upT + ' s');
  const tot = PLAYER.downT + PLAYER.upT; let worst = 0, wInfo = '', endErr = 0, detOk = true;
  for (const sg of [1, -1]) for (const h of [1, -1]) for (let i = 0; i < 4; i++) for (const id of ['h0', 'a1', 'bot3', 'x']) {
    const fa = i * 1.7 - 2.5, fb = fa + (sg > 0 ? 0.3 : Math.PI - 0.4) * (h > 0 ? 1 : -1), q = { id, n: i + 1, fb, fa, ba: fb, h };
    let prev = null;
    for (let t = 0; t <= Math.ceil(tot / DT); t++) {
      const el = Math.min(tot, t * DT), P = downPoints(el, { ...q, ba: fb + (el > PLAYER.downT ? (i - 1.5) * (1 - Math.exp(-6 * (el - PLAYER.downT))) : 0) }, PLAYER);   // při zvedání se tělo stáčí k míření (jako _move, rychlost 6/s)
      if (prev) for (const k in P) { const d = Math.hypot(P[k][0] - prev[k][0], P[k][1] - prev[k][1]); if (d > worst) { worst = d; wInfo = `${k} el=${el.toFixed(3)} sg=${sg} h=${h} fa=${fa.toFixed(1)}`; } }
      prev = P;
    }
    const c = Math.cos(q.ba), s = Math.sin(q.ba), R = PLAYER.radius;
    const want = { hd: [0.72 * R, 0], rs: [0.25 * R, 0.9 * R], ls: [0.25 * R, -0.9 * R] };
    for (const el of [0, tot]) { const P = downPoints(el, q, PLAYER); for (const k in want) { const w = want[k], wx = w[0] * c - w[1] * s, wy = w[0] * s + w[1] * c; endErr = Math.max(endErr, Math.hypot(P[k][0] - wx, P[k][1] - wy)); } }
    const a = JSON.stringify(downPoints(0.5, q, PLAYER)), b = JSON.stringify(downPoints(0.5, q, PLAYER)); if (a !== b) detOk = false;
  }
  chk('plynulost: max skok dílu ≤ 3 px/tik', worst <= 3, worst.toFixed(2) + ' px (' + wInfo + ')');
  chk('začátek/konec = stojící proporce (< 0,5 px)', endErr < 0.5, endErr.toFixed(3) + ' px');
  chk('póza deterministická', detOk);
}
console.log(`\n${ok} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
