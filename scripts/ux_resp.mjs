// Responzivita: jedna obrazovka na více velikostech okna + kontrola vodorovného přetečení. node scripts/ux_resp.mjs <url> <outdir> [obrazovka=main|profile|create|browse|stats]
import { chromium } from 'playwright';
const [url = 'http://localhost:4900/', out = 'ux', view = 'main'] = process.argv.slice(2);
const SIZES = [[1920,1080],[1440,900],[1280,720],[1024,768],[820,1180]];
const b = await chromium.launch();
for (const [w,h] of SIZES) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url, { waitUntil: 'networkidle' }); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done','1')); await p.reload({ waitUntil: 'networkidle' });
  const go = { profile: 'go-profile', create: 'vm-create-btn', browse: 'go-online', stats: 'go-stats' }[view];
  if (go) { await p.click('#' + go).catch(() => {}); }
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => ({ hscroll: document.documentElement.scrollWidth > innerWidth, overflowEls: [...document.querySelectorAll('#lobby *')].filter(e => { const r = e.getBoundingClientRect(); return !e.closest('.scene3') && r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).length }));
  await p.screenshot({ path: `${out}/${view}-${w}x${h}.png` });
  console.log(`${view} ${w}x${h}`.padEnd(20), 'přetéká vpravo:', m.overflowEls, '| chyby JS:', errs.length);
  await p.close();
}
await b.close();
