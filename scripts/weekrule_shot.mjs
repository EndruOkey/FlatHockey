// Snímek týdenního pravidla v HUD + bonusu v offline zápase. Server: PORT=4931 node server.js. node scripts/fx_shot.mjs → _wr.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] || 'http://localhost:4931/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(2500);
await p.evaluate(() => { const g = window.__fhGame, ids = [...g.players.keys()];
  g.weekRule = 'lastmin2'; g._onFx({ k: 'bonus', id: ids[0] }); });
await p.waitForTimeout(250);
await p.screenshot({ path: '_wr.png' });
console.log('snímek _wr.png | chyby JS:', errs.length ? errs : 0); await b.close();
