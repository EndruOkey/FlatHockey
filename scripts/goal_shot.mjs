// Výřez obou branek v offline zápase (kontrola kresby). Server musí běžet: PORT=4931 node server.js
// node scripts/goal_shot.mjs [url] → sloučený _goal_LR.png v aktuální složce
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4931/';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(2500);
const { k, RINK } = await p.evaluate(async () => ({ k: window.__fhGame._cam, RINK: (await import('/js/constants.js')).RINK }));
const shots = [];
for (const glx of [RINK.goalLineLeft, RINK.goalLineRight]) {
  const cx = k.ox + glx * k.scale, cy = k.oy + (RINK.goalY + RINK.goalH / 2) * k.scale;
  shots.push((await p.screenshot({ clip: { x: Math.max(0, cx - 60), y: Math.max(0, cy - 60), width: 120, height: 120 } })).toString('base64'));
}
await p.setContent(`<body style="margin:0;display:flex">${shots.map(s => `<img width=360 src="data:image/png;base64,${s}">`).join('')}</body>`);
await p.setViewportSize({ width: 720, height: 360 });
await p.screenshot({ path: '_goal_LR.png' });
console.log('snímek: _goal_LR.png | chyby JS:', errs.length ? errs : 0); await b.close();
