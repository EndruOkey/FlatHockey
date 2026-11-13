// Vizuální varianty (2026-11-12). Pro všechny platí výchozí hodnoty; pokusy jen v dev playgroundu (/dev pod heslem, window.FH_DEV).
// g = branka (0 šikmý 3D náklon, 1 čistý půdorys, 2 nízký náklon, 3 top-down s hloubkou, 4 větší hloubka, 5 shora přesně podle kolize + hloubka stínem = výchozí, 6/7 hezčí obdélník, 8 skutečný tvar NHL, 9 skutečný tvar jen základna), s = hokejka (0, 1 štíhlá, 2 lopatka + odlesk + stín),
// k = bruslení (0 dřívější, 1 krok do stran, 2 velký odraz + skluz, 3 plynulý krok s odrazem ven a přenosem váhy = výchozí), h = hlava (0 v barvě dresu, 1 oddělená helma, 2 světlá helma jako dřív).
// Objekt se čte každý snímek → změna z dev panelu platí hned.
export const DEFAULT_VIS = { g: 5, s: 3, k: 3, h: 1, p: 1 };   // 2026-11-12 Ondřej: hlava oddělená (H1), hokejka dnešní štíhlejší (S3); bruslení K3 plynulý krok (scripts/skate_anim_metrics.mjs)   // p = kresba výšky puku (0 šikmo nahoru, 1 shora: zvětšení + stín = jako branka)
// JEDNO PRAVIDLO VÝŠKY (kamera kolmo shora): výška = zvětšení (ve výšce břevna × (1 + k)) + stín odsunutý od světla (vlevo nahoře).
// Branka G3 i puk ho sdílejí → puk ve výšce břevna je stejně velký a má stín stejně daleko jako břevno.
export const HGT = { k: 0.25, lx: 0.45, ly: 0.6 };                // k = zvětšení na břevnu; lx, ly = posun stínu na 1 px výšky
export const hScale = (z, bar) => 1 + HGT.k * Math.max(0, z) / bar;
export const VIS = { ...DEFAULT_VIS };
const VIS_VER = 3;   // zvyš při změně DEFAULT_VIS
export const DEV = !!globalThis.FH_DEV;
if (DEV) try {
  // VIS_VER: při změně výchozích hodnot se uložené volby z playgroundu zahodí (jinak by tam zůstala např. stará 3D branka G4)
  let saved = JSON.parse(localStorage.getItem('fh_vis') || '{}'); if (saved._v !== VIS_VER) { saved = {}; localStorage.removeItem('fh_vis'); }
  for (const k of Object.keys(DEFAULT_VIS)) if (Number.isInteger(saved[k])) VIS[k] = saved[k];
  const q = (globalThis.location?.search || '').match(/[?&]vis=([^&]*)/);
  if (q) for (const t of decodeURIComponent(q[1]).split(',')) { const m = t.match(/^([gskhp])(\d)$/); if (m) VIS[m[1]] = +m[2]; }
} catch {}
export function setVis(k, v) { VIS[k] = v; try { localStorage.setItem('fh_vis', JSON.stringify({ ...VIS, _v: VIS_VER })); } catch {} }
