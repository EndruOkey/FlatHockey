// Vizuální varianty k porovnání (2026-11-12): ?vis=g1,s1,k1 v adrese (jen kresba, simulace beze změny).
// g = branka (g0 dnešní, g1 čistý půdorys, g2 nízký náklon), s = hokejka (s0, s1 štíhlá, s2 štíhlá + odlesk a stín),
// k = bruslení (k0, k1 krok do stran, k2 krok do stran + dlouhý skluz). Vybraná varianta se pak stane výchozí.
export const VIS = { g: 0, s: 0, k: 0 };
try {
  const q = (globalThis.location?.search || '').match(/[?&]vis=([^&]*)/);
  if (q) for (const t of decodeURIComponent(q[1]).split(',')) { const m = t.match(/^([gsk])(\d)$/); if (m) VIS[m[1]] = +m[2]; }
} catch {}
