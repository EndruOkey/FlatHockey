// Vizuální varianty (2026-11-12). Pro všechny platí výchozí hodnoty; pokusy jen v dev playgroundu (/dev pod heslem, window.FH_DEV).
// g = branka (0 šikmý 3D náklon, 1 čistý půdorys, 2 nízký náklon, 3 top-down s hloubkou = výchozí, 4 top-down s větší hloubkou), s = hokejka (0, 1 štíhlá, 2 lopatka + odlesk + stín),
// k = bruslení (0, 1 krok do stran, 2 velký odraz + skluz), h = hlava (0 v barvě dresu, 1 oddělená helma, 2 světlá helma jako dřív).
// Objekt se čte každý snímek → změna z dev panelu platí hned.
export const DEFAULT_VIS = { g: 3, s: 0, k: 0, h: 0 };
export const VIS = { ...DEFAULT_VIS };
export const DEV = !!globalThis.FH_DEV;
if (DEV) try {
  const saved = JSON.parse(localStorage.getItem('fh_vis') || '{}');
  for (const k of Object.keys(DEFAULT_VIS)) if (Number.isInteger(saved[k])) VIS[k] = saved[k];
  const q = (globalThis.location?.search || '').match(/[?&]vis=([^&]*)/);
  if (q) for (const t of decodeURIComponent(q[1]).split(',')) { const m = t.match(/^([gskh])(\d)$/); if (m) VIS[m[1]] = +m[2]; }
} catch {}
export function setVis(k, v) { VIS[k] = v; try { localStorage.setItem('fh_vis', JSON.stringify(VIS)); } catch {} }
