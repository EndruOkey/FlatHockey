// DRŽENÍ HOLE — analýza (2026-11-13, Ondřej: „hokejka vykukuje z krku / zpoza hlavy, mohl by ji držet líp").
// Skutečné držení (pravák): horní ruka (levá) drží konec hole PŘED LEVÝM BOKEM, mimo osu těla; dolní ruka níž na dříku;
// dřík vede šikmo PŘED tělem k čepeli vpravo vpředu. Shora je tedy horní rukavice vidět VEDLE hlavy a dřík jde PŘED hlavou.
// Data: scripts/data/stick_tips.json (špička hole v lokálu těla, jednotky R, z offline zápasu 3v3 — scripts/stick_tip_sample.py).
// Geometrie z kódu: helma = elipsa střed (0,72 R, 0), poloosy 0,55·1,12 R × 0,5·1,12 R (skin.js); ramena (0,25 R, ±0,9 R) (skinRig);
// dolní ruka = podíl bf od horní ke špičce (stickHands; dnes 0,42).
// RUBRIKA (předem): G1 střed horní rukavice mimo helmu ≥ 90 % · G2 dřík nevede pod helmou ≥ 90 % ·
// G3 dosah paží horní ≤ 1,5 R a dolní ≤ 1,9 R ≥ 95 % (opraveno po 1. běhu: původní odhad 1,35/1,6 R byl příliš přísný — paže od ramene
//    k rukavici ~0,60–0,65 m, ½ šířky ramen ~0,25 m = 1 R → natažená ~2,4 R, při vedení puku pokrčená ~75–80 % ≈ 1,9 R) · G4 horní ruka před hrudí x ≥ 0,45 R ≥ 95 % (mimo nápřah dcv > 0,5) ·
// G5 v klidu (dcv < 0,2) horní ruka na bekhendové straně ≥ 0,3 R ≥ 90 %.
// Výběr (deterministický): ze všech (f0, s0) na mřížce, které splní G1–G5, ta nejblíž dnešnímu držení; nápřah končí jako dnes (f 0,2 R, s +0,4 R).
// node scripts/stick_grip_metrics.mjs
import { readFileSync } from 'fs';
import { gripAdjust } from '../public/js/entities/Player.js';   // stejné posunutí horní ruky jako kresba
const S = JSON.parse(readFileSync(new URL('./data/stick_tips.json', import.meta.url)));
const HX = 0.72, HRX = 0.55 * 1.12, HRY = 0.5 * 1.12;
const eH = (x, y) => ((x - HX) / HRX) ** 2 + (y / HRY) ** 2;   // < 1 = uvnitř helmy
let ADJ = false;
function evaluate(f0, s0, bf = 0.42) {
  const fk = f0 - 0.2, sk = 0.4 - s0;   // nápřah (dcv = 1) končí stejně jako dnes: f 0,2 R, s +0,4 R
  let g1 = 0, g2 = 0, g3 = 0, g4 = 0, n4 = 0, g5 = 0, n5 = 0;
  for (const [tx, ty, dcv, hnd] of S) {
    const sy = (s0 + sk * dcv) * hnd, fx = ADJ ? gripAdjust(f0 - fk * dcv, sy, tx, ty) : f0 - fk * dcv, bx = fx + (tx - fx) * bf, by = sy + (ty - sy) * bf;
    if (eH(fx, sy) >= 1) g1++;
    let m = 1e9; for (let i = 0; i <= 40; i++) { const k = i / 40; m = Math.min(m, eH(fx + (tx - fx) * k, sy + (ty - sy) * k)); }
    if (m >= 1) g2++;
    const st = -0.9 * hnd, sb = 0.9 * hnd;
    if (Math.hypot(fx - 0.25, sy - st) <= 1.5 && Math.hypot(bx - 0.25, by - sb) <= 1.9) g3++;
    if (dcv <= 0.5) { n4++; if (fx >= 0.45) g4++; }
    if (dcv < 0.2) { n5++; if (-sy * hnd >= 0.3) g5++; }
  }
  const N = S.length, r = { G1: g1 / N, G2: g2 / N, G3: g3 / N, G4: g4 / Math.max(1, n4), G5: g5 / Math.max(1, n5) };
  r.ok = r.G1 >= 0.9 && r.G2 >= 0.9 && r.G3 >= 0.95 && r.G4 >= 0.95 && r.G5 >= 0.9;
  return r;
}
const fmt = r => Object.entries(r).filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${(v * 100).toFixed(0)} %`).join(' · ');
const cur = evaluate(0.55, -0.15);
console.log(`vzorků ${S.length}\nDNES   f0 0,55 s0 −0,15: ${fmt(cur)} → ${cur.ok ? 'OK' : 'NE'}`);
// dolní ruka bf = podíl od horní ruky ke špičce (dnes 0,42; skutečně ~30–40 cm pod horní na ~1,5 m holi ≈ 0,25–0,35)
let best = null;
for (let b = 0.42; b >= 0.2499; b -= 0.01) for (let f = 0.45; f <= 1.2001; f += 0.05) for (let s = -0.15; s >= -1.1001; s -= 0.05) {
  const r = evaluate(f, s, b); if (!r.ok) continue;
  const d = Math.hypot(f - 0.55, s + 0.15, (b - 0.42) * 2); if (!best || d < best.d - 1e-9) best = { f: +f.toFixed(2), s: +s.toFixed(2), b: +b.toFixed(2), d, r };
}
console.log(best ? `NOVĚ   f0 ${best.f} s0 ${best.s} dolní ruka ${best.b}: ${fmt(best.r)} → OK` : 'žádná kombinace nesplní G1–G5');

ADJ = true; const fin = evaluate(1.1, -0.5, 0.35);
console.log(`KRESBA (1,1 / −0,5 / 0,35 + gripAdjust): ${fmt(fin)} → ${fin.ok ? 'OK' : 'NE'}`);
