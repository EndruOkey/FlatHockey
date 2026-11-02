// Deterministické snímky + metriky obrazovek menu (pevné okno 1440×900, pevné čekání).
// node scripts/ux_shots.mjs [url] [outdir]  → PNG + metriky: počet viditelných textů <12px, kontrast <4.5:1, kliků do zápasu.
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://flathockey.fun/';
const out = process.argv[3] || 'ux';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const metrics = () => p.evaluate(() => {
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r,g,bb,a='1'] = m.map(Number); if (+a < 0.5) return null;
    const f = v => { v/=255; return v<=0.03928? v/12.92 : ((v+0.055)/1.055)**2.4; }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(bb); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && s.backgroundImage.includes('gradient')) return null; const l = lum(s.backgroundColor); if (l != null) return l; } return lum('rgb(13,15,20)'); };
  let small = 0, lowc = 0, n = 0; const smallEx = [], lowEx = [];
  for (const el of document.querySelectorAll('body *')) {
    const txt = [...el.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join('');
    if (!txt) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity === 0) continue;
    if (el.closest('[style*="display: none"]')) continue;
    const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;   // zakrytý jiným prvkem
    n++; const fs = parseFloat(s.fontSize); if (fs < 12) { small++; smallEx.push(txt.slice(0,20)); }
    const fg = lum(s.color), bg = bgOf(el);
    if (fg != null && bg != null) { const op = parseFloat(s.opacity); const cr = (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05); if (cr < 4.5) { lowc++; lowEx.push(txt.slice(0,20)); } }
  }
  return { texts: n, small, lowc, smallEx: smallEx.slice(0,6), lowEx: lowEx.slice(0,6) };
});
const shot = async n => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${n}.png` }); const m = await metrics(); console.log(n.padEnd(18), 'texty', m.texts, '| <12px', m.small, '| kontrast<4.5', m.lowc, '|', m.smallEx.join(' · '), '| low:', m.lowEx.join(' · ')); };
const click = async id => { const e = p.locator('#' + id); if (await e.isVisible()) await e.click(); else console.log('  skryto:', id); };
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await shot('01-splash-first');
await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await shot('01b-return');
await click('mn-tab-home'); await shot('02-main');
await click('go-online'); await shot('03-browse');
await click('mn-tab-home'); await click('vm-create-btn'); await shot('04-create');
await p.locator('.sv-teams-adv summary').click(); await shot('04b-create-teams');
await click('mn-tab-locker'); await shot('05-locker');
for (const k of ['helma','hul','doplnky']) { await p.click(`.lk-tab[data-lk=${k}]`); await shot('05-locker-' + k); }
await p.click('.lk-tab[data-lk=dres]');
await click('mn-tab-stats'); await shot('06-stats');
await click('mn-tab-home'); await click('vm-create-btn'); await click('create-go'); await p.waitForTimeout(800); await shot('08-wait');
await click('mn-tab-home'); await click('settings-btn'); await shot('07-settings'); await p.keyboard.press('Escape');
await click('mn-tab-home'); await click('go-play'); await p.waitForTimeout(3000); await shot('09-ingame');
await b.close();
