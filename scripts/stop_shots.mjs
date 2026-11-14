// SNÍMKY HOKEJOVÉHO STOPU ze živé hry (trénink, uprostřed ledu), vysoké rozlišení. Server musí běžet.
// node scripts/stop_shots.mjs --port=P --out=DIR [--tag=po] [--dpr=4]
// --k3='{"hsD":1.7}' přepis SKATE_K3 v prohlížeči. --hold=N: Space držen N snímků (výchozí celou dobu). Situace: jízda doprava ~165 px/s čelem po směru → Space (stop); a čelem k myši nahoru (jízda doprava, tělo kolmo) → Space.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const HOLDF = +(A.hold ?? 999);   // počet snímků držení Space (výchozí = drží celou dobu)
const PORT = A.port || 4611, OUT = A.out || '_stop', TAG = A.tag || 'po', DPR = +(A.dpr || 4); mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: DPR })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.k3) await p.evaluate(async j => { Object.assign((await import('/js/entities/Player.js')).SKATE_K3, JSON.parse(j)); }, A.k3);   // --k3='{json}' přepis parametrů K3
// snímání přes engine.onDraw (každý 3. snímek po stisku Space), výřez kolem hráče z canvasu → deterministické okno snímků
for (const [lab, my] of [['celem', 384], ['kolmo', 40]]) {
  await p.evaluate(() => { const L = window.__fhGame.local; L.x = 140; L.y = 330; L.vx = L.vy = 0; });
  await p.mouse.move(1350, my); await p.keyboard.down('KeyD'); await p.waitForTimeout(1300);
  const shots = await p.evaluate(async (HOLD) => { const g = window.__fhGame, eng = g.engine, cv = g.canvas, out = []; let f = 0;
    g.input.keys.Space = true; g.input.keys.KeyD = false;
    await new Promise(res => { const prev = eng.onDraw; eng.onDraw = (...a) => { prev && prev(...a); f++;
      if (f === HOLD) g.input.keys.Space = false;
      if (f % 3 === 0) { const L = g.local, cam = g._cam, k = cv.width / cv.getBoundingClientRect().width, sx = (cam.ox + L.x * cam.scale) * k, sy = (cam.oy + L.y * cam.scale) * k, h = 34 * k * cam.scale / 1.2;
        const c = document.createElement('canvas'); c.width = c.height = 240; c.getContext('2d').drawImage(cv, sx - h, sy - h, 2 * h, 2 * h, 0, 0, 240, 240);
        out.push({ img: c.toDataURL('image/png'), v: Math.round(Math.hypot(L.vx || 0, L.vy || 0)), st: +(L._stopK3 || 0).toFixed(2) }); }
      if (out.length >= 12) { eng.onDraw = prev; g.input.keys.Space = false; res(); } }; });
    return out; }, HOLDF);
  await p.keyboard.up('KeyD');
  const fs = await import('fs');
  shots.forEach((s, i) => fs.writeFileSync(`${OUT}/${TAG}_${lab}_${String(i).padStart(2, '0')}.png`, Buffer.from(s.img.split(',')[1], 'base64')));
  console.log(lab, shots.map(s => `v${s.v}/st${s.st}`).join(' '));
  await p.waitForTimeout(1200);
}
console.log('chyby:', errs.length ? errs : 0); await b.close();
