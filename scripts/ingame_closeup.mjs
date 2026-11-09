// Živá offline hra (boti hrají): každých 0,5 s najdi nosiče puku → kontrola, že puk je NAKRESLENÝ na jeho čepeli
// (p._visPuck existuje, vzdálenost od fyzikálního puku malá) + výřez 3×. Server: PORT=4931 node server.js → _closeup.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(4000);
const shots = [], checks = [];
for (let i = 0; i < 40 && shots.length < 4; i++) {
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => { const g = window.__fhGame, m = g.match, c = g._cam;
    const car = [...m.players.values()].find(o => o.hasPuck); if (!car) return null;
    const v = car._visPuck; return { x: c.ox + car.x * c.scale, y: c.oy + car.y * c.scale, hand: car.handed, drawn: !!v,
      d: v ? Math.hypot(v.x - m.puck.x, v.y - m.puck.y) : -1, carrierOk: m.puck._carrier === car };
  });
  if (!r) continue; checks.push(r);
  if (shots.length < 4) shots.push({ img: (await p.screenshot({ clip: { x: Math.max(0, r.x - 55), y: Math.max(0, r.y - 55), width: 110, height: 110 } })).toString('base64'), r });
}
await p.setContent(`<body style="margin:0;display:flex;background:#fff">${shots.map(s => `<div style="text-align:center;font:bold 13px sans-serif"><img width=300 src="data:image/png;base64,${s.img}"><br>${s.r.hand === 1 ? 'pravák' : 'levák'} · puk ${s.r.drawn ? 'na čepeli' : 'NENAKRESLEN'}</div>`).join('')}</body>`);
await p.setViewportSize({ width: 1200, height: 330 });
await p.screenshot({ path: '_closeup.png' });
const bad = checks.filter(c => !c.drawn || !c.carrierOk);
console.log(`nosičů zkontrolováno ${checks.length} | puk nenakreslen ${bad.length} | max vzdálenost kresba–fyzika ${Math.max(...checks.map(c => c.d)).toFixed(1)} px | chyby JS:`, errs.length ? errs : 0);
await b.close();
