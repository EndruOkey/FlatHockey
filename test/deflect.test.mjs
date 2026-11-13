// TEČ NA Q — sdílená simulace match-core (offline i online; trénink volá stejnou Player.trySkateKick). Deterministicky.
// Scéna: spoluhráč pálí od modré čáry (nabití 0,6–1,0), ty ve slotu 30–90 px před soupeřovou brankou, kurzor do rohu (±15 px).
// RUBRIKA PŘEDEM (2026-11-12):
//  R1 okno teče (medián přes rány) 80–250 ms
//  R2 Q v okně přesměruje ≥ 90 % stisků a ≥ 90 % z nich míří do ústí ± 8 px
//  R3 gól z teče 25–60 % stisků v okně (brankář má šanci)
//  R4 ztráta rychlosti 0,70–0,85× (načasování: stisk těsně před dotekem = 0,85×)
//  R5 bez Q se nic nemění: žádná teč na Q, pasivní teč/převzetí jako před změnou (32 / 123 / 0 ze 180 ran, stance shooter — změřeno na kódu před změnou)
//  R6 soupeřova rána: Q ji netečuje (ani nepřikopne — fresh rána soupeře), mimo prostor (150 px) Q netečuje
//  R7 kurzor za brankou → teč jde nahoru (na brankové čáře ≥ 8 px, pod břevnem), kurzor na čáře → po ledě (≤ 1,5 px)
//  R8 deterministické (dva běhy shodné)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-deflect.db');
const { scene, windowTicks } = await import('./deflect-scene.mjs');
let ok = 0, fail = 0; const chk = (n, c) => { console.log((c ? 'OK   ' : 'FAIL ') + n); c ? ok++ : fail++; };
const G = []; for (const c of [0.6, 1.0]) for (const d of [30, 60, 90]) for (const sy of [-90, 90]) for (const ay of [-15, 15]) G.push({ c, d, sy, ay, o: 0, stance: 'goal' });
let presses = 0, redir = 0, aim = 0, goal = 0, vr = [], wms = [];
for (const g of G) { const w = windowTicks(g); if (w.length) wms.push(w.length * 1000 / 60);
  for (const q of w) { const r = scene({ ...g, q }); presses++; if (r.redir) { redir++; vr.push(r.vOut / r.vIn); } if (r.aimOk) aim++; if (r.goal) goal++; } }
wms.sort((a, b) => a - b); vr.sort((a, b) => a - b); const med = wms[wms.length >> 1] || 0;
console.log(`info ${G.length} ran, ${wms.length} s oknem, okno ${wms[0]?.toFixed(0)}–${wms[wms.length - 1]?.toFixed(0)} ms, ${presses} stisků v okně`);
chk(`R1 okno teče medián 80–250 ms (${med.toFixed(0)} ms)`, med >= 80 && med <= 250 && wms.length >= G.length * 0.9);
chk(`R2 přesměrováno ${(100 * redir / presses).toFixed(1)} % stisků, do ústí ${(100 * aim / Math.max(1, redir)).toFixed(1)} %`, redir >= 0.9 * presses && aim >= 0.9 * redir);
const gp = 100 * goal / presses; chk(`R3 gól z teče 25–60 % (${gp.toFixed(1)} %)`, gp >= 25 && gp <= 60);
chk(`R4 rychlost po teči ${vr[0]?.toFixed(2)}–${vr[vr.length - 1]?.toFixed(2)}× (v 0,70–0,85)`, vr[0] >= 0.70 - 1e-9 && vr[vr.length - 1] <= 0.85 + 1e-9);
{ let n = 0, defl = 0, pick = 0, gl = 0, q = 0;
  for (const c of [0.2, 0.4, 0.6, 0.8, 1.0]) for (const d of [30, 50, 70, 90]) for (const sy of [-90, 0, 90]) for (const o of [-6, 0, 6]) {
    const r = scene({ c, d, sy, o, stance: 'shooter' }); n++; if (r.passive) defl++; if (r.picked) pick++; if (r.goal) gl++; if (r.redir) q++; }
  chk(`R5 bez Q: teč na Q 0 (${q}), pasivní teč ${defl}/${n} (32), převzato ${pick}/${n} (123), gól ${gl} (0)`, q === 0 && defl === 32 && pick === 123 && gl === 0); }
{ let opp = 0, far = 0; for (const g of G.slice(0, 6)) { for (let q = 0; q < 75; q++) { if (scene({ ...g, q, oppShot: true }).redir) opp++; if (scene({ ...g, d: 150, q }).redir) far++; } }
  chk(`R6 soupeřova rána Q netečuje (${opp}), mimo prostor 150 px netečuje (${far})`, opp === 0 && far === 0); }
{ let hiZ = [], loZ = []; for (const g of G) { const wh = windowTicks({ ...g, high: true }), wl = windowTicks(g);
    if (wh.length) hiZ.push(scene({ ...g, high: true, q: wh[wh.length >> 1] }).zLine); if (wl.length) loZ.push(scene({ ...g, q: wl[wl.length >> 1] }).zLine); }
  const mh = Math.min(...hiZ), xl = Math.max(...loZ);
  chk(`R7 kurzor za brankou: výška na brankové čáře ≥ 8 px (min ${mh.toFixed(1)}), kurzor na čáře ≤ 1,5 px (max ${xl.toFixed(1)}), pod břevnem 21`, mh >= 8 && Math.max(...hiZ) < 21 && xl <= 1.5); }
{ const g = G[3], w = windowTicks(g), a = JSON.stringify(w.map(q => scene({ ...g, q }))), b = JSON.stringify(w.map(q => scene({ ...g, q })));
  chk('R8 deterministické', a === b); }
console.log(`\n${ok}/${ok + fail} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
