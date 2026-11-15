// SNÍMKY BRZDY (Space) — 4 situace v jednom sloučeném PNG (řádek = situace, sloupec = každý 2. snímek od stisku). Server musí běžet.
// node scripts/brake_shots.mjs --port=P --out=FILE.png [--k3='{json}'] [--dpr=4]
// Řádky: celem (jízda doprava, tělo po jízdě) · kolmo (tělo nahoru) · obrat (brzda 14 sn. → rozjezd doleva) · zatáčka (jízda doprava, přidá W + Space).
// Deterministické okno: snímání přes engine.onDraw, pevný počet snímků od stisku.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const PORT = A.port || 4611, OUT = A.out || '_brake.png', DPR = +(A.dpr || 4), COLS = 14, STEP = 2, CELL = 300;
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: DPR })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
if (A.k3) await p.evaluate(async j => { Object.assign((await import('/js/entities/Player.js')).SKATE_K3, JSON.parse(j)); }, A.k3);
const rows = [];
for (const [lab, my] of [['celem', 384], ['kolmo', 40], ['obrat', 384], ['zatacka', 384]]) {
  await p.evaluate(() => { const L = window.__fhGame.local; L.x = 140; L.y = 330; L.vx = L.vy = 0; });
  await p.mouse.move(lab === 'obrat' ? 683 : 1350, my); await p.keyboard.down('KeyD'); await p.waitForTimeout(1300);
  const shots = await p.evaluate(async ([lab, COLS, STEP]) => { const g = window.__fhGame, eng = g.engine, cv = g.canvas, out = []; let f = 0;
    const K = g.input.keys; K.Space = true; if (lab !== 'zatacka') K.KeyD = false; else K.KeyW = true;
    await new Promise(res => { const prev = eng.onDraw; eng.onDraw = (...a) => { prev && prev(...a); f++;
      if (lab === 'obrat' && f === 14) { K.Space = false; K.KeyA = true; }
      if (f % STEP === 0) { const L = g.local, cam = g._cam, k = cv.width / cv.getBoundingClientRect().width, sx = (cam.ox + L.x * cam.scale) * k, sy = (cam.oy + L.y * cam.scale) * k, h = 22 * k * cam.scale / 1.2;
        const c = document.createElement('canvas'); c.width = c.height = 300; c.getContext("2d").drawImage(cv, sx - h, sy - h, 2 * h, 2 * h, 0, 0, 300, 300);
        out.push({ img: c.toDataURL('image/png'), f, v: Math.round(Math.hypot(L.vx || 0, L.vy || 0)), st: +(L._stopK3 || 0).toFixed(2) }); }
      if (out.length >= COLS) { eng.onDraw = prev; K.Space = K.KeyA = K.KeyW = K.KeyD = false; res(); } }; });
    return out; }, [lab, COLS, STEP]);
  await p.keyboard.up('KeyD');
  rows.push({ lab, shots }); console.log(lab.padEnd(8), shots.map(s => `${s.v}/${s.st}`).join(' '));
  await p.waitForTimeout(1500);
}
// složení do jednoho PNG (v prohlížeči, bez dalších balíčků)
const png = await p.evaluate(async ([rows, CELL]) => { const c = document.createElement('canvas'); c.width = rows[0].shots.length * CELL; c.height = rows.length * (CELL + 16); const x = c.getContext('2d');
  x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height); x.font = '12px monospace';
  for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r].shots.length; i++) { const s = rows[r].shots[i], im = new Image(); im.src = s.img; await im.decode();
    x.drawImage(im, i * CELL, r * (CELL + 16) + 16); x.fillStyle = '#fff'; x.fillText(`${i ? '' : rows[r].lab + ' '}f${s.f} v${s.v} st${s.st}`, i * CELL + 3, r * (CELL + 16) + 12); }
  return c.toDataURL('image/png'); }, [rows, CELL]);
writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
console.log('PNG', OUT, 'chyby:', errs.length ? errs : 0); await b.close();
