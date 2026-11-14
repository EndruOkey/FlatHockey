// Ověření: barva rukavic ze šatny (localStorage hockey_gloves) se propíše do hry. node scripts/glove_color_shot.mjs --port=P --out=DIR
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, OUT = A.out || '_glove'; mkdirSync(OUT, { recursive: true });
const COLS = ['#1a1f29', '#ffcf3a', '#df2626', '#f4f7fb'];
const b = await chromium.launch(); const errs = [];
for (const col of COLS) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 3 });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${PORT}/?fhtest`); 
  await p.evaluate(c => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_gloves', c); }, col);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1800);
  // host má vzhled vynucený (main.js DEFAULT_LOOK) → barvu dáme hráči přímo, jako by ji poslal profil přihlášeného
  const r = await p.evaluate(c => { const L = window.__fhGame.local; L.gloves = c; return { gl: L.gloves }; }, col); await p.waitForTimeout(300);
  const box = await p.evaluate(() => { const g = window.__fhGame, L = g.local, c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); const cam = g.cam || g.engine?.cam || g.renderer?.cam; return cam ? { x: r.left + cam.ox + L.x * cam.scale, y: r.top + cam.oy + L.y * cam.scale } : null; });
  await p.screenshot({ path: `${OUT}/g_${col.slice(1)}.png`, ...(box ? { clip: { x: box.x - 60, y: box.y - 60, width: 120, height: 120 } } : {}) });
  console.log(col, '→ hráč.gloves =', r.gl);
  await ctx.close();
}
await b.close(); console.log('chyby:', errs.length ? errs : 0);
