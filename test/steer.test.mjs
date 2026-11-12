// Ovládání B2 „za kurzorem + zámek" (public/js/steer.js) + analogový průchod offline v match-core.
import { makeSteer, steerB2, steerR1, ROUND_W, STEER_DEAD } from '../public/js/steer.js';
import { makeInput, applyClientInput } from '../public/js/match-core.js';

let ok = 0, fail = 0;
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const chk = (name, c) => { console.log((c ? 'OK   ' : 'FAIL ') + name); c ? ok++ : fail++; };
const K = s => ({ w: s.includes('w'), a: s.includes('a'), s: s.includes('s'), d: s.includes('d') });
const me = { x: 0, y: 0, vx: 0, vy: 0 };

{ const st = makeSteer(); const r = steerB2(st, K('w'), me, { x: 100, y: 100 }, false, false);
  chk('W jede přesně ke kurzoru (45°, plynule)', near(r.dx, Math.SQRT1_2) && near(r.dy, Math.SQRT1_2)); }
{ const st = makeSteer(); const r = steerB2(st, K('w'), me, { x: 100, y: 30 }, false, false);
  chk('W k libovolnému úhlu (ne 8 směrů)', near(Math.atan2(r.dy, r.dx), Math.atan2(30, 100))); }
{ const st = makeSteer(); const r = steerB2(st, K('s'), me, { x: 100, y: 0 }, false, false);
  chk('S od kurzoru', near(r.dx, -1) && near(r.dy, 0, 1e-9)); }
{ const st = makeSteer(); const r = steerB2(st, K('d'), me, { x: 0, y: -100 }, false, false);
  chk('D bokem vpravo vůči kurzoru nahoře', near(r.dx, 1) && near(r.dy, 0, 1e-9)); }
{ const st = makeSteer(); const r = steerB2(st, K(''), me, { x: 100, y: 0 }, false, false);
  chk('bez kláves stojí', r.dx === 0 && r.dy === 0); }
{ const st = makeSteer();
  steerB2(st, K('w'), me, { x: 100, y: 0 }, false, false);
  const r1 = steerB2(st, K('w'), me, { x: 0, y: 100 }, true, false);   // stisk LMB: kurz už zamčen na 0°? ne — zamkne se na aktuální kurzor
  const r2 = steerB2(st, K('w'), me, { x: -100, y: 0 }, true, false);  // kurzor jinam při drženém LMB
  chk('LMB zamkne kurz při stisku a kurzor ho pak nemění', near(Math.atan2(r1.dy, r1.dx), Math.PI / 2) && near(r2.dx, r1.dx) && near(r2.dy, r1.dy));
  const r3 = steerB2(st, K('d'), me, { x: 100, y: 100 }, false, true);
  chk('RMB drží stejný zámek (D = bokem vůči zámku)', near(r3.dx, -1) && near(r3.dy, 0, 1e-9));
  const r4 = steerB2(st, K('w'), me, { x: 100, y: 0 }, false, false);
  chk('puštění tlačítek odemkne', near(r4.dx, 1)); }
{ const st = makeSteer();
  steerB2(st, K('w'), me, { x: 100, y: 0 }, false, false);
  const r = steerB2(st, K('w'), me, { x: 0, y: STEER_DEAD - 1 }, false, false);
  chk('kurzor v mrtvé zóně drží poslední kurz', near(r.dx, 1)); }
{ const run = () => { const st = makeSteer(), out = [];
    for (let i = 0; i < 200; i++) out.push(steerB2(st, K(['w', 'wd', 's', 'a', ''][i % 5]), { x: i, y: -i, vx: 3, vy: 1 }, { x: (i * 37) % 300 - 150, y: (i * 53) % 200 - 100 }, i % 7 < 2, i % 11 === 0));
    return JSON.stringify(out); };
  chk('deterministické (stejný vstup = stejný výstup)', run() === run()); }

// R1 zaoblené WASD
{ const st = makeSteer(); const r = steerR1(st, K('w'), me, 1 / 60);
  chk('R1 ze stání jede hned směrem kláves', near(r.dx, 0, 1e-9) && near(r.dy, -1)); }
{ const st = makeSteer(); steerR1(st, K('w'), me, 1 / 60); const r = steerR1(st, K('d'), me, 0.1);
  chk('R1 přepnutí W→D stočí jen o ROUND_W·dt (oblouk, ne skok)', near(Math.atan2(r.dy, r.dx), -Math.PI / 2 + ROUND_W * 0.1, 1e-9)); }
{ const st = makeSteer(); steerR1(st, K('w'), me, 1 / 60); let r; for (let i = 0; i < 60; i++) r = steerR1(st, K('d'), me, 1 / 60);
  chk('R1 po 1 s dojede přesně na směr kláves', near(r.dx, 1) && near(r.dy, 0, 1e-9)); }
{ const st = makeSteer(); const r = steerR1(st, K('d'), { x: 0, y: 0, vx: 0, vy: -150 }, 1 / 60);
  chk('R1 rozjezd z klouzání navazuje na aktuální kurz', Math.atan2(r.dy, r.dx) < -1.4); }
{ const st = makeSteer(); steerR1(st, K('w'), me, 1 / 60); const r0 = steerR1(st, K(''), me, 1 / 60); const r = steerR1(st, K('d'), me, 1 / 60);
  chk('R1 puštění kláves zastaví a další stisk jede hned', r0.dx === 0 && r0.dy === 0 && near(r.dx, 1)); }

// match-core: server-cesta dál 8 směrů, offline s an=1 plynule a nikdy rychleji než jednotka
{ const i = makeInput(); applyClientInput(i, { dx: 0.8, dy: 0.6, an: 1 });
  chk('bez analog flagu (server) kvantuje na 8 směrů', i.dx === 1 && i.dy === 1); }
{ const i = makeInput(); applyClientInput(i, { dx: 0.8, dy: 0.6, an: 1 }, true);
  chk('offline analog projde plynule', near(i.dx, 0.8) && near(i.dy, 0.6)); }
{ const i = makeInput(); applyClientInput(i, { dx: 3, dy: 4, an: 1 }, true);
  chk('offline analog ořízne délku na 1', near(Math.hypot(i.dx, i.dy), 1)); }
{ const i = makeInput(); applyClientInput(i, { dx: 0.8, dy: 0.6 }, true);
  chk('offline bez an (WASD) dál 8 směrů', i.dx === 1 && i.dy === 1); }
{ const i = makeInput(); applyClientInput(i, { dx: NaN, dy: 0, an: 1 }, true);
  chk('NaN nerozbije vstup', i.dx === 0 && i.dy === 0); }

console.log(`\n${ok}/${ok + fail} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
