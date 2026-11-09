// Snímek hlášek (game._onFx) v offline zápase. Server: PORT=4931 node server.js. node scripts/fx_shot.mjs → _fx.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] || 'http://localhost:4931/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(2500);
await p.evaluate(() => { const g = window.__fhGame, ids = [...g.players.keys()];
  g._onFx({ k: 'combo', n: 3, id: ids[0] }); g._onFx({ k: 'perfect', id: ids[1] }); g._onFx({ k: 'fake', id: ids[2] });
  g._onFx({ k: 'onetimer', id: ids[3] }); g._onFx({ k: 'combogoal', n: 4, id: ids[0] }); });
await p.waitForTimeout(250);
await p.screenshot({ path: '_fx.png' });
console.log('snímek _fx.png | chyby JS:', errs.length ? errs : 0); await b.close();
