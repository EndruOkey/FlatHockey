// RUBRIKA VZHLEDU BRANKY (2026-11-12, kritéria stanovená předem) — počítá se z parametrů GOAL_STYLE v Rink.js, deterministicky.
// K1 geometrie = kolize · K2 obrys vs led ≥ 3:1 · K3 týmová barva viditelná (≥ 2 px v 1×, s obrysem) · K4 obrys jako hráči (0,8–1,3×)
// K5 síť bez šumu (rozteč ≥ 6 px v 1×, kontrast sítě < kontrast rámu) · K6 hloubka (jas ústí→záda ≥ 15 %) · K7 stín není blok (≤ 0,3 plochy)
// node scripts/goal_rubric.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-gr.db');
const { GOAL_STYLE } = await import('../public/js/entities/Rink.js');
const { RINK, PUCK } = await import('../public/js/constants.js');
const { SKIN_OUT, SKIN_ICE } = await import('../public/js/entities/skin.js');
const { HGT } = await import('../public/js/vis.js');
const SCALE_1X = 1.15;          // px na px hřiště v reálné velikosti (notebook 1366 px — nejhorší běžný případ, engine.computeCamera)
const PLAYER_EDGE = 1.0;        // viditelný okraj obrysu hráče (skinBody: obrys 2,0 pod výplní → 1,0 na stranu)
const lum = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const W = RINK.goalDepth, H = RINK.goalH, A = W * H, Hs = PUCK.crossbarHeight, dx = Hs * HGT.lx, dy = Hs * HGT.ly;
const rows = [];
for (const [g, st] of Object.entries(GOAL_STYLE)) {
  const K = {};
  K.K1 = { v: 0, ok: true, txt: 'rám = kolizní čáry (stejné x/xB/y1/y2)' };
  const c2 = contrast(SKIN_OUT, SKIN_ICE); K.K2 = { v: c2, ok: c2 >= 3, txt: `obrys/led ${c2.toFixed(1)}:1` };
  const barPx = st.bar * SCALE_1X; K.K3 = { v: barPx, ok: barPx >= 2, txt: `břevno ${barPx.toFixed(1)} px v 1×` };
  const edge = (st.out - st.pipe) / 2, r4 = edge / PLAYER_EDGE; K.K4 = { v: r4, ok: r4 >= 0.8 && r4 <= 1.3, txt: `okraj ${edge.toFixed(2)} = ${r4.toFixed(2)}× hráč` };
  const meshPx = st.mesh * SCALE_1X / (st.meshDiag ? Math.SQRT2 : 1);   // diagonální síť: kolmá vzdálenost čar = rozteč / √2
  const meshC = 1 + (contrast('#50648a', SKIN_ICE) - 1) * st.meshA, frameC = c2;
  K.K5 = { v: meshPx, ok: meshPx >= 6 && meshC < frameC, txt: `rozteč ${meshPx.toFixed(1)} px, kontrast sítě ${meshC.toFixed(1)} < rámu ${frameC.toFixed(1)}` };
  const d6 = (st.depth[0] - st.depth[1]) / st.depth[0]; K.K6 = { v: d6, ok: d6 >= 0.15, txt: `jas ústí→záda −${(d6 * 100).toFixed(0)} %` };
  // K7: plná plocha stínu mimo půdorys / plocha půdorysu
  let out7;
  if (st.shadow === 'fill') { const ov = Math.max(0, W - dx) * Math.max(0, H - dy); out7 = (2 * A - ov + dx * H + dy * W) / A - 1; }   // sjednocení posunutého obdélníku + spojovací pásy, mínus půdorys (ODHAD tvaru)
  else out7 = ((2 * W + 2 * H) * st.pipe) / A;   // jen tenké linky od trubek
  K.K7 = { v: out7, ok: out7 <= 0.3, txt: `stín ${(out7 * 100).toFixed(0)} % plochy branky` };
  rows.push({ g, K, pts: Object.values(K).filter(k => k.ok).length });
}
for (const r of rows) {
  console.log(`== G${r.g} · ${r.pts}/7`);
  for (const [k, v] of Object.entries(r.K)) console.log(`${v.ok ? 'ANO' : 'NE '}  ${k}  ${v.txt}`);
}
process.exit(0);
