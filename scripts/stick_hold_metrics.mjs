// DRŽENÍ HOLE „jako hokejka, ne jako meč" — rubrika (2026-11-13, Ondřej: „drží ji jak meč a ne jak hokejku").
// Skutečnost shora (pravák; rešerše: icehockeysystems.com, hockeyshot.com, snipersedgehockey.com): horní ruka drží konec hole
// s mezerou před břichem (ne u hlavy, ne natažená), dolní ruka o délku rukavice až šířku ramen níž (~25–45 cm), paže dolní ruky
// víc natažená; dřík vede ŠIKMO přes přední stranu těla k čepeli na forhendu. Měřítko: ramena ±0,9 R ≈ ±23 cm → R ≈ 0,25 m.
// Vstup: scripts/data/stick_tips.json (simulační špička v lokálu těla, R); KRESBA kreslí špičku dříku = úchop + (sim − úchop)·stickDraw
// (Player.js draw: windLen = dosah·stickDraw) → převedeno stejně. Ruce = stickHands (totéž volá kresba).
// RUBRIKA (předem, klid/vedení dcv < 0,2):
//  H1 rozestup rukou po dříku ≥ 1,0 R (≈ délka rukavice 25 cm; spodní mez rešerše) ≥ 90 %
//  H2 horní ruka u těla: vpředu x ≤ 1,0 R (hrudník ~0,6 R + mezera pěst ~0,4 R) a na bekhendu y·hnd ≤ −0,3 R ≥ 90 %
//  H3 dolní paže natažená víc než horní: |dolní − forhendové rameno| ≥ |horní − bekhendové rameno| + 0,4 R ≥ 90 %
//  H4 dosah paží: horní ≤ 1,5 R, dolní ≤ 1,9 R od ramene (jako G3) ≥ 95 %
//  H5 dřík nevede pod helmou (elipsa skin.js) ≥ 95 %
//  H6 dřík přes přední stranu těla: od horní ruky ke špičce překříží osu těla (y = 0) vpředu, x ∈ ⟨0,5; 2,8⟩ R — u špiček
//     na forhendu vpředu (tx > 1,5, ty·hnd > 0) ≥ 90 %
// node scripts/stick_hold_metrics.mjs
import { readFileSync } from 'fs';
import { stickHands } from '../public/js/entities/Player.js';
import { PLAYER } from '../public/js/constants.js';
const S = JSON.parse(readFileSync(new URL('./data/stick_tips.json', import.meta.url)));
const R = PLAYER.radius, SD = PLAYER.stickDraw;
const eH = (x, y) => ((x - 0.72) / (0.55 * 1.12)) ** 2 + (y / (0.5 * 1.12)) ** 2;
function drawnTip(tx, ty, h) {   // úchop g = 0,2 R podél hole + 0,5 R na stranu ruky (Player.gripPoint)
  let d = Math.atan2(ty, tx), gx = 0, gy = 0;
  for (let i = 0; i < 8; i++) { gx = 0.2 * Math.cos(d) - 0.5 * h * Math.sin(d); gy = 0.2 * Math.sin(d) + 0.5 * h * Math.cos(d); d = Math.atan2(ty - gy, tx - gx); }
  return { x: gx + (tx - gx) * SD, y: gy + (ty - gy) * SD };
}
const c = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, n: 0, n6: 0 };
for (const [tx0, ty0, dcv, h] of S) {
  if (dcv >= 0.2) continue; c.n++;
  const t = drawnTip(tx0, ty0, h);
  const { topW: a, botW: b } = stickHands(0, 0, 0, dcv, h, { x: t.x * R, y: t.y * R }, 0);
  const A = { x: a.x / R, y: a.y / R }, B = { x: b.x / R, y: b.y / R };
  if (Math.hypot(B.x - A.x, B.y - A.y) >= 1.0) c.h1++;
  if (A.x <= 1.0 && A.y * h <= -0.3) c.h2++;
  const dt = Math.hypot(A.x - 0.25, A.y + 0.9 * h), db = Math.hypot(B.x - 0.25, B.y - 0.9 * h);
  if (db >= dt + 0.4) c.h3++;
  if (dt <= 1.5 && db <= 1.9) c.h4++;
  let m = 1e9; for (let i = 0; i <= 40; i++) { const k = i / 40; m = Math.min(m, eH(A.x + (t.x - A.x) * k, A.y + (t.y - A.y) * k)); }
  if (m >= 1) c.h5++;
  if (tx0 > 1.5 && ty0 * h > 0) { c.n6++;
    if (A.y * h < 0 && t.y * h > 0) { const k = A.y / (A.y - t.y), x = A.x + (t.x - A.x) * k; if (x >= 0.5 && x <= 2.8) c.h6++; } }
}
const r = { H1: c.h1 / c.n, H2: c.h2 / c.n, H3: c.h3 / c.n, H4: c.h4 / c.n, H5: c.h5 / c.n, H6: c.h6 / Math.max(1, c.n6) };
const lim = { H1: 0.9, H2: 0.9, H3: 0.9, H4: 0.95, H5: 0.95, H6: 0.9 };
console.log(`vzorků ${c.n} (dcv < 0,2), z toho špička vpředu na forhendu ${c.n6}`);
for (const k in r) console.log(`${k} ${(r[k] * 100).toFixed(1)} % (práh ${lim[k] * 100} %) ${r[k] >= lim[k] ? 'OK' : 'NE'}`);
const ok = Object.keys(r).every(k => r[k] >= lim[k]);
console.log(ok ? 'DRŽENÍ: OK' : 'DRŽENÍ: NE'); process.exitCode = ok ? 0 : 1;
