// PŘIHRÁVKA A PŘÍJEM — deterministické měření KRESBY puku a hole při vypuštění (pas), chycení (příjem pasu) a sebrání volného puku.
// Simulace = match-core stepMatch (60 Hz, pevný seed), po každém tiku se zavolá SKUTEČNÉ Puck.draw() + Player.draw() do atrapy canvasu
// (Proxy) s pevnou kamerou 1× (1,198 px na svět. j., dt 1/60). Simulace se NEMĚNÍ — měří se jen, kde se puk a čepel KRESLÍ.
//   node scripts/pass_recv_metrics.mjs [--detail] [--r=0 = dřívější kresba]
//
// Rešerše (2026-11-15; hockeycanada.ca „Passing and receiving", usahockeygoaliecoach/USA Hockey ADM „Receiving a pass", howtohockey.com
// „How to receive a pass"): při příjmu jde čepel puku NAPROTI (natočená k přihrávce ještě před dotykem = cíl pro spoluhráče), v dotyku
// „povolí" — ustoupí po směru puku pár cm (cushioning, „soft hands") a puk tak zbrzdí, místo aby se od tvrdé čepele odrazil; přihrávka
// = švih/tah čepelí (puk se veze po čepeli od paty ke špičce) a čepel pokračuje za pukem k cíli (follow-through).
//
// RUBRIKA (stanovena PŘEDEM; 1× = 1366×768 dpr 1 → 1,198 px na svět. j.; okno události = 3 snímky před až 24 snímků po):
//  R1 Skok puku ≤ 2 px: pro každý snímek v okně s = min(|Δₙ − Δₙ₋₁|, |Δₙ − Vₙ·dt|) · 1,198, kde Δₙ = posun KRESLENÉHO puku za snímek
//     a Vₙ = rychlost puku v simulaci. Tj. kreslený puk buď plynule pokračuje ve svém viditelném pohybu (zrychlení ≤ 2 px/snímek²),
//     nebo se pohne přesně tak, jak se teď pohybuje simulace (skutečný úder = pas odejde z místa, kde byl puk VIDĚT). Teleport neprojde
//     ani jedním. Práh 2 px: puk má Ø 7 px; posun o ≥ 2 px za 1/60 s mimo trajektorii oko čte jako cuknutí (odhad, stejný práh jako P5
//     v puck_carry_metrics.mjs). Ve všech snímcích okna 100 %.
//  R2 Skok špičky hole ≤ 3 px: |Δₙ − Δₙ₋₁| koncového bodu kreslené čepele (p._visBlade e) u přihrávajícího i přijímajícího, 100 %.
//     (3 px: hůl je tenká a delší, rychlé natočení zápěstím je v pořádku; víc = záškub. Odhad, o 1 px volnější než puk.)
//  Okno končí 4 snímky před další událostí (pas dorazí dřív než za 24 snímků → okna se nepřekrývají).
//  R3 Přechod 0,06–0,15 s: doba od změny držení (puk na čepel / z čepele) do chvíle, kdy kreslený puk sedí přesně tam, kde ho kreslí
//     ustálený stav (na čepeli: bladePuck; volný: poloha simulace), tolerance 0,3 px. 0 s = skok, > 0,15 s = puk „plave" (lag).
//     [upřesněno po 1. měření: když další událost přijde dřív než za 0,1 s (krátký pas → chycení), přechod vypuštění nejde dokončit
//     v okně → „n/a" (nevyhodnoceno), ne chyba.]
//  Stav 2026-11-15 (VIS.r 1): R1 97,9 % — 6 snímků 2,1–2,16 px jen v pas_jizda (příjemce jede napříč pasem, relativní rychlost
//  ~480 j./s, puk chycen ~12 j. před čepelí): zastavit ho do 0,15 s (R3) vyžaduje ≥ ~6300 j./s² ≈ 2,1 px/snímek (výpočet bang-bang,
//  Player.js recvCatchPlan) — R1 a R3 tu jdou proti sobě. Před: nejhorší 16,96 px (--r=0).
//  R4 Deterministické: dva běhy = stejný hash (kreslený puk + čepele obou hráčů, všechny scénáře).
import { createHash } from 'crypto';
globalThis.Path2D = globalThis.Path2D || class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
globalThis.DOMMatrix = globalThis.DOMMatrix || class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new globalThis.DOMMatrix()) }); } };
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK } = await import('../public/js/constants.js');
const { VIS } = await import('../public/js/vis.js');
const VR = process.argv.find(a => a.startsWith('--r='));   // --r=0 = dřívější kresba (skok), výchozí VIS.r
if (VR) VIS.r = +VR.slice(4);
const DETAIL = process.argv.includes('--detail'), SC = 1.198;
const mk = () => { const f = function () {}; const P = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : (k in t ? t[k] : P), set: (t, k, v) => { t[k] = v; return true; }, apply: () => P }); return P; };
const ctx = mk(); const cam = { scale: SC, ox: 0, oy: 0, dt: DT };
const cy = RINK.h / 2, cx = RINK.centerX;

// scénáře: H = přihrávající (s pukem), T = příjemce (spoluhráč). passAt = tik stisku RMB (ťuk 2 tiky). free = volný puk bez H.
export const SCN = [
  { id: 'pas_stoj', H: [cx - 160, cy, 0], T: [cx + 40, cy, Math.PI], passAt: 20 },
  { id: 'pas_dlouhy', H: [cx - 260, cy, 0], T: [cx + 120, cy - 30, Math.PI], passAt: 20 },
  { id: 'pas_kratky', H: [cx - 60, cy, 0], T: [cx + 30, cy + 10, Math.PI], passAt: 20 },
  { id: 'pas_jizda', H: [cx - 160, cy + 60, 0], T: [cx + 20, cy - 60, 2.55], passAt: 25, tdy: 1, hdx: 1 },
  { id: 'pas_bok', H: [cx - 120, cy - 100, Math.PI / 2], T: [cx - 120, cy + 60, -Math.PI / 2], passAt: 20 },
  { id: 'volny_najezd', T: [cx - 90, cy, 0], free: [cx, cy, 0, 0], tdx: 1 },
  { id: 'volny_prijede', T: [cx + 60, cy, Math.PI], free: [cx - 40, cy + 2, 150, 0] },
];

export function run(sc) {
  const m = createMatch(7); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const T = new Player('t', 'home', makeInput()); m.players.set('t', T); m.inputs.set('t', T.input);
  let H = null;
  if (!sc.free) { H = new Player('h', 'home', makeInput()); m.players.set('h', H); m.inputs.set('h', H.input); }
  rebuildEntities(m); m.goalieL.x = -999; m.goalieR.x = -999;
  const place = (P, [x, y, a]) => { P.x = x; P.y = y; P.aimAngle = P.carryAngle = P.bodyAngle = P.skateAngle = a; P._stickDisp = a; P.input.aim = a; P.input.aimDist = 60; P._isLocal = false; };
  place(T, sc.T); if (H) { place(H, sc.H); H.hasPuck = true; H._possT = 99; m.puck.ownerId = 'h'; }
  else { const P = m.puck; P.x = sc.free[0]; P.y = sc.free[1]; P.vx = sc.free[2]; P.vy = sc.free[3]; P.z = 0; P.vz = 0; P.faceoffTimer = 0; P.ownerId = null; }
  const F = [];
  for (let n = 0; n < 110; n++) {
    T.input.dx = sc.tdx || 0; T.input.dy = sc.tdy || 0;
    T.input.aim = sc.T[2];   // příjemce míří kurzorem pevně (k přihrávajícímu / k puku); hůl k puku natáčí jen kresba (předstih)
    if (H) { H.input.dx = sc.hdx || 0; H.input.aim = Math.atan2(T.y - H.y, T.x - H.x); H.input.rmb = n >= sc.passAt && n < sc.passAt + 2; }
    stepMatch(m);
    const P = m.puck; P.draw(ctx, cam); if (H) H.draw(ctx, cam); T.draw(ctx, cam);
    const car = P._carrier && P._carrier.hasPuck && !P._carrier.crossCheck ? P._carrier : null;
    const d = P._drawn ? P._drawn :   // Puck.draw si pamatuje, kde puk nakreslil (volný i na čepeli)
      car && car._visPuck ? car._visPuck : P;
    const tipOf = Q => Q && Q._visBlade ? { x: Q._visBlade.ex, y: Q._visBlade.ey } : null;
    F.push({ n, d: { x: d.x, y: d.y }, v: { x: P.vx, y: P.vy }, sim: { x: P.x, y: P.y }, car: car ? car.id : null,
      rest: (q => ({ x: q.x, y: q.y }))(car ? (car._visRest || car._visPuck || P) : P),
      tH: tipOf(H), tT: tipOf(T), hH: H ? H.hasPuck : false, hT: T.hasPuck });
  }
  return F;
}

function evaluate() {
  const hash = createHash('sha256'), out = [];
  const W = { r1: 0, r2: 0, n1: 0, ok1: 0, n2: 0, ok2: 0, r3: [], ok3: true };
  for (const sc of SCN) {
    const F = run(sc);
    for (const f of F) hash.update(JSON.stringify([f.d, f.tH, f.tT].map(o => o && [+o.x.toFixed(6), +o.y.toFixed(6)])));
    const ev = [];
    for (let i = 1; i < F.length; i++) if (F[i].car !== F[i - 1].car) ev.push({ i, kind: F[i].car ? (F[i - 1].car ? 'předání' : 'chycení') : 'vypuštění', who: F[i].car || F[i - 1].car });
    const r = { id: sc.id, ev: [], r1: 0, r2: 0 };
    for (const [ei, e] of ev.entries()) {
      let m1 = 0, m2 = 0; const end = Math.min(F.length - 1, e.i + 24, ev[ei + 1] ? ev[ei + 1].i - 4 : 1e9);
      for (let k = Math.max(2, e.i - 3); k <= end; k++) {
        const a = F[k], b = F[k - 1], c = F[k - 2];
        const dn = { x: a.d.x - b.d.x, y: a.d.y - b.d.y }, dp = { x: b.d.x - c.d.x, y: b.d.y - c.d.y };
        const s1 = Math.min(Math.hypot(dn.x - dp.x, dn.y - dp.y), Math.hypot(dn.x - a.v.x * DT, dn.y - a.v.y * DT)) * SC;
        W.n1++; if (s1 <= 2) W.ok1++; m1 = Math.max(m1, s1);
        for (const key of ['tH', 'tT']) { if (!a[key] || !b[key] || !c[key]) continue;
          const s2 = Math.hypot(a[key].x - 2 * b[key].x + c[key].x, a[key].y - 2 * b[key].y + c[key].y) * SC; W.n2++; if (s2 <= 3) W.ok2++; m2 = Math.max(m2, s2); }
      }
      // R3: první snímek od události, kdy kreslený puk sedí na ustáleném místě (≤ 0,3 px) a už tam zůstane do konce okna
      let settle = null;
      for (let k = e.i; k <= end; k++) {
        let ok = true; for (let j = k; j <= end; j++) if (Math.hypot(F[j].d.x - F[j].rest.x, F[j].d.y - F[j].rest.y) * SC > 0.3) { ok = false; break; }
        if (ok) { settle = (k - e.i) * DT; break; }
      }
      const na = (end - e.i) * DT < 0.1 && settle == null;   // okno kratší než 0,1 s (puk chycen dřív, než přechod mohl doběhnout) → nevyhodnoceno
      const ok3 = na || (settle != null && settle >= 0.06 - 1e-9 && settle <= 0.15 + 1e-9); W.ok3 &&= ok3; W.r3.push(na ? 'n/a' : settle);
      W.r1 = Math.max(W.r1, m1); W.r2 = Math.max(W.r2, m2);
      r.ev.push(`${e.kind}@${e.i} (${e.who}) skok puku max ${m1.toFixed(2)} px, špička max ${m2.toFixed(2)} px, přechod ${settle == null ? '—' : settle.toFixed(3) + ' s'}`);
    }
    if (!ev.length) { W.ok3 = false; r.ev.push('BEZ UDÁLOSTI (puk nikdo nechytil)'); }
    out.push(r);
  }
  return { out, W, hash: hash.digest('hex').slice(0, 16) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('pass_recv_metrics.mjs')) {
  const A = evaluate(), B = evaluate(), W = A.W;
  if (DETAIL) for (const r of A.out) console.log(`${r.id.padEnd(14)} ${r.ev.join(' | ')}`);
  const ok = { R1: W.ok1 === W.n1, R2: W.ok2 === W.n2, R3: W.ok3, R4: A.hash === B.hash };
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + ' %';
  console.log(`scénářů ${SCN.length}, snímků v oknech ${W.n1}`);
  console.log(`R1 skok puku ≤ 2 px     ${pct(W.ok1, W.n1)} (práh 100 %, nejhorší ${W.r1.toFixed(2)} px) ${ok.R1 ? 'OK' : 'NE'}`);
  console.log(`R2 skok špičky ≤ 3 px   ${pct(W.ok2, W.n2)} (práh 100 %, nejhorší ${W.r2.toFixed(2)} px) ${ok.R2 ? 'OK' : 'NE'}`);
  console.log(`R3 přechod 0,06–0,15 s  [${W.r3.map(v => v == null ? '—' : typeof v === 'string' ? v : v.toFixed(3)).join(', ')}] ${ok.R3 ? 'OK' : 'NE'}`);
  console.log(`R4 determinismus        ${A.hash} / ${B.hash} ${ok.R4 ? 'OK' : 'NE'}`);
  const all = Object.values(ok).every(Boolean);
  console.log(all ? 'PŘIHRÁVKA A PŘÍJEM: OK' : 'PŘIHRÁVKA A PŘÍJEM: NE'); process.exitCode = all ? 0 : 1;
}
