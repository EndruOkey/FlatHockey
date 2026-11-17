// Snímek buly v reálné hře (rychlá hra přes server): kruh QTE u bodu + nápověda pro lidského centra.
// node scripts/faceoff_shot.mjs --port=5150 --out=DIR   (server musí běžet; ?fhtest zpřístupní window.__fhNet)
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 5150, OUT = A.out || '_fo'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-play');
const shots = [];
for (const [ph, name] of [[2, 'ring'], [3, 'click']]) {
  try {
    await p.waitForFunction(ph => { const g = window.__fhNet, f = g && g._fo; return f && f.a[0] === ph && g.myId === f.a[3 + (f.a[4] === g.myId ? 1 : 0)]; }, ph, { timeout: 150000, polling: 'raf' });
    const path = `${OUT}/faceoff_${name}.png`; await p.screenshot({ path }); shots.push(path);
    const st = await p.evaluate(() => { const g = window.__fhNet; return { fo: g._fo.a, me: g.myId, locked: g.locked }; });
    console.log(name, JSON.stringify(st));
  } catch (e) { console.log(name, 'nezachyceno:', e.message.split('\n')[0]); }
}
console.log('snímky:', shots.join(', ') || 0, '| chyby:', errs.length ? [...new Set(errs)].slice(0, 6) : 0);
await b.close();
