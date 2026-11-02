// Ověří cestu nového hráče: čistý profil → 1 klik HRÁT → běží zápas (lobby skryté). node scripts/ux_playnow.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4900/';
const b = await chromium.launch(); const errs = [];
for (const [label, sel, pre] of [['splash (1. návštěva)', '#splash-play-btn', null], ['menu (vracející se)', '#go-play', '1']]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ': ' + e.message));
  await p.goto(url, { waitUntil: 'networkidle' });
  if (pre) { await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload({ waitUntil: 'networkidle' }); }
  await p.waitForTimeout(600);
  await p.click(sel); await p.waitForTimeout(2500);
  const st = await p.evaluate(() => ({ lobbyHidden: getComputedStyle(document.getElementById('lobby')).display === 'none', name: localStorage.getItem('hockey_name') || document.getElementById('name-input')?.value }));
  console.log(label.padEnd(22), 'kliků: 1 | zápas běží:', st.lobbyHidden, '| jméno:', st.name);
  await ctx.close();
}
console.log('chyby JS:', errs.length ? errs : 0);
await b.close();
