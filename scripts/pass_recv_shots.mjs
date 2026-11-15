// SNÍMKY PŘIHRÁVKY A PŘÍJMU ze živé hry (trénink s nahrávačem): hráč přihraje (F) nahrávači, ten vrátí pas a hráč ho převezme.
// PŘED (VIS.r = 0) i PO (VIS.r = 1). Snímá se z herního canvasu po každém vykreslení (hook engine.onDraw), KAŽDÝ snímek,
// ukládají se okna kolem událostí (vypuštění pasu, převzetí). Server musí běžet: PORT=49xx node server.js.
//   node scripts/pass_recv_shots.mjs --port=4931 --out=DIR [--dpr=3]        list + GIF: python scripts/pass_recv_sheet.py DIR OUT
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4931, OUT = A.out || '_pass_shots', DPR = +(A.dpr || 3);
mkdirSync(OUT, { recursive: true });
const errs = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: DPR, reducedMotion: 'no-preference' });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push('console: ' + m.text()); });
await p.goto(`http://localhost:${PORT}/?fhtest`, { waitUntil: 'load' });
await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
const meta = {};
for (const lab of ['pred', 'po']) {
  await p.evaluate(async v => { (await import('/js/vis.js')).VIS.r = v; }, lab === 'po' ? 1 : 0);
  // hráč s pukem vlevo, nahrávač vpravo (stojí, bez driftu); kurzor na nahrávače
  await p.evaluate(() => { const g = window.__fhGame, L = g.local, P = g.passer;
    L.x = 420; L.y = 330; L.vx = L.vy = 0; L.bodyAngle = L.skateAngle = L.aimAngle = L.carryAngle = 0; L._stickDisp = 0;
    P.active = true; P.dragTo(620, 330); P.driftSpeed = 0; P.hasPuck = false;
    const t = L.stickTip; g.puck.x = t.x; g.puck.y = t.y; g.puck.vx = g.puck.vy = 0; g.puck.z = g.puck.vz = 0; });
  const cam = await p.evaluate(() => { const c = window.__fhGame._cam; return { s: c.scale, ox: c.ox, oy: c.oy }; });
  await p.mouse.move(cam.ox + 620 * cam.s, cam.oy + 330 * cam.s); await p.waitForTimeout(700);
  const frames = await p.evaluate(async () => {
    const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas');
    const sc = cv.width / cv.clientWidth, out = [], prev = eng.onDraw; let f = 0, done = -1;
    await new Promise(res => {
      eng.onDraw = (c) => { prev(c); const cm = g._cam, L = g.local, P = g.passer; f++;
        if (f === 4) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
        if (f === 6) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' }));
        if (P.hasPuck) { P._held = (P._held || 0) + 1; if (P._held === 24) P.forceReturn(); } else P._held = 0;   // po 24 snímcích si řekni o pas (jako MMB)
        // výřez: od hráče k nahrávači (svět 380–660 × 290–370)
        const x0 = (cm.ox + 380 * cm.scale) * sc, y0 = (cm.oy + 290 * cm.scale) * sc, w = 280 * cm.scale * sc, h = 80 * cm.scale * sc;
        const o = document.createElement('canvas'); o.width = Math.round(w); o.height = Math.round(h);
        o.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, o.width, o.height);
        out.push({ img: o.toDataURL('image/png'), L: L.hasPuck, P: P.hasPuck, f });
        if (done < 0 && f > 20 && L.hasPuck) done = f;
        if ((done > 0 && f >= done + 14) || f > 400) { eng.onDraw = prev; res(); } };
    });
    return out;
  });
  // okna: vypuštění (L ztratí puk), převzetí (L ho znovu má)
  const edge = (k, on, from) => frames.findIndex((q, i) => i > from && !!frames[i - 1][k] !== on && !!q[k] === on);
  const iRel = edge('L', false, 0), iPc = edge('P', true, iRel), iPr = edge('P', false, iPc), iCat = edge('L', true, iPr);
  const keep = [];
  const win = (k, i0, a, b2) => { if (i0 < 0) return; for (let i = Math.max(0, i0 - a); i <= i0 + b2 && i < frames.length; i++) keep.push([k, i - i0, i]); };
  win('1vypusteni', iRel, 2, 9); win('2nahravac_prijem', iPc, 3, 10); win('3nahravac_pas', iPr, 2, 9); win('4prijem', iCat, 3, 10);
  for (const [k, d, i] of keep) writeFileSync(join(OUT, `${lab}_${k}_${String(d + 10).padStart(2, '0')}.png`), Buffer.from(frames[i].img.split(',')[1], 'base64'));
  meta[lab] = { snimku: frames.length, vypusteni: iRel, nahravac_prijem: iPc, nahravac_pas: iPr, prijem: iCat, drzi: frames.map(q => (q.P ? 'P' : q.L ? 'L' : '.')).join('') };
  console.log(lab, JSON.stringify(meta[lab]));
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
await b.close();
if (errs.length) { console.log('CHYBY:', errs.slice(0, 5).join(' | ')); process.exitCode = 1; } else console.log('bez chyb v konzoli');
