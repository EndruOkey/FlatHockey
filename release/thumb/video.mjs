// CrazyGames preview videos rendered IN-ENGINE (no screen recording, no black bars).
// Deterministic: server stepMatch with bot inputs (3v3, rules off) -> pick seed+window by a fixed action score
// -> replay that seed, capture entity state -> draw with the game's own draw code at 30 fps -> ffmpeg (H.264).
// Run: node release/thumb/video.mjs [16x9|2x3]      (default: both)  env PORT (default 4160), SEEDS (default 40)
// Output: release/assets/crazygames/preview-16x9-1920x1080.mp4, preview-2x3-1080x1620.mp4
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'release', 'assets', 'crazygames');
const COVERS = path.join(ROOT, 'release', 'thumb', 'out');
const TMP = path.join(os.tmpdir(), 'fh-video2');
const PORT = String(+process.env.PORT || 4160);
const NSEEDS = +process.env.SEEDS || 40;
const SIM_TICKS = 90 * 60;                // up to 90 s per seed
const GAME_S = 16.5, AFTER_GOAL_S = 1.5, HOLD_S = 1.0, XF_S = 0.4, FPS = 30;
const WIN = Math.round(GAME_S * 60), AFTER = Math.round(AFTER_GOAL_S * 60);
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

process.env.PORT = PORT;
process.env.DB_PATH = path.join(os.tmpdir(), `fh-video-${PORT}.db`);
const { __test } = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
const { botThink, makeBotBrain, hashSeed } = await import(pathToFileURL(path.join(ROOT, 'bot.js')).href);
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

// ---------- simulation ----------
function newMatch(seq) {
  const l = { id: 'VID01', hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 3 }),
              members: new Map(), matchSeq: seq - 1 };
  for (let i = 0; i < 3; i++) {
    l.members.set('h' + i, makeMember({ name: '', number: [9, 17, 4][i] }, 'home'));
    l.members.set('a' + i, makeMember({ name: '', number: [88, 21, 7][i] }, 'away'));
  }
  lobbies.set(l.id, l);
  startMatch(l);
  const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  return m;
}
const stepNoRandom = (m) => { const r = Math.random; Math.random = () => { throw new Error('Math.random in sim'); };
  try { stepMatch(m); } finally { Math.random = r; } };

// Action score (fixed rule) of a window of WIN ticks that ends AFTER ticks after a goal:
//   score = 10 * shots + 4 * passes + mean puck speed (px/s) / 10
//   release = a carrier lets go of the puck (hasPuck true -> none) with puck speed >= 120 px/s
//   shot    = release with speed >= 250 toward the opponent goal (home -> +x, away -> -x), puck within 330 px of it
//   pass    = other release followed within 2 s by a different player of the SAME team holding the puck
// Windows containing a frozen faceoff / celebration before the goal are rejected. Strict > : earliest seed/goal wins ties.
function scoreWindow(rec, a, b) {
  let shots = 0, passes = 0, spd = 0;
  for (let t = a + 1; t <= b; t++) {
    const r = rec[t], q = rec[t - 1];
    spd += r.sp;
    if (q.car && !r.car && r.sp >= 120) {
      const dirx = q.team === 'home' ? 1 : -1, gx = q.team === 'home' ? 990 : 90;
      if (r.sp >= 250 && r.vx * dirx > 0 && Math.abs(gx - r.x) <= 330) { shots++; continue; }
      for (let u = t + 1; u <= Math.min(b, t + 120); u++) if (rec[u].car) { if (rec[u].car !== q.car && rec[u].team === q.team) passes++; break; }
    }
  }
  const mean = spd / (b - a);
  return { score: 10 * shots + 4 * passes + mean / 10, shots, passes, mean };
}

function scan() {
  let best = null, ncand = 0;
  for (let seed = 1; seed <= NSEEDS; seed++) {
    const m = newMatch(seed);
    const rec = [null], goalsAt = []; let prevScore = 0;
    for (let t = 1; t <= SIM_TICKS; t++) {
      stepNoRandom(m);
      const car = [...m.players.values()].find(p => p.hasPuck);
      rec.push({ x: m.puck.x, vx: m.puck.vx, sp: Math.hypot(m.puck.vx, m.puck.vy), car: car ? car.id : null, team: car ? car.team : null,
                 dead: !!(m.setup || m.world._goalLock) });
      const sc = m.score.home + m.score.away;
      if (sc > prevScore) { prevScore = sc; goalsAt.push(t); }
    }
    let n = 0;
    for (const g of goalsAt) {
      const end = g + AFTER, start = end - WIN;
      if (start < 1 || end > SIM_TICKS) continue;
      let ok = true; for (let u = start; u < g; u++) if (rec[u].dead) { ok = false; break; }
      if (!ok) continue;
      const s = scoreWindow(rec, start, end); n++; ncand++;
      if (!best || s.score > best.s.score) best = { seed, goalTick: g, start, end, s };
    }
    lobbies.delete('VID01');
    console.log(`seed ${seed}: goals ${goalsAt.length} (ticks ${goalsAt.join(',') || '-'}), valid windows ${n}`);
  }
  return { best, ncand };
}

// state capture of an entity: own enumerable props, no rng/brain/input/functions/circular refs
const SKIP = new Set(['rng', 'brain', 'input', '_solids', 'world']);
function snapEnt(e) {
  const seen = new Set();
  return JSON.stringify(e, function (k, v) {
    if (SKIP.has(k) || typeof v === 'function') return undefined;
    if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); }
    return v;
  });
}
function capture(seed, start, end) {
  const m = newMatch(seed);
  const ticks = [];   // per tick: puck x,y,vx,vy
  const frames = [];  // per frame (every 2nd tick): entity states
  for (let t = 1; t <= end; t++) {
    stepNoRandom(m);
    if (t > start) {
      ticks.push([m.puck.x, m.puck.y, m.puck.vx, m.puck.vy]);
      if ((t - start) % 2 === 0) frames.push(m.world.entities.map(e => snapEnt(e)));
    }
  }
  const kinds = m.world.entities.map(e => e.isPlayer ? 'p' : e.isGoalie ? 'g' : e.isPuck ? 'k' : 'r');
  const gid = m.world.entities.map(e => e.isPlayer ? [e.id, e.team] : e.isGoalie ? [e.side || e.team || 'left', ''] : ['', '']);
  lobbies.delete('VID01');
  return { ticks, frames, kinds, gid, score: { ...m.score } };
}

// ---------- ffmpeg ----------
function findFfmpeg() {
  const cands = [process.env.FFMPEG, 'ffmpeg'];
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0) cands.push(py.stdout.trim());
  for (const c of cands.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && /libx264/.test(r.stdout)) return c;
  }
  throw new Error('ffmpeg with libx264 not found (pip install imageio-ffmpeg or set FFMPEG)');
}

// ---------- main ----------
const t0 = Date.now();
const { best, ncand } = scan();
if (!best) throw new Error('no goal window found');
console.log(`CHOSEN seed ${best.seed} goal@tick ${best.goalTick} window ticks ${best.start}..${best.end} (${(best.start / 60).toFixed(2)}s..${(best.end / 60).toFixed(2)}s) ` +
  `score ${best.s.score.toFixed(2)} = 10*${best.s.shots} shots + 4*${best.s.passes} passes + ${best.s.mean.toFixed(1)}/10 mean puck px/s; ${ncand} candidate windows`);
const cap = capture(best.seed, best.start, best.end);
console.log(`captured ${cap.frames.length} frames, ${(cap.frames.reduce((a, f) => a + f.reduce((b, s) => b + s.length, 0), 0) / 1048576).toFixed(1)} MB state, final score ${JSON.stringify(cap.score)}`);

const FFMPEG = findFfmpeg();
const FORMATS = {
  '16x9': { W: 1920, H: 1080, scale: 4.2, out: 'preview-16x9-1920x1080.mp4' },
  '2x3':  { W: 1080, H: 1620, scale: 4.4, out: 'preview-2x3-1080x1620.mp4' },
};
const only = process.argv[2];
const coverOf = (W, H) => {
  const p = path.join(COVERS, `ice-${W}x${H}.png`);
  if (!fs.existsSync(p)) {
    console.log('rendering cover via thumbs.mjs ice');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'release', 'thumb', 'thumbs.mjs'), 'ice'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(+PORT + 1) } });
    if (r.status !== 0) throw new Error('thumbs.mjs failed');
  }
  return p;
};

const browser = await chromium.launch();
try {
  for (const [name, F] of Object.entries(FORMATS)) {
    if (only && only !== name) continue;
    const { W, H } = F;
    const dir = path.join(TMP, name);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const cover = coverOf(W, H);
    const nHold = Math.round(HOLD_S * FPS), nXf = Math.round(XF_S * FPS), nGame = Math.round(GAME_S * FPS);
    const total = nHold + nGame;
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    await page.goto(`http://localhost:${PORT}/api/season`);
    await page.setContent(`<style>html,body{margin:0;background:#07090f}</style><canvas id=c width=${W} height=${H}></canvas>`);
    await page.evaluate(async ([coverB64, cap, W, H, scale]) => {
      // deterministic page: fixed clock and seeded Math.random (particles / pulses in the draw code)
      let fr = 0; const base = 1.8e12; Date.now = () => base + Math.round(fr * 1000 / 30);
      let a = 20261030; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const B = location.origin + '/js/';
      const { Player } = await import(B + 'entities/Player.js');
      const { Puck }   = await import(B + 'entities/Puck.js');
      const { Goalie } = await import(B + 'entities/Goalie.js');
      const { Rink }   = await import(B + 'entities/Rink.js');
      const { RINK }   = await import(B + 'constants.js');
      const inp = () => ({ dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aim: 0, aimDist: 100, keys: { Space: false },
        lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false });
      const ents = cap.kinds.map((k, i) => k === 'p' ? new Player(cap.gid[i][0], cap.gid[i][1], inp())
        : k === 'g' ? new Goalie(cap.gid[i][0]) : k === 'k' ? new Puck() : new Rink());
      const rink = ents[cap.kinds.indexOf('r')], puck = ents[cap.kinds.indexOf('k')];
      const img = new Image(); img.src = 'data:image/png;base64,' + coverB64; await img.decode();
      const ctx = document.getElementById('c').getContext('2d');
      // camera: critically damped spring (omega 4.2 rad/s, dt 1/60) on puck + velocity lead, target clamped so the view stays inside the rink
      const vw = W / scale, vh = H / scale, OM = 4.2, DT = 1 / 60, LEAD = 0.30;
      const clampX = (x) => Math.min(Math.max(x, vw / 2), RINK.w - vw / 2), clampY = (y) => Math.min(Math.max(y, vh / 2), RINK.h - vh / 2);
      const cams = []; let cx = clampX(cap.ticks[0][0]), cy = clampY(cap.ticks[0][1]), vx = 0, vy = 0;
      let lvx = cap.ticks[0][2], lvy = cap.ticks[0][3];
      for (const [px, py, pvx, pvy] of cap.ticks) {
        lvx += (pvx - lvx) * 0.08; lvy += (pvy - lvy) * 0.08;
        const lx = Math.max(-vw * 0.2, Math.min(vw * 0.2, lvx * LEAD)), ly = Math.max(-vh * 0.15, Math.min(vh * 0.15, lvy * LEAD));
        const tx = clampX(px + lx), ty = clampY(py + ly);
        vx += (OM * OM * (tx - cx) - 2 * OM * vx) * DT; vy += (OM * OM * (ty - cy) - 2 * OM * vy) * DT;
        cx += vx * DT; cy += vy * DT;
        cams.push([clampX(cx), clampY(cy)]);
      }
      window.__renderGame = (g) => {                 // frame g shows tick 2*(g+1) of the window
        fr = g;
        const [ccx, ccy] = cams[Math.min(cams.length - 1, 2 * g + 1)];
        const cam = { scale, ox: W / 2 - ccx * scale, oy: H / 2 - ccy * scale };
        ents.forEach((e, i) => Object.assign(e, JSON.parse(cap.frames[g][i])));
        ctx.globalAlpha = 1; ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
        rink.draw(ctx, cam);
        const solids = ents.filter((_, i) => cap.kinds[i] === 'p' || cap.kinds[i] === 'g').map(e => ({ ent: e, x: e.x, y: e.y, r: e.radius }));
        puck.draw(ctx, cam);
        ents.forEach((e, i) => { if (cap.kinds[i] === 'p') { e._solids = solids.filter(s => s.ent !== e); e._isLocal = false; e.draw(ctx, cam); } });
        ents.forEach((e, i) => { if (cap.kinds[i] === 'g') e.draw(ctx, cam); });
      };
      window.__cover = (alpha) => { ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0, W, H); ctx.globalAlpha = 1; };
    }, [fs.readFileSync(cover).toString('base64'), cap, W, H, F.scale]);

    const pad = (n) => String(n).padStart(5, '0');
    for (let f = 0; f < total; f++) {
      if (f < nHold) { fs.copyFileSync(cover, path.join(dir, `f${pad(f)}.png`)); continue; }
      const g = f - nHold;                                  // game frame index, real time (no slow-mo / fast-forward)
      const a = g < nXf ? 1 - (g + 1) / nXf : 0;            // cover opacity over the game, fading out (never to black)
      const png = await page.evaluate(([g, a]) => { window.__renderGame(g); if (a > 0) window.__cover(a);
        return document.getElementById('c').toDataURL('image/png').slice(22); }, [g, a]);
      fs.writeFileSync(path.join(dir, `f${pad(f)}.png`), Buffer.from(png, 'base64'));
    }
    await page.close();
    const outp = path.join(OUT, F.out);
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', '-movflags', '+faststart', outp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
    console.log(`${F.out}: ${total} frames (${(total / FPS).toFixed(1)} s), ${(fs.statSync(outp).size / 1048576).toFixed(2)} MB, frames in ${dir}`);
  }
} finally {
  await browser.close();
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);
