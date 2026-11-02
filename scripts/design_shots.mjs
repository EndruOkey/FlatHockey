// Vyfotí HTML návrhy (směry) v pevném okně 1440×900 po načtení písem. node scripts/design_shots.mjs <složka> <a.html> [b.html ...]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [dir, ...files] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +(process.env.W||1440), height: +(process.env.H||900) } });
for (const f of files) {
  await p.goto(pathToFileURL(path.join(dir, f)).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(dir, f.replace(/\.html$/, '.png')) }); console.log(f);
}
await b.close();
