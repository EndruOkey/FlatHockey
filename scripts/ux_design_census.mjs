// Sčítání designu (deterministicky): různá písma, barvy textu, barvy pozadí/rámečků, styly písma, poloměry rohů na obrazovkách menu.
// node scripts/ux_design_census.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://flathockey.fun/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: 'networkidle' }); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload({ waitUntil: 'networkidle' });
const census = () => p.evaluate(() => {
  const F = new Set(), C = new Set(), B = new Set(), T = new Set(), S = new Set(), LS = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.top > innerHeight) continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText) { F.add(s.fontFamily.split(',')[0].replace(/"/g, '')); C.add(s.color); T.add(`${s.fontFamily.split(',')[0]}|${s.fontWeight}|${s.fontStyle}|${s.textTransform}`); S.add(Math.round(parseFloat(s.fontSize))); LS.add(s.letterSpacing); }
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') B.add(s.backgroundColor);
    if (s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none') B.add(s.borderTopColor);
  }
  return { pisma: [...F], barvyTextu: C.size, barvyPlochARamecku: B.size, typoStylu: T.size, velikosti: [...S].sort((a, b) => a - b), prolozeni: LS.size };
});
for (const [n, sel] of [['menu', '#mn-tab-home'], ['satna', '#mn-tab-locker'], ['statistiky', '#mn-tab-stats']]) {
  await p.click(sel); await p.waitForTimeout(500); console.log(n, JSON.stringify(await census()));
}
await b.close();
