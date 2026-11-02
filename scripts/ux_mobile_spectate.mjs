// Mobil + divák: PC spustí zápas, mobil (dotyk 390×844) nesmí hrát, ale najde živý zápas a sleduje ho.
// node scripts/ux_mobile_spectate.mjs [url] [outdir]
import { chromium, devices } from 'playwright';
const url = process.argv[2] || 'http://localhost:4901/';
const out = process.argv[3] || '.';
const b = await chromium.launch(); const errs = []; const res = {};
const pc = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
pc.on('pageerror', e => errs.push('pc: ' + e.message));
await pc.goto(url, { waitUntil: 'networkidle' }); await pc.waitForTimeout(500);
await pc.click('#go-play'); await pc.waitForTimeout(2500);
res.pcHraje = await pc.evaluate(() => document.getElementById('lobby').style.display === 'none');

const mctx = await b.newContext({ ...devices['iPhone 13'] }); const m = await mctx.newPage();
m.on('pageerror', e => errs.push('mobil: ' + e.message));
await m.goto(url, { waitUntil: 'networkidle' }); await m.waitForTimeout(600);
await m.screenshot({ path: `${out}/mob-1-menu.png` });
await m.tap('#go-play', { force: true }); await m.waitForTimeout(800);
res.mobilHratNejde = await m.evaluate(() => document.getElementById('lobby').style.display !== 'none' && document.getElementById('toast').classList.contains('show'));
await m.tap('#go-online'); await m.waitForTimeout(1200);
await m.screenshot({ path: `${out}/mob-2-browse.png` });
res.zivychZapasu = await m.locator('.li-watch').count();
if (res.zivychZapasu) {
  await m.locator('.li-watch').first().tap(); await m.waitForTimeout(2500);
  res.sleduje = await m.evaluate(() => document.getElementById('lobby').style.display === 'none' && !document.getElementById('spec-bar').hidden);
  await m.screenshot({ path: `${out}/mob-3-spectate.png` });
  res.pcPorádHraje = await pc.evaluate(() => document.getElementById('lobby').style.display === 'none');
  await m.tap('#spec-leave'); await m.waitForTimeout(800);
  res.odchodZpetNaSeznam = await m.evaluate(() => document.getElementById('v-browse').style.display !== 'none');
}
for (const [btn, name] of [['#go-profile', 'mob-4-satna'], ['#go-stats', 'mob-5-stats'], ['#go-store', 'mob-6-store']]) {
  await m.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await m.keyboard.press('Escape'); await m.waitForTimeout(300);
  await m.tap(btn).catch(() => {}); await m.waitForTimeout(600); await m.screenshot({ path: `${out}/${name}.png` });
}
console.log(res, '| chyby JS:', errs.length ? errs : 0);
await b.close();
