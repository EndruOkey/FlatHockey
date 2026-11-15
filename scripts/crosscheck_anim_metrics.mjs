// CROSSCHECK PLYNULE — deterministické měření přechodu hůl ↔ crosscheck (2026-11-14, Ondřej: „Crosscheck by neměl být sekavá
// animace, ale plynulá, jako všechno ostatní."). Kreslí SKUTEČNÁ kresba hry (Player.draw z /js/entities/Player.js) v prohlížeči
// na vlastní plátno s pevným krokem 1/60 s (cam.dt) a předepsanou kinematikou → stejný vstup = stejné snímky. Simulace se nepouští,
// jen Player._updateStickDisplay (vyhlazení úhlu hole, jako ve hře). Body póz čte z háčku globalThis.__fhCcDbg (p._ccDbg).
// Server musí běžet: PORT=49xx node server.js
//   node scripts/crosscheck_anim_metrics.mjs --port=4931 [--T=0 (okamžité přepnutí = chování před změnou)] [--out=DIR (snímky)] [--json]
//
// RUBRIKA (stanovena PŘEDEM, 2026-11-14; 1× = trénink 1366×768 dpr 1 → 1,198 px na svět. jednotku, jako body_anim_metrics.mjs):
// Měří se v LOKÁLU TĚLA (střed hráče, natočení bodyAngle) → jízda a otáčení těla se odečtou, zbude jen pohyb hole/rukou/těla vůči hráči.
// Scénáře: stoj (pravák), stoj (levák), jízda vpřed 165 px/s (pravák); v každém RMB zapnout na 0,6 s a pustit, okno = 0,4 s po přepnutí;
// navíc „tuk" = RMB jen 4 snímky v jízdě (puštění uprostřed náběhu) — platí C1–C3, C5 (po puštění), C4 se tu neměří.
//  C1 Hůl: konec, pata čepele a špička čepele neskočí mezi snímky > 3 px (1×). Proč 3: B10 v body_anim_metrics (body těla ≤ 3 px)
//     a 3 px ≈ čtvrtina šířky těla v 1× (R 7 × 1,198 ≈ 8,4 px) — větší skok oko čte jako „cuk" (odhad, ne měřeno na lidech).
//     Pozn.: hůl se při přechodu otočí o ~50–90° kolem úchopu → špička čepele urazí ~25 px (1×); při 0,15 s a hladkém náběhu
//     (smoothstep, špička rychlosti 1,5× průměru) to vychází ~3–4 px/snímek → C1 je u špičky na hraně (odhad předem).
//  C2 Ruce: obě rukavice (skinRig H) neskočí > 3 px (1×).
//  C3 Tělo: ramena, lokty a helma (skinRig S, E, head) neskočí > 3 px (1×).
//  C4 Délka přechodu: míchání póz (p._ccB) projede 0 → 1 i 1 → 0 za 0,08–0,2 s (kratší = pořád cuk, delší = líné, RMB je bojová akce).
//  C5 Konečná póza: plně v crosschecku (0,6 s po stisku) i 1 s po puštění jsou body hole/rukou/těla shodné s okamžitým přepnutím
//     (--T=0 = dnešní chování) do 0,01 px → mění se jen cesta, ne cíl. (Výjimka: dýchání ve stoji běží dál i během crosschecku → helma
//     po puštění může mít jinou fázi dechu; ve stoji se proto po puštění C5 porovná bez těla, jen hůl a ruce.)
//  C6 Deterministické: dva běhy = stejný hash všech bodů a obrazů.
import { chromium } from 'playwright';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4931, SC1 = 1.198, LIM = 3, OUT = A.out || null;
const SCEN = [
  { id: 'stoj', hnd: 1, v: 0 },
  { id: 'stoj_levak', hnd: -1, v: 0 },
  { id: 'jizda', hnd: 1, v: 165 },
  { id: 'tuk', hnd: 1, v: 165, off: 34 },   // ťuknutí RMB na 4 snímky: puštění uprostřed náběhu (obrat přechodu)
];
const ON = 30, OFF = 66, END = 130;   // snímek stisku RMB, puštění, konec (60 fps)

async function run(page, T) {
  return page.evaluate(async ({ SCEN, T, ON, OFF, END, shots }) => {
    const { Player } = await import('/js/entities/Player.js');
    const { skinRig } = await import('/js/entities/skin.js');
    globalThis.__fhCcDbg = true; if (T != null) globalThis.__fhCcT = T; else delete globalThis.__fhCcT;
    const DT = 1 / 60, S = 1.198 * 3, W = 200, res = {};
    const cv = document.createElement('canvas'); cv.width = W; cv.height = W; const ctx = cv.getContext('2d');
    for (const sc of SCEN) {
      const p = new Player('cc' + sc.id, sc.hnd > 0 ? 'home' : 'away', { keys: {} });
      p.handed = sc.hnd; p.x = 300; p.y = 300; p.vx = sc.v; p.vy = 0; p.bodyAngle = p.skateAngle = p.aimAngle = 0;
      p.carryAngle = 0.35 * sc.hnd; p._stickDisp = p.carryAngle; p.aimDist = 60; p._isLocal = false;
      const F = [], img = [];
      for (let n = 0; n < END; n++) {
        p.crossCheck = n >= ON && n < (sc.off ?? OFF);
        p.x += p.vx * DT; p._updateStickDisplay(DT);
        const cam = { scale: S, ox: W / 2 - p.x * S, oy: W / 2 - p.y * S, dt: DT, t: n * DT };
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#e8f1f8'; ctx.fillRect(0, 0, W, W);
        p.draw(ctx, cam);
        const d = p._ccDbg, ba = p.bodyAngle, c = Math.cos(ba), s = Math.sin(ba);
        const L = q => ({ x: (q.x - p.x) * c + (q.y - p.y) * s, y: -(q.x - p.x) * s + (q.y - p.y) * c });   // svět → lokál těla
        const rig = d ? skinRig(d.B) : null, O = d ? { x: d.bx, y: d.by } : { x: 0, y: 0 }, A = q => ({ x: q.x + O.x, y: q.y + O.y });
        F.push(d ? { e: d.e, b: d.b, stick: [L(d.butt), L(d.heel), L(d.end)], hands: rig.H.map(A), body: [...rig.S, ...rig.E, rig.head].map(A) } : null);
        img.push(cv.toDataURL('image/png'));
      }
      res[sc.id] = { F, img: shots ? img : null, ih: img };
    }
    return res;
  }, { SCEN, T, ON, OFF, END, shots: !!OUT });
}

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/?fhtest`, { waitUntil: 'load' }); await page.waitForTimeout(800);
const T = A.T != null ? +A.T : null;
const R1 = await run(page, T), R2 = await run(page, T), R0 = await run(page, 0);
await b.close();
if (!R1[SCEN[0].id].F[0]) {   // kresba bez háčku p._ccDbg (verze před změnou) → jen snímky + hash obrazů
  if (OUT) { mkdirSync(OUT, { recursive: true });
    for (const sc of SCEN) R1[sc.id].img.forEach((u, i) => writeFileSync(join(OUT, `${sc.id}_${String(i).padStart(3, '0')}.png`), Buffer.from(u.split(',')[1], 'base64'))); }
  const hi = r => createHash('sha256').update(JSON.stringify(Object.values(r).map(x => x.ih))).digest('hex').slice(0, 16);
  console.log('kresba bez háčku __fhCcDbg (stará verze): jen snímky; hash obrazů', hi(R1), hi(R2));
  process.exit(errs.length ? 1 : 0);
}

const H = r => createHash('sha256').update(JSON.stringify(Object.values(r).map(x => [x.F, x.ih]))).digest('hex').slice(0, 16);
const jump = (F, k, a, z) => { let m = 0; for (let n = a + 1; n <= z; n++) for (let i = 0; i < F[n][k].length; i++)
  m = Math.max(m, Math.hypot(F[n][k][i].x - F[n - 1][k][i].x, F[n][k][i].y - F[n - 1][k][i].y) * SC1); return m; };
const dur = (F, a, to) => { for (let n = a; n < F.length; n++) if (F[n].b === to) return (n - a + 1) / 60; return Infinity; };
const diff = (F, G, n, ks) => { let m = 0; for (const k of ks) for (let i = 0; i < F[n][k].length; i++) m = Math.max(m, Math.hypot(F[n][k][i].x - G[n][k][i].x, F[n][k][i].y - G[n][k][i].y) * SC1); return m; };
const rows = [], ok = { C1: true, C2: true, C3: true, C4: true, C5: true };
for (const sc of SCEN) {
  const F = R1[sc.id].F, G = R0[sc.id].F, W = 24;
  const r = { id: sc.id };
  const OF = sc.off ?? OFF;
  for (const [lab, a] of [['zap', ON], ['vyp', OF]]) {
    r[lab] = { hul: jump(F, 'stick', a - 1, a + W), ruce: jump(F, 'hands', a - 1, a + W), telo: jump(F, 'body', a - 1, a + W), t: dur(F, a, lab === 'zap' ? 1 : 0),
      klid: Math.max(jump(F, 'stick', 2, ON - 2), jump(F, 'hands', 2, ON - 2), jump(F, 'body', 2, ON - 2)) };
    ok.C1 &&= r[lab].hul <= LIM; ok.C2 &&= r[lab].ruce <= LIM; ok.C3 &&= r[lab].telo <= LIM; if (!sc.off) ok.C4 &&= r[lab].t >= 0.08 && r[lab].t <= 0.2;
  }
  r.konecCC = sc.off ? 0 : diff(F, G, OFF - 1, ['stick', 'hands', 'body']);
  r.konecVyp = diff(F, G, END - 1, sc.v ? ['stick', 'hands', 'body'] : ['stick', 'hands']);
  ok.C5 &&= r.konecCC <= 0.01 && r.konecVyp <= 0.01;
  rows.push(r);
}
const h1 = H(R1), h2 = H(R2); ok.C6 = h1 === h2;
const f = x => (x === Infinity ? '∞' : x.toFixed(2));
console.log(`crosscheck přechod (T = ${T ?? 'výchozí'}; 1× px/snímek, okno 0,4 s po přepnutí; limit ${LIM} px)`);
for (const r of rows) for (const lab of ['zap', 'vyp']) { const q = r[lab];
  console.log(`  ${r.id.padEnd(11)} ${lab}: hůl ${f(q.hul)}  ruce ${f(q.ruce)}  tělo ${f(q.telo)}  přechod ${f(q.t)} s  (klid před: ${f(q.klid)})`); }
for (const r of rows) console.log(`  ${r.id.padEnd(11)} konečná póza vs okamžité: v CC ${f(r.konecCC)} px, po puštění ${f(r.konecVyp)} px`);
console.log(`  C1 hůl ≤ ${LIM} px: ${ok.C1 ? 'OK' : 'NE'} | C2 ruce: ${ok.C2 ? 'OK' : 'NE'} | C3 tělo: ${ok.C3 ? 'OK' : 'NE'} | C4 0,08–0,2 s: ${ok.C4 ? 'OK' : 'NE'} | C5 cíl shodný: ${ok.C5 ? 'OK' : 'NE'} | C6 determinismus: ${ok.C6 ? 'OK' : 'NE'} (${h1})`);
if (errs.length) console.log('chyby stránky:', errs);
if (A.json) writeFileSync(A.json, JSON.stringify({ rows, ok, hash: h1 }, null, 1));
if (OUT) { mkdirSync(OUT, { recursive: true });
  for (const sc of SCEN) R1[sc.id].img.forEach((u, i) => writeFileSync(join(OUT, `${sc.id}_${String(i).padStart(3, '0')}.png`), Buffer.from(u.split(',')[1], 'base64'))); }
process.exit(errs.length || !Object.values(ok).every(Boolean) ? 1 : 0);
