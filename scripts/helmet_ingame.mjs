// HELMA ve hře: offline zápas s boty, falešné hodiny (page.clock) → stejný okamžik pro všechny varianty VIS.h (mezi nimi 1 snímek).
// Výřez kolem nejhustšího shluku hráčů 1:1 a 2× (nejbližší soused). Server: PORT=5850 node server.js → node scripts/helmet_ingame.mjs <out> [port]
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const OUT = process.argv[2] || '.', PORT = process.argv[3] || '5850', VARS = [1, 3, 4, 5, 6];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.clock.install({ time: new Date('2026-11-17T12:00:00Z') });
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'domcontentloaded' }); await p.clock.runFor(1500);
await p.evaluate(() => document.getElementById('go-offline').click()); await p.clock.runFor(Number(process.env.T || 9000));
// hledej okamžik (krok 0,5 s, max 40 s), kdy se všichni hráči vejdou do výřezu W×H (po buly se rozjedou)
const W = 400, H = 250; let box = null;
for (let t = 0; t < 80; t++) {
  box = await p.evaluate(() => { const g = window.__fhGame, m = g.match, c = g._cam; const P = [...m.players.values()].map(o => ({ x: c.ox + o.x * c.scale, y: c.oy + o.y * c.scale }));
    const xs = P.map(q => q.x), ys = P.map(q => q.y); return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), scale: c.scale, total: P.length }; });
  if (t > 6 && box.w < W - 60 && box.h < H - 60) break; await p.clock.runFor(500);
}
const fr = await p.evaluate(() => { const e = window.__fhGame.engine; if (e) e.tempo = 0; return !!e; });   // zmrazit simulaci (kresba běží dál) → všechny varianty ze stejné polohy
const clip = { x: Math.max(0, box.x - W / 2), y: Math.max(0, box.y - H / 2), width: W, height: H };
for (const h of VARS) {
  await p.evaluate(async h => { (await import('/js/vis.js')).VIS.h = h; }, h); await p.clock.runFor(300);
  writeFileSync(`${OUT}/ingame_h${h}.png`, await p.screenshot({ clip }));
}
console.log(JSON.stringify({ box, frozen: fr, errs }));
await b.close();
