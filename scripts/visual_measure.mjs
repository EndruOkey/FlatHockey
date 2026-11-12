// Spustí měření blokovosti z náhledu scripts/visual_variants.html (window.__cd2) a vypíše tabulku.
// Spuštění: node scripts/visual_build.mjs && node scripts/visual_measure.mjs [--shot cesta.png]
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(pathToFileURL(path.join(here, 'visual_variants.html')).href);
await p.waitForFunction(() => window.__cd2, null, { timeout: 60000 }).catch(e => { console.log('page errors:', errs); throw e; });
const r = await p.evaluate(() => { const { mA, mB, pB, res, stable, ms, msA, ops, opsA } = window.__cd2;
  const pc = (b, a) => Math.round(100 * b / a);
  return { stable, res, seam: { p3: pc(mB.p3.seam, mA.p3.seam), p1: pc(mB.p1.seam, mA.p1.seam), g3: pc(mB.g3.seam, mA.g3.seam), g1: pc(mB.g1.seam, mA.g1.seam) },
    joints: mB.joints.map(j => [j[0], +j[1].toFixed(1)]), holes: { p3: mB.p3.holes, p1: mB.p1.holes, g3: mB.g3.holes, g1: mB.g1.holes, at: mB.g3.holeAt },
    teeth: [mB.p3.teeth, mA.p3.teeth, mB.g3.teeth, mA.g3.teeth], perim: [mB.p3.perimRatio, mA.p3.perimRatio, mB.g3.perimRatio, mA.g3.perimRatio].map(v => +v.toFixed(3)),
    patDE: +pB.mn.toFixed(1), ms: +ms.toFixed(3), msA: +msA.toFixed(3), ops, opsA }; });
console.log(JSON.stringify(r, null, 1));
const shot = process.argv.indexOf('--shot'); if (shot > 0) { const el = await p.$('#cd2wrap'); await el.screenshot({ path: process.argv[shot + 1] }); }
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await b.close();
