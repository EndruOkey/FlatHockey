// Snímek štítu (krytí tělem) u hráče v offline zápase. Server: PORT=4931 node server.js. → _shield.png (výřez 3×)
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] || 'http://localhost:4931/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(2000);
const pos = await p.evaluate(() => new Promise(res => { const g = window.__fhGame, e = g.local;
  const f = () => { e._shieldT = 0.35; e._shieldA = Math.PI * 0.75; };
  f(); requestAnimationFrame(() => { f(); requestAnimationFrame(() => { f(); const c = g._cam; res({ x: c.ox + e.x * c.scale, y: c.oy + e.y * c.scale }); }); }); }));
const shot = await p.screenshot({ clip: { x: pos.x - 50, y: pos.y - 50, width: 100, height: 100 } });
await p.setContent(`<img width=300 src="data:image/png;base64,${shot.toString('base64')}">`); await p.setViewportSize({ width: 300, height: 300 });
await p.screenshot({ path: '_shield.png' }); console.log('snímek _shield.png | chyby JS:', errs.length ? errs : 0); await b.close();
