// Živé pozadí menu (menu-bg.js): snímky + deterministické kontroly.
// node scripts/menu_bg_shots.mjs <base_url> [outdir]
// 1) menu ve 2 bodech (frame ≥ 60 ≈ 2 s, frame ≥ 180 ≈ 6 s) → scéna se liší (podíl změněných pixelů plátna),
// 2) determinismus: 2 nezávislá načtení → stejný otisk scény v ticku 120 a 360,
// 3) start tréninku → pozadí stojí (frames se nezvyšují, plátno uvolněné), návrat do menu → běží znovu,
// 4) výkon: průměr ms na krok simulace a na kreslení snímku, fps strop, chyby v konzoli.
// Prohlížeč hlásí prefers-reduced-motion: reduce (jako u uživatele) — animace musí běžet i tak.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:5873').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('scripts/data/menu_bg');
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

const browser = await chromium.launch();
async function openMenu() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // /auth/me 401 = host bez přihlášení (očekávaná odpověď serveru, ne chyba stránky)
  pg.on('console', m => { if (m.type() === 'error' && !/\/auth\/me$/.test(m.location()?.url || '')) errors.push('console: ' + m.text() + (m.location()?.url ? ' @ ' + m.location().url : '')); });
  await pg.goto(BASE + '/?fhtest', { waitUntil: 'networkidle' });
  if (await pg.locator('#splash-guest-btn').isVisible()) await pg.click('#splash-guest-btn');
  return { ctx, pg };
}
const waitFrames = (pg, n) => pg.waitForFunction(n => (globalThis.__fhMenuBg?.frames || 0) >= n, n, { timeout: 30000 });
const grab = pg => pg.evaluate(() => { const c = document.querySelector('.scene3-live'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });

// ── 1) dva časy ─────────────────────────────────────────────────────
const A = await openMenu();
const reduce = await A.pg.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
check(reduce, 'prohlížeč hlásí prefers-reduced-motion: reduce (scéna má běžet i tak)');
await waitFrames(A.pg, 60);
const f1 = await A.pg.evaluate(() => __fhMenuBg.frames);
await A.pg.screenshot({ path: path.join(OUT, 'menu_2s.png') });
const px1 = await grab(A.pg);
await waitFrames(A.pg, 180);
const f2 = await A.pg.evaluate(() => __fhMenuBg.frames);
await A.pg.screenshot({ path: path.join(OUT, 'menu_6s.png') });
const px2 = await grab(A.pg);
let diff = 0; for (let i = 0; i < px1.length; i += 4) if (Math.abs(px1[i] - px2[i]) + Math.abs(px1[i + 1] - px2[i + 1]) + Math.abs(px1[i + 2] - px2[i + 2]) > 24) diff++;
const diffPct = diff / (px1.length / 4) * 100;
check(diffPct > 0.5, `scéna se mezi snímky ${f1} a ${f2} liší: ${diffPct.toFixed(2)} % pixelů plátna`);
const vis = await A.pg.evaluate(() => ({ live: document.querySelector('.scene3').classList.contains('live'),
  title: getComputedStyle(document.querySelector('.scene3-live')).display }));
check(vis.live && vis.title === 'block', 'živé plátno je zobrazené (SVG záloha skrytá)');

// fps strop: snímky za 3 s reálného času
const t0 = await A.pg.evaluate(() => [__fhMenuBg.frames, performance.now()]);
await A.pg.waitForTimeout(3000);
const t1 = await A.pg.evaluate(() => [__fhMenuBg.frames, performance.now()]);
const fps = (t1[0] - t0[0]) / ((t1[1] - t0[1]) / 1000);
check(fps <= 31.5, `strop fps: ${fps.toFixed(1)} fps (max ~30)`);
const perf = await A.pg.evaluate(() => ({ step: __fhMenuBg.stepMs, draw: __fhMenuBg.drawMs, drawMax: __fhMenuBg.drawMax }));
console.log(`výkon: krok simulace ${perf.step.toFixed(2)} ms, kreslení ${perf.draw.toFixed(2)} ms/snímek (max ${perf.drawMax.toFixed(2)} ms) → ${(fps * (perf.step + perf.draw) / 10).toFixed(1)} % jednoho jádra`);

// skrytá záložka: pauza
await A.pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
const h0 = await A.pg.evaluate(() => __fhMenuBg.frames); await A.pg.waitForTimeout(1000);
const h1 = await A.pg.evaluate(() => [__fhMenuBg.frames, __fhMenuBg.running]);
check(h1[0] === h0 && !h1[1], `skrytá záložka: snímky stojí (${h0} → ${h1[0]})`);
await A.pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await A.pg.waitForTimeout(500);
check(await A.pg.evaluate(() => __fhMenuBg.running), 'viditelná záložka: scéna znovu běží');

// ── 3) trénink → stop, návrat → běží ─────────────────────────────────
await A.pg.click('#go-train'); await A.pg.waitForTimeout(300);
await A.pg.click('#go-solo'); await A.pg.waitForTimeout(800);
const g0 = await A.pg.evaluate(() => [__fhMenuBg.frames, __fhMenuBg.ticks]);
await A.pg.waitForTimeout(2000);
const g1 = await A.pg.evaluate(() => ({ f: __fhMenuBg.frames, t: __fhMenuBg.ticks, run: __fhMenuBg.running, w: document.querySelector('.scene3-live').width, game: !!window.__fhGame }));
await A.pg.screenshot({ path: path.join(OUT, 'training.png') });
check(g1.game && g1.f === g0[0] && g1.t === g0[1] && !g1.run && g1.w === 1, `trénink: menu-scéna stojí (frames ${g0[0]} → ${g1.f}, ticks ${g0[1]} → ${g1.t}) a plátno uvolněné (šířka ${g1.w})`);
await A.pg.keyboard.press('Escape'); await A.pg.waitForTimeout(300);
await A.pg.click('#leave-btn'); await A.pg.waitForTimeout(1500);
const r1 = await A.pg.evaluate(() => [__fhMenuBg.frames, __fhMenuBg.running]);
check(r1[1] && r1[0] > 10, `návrat do menu: scéna běží znovu od buly (frames ${r1[0]})`);
await A.pg.screenshot({ path: path.join(OUT, 'menu_back.png') });
const marksA = await (async () => { await waitFrames(A.pg, 181); return A.pg.evaluate(() => __fhMenuBg.marks); })();

// ── 2) determinismus: druhé nezávislé načtení ───────────────────────
const B = await openMenu();
await waitFrames(B.pg, 181);
const marksB = await B.pg.evaluate(() => __fhMenuBg.marks);
check(marksA[120] && marksA[120] === marksB[120] && marksA[360] === marksB[360], 'determinismus: otisk scény v ticku 120 a 360 shodný ve 2 načteních');
check(marksA[120] !== marksA[360], 'otisk 120 ≠ 360 (hráči se hýbou)');

await browser.close();
check(errors.length === 0, `chyby v konzoli: ${errors.length}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
console.log('snímky: ' + OUT);
process.exit(fails.length ? 1 : 0);
