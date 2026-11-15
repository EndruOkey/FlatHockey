// PUK NA ČEPELI — deterministické měření KRESBY vedeného puku (bez prohlížeče). Simulace = match-core stepMatch (60 Hz, pevný seed),
// po každém tiku se zavolá SKUTEČNÉ Player.draw() do atrapy canvasu (Proxy) s pevnou kamerou (1× trénink: 1,198 px na svět. j., dt 1/60).
// Kresba si uloží čepel (p._visBlade: bezier pata→špička, poloviční tloušťka s obrysem), polohu puku (p._visPuck) a natočení puku (puck._spin).
// Simulace (poloha puku ve hře) se NEMĚNÍ — měří se jen, kam a jak se puk kreslí.  node scripts/puck_carry_metrics.mjs [--detail]
//
// Rešerše (2026-11-14; hockeyshare.com „Stationary Stickhandling", howtohockey.com „soft touch", hockeyshot.com stickhandling series,
// icehockeysystems.com „Puck Handling Basics"): puk se vede UPROSTŘED čepele (ne u paty, ne na špičce), čepel ho „přiklápí" (cupping)
// na forhendu i bekhendu, přechod forhend↔bekhend = otočení zápěstí, puk se při tom kutálí po čepeli; vedení před tělem v šířce ramen.
// Fyzika kresby: puk se o čepel neprokluzuje → když po ní popojede o ds, pootočí se o ds/r; když se čepel otáčí (klička), puk se otáčí s ní.
// Jízda rovně se stálou holí = puk klouže s čepelí po ledě, netočí se.
//
// RUBRIKA (stanovena PŘEDEM; 1× = 1366×768 dpr 1 → 1,198 px na svět. j.; vedení = hráč drží puk, nápřah dcv < 0,2, bez přikopnutí):
//  P1 Dotyk: vzdálenost středu puku od osy čepele − (poloviční tloušťka čepele s obrysem + poloměr puku) ∈ ⟨−0,6; +0,6⟩ px ≥ 95 % snímků.
//     (0,6 px = půl pixelu + zaokrouhlení antialiasu; víc už je vidět mezera nebo puk „v“ čepeli.) Měří se usazený puk |p._visSide| ≥ 0,95;
//     při přehozu forhend↔bekhend se čepel nad pukem zvedne a puk pod ní podjede (to hlídá P3 + P5). [upřesněno po 1. měření]
//  P2 Uprostřed čepele: střed puku promítnutý na čepel leží od středu čepele ≤ 2,5 px (≈ 20 % délky kreslené čepele 10,3 j.) ≥ 95 %
//     ve VŠECH směrech jízdy (vpřed, zatáčka, couvání, bokem, stoj, klička, blízko, daleko).
//  P3 Strana: usazený puk leží na forhendu (prohnutá strana), dokud hůl nejde zřetelně přes tělo (úhel hole vůči ose těla ·ruka ≥ −0,05 rad),
//     na bekhendu při ≤ −0,25 rad (mezi = hystereze, obojí OK) ≥ 95 %; přechod spojitě (P5). [upřesněno po snímcích: dřív podle
//     simulačního _cradleSide, ten se překlápí už u hole rovně před tělem → puk ve stoji/couvání skákal na bekhend]
//  P4 Nikdy pod tělem/helmou: kotouč puku nezasahuje do trupu (kruh 1,1 R = kreslený trup) ani do helmy (elipsa skin.js, střed 0,72 R,
//     poloosy 0,616 × 0,56 R) — 100 % snímků. (Puk se kreslí PŘED tělem → překryv = schovaný puk.)
//  P5 Plynulost: poloha puku vůči STŘEDU ČEPELE neskočí > 2 px mezi snímky (mimo prvních 10 tiků scénáře) — 100 %.
//     (Vůči čepeli, ne vůči hráči: rychlá klička ±0,9 rad 1,2 Hz posune samotnou čepel o 2,7 px/snímek — to je pohyb hole, ne skok puku.)
//  P6 Rotace z pohybu čepele: při kličce |korelace(rychlost otáčení puku, rychlost otáčení tečny čepele − sg·ds/r)| ≥ 0,9 a otáčení
//     není nulové (špička–špička ≥ 1 rad); při jízdě rovně a ve stoji se puk netočí sám od sebe: čistý posun ≤ 0,3 rad za 2 s a kyv
//     ≤ 0,3 rad (puk smí jen kopírovat kývání čepele v rytmu kroku). [upřesněno po 1. měření: dřív |ω| ≤ 0,3 rad/s — kyv čepele s krokem
//     ±0,05 rad dává ~1 rad/s, a to je pohyb čepele, ne samovolná rotace]
//  P7 Deterministické: dva běhy = stejný hash (poloha + natočení puku, čepel, všechny scénáře).
// Prahy px jsou na 1×; odhad: tloušťka obrysu ze STICK_V (S3 blo 4,3) — kdyby se měnil skin hole, mění se P1 automaticky (čte hw z kresby).
import { createHash } from 'crypto';
globalThis.Path2D = globalThis.Path2D || class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
globalThis.DOMMatrix = globalThis.DOMMatrix || class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new globalThis.DOMMatrix()) }); } };
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK, PLAYER, PUCK } = await import('../public/js/constants.js');
const DETAIL = process.argv.includes('--detail');
const SC = 1.198, R = PLAYER.radius;
// atrapa 2D kontextu: každá metoda vrací atrapu, vlastnosti se dají zapisovat
const mk = () => { const f = function () {}; const P = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : (k in t ? t[k] : P), set: (t, k, v) => { t[k] = v; return true; }, apply: () => P }); return P; };
const ctx = mk(); const cam = { scale: SC, ox: 0, oy: 0, dt: DT };

const SCN = [
  { id: 'vpred', dx: 1, dy: 0, aim: () => 0, dist: 60, straight: true },
  { id: 'zatacka', dx: 1, dy: 0, aim: (t, H) => Math.atan2(H.vy, H.vx), dist: 60, turn: true },
  { id: 'couvani', dx: -1, dy: 0, aim: () => 0, dist: 60, straight: true },
  { id: 'bokem', dx: 0, dy: 1, aim: () => 0, dist: 60, straight: true },
  { id: 'stoj', dx: 0, dy: 0, aim: () => 0, dist: 60, still: true },
  { id: 'klicka', dx: 0, dy: 0, aim: t => 0.9 * Math.sin(t * Math.PI * 2 * 1.2), dist: 60, osc: true },
  { id: 'klicka_jizda', dx: 1, dy: 0, aim: t => 0.7 * Math.sin(t * Math.PI * 2 * 1.5), dist: 80, osc: true },
  { id: 'blizko', dx: 1, dy: 0, aim: () => 0.5, dist: 22 },
  { id: 'daleko', dx: 0, dy: -1, aim: () => -0.4, dist: 130 },
];

function run(sc) {
  const m = createMatch(7); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const H = new Player('h', 'home', makeInput());
  m.players.set('h', H); m.inputs.set('h', H.input); rebuildEntities(m);
  m.goalieL.x = -999; m.goalieR.x = -999;
  H.x = RINK.centerX - 120; H.y = sc.turn ? 50 : sc.dy > 0 ? 40 : sc.dy < 0 ? RINK.h - 40 : RINK.h / 2;
  H.aimAngle = H.carryAngle = H.bodyAngle = H.skateAngle = 0; H.input.aim = 0; H.input.aimDist = sc.dist;
  H.hasPuck = true; H._possT = 99; m.puck.ownerId = 'h'; H._isLocal = false;
  const F = [];
  for (let n = 0; n < 150; n++) {
    const t = n * DT;
    H.input.dx = sc.turn ? (n < 100 ? 1 : n < 120 ? 0 : -1) : sc.dx; H.input.dy = sc.turn ? (n >= 50 ? 1 : 0) : sc.dy;   // zatáčka: → ↘ ↓ ↙
    H.input.aim = n < 5 ? 0 : sc.aim(t, H); H.input.aimDist = sc.dist;
    stepMatch(m);
    H.draw(ctx, cam);
    if (!H.hasPuck) { F.push({ lost: true }); break; }
    const B = H._visBlade, V = H._visPuck, P = m.puck;
    F.push({ n, B: B && { ...B }, V: V && { x: V.x, y: V.y, kick: !!V._kick }, spin: P._spin ?? 0, side: H._visSide ?? 1, rel: ((H.carryAngle ?? 0) - (H.bodyAngle ?? 0)), hnd: H.handed ?? 1,
      x: H.x, y: H.y, ba: H.bodyAngle, dcv: H._dispCharge ?? 0, vx: H.vx, vy: H.vy });
  }
  return F;
}

// bezier: bod, tečna, nejbližší parametr (husté vzorkování + zjemnění)
const bz = (B, t) => ({ x: (1 - t) ** 2 * B.sx + 2 * (1 - t) * t * B.cx + t * t * B.ex, y: (1 - t) ** 2 * B.sy + 2 * (1 - t) * t * B.cy + t * t * B.ey });
const bzd = (B, t) => ({ x: 2 * (1 - t) * (B.cx - B.sx) + 2 * t * (B.ex - B.cx), y: 2 * (1 - t) * (B.cy - B.sy) + 2 * t * (B.ey - B.cy) });
function closest(B, q) {
  let bt = 0, bd = 1e9; for (let i = 0; i <= 200; i++) { const t = i / 200, p = bz(B, t), d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; bt = t; } }
  // uvnitř úsečky: znaménková vzdálenost (vlevo od tečny +)
  const p = bz(B, bt), d = bzd(B, bt), dl = Math.hypot(d.x, d.y) || 1, cr = (d.x * (q.y - p.y) - d.y * (q.x - p.x)) / dl;
  return { t: bt, d: bd, sgn: Math.sign(cr) };
}
function arcLen(B, t0, t1) { let L = 0, pr = bz(B, t0); const n = 40; for (let i = 1; i <= n; i++) { const p = bz(B, t0 + (t1 - t0) * i / n); L += Math.hypot(p.x - pr.x, p.y - pr.y); pr = p; } return L; }
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb || 1e-12); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function evaluate() {
  const hash = createHash('sha256'), res = {}, tot = { n1: 0, p1: 0, p2: 0, p3: 0, n: 0, p4: 0, n4: 0, p5: 0, n5: 0 }, worst = { p1: 0, p2: 0, p5: 0, p4: 1e9 };
  let p6ok = true; const p6info = [];
  for (const sc of SCN) {
    const F = run(sc), c = { n1: 0, p1: 0, p2: 0, p3: 0, n: 0, p4: 0, n4: 0, p5: 0, n5: 0 }, w = { p1: 0, p2: 0, p5: 0, p4: 1e9 };
    const om = [], ex = [];
    let prev = null;
    for (const f of F) {
      if (f.lost) { c.lost = true; break; }
      hash.update(JSON.stringify([f.B, f.V, +f.spin.toFixed(9)]));
      if (!f.B || !f.V || f.V.kick) { prev = null; continue; }
      const q = f.V, cl = closest(f.B, q), Lb = arcLen(f.B, 0, 1), along = (arcLen(f.B, 0, cl.t) - Lb / 2) * SC;
      const gap = (cl.d - f.B.hw - PUCK.radius) * SC;
      // P4: lokál těla
      const cb = Math.cos(f.ba), sb = Math.sin(f.ba), lx = ((q.x - f.x) * cb + (q.y - f.y) * sb) / R, ly = (-(q.x - f.x) * sb + (q.y - f.y) * cb) / R, pr = PUCK.radius / R;
      const dTr = Math.hypot(lx, ly) - 1.1 - pr;
      let dHe = 1e9; for (let i = 0; i < 64; i++) { const a = i / 32 * Math.PI, ux = lx + Math.cos(a) * pr, uy = ly + Math.sin(a) * pr; dHe = Math.min(dHe, ((ux - 0.72) / 0.616) ** 2 + (uy / 0.56) ** 2); }
      if (f.n >= 10) { c.n4++; if (dTr >= 0 && dHe >= 1) c.p4++; w.p4 = Math.min(w.p4, dTr * R * SC); }
      if (f.dcv < 0.2 && f.n >= 10) {
        c.n++;
        if (Math.abs(f.side) >= 0.95) { c.n1++; if (Math.abs(gap) <= 0.6) c.p1++; w.p1 = Math.max(w.p1, Math.abs(gap)); }
        if (Math.abs(along) <= 2.5) c.p2++; w.p2 = Math.max(w.p2, Math.abs(along));
        // P3: strana: + = vlevo od tečny pata→špička. Forhend (prohnutá strana) = −hnd (vlevo u praváka v souřadnicích canvasu → znaménko −1·hnd)
        const rel = Math.atan2(Math.sin(f.rel), Math.cos(f.rel)) * f.hnd, want = Math.abs(f.side) < 0.95 ? 0 : rel >= -0.05 ? -f.hnd : rel <= -0.25 ? f.hnd : 0;
        if (want === 0 || cl.sgn === want) c.p3++;
      }
      if (prev && f.n >= 10) {
        c.n5++; const m0 = bz(f.B, 0.5), m1 = bz(prev.B, 0.5), j = Math.hypot((q.x - m0.x) - (prev.q.x - m1.x), (q.y - m0.y) - (prev.q.y - m1.y)) * SC; w.p5 = Math.max(w.p5, j); if (j <= 2) c.p5++;
        // P6: rychlost otáčení puku vs. otáčení čepele + kutálení po čepeli
        const ang = B => Math.atan2(B.ey - B.sy, B.ex - B.sx);
        const tan = (B, t) => { const d = bzd(B, t); return Math.atan2(d.y, d.x); };
        const dA = wrap(tan(f.B, cl.t) - tan(prev.B, prev.t)), ds = (arcLen(f.B, 0, cl.t) - arcLen(prev.B, 0, prev.t)) * -(cl.sgn || 1);
        om.push(wrap(f.spin - prev.spin) / DT); ex.push((dA + ds / PUCK.radius) / DT);
      }
      prev = { q, x: f.x, y: f.y, B: f.B, t: cl.t, spin: f.spin };
    }
    let p6 = '';
    if (sc.osc) { const r = om.length > 5 ? corr(om, ex) : 0; let acc = 0, mn = 0, mx = 0; for (const o of om) { acc += o * DT; mn = Math.min(mn, acc); mx = Math.max(mx, acc); }
      const ok = Math.abs(r) >= 0.9 && mx - mn >= 1; p6ok &&= ok; p6 = `P6 korel ${r.toFixed(3)} rozsah ${(mx - mn).toFixed(2)} rad ${ok ? 'OK' : 'NE'}`; p6info.push(sc.id + ' ' + p6); }
    if (sc.straight || sc.still) { let acc = 0, mn = 0, mx = 0; for (const o of om.slice(20)) { acc += o * DT; mn = Math.min(mn, acc); mx = Math.max(mx, acc); }
      const ok = Math.abs(acc) <= 0.3 && mx - mn <= 0.3; p6ok &&= ok; p6 = `P6 posun ${acc.toFixed(3)} rad, kyv ${(mx - mn).toFixed(3)} rad ${ok ? 'OK' : 'NE'}`; p6info.push(sc.id + ' ' + p6); }
    res[sc.id] = { c, w, p6 };
    for (const k of ['n1', 'p1', 'p2', 'p3', 'n', 'p4', 'n4', 'p5', 'n5']) tot[k] += c[k];
    worst.p1 = Math.max(worst.p1, w.p1); worst.p2 = Math.max(worst.p2, w.p2); worst.p5 = Math.max(worst.p5, w.p5); worst.p4 = Math.min(worst.p4, w.p4);
  }
  return { res, tot, worst, p6ok, p6info, hash: hash.digest('hex').slice(0, 16) };
}

const A = evaluate(), B = evaluate();
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + ' %';
if (DETAIL) for (const [id, r] of Object.entries(A.res)) console.log(`${id.padEnd(13)} P1 ${pct(r.c.p1, r.c.n1)} (max ${r.w.p1.toFixed(2)} px)  P2 ${pct(r.c.p2, r.c.n)} (max ${r.w.p2.toFixed(2)} px)  P3 ${pct(r.c.p3, r.c.n)}  P4 ${pct(r.c.p4, r.c.n4)} (trup min ${r.w.p4.toFixed(2)} px)  P5 ${pct(r.c.p5, r.c.n5)} (max ${r.w.p5.toFixed(2)} px)${r.c.lost ? '  ZTRÁTA PUKU' : ''}  ${r.p6}`);
const T = A.tot, ok = {
  P1: T.p1 / T.n1 >= 0.95, P2: T.p2 / T.n >= 0.95, P3: T.p3 / T.n >= 0.95, P4: T.p4 === T.n4, P5: T.p5 === T.n5, P6: A.p6ok, P7: A.hash === B.hash,
};
console.log(`vzorků vedení ${T.n} (9 scénářů × 2,5 s, 60 Hz)`);
console.log(`P1 dotyk ±0,6 px      ${pct(T.p1, T.n1)} (práh 95 %, nejhorší ${A.worst.p1.toFixed(2)} px) ${ok.P1 ? 'OK' : 'NE'}`);
console.log(`P2 střed čepele ≤2,5 px ${pct(T.p2, T.n)} (práh 95 %, nejhorší ${A.worst.p2.toFixed(2)} px) ${ok.P2 ? 'OK' : 'NE'}`);
console.log(`P3 strana čepele      ${pct(T.p3, T.n)} (práh 95 %) ${ok.P3 ? 'OK' : 'NE'}`);
console.log(`P4 ne pod tělem       ${pct(T.p4, T.n4)} (práh 100 %, nejtěsněji ${A.worst.p4.toFixed(2)} px od trupu) ${ok.P4 ? 'OK' : 'NE'}`);
console.log(`P5 skok ≤ 2 px/snímek ${pct(T.p5, T.n5)} (práh 100 %, nejhorší ${A.worst.p5.toFixed(2)} px) ${ok.P5 ? 'OK' : 'NE'}`);
console.log(`P6 rotace z čepele    ${ok.P6 ? 'OK' : 'NE'}  [${A.p6info.join(' | ')}]`);
console.log(`P7 determinismus      ${A.hash} / ${B.hash} ${ok.P7 ? 'OK' : 'NE'}`);
const all = Object.values(ok).every(Boolean);
console.log(all ? 'PUK NA ČEPELI: OK' : 'PUK NA ČEPELI: NE'); process.exitCode = all ? 0 : 1;
