// itch.io screenshots rendered IN-ENGINE (1280x720, full-bleed), same seeded 3v3 bot sim + seed search as video.mjs.
// Run: node release/thumb/shots.mjs     env PORT (default 4170), SEEDS (default 40)
// Output: release/assets/itch/screenshot-{1-menu,2-gameplay,3-shot,4-goal}.png
// Moment rule (fixed, deterministic): window = video.mjs best window (action score), g = goal tick.
//   shot     = last shot release (puck speed>=250 toward opp goal, within 330 px of it) before g; frame = first tick
//              after release with puck z>2 (airborne), else release+8. Camera = midpoint puck/defending goalie.
//   goal     = tick g+GOAL_OFF (puck in net). Camera = midpoint puck/goalie. (The game's GOAL! jumbotron is a full-screen
//              private overlay that hides the net -> not drawn.)
//   gameplay = tick in [start+60, shotRelease-60] with a FREE puck moving >=120 px/s (pass/rebound), with puck >=40 px inside frame, maximising players in view (camera = centroid of players in view + puck); earliest wins ties.
//   menu     = real page screenshot of the main menu (guest, lobby chooser) at 1280x720.
import { chromium } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'release', 'assets', 'itch');
const PORT = String(+process.env.PORT || 4170);
const NSEEDS = +process.env.SEEDS || 40;
const GOAL_OFF = +process.env.GOAL_OFF || 12;
const SIM_TICKS = 90 * 60, WIN = Math.round(16.5 * 60), AFTER = 90;
const W = 1280, H = 720, SCALE = 4.4, VW = W / SCALE, VH = H / SCALE;
fs.mkdirSync(OUT, { recursive: true });
process.env.PORT = PORT; process.env.DB_PATH = path.join(os.tmpdir(), `fh-shots-${PORT}.db`);
const { __test } = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
const { makeBotBrain, hashSeed } = await import(pathToFileURL(path.join(ROOT, 'bot.js')).href);
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

function newMatch(seq) {
  const l = { id: 'SHT01', hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 3 }), members: new Map(), matchSeq: seq - 1 };
  for (let i = 0; i < 3; i++) {
    l.members.set('h' + i, makeMember({ name: '', number: [9, 17, 4][i] }, 'home'));
    l.members.set('a' + i, makeMember({ name: '', number: [88, 21, 7][i] }, 'away'));
  }
  lobbies.set(l.id, l); startMatch(l);
  const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  return m;
}
const step = (m) => { const r = Math.random; Math.random = () => { throw new Error('Math.random in sim'); }; try { stepMatch(m); } finally { Math.random = r; } };

// identical to video.mjs
function scoreWindow(rec, a, b) {
  let shots = 0, passes = 0, spd = 0;
  for (let t = a + 1; t <= b; t++) {
    const r = rec[t], q = rec[t - 1]; spd += r.sp;
    if (q.car && !r.car && r.sp >= 120) {
      const dirx = q.team === 'home' ? 1 : -1, gx = q.team === 'home' ? 990 : 90;
      if (r.sp >= 250 && r.vx * dirx > 0 && Math.abs(gx - r.x) <= 330) { shots++; continue; }
      for (let u = t + 1; u <= Math.min(b, t + 120); u++) if (rec[u].car) { if (rec[u].car !== q.car && rec[u].team === q.team) passes++; break; }
    }
  }
  const mean = spd / (b - a); return { score: 10 * shots + 4 * passes + mean / 10, shots, passes, mean };
}
function shotReleases(rec, a, b) {
  const out = [];
  for (let t = a + 1; t <= b; t++) {
    const r = rec[t], q = rec[t - 1];
    if (q.car && !r.car && r.sp >= 250) {
      const dirx = q.team === 'home' ? 1 : -1, gx = q.team === 'home' ? 990 : 90;
      if (r.vx * dirx > 0 && Math.abs(gx - r.x) <= 330) out.push({ t, dirx, gx });
    }
  }
  return out;
}
const clampC = (x, y) => [Math.min(Math.max(x, VW / 2), 1080 - VW / 2), Math.min(Math.max(y, VH / 2), 456 - VH / 2)];

let best = null;
for (let seed = 1; seed <= NSEEDS; seed++) {
  const m = newMatch(seed); const rec = [null], goalsAt = []; let prev = 0;
  for (let t = 1; t <= SIM_TICKS; t++) {
    step(m);
    const car = [...m.players.values()].find(p => p.hasPuck);
    const ents = m.world.entities;
    rec.push({ x: m.puck.x, y: m.puck.y, z: m.puck.z || 0, vx: m.puck.vx, sp: Math.hypot(m.puck.vx, m.puck.vy), car: car ? car.id : null, team: car ? car.team : null,
      dead: !!(m.setup || m.world._goalLock), pl: ents.filter(e => e.isPlayer).map(e => [e.x, e.y]), gl: ents.filter(e => e.isGoalie).map(e => [e.x, e.y]) });
    const sc = m.score.home + m.score.away; if (sc > prev) { prev = sc; goalsAt.push(t); }
  }
  for (const g of goalsAt) {
    const end = g + AFTER, start = end - WIN; if (start < 1 || end > SIM_TICKS) continue;
    let ok = true; for (let u = start; u < g; u++) if (rec[u].dead) { ok = false; break; } if (!ok) continue;
    const s = scoreWindow(rec, start, end);
    if (!best || s.score > best.s.score) best = { seed, g, start, end, s, rec };
  }
  lobbies.delete('SHT01');
}
if (!best) throw new Error('no goal window');
const { rec, g, start } = best;
const rels = shotReleases(rec, start, g).filter(r => r.t < g);
const rel = rels.length ? rels[rels.length - 1] : null;
if (!rel) throw new Error('no shot before goal');
let tShot = rel.t + 8; for (let t = rel.t; t < rel.t + 40; t++) if (rec[t].z > 2) { tShot = t; break; }
const tGoal = g + GOAL_OFF;
let tPlay = null, bestN = -1, playCam = null;
const MARG = 40 / SCALE;   // puck must be >=40 px inside the frame
const inView = (x, y, c, m) => Math.abs(x - c[0]) < VW / 2 - m && Math.abs(y - c[1]) < VH / 2 - m;
for (let t = start + 60; t <= rel.t - 60; t++) {
  // Volný puk v pohybu (přihrávka/odraz) — pod hokejkou nositele by nebyl vidět
  const r = rec[t]; if (r.car || r.dead || r.sp < 120) continue;
  const c0 = clampC(r.x, r.y);
  const grp = r.pl.filter(([x, y]) => inView(x, y, c0, 10));
  const c = clampC((grp.reduce((a, q) => a + q[0], r.x)) / (grp.length + 1), (grp.reduce((a, q) => a + q[1], r.y)) / (grp.length + 1));
  if (!inView(r.x, r.y, c, MARG)) continue;
  const n = r.pl.filter(([x, y]) => inView(x, y, c, 10)).length;
  if (n > bestN) { bestN = n; tPlay = t; playCam = c; }
}
if (tPlay == null) { tPlay = start + 60; playCam = clampC(rec[tPlay].x, rec[tPlay].y); }
const goalX = rel.gx;
const gl = (t, gx) => rec[t].gl.reduce((a, b) => Math.abs(b[0] - gx) < Math.abs(a[0] - gx) ? b : a);
const camOf = (t, gx) => { const r = rec[t], G = gl(t, gx); return clampC((r.x + G[0]) / 2, (r.y + G[1]) / 2); };
const picks = {
  gameplay: { t: tPlay, cam: playCam },
  shot: { t: tShot, cam: camOf(tShot, goalX) },
  goal: { t: tGoal, cam: camOf(tGoal, goalX) },
};
console.log(`RULE seed ${best.seed} window ${start}..${best.end} goal@${g} score ${best.s.score.toFixed(2)}; shot release@${rel.t} -> frame ${tShot}; goal frame ${tGoal}; gameplay frame ${tPlay} (${bestN} players in view)`);

// capture entity state at the picked ticks
const SKIP = new Set(['rng', 'brain', 'input', '_solids', 'world']);
const snapEnt = (e) => { const seen = new Set(); return JSON.stringify(e, (k, v) => { if (SKIP.has(k) || typeof v === 'function') return undefined; if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); } return v; }); };
const want = new Set(Object.values(picks).map(p => p.t)); const snaps = {};
const m2 = newMatch(best.seed);
for (let t = 1; t <= tGoal; t++) { step(m2); if (want.has(t)) snaps[t] = m2.world.entities.map(snapEnt); }
const kinds = m2.world.entities.map(e => e.isPlayer ? 'p' : e.isGoalie ? 'g' : e.isPuck ? 'k' : 'r');
const gid = m2.world.entities.map(e => e.isPlayer ? [e.id, e.team] : e.isGoalie ? [e.side || e.team || 'left', ''] : ['', '']);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${PORT}/api/season`);
  await page.setContent(`<style>html,body{margin:0;background:#07090f}</style><canvas id=c width=${W} height=${H}></canvas>`);
  const shots = await page.evaluate(async ([picks, snaps, kinds, gid, W, H, S]) => {
    let a = 20261030; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const base = 1.8e12; Date.now = () => base;
    const B = location.origin + '/js/';
    const { Player } = await import(B + 'entities/Player.js'), { Puck } = await import(B + 'entities/Puck.js'),
      { Goalie } = await import(B + 'entities/Goalie.js'), { Rink } = await import(B + 'entities/Rink.js');
    const inp = () => ({ dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aim: 0, aimDist: 100, keys: { Space: false }, lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false });
    const ents = kinds.map((k, i) => k === 'p' ? new Player(gid[i][0], gid[i][1], inp()) : k === 'g' ? new Goalie(gid[i][0]) : k === 'k' ? new Puck() : new Rink());
    const rink = ents[kinds.indexOf('r')], puck = ents[kinds.indexOf('k')];
    const cv = document.getElementById('c'), ctx = cv.getContext('2d'); const res = {};
    for (const [name, p] of Object.entries(picks)) {
      const cam = { scale: S, ox: W / 2 - p.cam[0] * S, oy: H / 2 - p.cam[1] * S };
      ents.forEach((e, i) => Object.assign(e, JSON.parse(snaps[p.t][i])));
      ctx.globalAlpha = 1; ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      rink.draw(ctx, cam);
      const solids = ents.filter((_, i) => kinds[i] === 'p' || kinds[i] === 'g').map(e => ({ ent: e, x: e.x, y: e.y, r: e.radius }));
      puck.draw(ctx, cam);
      ents.forEach((e, i) => { if (kinds[i] === 'p') { e._solids = solids.filter(s => s.ent !== e); e._isLocal = false; e.draw(ctx, cam); } });
      ents.forEach((e, i) => { if (kinds[i] === 'g') e.draw(ctx, cam); });
      res[name] = cv.toDataURL('image/png').slice(22);
    }
    return res;
  }, [picks, snaps, kinds, gid, W, H, SCALE]);
  const names = { gameplay: 'screenshot-2-gameplay.png', shot: 'screenshot-3-shot.png', goal: 'screenshot-4-goal.png' };
  for (const [k, f] of Object.entries(names)) fs.writeFileSync(path.join(OUT, f), Buffer.from(shots[k], 'base64'));
  await page.close();

  // menu: real page
  const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: 'no-preference' });
  await ctx2.addInitScript(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('fh_lang', 'en'); localStorage.setItem('hockey_name', 'OKEY'); localStorage.setItem('hockey_num', '9'); });
  const mp = await ctx2.newPage();
  await mp.goto(`http://localhost:${PORT}/`); await mp.waitForTimeout(1500);
  await mp.click('#splash-guest-btn'); await mp.waitForSelector('#vm-create-btn', { state: 'visible' }); await mp.waitForTimeout(1500);
  await mp.screenshot({ path: path.join(OUT, 'screenshot-1-menu.png') });
  await ctx2.close();
} finally { await browser.close(); }
const sz = (f) => { const b = fs.readFileSync(path.join(OUT, f)); return `${f} ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
for (const f of ['screenshot-1-menu.png', 'screenshot-2-gameplay.png', 'screenshot-3-shot.png', 'screenshot-4-goal.png']) console.log(sz(f));
process.exit(0);
