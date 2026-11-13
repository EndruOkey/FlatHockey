// ANIMACE BRUSLENÍ — deterministické měření (bez canvasu). Polohy bruslí i těla počítá TÁŽ čistá funkce jako draw():
// skateAdvance + skateStopBlend + skatePose z public/js/entities/Player.js. Simulace se nepouští — kinematika je předepsaná (60 fps).
// node scripts/skate_anim_metrics.mjs [--k=0,3] [--json]
//
// RUBRIKA (stanovena PŘEDEM, 2026-11-12; 1× = trénink 1366×768 dpr 1 → cam.scale 1,198 px na svět. jednotku, změřeno Playwrightem):
//  R1 Čitelnost kroku: v jízdě vpřed 165 px/s brusle vyjede ≥ 4 px (1×) mimo siluetu těla (trup+ramena+kalhoty+helma, s obrysem) v ≥ 40 % snímků.
//  R2 Čitelnost do strany: totéž při jízdě bokem 165 px/s (≥ 4 px v ≥ 40 % snímků).
//  R3 Kadence: krok = celý cyklus (odraz levou + pravou). Roste s rychlostí (60 < 110 < 165 px/s) a při 165 px/s je 1,2–2,5 kroku/s.
//  R4 Plynulost: žádný skok bruslí (špička/pata, lokál těla) > 3 px (1×) mezi snímky — ve všech situacích vč. rozjezdu z klidu,
//     otočky z couvání do jízdy vpřed a stopu.
//  R5 Symetrie L/P: v jízdě vpřed se průměrné vyjetí levé a pravé brusle liší ≤ 15 % a nohy jsou posunuté o půl cyklu (±0,05).
//  R6 Bez smyku: během odrazu (noha na ledě a jede ven) je boční rychlost brusle vůči ledu (kolmo na ostří) v mediánu ≤ 15 % rychlosti těla (vpřed 165).
//  R7 Couvání má C-cuty: každá noha za cyklus vyjede do boku ≥ 0,8 R a ostří projde špičkou dovnitř i ven (obě znaménka ≥ 0,15 rad).
//  R8 Stop čitelný: při plném stopu obě brusle napříč k jízdě (90° ± 20°) a aspoň jedna vyjede ≥ 3 px mimo siluetu.
//  R9 Přenos váhy: tělo se v jízdě vpřed posouvá napříč ≥ 0,6 px (1×, špička–špička) v rytmu kroku (|korelace s fází nohy| ≥ 0,7).
//  R10 Deterministické: dva běhy = stejný hash všech póz.
import { createHash } from 'crypto';
const { PLAYER } = await import('../public/js/constants.js');
const { skateAdvance, skateStopBlend, skatePose, skateCycle, skateFeetSmooth } = await import('../public/js/entities/Player.js');
const { angleDiff } = await import('../public/js/utils.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const KS = String(ARG.k ?? '0,3').split(',').map(Number);
const R = PLAYER.radius, SC = 1.198, DT = 1 / 60;

// ── silueta těla (skin.js skinBody, bez paží/rukavic, které jsou vpředu u hole) jako maska na mřížce 0,2 j.
const G = 0.2, N = 220, O = N / 2;   // mřížka ±22 j.
const inEll = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const torsoPoly = (() => { const r = R * 1.04, pts = [], q = (a, c, b) => { for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  let p0 = [r * 0.35, -r * 1.2]; const seg = [[[r * 0.75, -r * 0.6], [r * 0.55, 0]], [[r * 0.75, r * 0.6], [r * 0.35, r * 1.2]], [[-r * 0.15, r * 1.42], [-r * 0.75, r * 0.85]], [[-r * 1.05, 0], [-r * 0.75, -r * 0.85]], [[-r * 0.15, -r * 1.42], [r * 0.35, -r * 1.2]]];
  pts.push(p0); for (const [c, b] of seg) { q(p0, c, b); p0 = b; } return pts; })();
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function bodyMask(tw) {   // tw = natočení ramen
  const m = new Uint8Array(N * N), S = [[R * 0.25, -R * 0.9], [R * 0.25, R * 0.9]].map(([x, y]) => [x * Math.cos(tw) - y * Math.sin(tw), x * Math.sin(tw) + y * Math.cos(tw)]);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const x = (i - O) * G, y = (j - O) * G;
    m[i * N + j] = inPoly(x, y, torsoPoly) || S.some(s => inEll(x, y, s[0] - R * 0.12, s[1] * 0.98, R * 0.48, R * 0.42)) || inEll(x, y, -R * 0.62, -R * 0.62, R * 0.5, R * 0.46)
      || inEll(x, y, -R * 0.62, R * 0.62, R * 0.5, R * 0.46) || inEll(x, y, R * 0.72, 0, R * 0.55 * 1.12, R * 0.5 * 1.12) ? 1 : 0; }
  const edge = []; for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) if (m[i * N + j] && (!m[(i + 1) * N + j] || !m[(i - 1) * N + j] || !m[i * N + j + 1] || !m[i * N + j - 1])) edge.push([(i - O) * G, (j - O) * G]);
  return { m, edge };
}
const _masks = new Map();
const maskFor = tw => { const key = Math.round(tw * 50); let v = _masks.get(key); if (!v) { v = bodyMask(key / 50); _masks.set(key, v); } return v; };
const OUTL = 1.0;   // obrys těla 2,0 → 1 j. ven
function outside(x, y, M) {   // vzdálenost bodu vně siluety (0 uvnitř), svět. jednotky
  const i = Math.round(x / G) + O, j = Math.round(y / G) + O;
  if (i >= 0 && i < N && j >= 0 && j < N && M.m[i * N + j]) return 0;
  let d = 1e9; for (const [ex, ey] of M.edge) { const q = (x - ex) ** 2 + (y - ey) ** 2; if (q < d) d = q; } return Math.max(0, Math.sqrt(d) - OUTL);
}
// body brusle (rámec brusle: +x špička), skin.js skinSkate: roundRect −0,62R..0,52R × ±0,24R + obrys 0,8
const SK = []; for (let a = -0.62; a <= 0.521; a += 0.0285) for (const b of [-0.24, 0, 0.24]) SK.push([a * R, b * R + Math.sign(b) * 0.8]);
SK.push([-0.62 * R - 0.8, 0], [0.52 * R + 0.8, 0]);
const skatePts = (f) => { const c = Math.cos(f.a), s = Math.sin(f.a), k = 1 + 0.08 * (f.lift || 0); return SK.map(([a, b]) => [f.x + (a * c - b * s) * k, f.y + (a * s + b * c) * k]); };
const tipHeel = f => { const c = Math.cos(f.a), s = Math.sin(f.a); return [[f.x + c * 0.52 * R, f.y + s * 0.52 * R], [f.x - c * 0.62 * R, f.y - s * 0.62 * R]]; };

// ── scénáře: předepsaná kinematika (x, y, vx, vy, úhel těla, náklon, stop)
function scenario(id, k) {
  const p = { x: 0, y: 0, vx: 0, vy: 0, bodyAngle: 0, _lean: 0 }, F = [];
  const T = id.T || 4;
  for (let n = 0; n < T * 60; n++) {
    const t = n * DT; id.step(p, t);
    p.x += p.vx * DT; p.y += p.vy * DT;
    // == draw(): stop + póza (stejné pořadí jako _renderPlayer)
    const spd = Math.hypot(p.vx, p.vy), ba = p.bodyAngle;
    if (spd > 30) p._hsDir = Math.atan2(p.vy, p.vx);
    if ((p._stopFx ?? 0) > 0) p._stopFx -= DT;
    p._stopTSmooth = skateStopBlend(p._stopTSmooth ?? 0, (p._stopFx ?? 0) > 0, DT); p._stopK3 = skateStopBlend(p._stopK3 ?? 0, (p._stopFx ?? 0) > 0, DT, 5, 4); if (!p._stopTSmooth && !p._stopK3) p._hsDir = null;
    const stopT = (k === 3 ? p._stopK3 : p._stopTSmooth) ?? 0;
    const mLoc = spd > 8 ? angleDiff(Math.atan2(p.vy, p.vx), ba) : 0;
    skateAdvance(p, p.x, p.y, ba, spd, k, mLoc, DT);
    const pose = skatePose({ k, phase: p._skatePhase ?? 0, spd, mLoc: k === 3 ? p._mLocS : mLoc, stopT, stopLoc: p._hsDir != null ? angleDiff(p._hsDir, ba) : 0, rotSf: p._rotSf ?? 0, lean: p._lean });
    if (k === 3) skateFeetSmooth(p, pose.feet, DT);
    F.push({ t, x: p.x, y: p.y, ba, spd, mLoc, lean: p._lean, stopT, phase: p._skatePhase ?? 0, pose });
  }
  return F;
}
const steady = (v, ba, extra) => ({ step: (p, t) => { p.vx = v; p.vy = 0; p.bodyAngle = ba; if (extra) extra(p, t); } });
const SCN = {
  vpred60: steady(60, 0), vpred110: steady(110, 0), vpred165: steady(165, 0),
  bokem80: steady(80, -Math.PI / 2), bokem165: steady(165, -Math.PI / 2),
  couvani60: steady(60, Math.PI), couvani124: steady(124, Math.PI),
  zatacka150: { step: (p, t) => { const w = 150 / 110, a = t * w; p.vx = 150 * Math.cos(a); p.vy = 150 * Math.sin(a); p.bodyAngle = a; p._lean = 0.6; } },
  rozjezd: { T: 2.5, step: (p, t) => { const v = Math.min(165, Math.max(0, (t - 0.3) * 140)); p.vx = v; p.vy = 0; p.bodyAngle = 0; } },
  otocka: { step: (p, t) => { p.vx = 120; p.vy = 0; p.bodyAngle = Math.PI - Math.min(Math.PI, Math.max(0, (t - 1) * 3.8)); } },
  stop: { T: 3, step: (p, t) => { const v = t < 1.2 ? 165 : Math.max(0, 165 - (t - 1.2) * 300); if (t >= 1.2 && !p._stopped) { p._stopped = 1; p._stopFx = 0.9; } p.vx = v; p.vy = 0; p.bodyAngle = 0; } },
};

function analyze(k) {
  const res = {}, hash = createHash('sha256');
  for (const [id, sc] of Object.entries(SCN)) {
    const F = scenario(sc, k), from = id === 'rozjezd' || id === 'otocka' || id === 'stop' ? 0 : 60;   // ustálené: bez první sekundy
    let jump = 0, expHit = 0, expN = 0; const expSide = { '-1': [], 1: [] }, slip = [], bodyY = [], footY = [], cc = { '-1': { ymin: 1e9, ymax: -1e9, amin: 0, amax: 0 }, 1: { ymin: 1e9, ymax: -1e9, amin: 0, amax: 0 } };
    let stopOk = 0, stopN = 0;
    for (let n = from; n < F.length; n++) {
      const f = F[n], P = f.pose, M = maskFor(P.body.tw);
      for (const ft of P.feet) hash.update(ft.x.toFixed(4) + ft.y.toFixed(4) + ft.a.toFixed(4));
      // vyjetí mimo siluetu (rel. k posunutému tělu)
      let best = 0;
      for (const ft of P.feet) { let e = 0; for (const [x, y] of skatePts(ft)) e = Math.max(e, outside(x - P.body.x, y - P.body.y, M)); expSide[ft.side].push(e * SC); best = Math.max(best, e * SC); }
      expN++; if (best >= 4) expHit++;
      if (f.stopT >= 0.9) { stopN++; const mot = f.pose && (F[n].mLoc || angleDiff(Math.atan2(0, 1), f.ba));
        const okA = P.feet.every(ft => Math.abs(Math.abs(angleDiff(ft.a, mot)) - Math.PI / 2) <= 20 * Math.PI / 180);
        if (okA && best >= 3) stopOk++; }
      if (n > from) { const Q = F[n - 1].pose;
        for (let i = 0; i < 2; i++) { const a = tipHeel(P.feet[i]), b = tipHeel(Q.feet[i]); for (let j = 0; j < 2; j++) jump = Math.max(jump, Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]) * SC); }
        // smyk: rychlost brusle vůči ledu (svět) kolmo na ostří, během odrazu (na ledě, noha jede ven)
        const g = F[n - 1];
        for (let i = 0; i < 2; i++) { const ft = P.feet[i], fq = Q.feet[i];
          const W = (fr, fo) => { const c = Math.cos(fr.ba), s = Math.sin(fr.ba), ly = fo.y + (fr.lean ?? 0) * R * 0.15; return [fr.x + fo.x * c - ly * s, fr.y + fo.x * s + ly * c]; };
          const w1 = W(f, ft), w0 = W(g, fq), vx = (w1[0] - w0[0]) / DT, vy = (w1[1] - w0[1]) / DT, A = f.ba + ft.a;
          const out = ft.side * (ft.y - fq.y) > 0.001 && !(ft.lift > 0.05);
          if (out && f.spd > 20) slip.push(Math.abs(-Math.sin(A) * vx + Math.cos(A) * vy) / f.spd); }
      }
      bodyY.push(P.body.y); footY.push(Math.sin(f.phase));   // R9: korelace s fází kroku
      for (const ft of P.feet) { const c = cc[ft.side], yy = ft.side * ft.y, aa = ft.side * angleDiff(ft.a, 0); c.ymin = Math.min(c.ymin, yy); c.ymax = Math.max(c.ymax, yy); c.amin = Math.min(c.amin, aa); c.amax = Math.max(c.amax, aa); }
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1), med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
    const corr = (a, b) => { const ma = mean(a), mb = mean(b); let sab = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa && sb ? sab / Math.sqrt(sa * sb) : 0; };
    const cyc = (F.at(-1).spd ? F.at(-1).spd / skateCycle(k, F.at(-1).spd) : 0);
    const mL = mean(expSide[-1]), mR = mean(expSide[1]);
    // fázový posun nohou: najdi zpoždění (snímky), kdy y levé = −y pravé nejlépe sedí, v podílu cyklu
    const per = cyc ? 60 / cyc : 0; let lagBest = 0, lagErr = 1e9;
    if (per) { const yl = F.slice(from).map(f => -f.pose.feet[0].y), yr = F.slice(from).map(f => f.pose.feet[1].y);
      for (let L = 0; L < Math.round(per); L++) { let e = 0; for (let i = 0; i + L < yr.length; i++) e += (yl[i + L] - yr[i]) ** 2; if (e < lagErr) { lagErr = e; lagBest = L; } } }
    res[id] = { exp4: expHit / expN, expMax: Math.max(...expSide[-1], ...expSide[1]), expL: mL, expR: mR, sym: Math.abs(mL - mR) / Math.max(mL, mR, 1e-9),
      lag: per ? lagBest / per : 0, cadence: cyc, jump, slipMed: med(slip), slipN: slip.length,
      bodyPP: (Math.max(...bodyY) - Math.min(...bodyY)) * SC, bodyCorr: corr(bodyY, footY),
      ccY: Math.min(cc[-1].ymax - cc[-1].ymin, cc[1].ymax - cc[1].ymin) / R, ccA: Math.min(-cc[-1].amin, -cc[1].amin, cc[-1].amax, cc[1].amax),
      stop: stopN ? stopOk / stopN : null };
  }
  return { res, hash: hash.digest('hex').slice(0, 16) };
}

const f2 = v => v == null ? '–' : (+v).toFixed(2);
const out = {};
for (const k of KS) {
  const A = analyze(k), B = analyze(k), r = A.res;
  const rub = [
    ['R1 vpřed ≥4 px v ≥40 %', r.vpred165.exp4 >= 0.4, `${(r.vpred165.exp4 * 100).toFixed(0)} % (max ${f2(r.vpred165.expMax)} px)`],
    ['R2 bokem ≥4 px v ≥40 %', r.bokem165.exp4 >= 0.4, `${(r.bokem165.exp4 * 100).toFixed(0)} % (max ${f2(r.bokem165.expMax)} px)`],
    ['R3 kadence roste, 165: 1,2–2,5/s', r.vpred60.cadence < r.vpred110.cadence && r.vpred110.cadence < r.vpred165.cadence && r.vpred165.cadence >= 1.2 && r.vpred165.cadence <= 2.5,
      `${f2(r.vpred60.cadence)} / ${f2(r.vpred110.cadence)} / ${f2(r.vpred165.cadence)} kroku/s`],
    ['R4 skok ≤3 px/snímek', Object.values(r).every(x => x.jump <= 3), `max ${f2(Math.max(...Object.values(r).map(x => x.jump)))} px (${Object.entries(r).sort((a, b) => b[1].jump - a[1].jump)[0][0]})`],
    ['R5 symetrie ≤15 %, posun 0,5±0,05', r.vpred165.sym <= 0.15 && Math.abs(r.vpred165.lag - 0.5) <= 0.05, `rozdíl ${(r.vpred165.sym * 100).toFixed(0)} %, posun ${f2(r.vpred165.lag)}`],
    ['R6 smyk při odrazu ≤15 %', r.vpred165.slipMed <= 0.15, `medián ${(r.vpred165.slipMed * 100).toFixed(0)} % rychlosti (n=${r.vpred165.slipN})`],
    ['R7 couvání C-cut', r.couvani124.ccY >= 0.8 && r.couvani124.ccA >= 0.15, `do boku ${f2(r.couvani124.ccY)} R, ostří ±${f2(r.couvani124.ccA)} rad`],
    ['R8 stop napříč + ≥3 px', (r.stop.stop ?? 0) >= 0.9, `${((r.stop.stop ?? 0) * 100).toFixed(0)} % snímků plného stopu`],
    ['R9 přenos váhy ≥0,6 px, |r|≥0,7', r.vpred165.bodyPP >= 0.6 && Math.abs(r.vpred165.bodyCorr) >= 0.7, `${f2(r.vpred165.bodyPP)} px, r = ${f2(r.vpred165.bodyCorr)}`],
    ['R10 deterministické', A.hash === B.hash, A.hash],
  ];
  out[k] = { rub: rub.map(([n, ok, v]) => ({ n, ok, v })), res: r };
  console.log(`\n== K${k} ${k === 3 ? '(nové)' : k === 0 ? '(dřívější výchozí)' : ''} — ${rub.filter(x => x[1]).length}/${rub.length}`);
  for (const [n, ok, v] of rub) console.log(`  ${ok ? 'OK  ' : 'NE  '} ${n.padEnd(36)} ${v}`);
  if (ARG.detail) for (const [id, x] of Object.entries(r)) console.log(`   ${id.padEnd(11)} exp4 ${(x.exp4 * 100).toFixed(0).padStart(3)}%  max ${f2(x.expMax)}  skok ${f2(x.jump)}  smyk ${(x.slipMed * 100).toFixed(0)}%  tělo ${f2(x.bodyPP)}px r${f2(x.bodyCorr)}  kad ${f2(x.cadence)}`);
}
if (ARG.json) console.log(JSON.stringify(out));
