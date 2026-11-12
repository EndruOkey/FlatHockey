// HiDPI kontrola: zápas offline při deviceScaleFactor 1 a 2 → _dpr1.png/_dpr2.png, backing store, kamera,
// převod myši na herní bod a ostrost hrany (průměrný |Δ| jasu v řádku přes mantinel). Server: PORT=4931 node server.js
import { chromium } from 'playwright';
const b = await chromium.launch(); const out = {};
for (const dsf of [1, 2]) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: dsf })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
  await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.click('#go-offline'); await p.waitForTimeout(3000);
  const pts = [[400, 300], [900, 500], [640, 380]], hits = [];
  for (const [x, y] of pts) {
    await p.mouse.move(x, y); await p.waitForTimeout(80);
    hits.push(await p.evaluate(() => { const g = window.__fhGame, c = g._cam, i = g.input;
      return { mx: i.mouseX, my: i.mouseY, wx: +((i.mouseX - c.ox) / c.scale).toFixed(3), wy: +((i.mouseY - c.oy) / c.scale).toFixed(3) }; }));
  }
  const info = await p.evaluate(() => { const cv = document.getElementById('canvas'), c = window.__fhGame._cam;
    return { backing: `${cv.width}x${cv.height}`, css: `${cv.clientWidth}x${cv.clientHeight}`, dpr: cv.dpr, cam: { s: +c.scale.toFixed(4), ox: +c.ox.toFixed(2), oy: +c.oy.toFixed(2) },
      tf: cv.getContext('2d').getTransform().a }; });
  await p.screenshot({ path: `_dpr${dsf}.png` });
  out[dsf] = { ...info, hits, errs: errs.length };
  await p.close();
}
// ostrost: obě fotky vykresli do 2560 šířky (1× zvětšeno), změř průměrný |Δ| jasu sousedních px v pásu přes horní mantinel
const p = await (await b.newContext({ viewport: { width: 400, height: 300 } })).newPage();
const fs = await import('fs');
const img = n => 'data:image/png;base64,' + fs.readFileSync(n).toString('base64');
const sh = await p.evaluate(async ([a, c, cam]) => {
  const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
  const res = {};
  for (const [k, s] of [['1', a], ['2', c]]) {
    const im = await load(s), cv = document.createElement('canvas'); cv.width = 2560; cv.height = 1520;
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(im, 0, 0, 2560, 1520);
    const col = Math.round((cam.ox + 300) * 2), y0 = Math.round((cam.oy - 20) * 2), d = x.getImageData(col, y0, 1, 80).data;
    let sum = 0, mx = 0; for (let i = 4; i < d.length; i += 4) { const v = Math.abs((d[i]+d[i+1]+d[i+2]) - (d[i-4]+d[i-3]+d[i-2])) / 3; sum += v; mx = Math.max(mx, v); }
    res[k] = { meanGrad: +(sum / 79).toFixed(2), maxStep: +mx.toFixed(1) };
  }
  return res;
}, [img('_dpr1.png'), img('_dpr2.png'), out[1].cam]);
console.log(JSON.stringify({ out, sharp: sh }, null, 1));
await b.close();
