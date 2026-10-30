#!/usr/bin/env node
/**
 * FlatHockey release asset generator (itch.io + CrazyGames).
 *
 * Run (from repo root):   node release/make-assets.mjs
 *   env ASSET_URL=https://...   use an already running server instead of spawning a local one
 *                               (default: spawns `node server.js` on PORT 4120 with a throw-away DB,
 *                               so production metrics and flathockey.db are never touched)
 *   env PORT=4120               local server port
 *   env KEEP_TMP=1              keep temp files in <os tmp>/fh-assets
 *
 * Needs: Node >= 18, `npm i` (playwright devDependency + its chromium). ffmpeg is needed for the
 * videos (must decode vp8 + have libx264): `ffmpeg` on PATH, env FFMPEG=path, or `pip install imageio-ffmpeg`.
 * Playwright's bundled ffmpeg cannot decode vp8, so it does not work. Without ffmpeg only the raw
 * 16:9 .webm recording is delivered (untrimmed).
 *
 * How it works: a real browser plays a real match vs the server bot (guest, create lobby, start).
 * An autopilot reads the server snapshots (socket 'snap') and drives the player ONLY through
 * keyboard (WASD) + mouse (aim, hold/release LMB) via Playwright input. Network and bot timing are
 * not deterministic, so frames differ slightly between runs; the pilot's own randomness is seeded.
 *
 * Output -> release/assets/
 *   itch/cover-630x500.png, itch/screenshot-1..4-*.png (1280x720)
 *   crazygames/cover-1920x1080.png, cover-800x1200.png, cover-800x800.png
 *   crazygames/preview-16x9-1920x1080.mp4, preview-2x3-1080x1620.mp4  (H.264, 18 s, silent)
 *   contact-sheet.png (QA overview), report.txt (measured sizes/durations)
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release', 'assets');
const TMP = path.join(os.tmpdir(), 'fh-assets');
const PORT = process.env.PORT || 4120;
const RINK = { w: 1080, h: 456, goalLineRight: 990, goalY: 228 };
const report = [];
const log = (...a) => { const s = a.join(' '); console.log(s); report.push(s); };

fs.mkdirSync(path.join(OUT, 'itch'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'crazygames'), { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
for (const d of ['itch', 'crazygames']) for (const f of fs.readdirSync(path.join(OUT, d))) fs.rmSync(path.join(OUT, d, f)); // no stale files

// ---------- seeded RNG (mulberry32) ----------
let _seed = 20261030;
const rnd = () => { _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0; let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- server ----------
let server = null;
async function startServer() {
  if (process.env.ASSET_URL) return process.env.ASSET_URL.replace(/\/$/, '');
  const base = `http://localhost:${PORT}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(TMP, 'assets-throwaway.db') },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/')).ok) return base; } catch {}
    await sleep(500);
  }
  throw new Error('server did not start');
}

// ---------- ffmpeg ----------
function findFfmpeg() {
  // Must DECODE vp8 (Playwright's recording) and encode h264: Playwright's bundled ffmpeg cannot, so it is not used.
  const cands = [process.env.FFMPEG, 'ffmpeg'];
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0) cands.push(py.stdout.trim());
  for (const c of cands.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-decoders'], { encoding: 'utf8' });
    if (r.status === 0 && / vp8 /.test(r.stdout)) { const e = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout; if (/libx264/.test(e)) return c; }
  }
  return null;
}
const FFMPEG = findFfmpeg();
const ff = (args) => { const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr); };

// ---------- page helpers ----------
const INIT = () => {
  localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('fh_lang', 'en');
  localStorage.setItem('hockey_name', 'OKEY'); localStorage.setItem('hockey_num', '9');
  let real; // capture socket + latest server snapshot so the autopilot can read the game state
  Object.defineProperty(window, 'io', { configurable: true, get: () => real, set(v) {
    real = function (...a) { const s = v(...a); window.__sock = s;
      s.on('snap', d => { window.__snap = d; }); s.on('goal', () => { window.__goals = (window.__goals || 0) + 1; }); return s; };
    Object.assign(real, v); } });
};

async function openMatch(ctx, base, vp, shots) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(base + '/'); await page.waitForTimeout(1500);
  if (shots?.menu) { await page.click('#splash-guest-btn'); await page.waitForSelector('#vm-create-btn', { state: 'visible' });
    await page.waitForTimeout(1200); await page.screenshot({ path: shots.menu }); }
  else { await page.click('#splash-guest-btn'); await page.waitForSelector('#vm-create-btn', { state: 'visible' }); }
  await page.click('#vm-create-btn'); await page.waitForSelector('#create-go', { state: 'visible' });
  await page.click('#create-go'); await page.waitForSelector('#start-btn', { state: 'visible' });
  await page.waitForTimeout(800);
  await page.click('#start-btn');
  await page.waitForFunction(() => window.__snap && window.__snap.players && window.__snap.players.length > 1, null, { timeout: 20000 });
  return { page, t0, matchStart: Date.now() };
}

/** Autopilot: keyboard + mouse only. hooks.onTick(info) may return 'stop'. */
async function pilot(page, hooks, maxMs) {
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let lmb = false, lmbSince = 0, lastGoals = 0, jit = 0, shotsFired = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const st = await page.evaluate(() => ({ s: window.__snap, g: window.__goals || 0, id: window.__sock && window.__sock.id, cw: innerWidth, ch: innerHeight }));
    const s = st.s; const me = s && s.players.find(p => p.id === st.id);
    if (!me) { await sleep(60); continue; }
    // same camera as engine.computeCamera (pad 48)
    const sc = Math.min((st.cw - 96) / RINK.w, (st.ch - 96) / RINK.h);
    const ox = (st.cw - RINK.w * sc) / 2, oy = (st.ch - RINK.h * sc) / 2;
    const toS = (x, y) => ({ x: ox + x * sc, y: oy + y * sc });
    const dir = me.team === 'home' ? 1 : -1;
    const goalX = dir > 0 ? RINK.goalLineRight : 90;
    let tx, ty, aim;
    const hasPuck = !!me.hp;
    if (hasPuck) {
      const dGoal = Math.abs(goalX - me.x);
      if (!jit) jit = (rnd() - 0.5) * 26;
      tx = goalX - dir * 150; ty = RINK.goalY + jit * 2;
      aim = { x: goalX, y: RINK.goalY + jit };
      if (dGoal < 330 && Math.abs(me.y - RINK.goalY) < 120) {            // shooting range: charge, release at ~0.85
        if (!lmb) { await page.mouse.move(...Object.values(toS(aim.x, aim.y))); await page.mouse.down(); lmb = true; lmbSince = Date.now(); }
      }
    } else { tx = s.puck.x; ty = s.puck.y; aim = { x: s.puck.x, y: s.puck.y }; jit = 0; }
    if (lmb && (me.ch >= 0.85 || Date.now() - lmbSince > 1100 || !hasPuck)) {
      await page.mouse.up(); lmb = false; shotsFired++;
      await hooks.onShot?.({ page, me, s, toS });
    } else {
      const a = toS(aim.x, aim.y); await page.mouse.move(a.x, a.y);
    }
    const want = new Set();
    if (tx - me.x > 10) want.add('KeyD'); if (tx - me.x < -10) want.add('KeyA');
    if (ty - me.y > 10) want.add('KeyS'); if (ty - me.y < -10) want.add('KeyW');
    await setKeys(want);
    if (st.g > lastGoals) { lastGoals = st.g; await hooks.onGoal?.({ page, me, s, toS }); }
    if (await hooks.onTick?.({ page, me, s, toS, hasPuck, shotsFired }) === 'stop') break;
    await sleep(40);
  }
  if (lmb) await page.mouse.up();
  await setKeys(new Set());
}

// ---------- RUN A: itch screenshots @1280x720 ----------
async function runItch(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  await ctx.addInitScript(INIT);
  const P = (n) => path.join(OUT, 'itch', n);
  const { page, matchStart } = await openMatch(ctx, base, null, { menu: P('screenshot-1-menu.png') });
  const got = { play: 0, shot: 0, goal: 0, goal2: 0 };
  await pilot(page, {
    async onTick({ page, hasPuck, me }) {
      const el = Date.now() - matchStart;
      if (!got.play && ((hasPuck && me.x > 300 && el > 12000) || el > 30000)) { await page.screenshot({ path: P('screenshot-2-gameplay.png') }); got.play = 1; }
      return got.shot && got.goal ? 'stop' : undefined;
    },
    async onShot({ page }) { if (!got.shot) { await sleep(110); await page.screenshot({ path: P('screenshot-3-shot.png') }); got.shot = 1; } },
    async onGoal({ page }) { if (!got.goal) { await sleep(450); await page.screenshot({ path: P('screenshot-4-goal.png') }); got.goal = 1; } },
  }, 150000);
  log('itch run:', JSON.stringify(got));
  await ctx.close();
  return got;
}

// ---------- RUN B: 1920x1080 video + cover source frames ----------
async function runVideo(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference',
    recordVideo: { dir: path.join(TMP, 'vid'), size: { width: 1920, height: 1080 } } });
  await ctx.addInitScript(INIT);
  const { page, t0, matchStart } = await openMatch(ctx, base, null, null);
  const mStart = (matchStart - t0) / 1000;
  const track = []; let goalT = null;
  await pilot(page, {
    async onTick({ s, toS }) {
      const t = (Date.now() - t0) / 1000;
      const p = toS(s.puck.x, s.puck.y); track.push([t, p.x]);
      // stop 4 s after a goal, or after 100 s without one
      if (goalT && t - goalT > 4) return 'stop';
      if (!goalT && t - mStart > 100) return 'stop';
    },
    async onGoal() { goalT = (Date.now() - t0) / 1000; },
  }, 130000);
  const vpath = await page.video().path();
  await ctx.close();
  log(`video run: matchStart=${mStart.toFixed(1)}s goalT=${goalT?.toFixed(1) ?? 'none'}s`);
  return { vpath, mStart, goalT, track };
}

// ---------- RUN C: 3840x2160 still for the covers (sharp when cropped/zoomed) ----------
async function runCoverSource(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 3840, height: 2160 }, reducedMotion: 'no-preference' });
  await ctx.addInitScript(INIT);
  const { page, matchStart } = await openMatch(ctx, base, null, null);
  const file = path.join(TMP, 'cover-src-4k.png'); let focus = null;
  await pilot(page, {
    async onShot({ page, me, toS }) { await sleep(110); await page.screenshot({ path: file }); focus = toS(me.x, me.y); },
    onTick({ page }) { if (Date.now() - matchStart > 90000) return 'stop'; return focus ? 'stop' : undefined; },
  }, 100000);
  await ctx.close();
  if (!focus) throw new Error('no 4K cover frame captured (no shot fired)');
  log('cover source: 4K shot frame, focus', Math.round(focus.x) + ',' + Math.round(focus.y));
  return { file, focus };
}

// ---------- covers (HTML + CSS rendered by Playwright) ----------
async function composeCover(browser, { img, W, H, zoom, fx, fy, file, titleSize, titleW, align }) {
  // image is 3840x2160; scale by `zoom`, keep focus (fx,fy in image px) centred, clamp to image bounds
  const iw = 3840 * zoom, ih = 2160 * zoom;
  const left = -Math.min(Math.max(fx * zoom - W / 2, 0), iw - W);
  const top = -Math.min(Math.max(fy * zoom - H / 2, 0), ih - H);
  const html = `<!doctype html><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,900&display=swap" rel="stylesheet">
<style>
html,body{margin:0;background:#0b0e16}
#c{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#0b0e16}
#c img{position:absolute;left:${left}px;top:${top}px;width:${iw}px;height:${ih}px;image-rendering:auto}
#g{position:absolute;inset:0;background:
  linear-gradient(to top,rgba(8,10,20,.96) 0%,rgba(8,10,20,.78) 28%,rgba(8,10,20,0) 62%),
  linear-gradient(to bottom,rgba(8,10,20,.55) 0%,rgba(8,10,20,0) 22%)}
#t{position:absolute;left:${Math.round(W * 0.05)}px;bottom:${Math.round(H * 0.07)}px;text-align:${align || 'center'};
  font:italic 900 ${titleSize}px/0.9 'Barlow Condensed','Arial Narrow',Impact,sans-serif;letter-spacing:.01em;color:#fff;text-transform:uppercase;
  text-shadow:0 4px 24px rgba(0,0,0,.6)}
#w{display:inline-block;white-space:nowrap}
#t b{color:#3a9fff;font-weight:900}
#t i{color:#ff4455;font-style:italic}
#bar{height:${Math.max(4, Math.round(titleSize * 0.06))}px;margin:${Math.round(titleSize * 0.12)}px 0 0;width:100%;background:linear-gradient(90deg,#3a9fff 50%,#ff4455 50%)}
</style>
<div id=c><img src="${pathToFileURL(img).href}"><div id=g></div><div id=t><span id=w>FLAT<b>HOCKEY</b></span><div id=bar></div></div></div>`;
  const hp = path.join(TMP, 'cover.html'); fs.writeFileSync(hp, html);
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  await pg.goto(pathToFileURL(hp).href);
  await pg.evaluate(() => document.fonts.load("italic 900 100px 'Barlow Condensed'").then(() => document.fonts.ready)).catch(() => {});
  await pg.evaluate(([tw, W, al]) => { const t = document.getElementById('t'), w = document.getElementById('w');
    const k = (W * tw) / w.getBoundingClientRect().width; t.style.fontSize = (parseFloat(getComputedStyle(t).fontSize) * k) + 'px';
    t.style.left = al === 'left' ? Math.round(W * 0.05) + 'px' : Math.round(W * (1 - tw) / 2) + 'px'; t.style.width = Math.round(W * tw) + 'px'; }, [titleW, W, align]);
  const fontOk = await pg.evaluate(() => document.fonts.check("italic 900 100px 'Barlow Condensed'"));
  if (!fontOk) log('WARN: Barlow Condensed not loaded (offline?) - fallback font used for', path.basename(file));
  await pg.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  await pg.close();
}

// ---------- video conversion ----------
function buildCropX(track, t0, dur, cropW) {
  // 1 knot/s: smoothed puck x (moving average +-1.2 s) -> crop left edge; piecewise linear in t
  const knots = [];
  for (let k = 0; k <= Math.ceil(dur); k++) {
    const t = t0 + k; const pts = track.filter(([tt]) => Math.abs(tt - t) <= 1.2);
    const x = pts.length ? pts.reduce((a, p) => a + p[1], 0) / pts.length : 960;
    knots.push(Math.round(Math.min(Math.max(x - cropW / 2, 0), 1920 - cropW)));
  }
  let e = String(knots[knots.length - 1]);
  for (let k = knots.length - 2; k >= 0; k--) e = `if(lt(t\,${k + 1})\,${knots[k]}+(${knots[k + 1] - knots[k]})*(t-${k})\,${e})`;
  return e;
}
function probeDuration(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || ''); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : NaN;
}
function makeVideos(v) {
  const dur = 18;
  let start = v.mStart;
  if (v.goalT && v.goalT - v.mStart > dur - 4) start = v.goalT + 3.5 - dur;       // window ends ~3.5 s after the goal
  start = Math.max(start, v.mStart, 0);
  const total = probeDuration(v.vpath);
  if (Number.isFinite(total) && start + dur > total) start = Math.max(0, total - dur);
  log(`video window: ${start.toFixed(1)}s .. ${(start + dur).toFixed(1)}s (source ${total.toFixed(1)}s)`);
  const enc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', '30', '-an', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const o169 = path.join(OUT, 'crazygames', 'preview-16x9-1920x1080.mp4');
  const o23 = path.join(OUT, 'crazygames', 'preview-2x3-1080x1620.mp4');
  ff(['-ss', String(start), '-t', String(dur), '-i', v.vpath, '-vf', 'scale=1920:1080:flags=lanczos', ...enc, o169]);
  const x = buildCropX(v.track, start, dur, 720);
  ff(['-ss', String(start), '-t', String(dur), '-i', v.vpath, '-vf', `crop=720:1080:'${x}':0,scale=1080:1620:flags=lanczos`, ...enc, o23]);
  ff(['-i', o169, '-frames:v', '1', path.join(TMP, 'first-frame-16x9.png')]);
  ff(['-i', o23, '-frames:v', '1', path.join(TMP, 'first-frame-2x3.png')]);
  return [o169, o23];
}

// ---------- verification ----------
function pngSize(f) { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }

async function contactSheet(browser, files) {
  const cells = files.map(f => `<figure><img src="${pathToFileURL(f).href}"><figcaption>${path.relative(OUT, f).replace(/\\/g, '/')}</figcaption></figure>`).join('');
  const hp = path.join(TMP, 'sheet.html');
  fs.writeFileSync(hp, `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#222;color:#ccc;font:12px monospace;display:flex;flex-wrap:wrap;gap:8px;padding:8px;width:1584px}
figure{margin:0;height:300px;display:flex;flex-direction:column;gap:2px}img{height:280px;width:auto;border:1px solid #555}figcaption{height:16px}</style>${cells}`);
  const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await pg.goto(pathToFileURL(hp).href); await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(OUT, 'contact-sheet.png'), fullPage: true }); await pg.close();
}

// ---------- main ----------
const main = async () => {
  if (!FFMPEG) log('WARN: no ffmpeg found - video will be raw Playwright webm (16:9 only, not trimmed)');
  const base = await startServer();
  log('server:', base);
  const browser = await chromium.launch();
  try {
    await runItch(browser, base);
    const v = await runVideo(browser, base);

    const cs = await runCoverSource(browser, base);
    const img = cs.file, f = cs.focus;
    const C = (n) => path.join(OUT, 'crazygames', n);
    await composeCover(browser, { img, W: 1920, H: 1080, zoom: 0.75, fx: f.x, fy: f.y, file: C('cover-1920x1080.png'), titleSize: 200, titleW: 0.5, align: 'left' });
    await composeCover(browser, { img, W: 800, H: 1200, zoom: 0.8, fx: f.x, fy: f.y, file: C('cover-800x1200.png'), titleSize: 150, titleW: 0.86, align: 'center' });
    await composeCover(browser, { img, W: 800, H: 800, zoom: 0.8, fx: f.x, fy: f.y, file: C('cover-800x800.png'), titleSize: 150, titleW: 0.86, align: 'center' });
    await composeCover(browser, { img, W: 630, H: 500, zoom: 0.6, fx: f.x, fy: f.y, file: path.join(OUT, 'itch', 'cover-630x500.png'), titleSize: 100, titleW: 0.86, align: 'center' });

    let vids = [];
    if (FFMPEG) vids = makeVideos(v);
    else { const o = path.join(OUT, 'crazygames', 'preview-raw-1920x1080.webm'); fs.copyFileSync(v.vpath, o); vids = [o]; }

    // verify
    const expect = {
      'itch/cover-630x500.png': [630, 500], 'itch/screenshot-1-menu.png': [1280, 720], 'itch/screenshot-2-gameplay.png': [1280, 720],
      'itch/screenshot-3-shot.png': [1280, 720], 'itch/screenshot-4-goal.png': [1280, 720],
      'crazygames/cover-1920x1080.png': [1920, 1080], 'crazygames/cover-800x1200.png': [800, 1200], 'crazygames/cover-800x800.png': [800, 800],
    };
    const sheet = [];
    for (const [rel, [w, h]] of Object.entries(expect)) {
      const p = path.join(OUT, rel);
      if (!fs.existsSync(p)) { log('MISSING', rel); continue; }
      const [aw, ah] = pngSize(p); const kb = (fs.statSync(p).size / 1024).toFixed(0);
      log(`${aw === w && ah === h ? 'OK     ' : 'BAD SIZE'} ${rel} ${aw}x${ah} ${kb} KB`); sheet.push(p);
    }
    for (const vp of vids) {
      const mb = (fs.statSync(vp).size / 1048576).toFixed(2);
      const d = probeDuration(vp);
      log(`${d >= 15 && d <= 20 && mb <= 50 ? 'OK     ' : 'CHECK  '} ${path.relative(OUT, vp).replace(/\\/g, '/')} ${d.toFixed(1)} s ${mb} MB (no audio track)`);
    }
    for (const n of ['first-frame-16x9.png', 'first-frame-2x3.png']) { const p = path.join(TMP, n); if (fs.existsSync(p)) sheet.push(p); }
    await contactSheet(browser, sheet);
  } finally {
    await browser.close();
    if (server) server.kill();
    fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n');
    if (!process.env.KEEP_TMP) { try { fs.rmSync(path.join(TMP, 'vid'), { recursive: true, force: true }); } catch {} }
  }
};
main().catch(e => { console.error(e); if (server) server.kill(); process.exit(1); });
