// Krátké klipy k devlogu (hover/klepnutí), vykreslené HERNÍM KÓDEM ze simulace botů — žádné nahrávání obrazovky.
// Deterministické: seedované zápasy 3v3 (Math.random v simulaci zakázán), událost vybraná pevným pravidlem,
// pevné hodiny a seedovaný Math.random při kreslení. Stejný kód hry = stejné klipy.
// Spuštění: node scripts/devlog-clips.mjs [jméno ...]    env SEEDS (výchozí 24), PORT (výchozí 4170)
// Výstup:   public/devlog/clips/<jméno>.mp4 (640×360, 30 fps, H.264, smyčka) + <jméno>.jpg (náhled = snímek události)
//
// PRAVIDLA VÝBĚRU (tick = 1/60 s; vyhrává nejvyšší skóre, při shodě nejnižší seed a nejdřívější tick):
//   pass  — puk opustí nosiče rychlostí ≥ 120 px/s a do 2 s ho převezme spoluhráč;   skóre = délka přihrávky
//   goal  — gól bez buly/přerušení 2,5 s před ním;                                     skóre = max. rychlost puku 1 s před gólem
//   save  — brankáři naskočí zákrok (_saveFlash 0 → >0) a do 1,5 s nepadne gól;       skóre = rychlost puku tick před zákrokem
//   down  — hráč spadne (_downT 0 → >0);                                               skóre = rychlost hráče 0,25 s před pádem
//   stop  — rychlost hráče bez puku klesne za 0,25 s z ≥ 140 px/s pod 25 %, bez zásahu; skóre = rychlost před stopem
//   carry — 3 s souvislé jízdy jednoho hráče s pukem;                                  skóre = součet změn směru (rad) × průměrná rychlost / 100
//   ring  — jako carry, ale druhý nejlepší seed; hráč vykreslen jako „tvůj" (ledový kruh + jmenovka)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'devlog', 'clips');
const TMP = path.join(os.tmpdir(), 'fh-devlog-clips');
const PORT = String(+process.env.PORT || 4170);
const NSEEDS = +process.env.SEEDS || 24;
const SIM_TICKS = 90 * 60, LEN = 180, FPS = 30, W = 640, H = 360;
fs.mkdirSync(OUT, { recursive: true });

process.env.PORT = PORT;
process.env.DB_PATH = path.join(os.tmpdir(), `fh-devlog-${PORT}.db`);
const { __test } = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
const { makeBotBrain, hashSeed } = await import(pathToFileURL(path.join(ROOT, 'public/js/bot.js')).href);
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

// klip: událost, kde v okně leží (pre ticků před ní), kamera (zoom = šířka záběru v px hřiště)
const CLIPS = {
  pass:  { pre: 50,  view: 250 },
  goal:  { pre: 120, view: 210 },
  save:  { pre: 100, view: 170 },
  down:  { pre: 60,  view: 150 },
  stop:  { pre: 80,  view: 150 },
  carry: { pre: 0,   view: 150 },
  ring:  { pre: 0,   view: 200, ring: true },
};
const only = process.argv.slice(2);

function newMatch(seq) {
  const l = { id: 'DLOG1', hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 3 }),
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
const step = (m) => { const r = Math.random; Math.random = () => { throw new Error('Math.random v simulaci'); };
  try { stepMatch(m); } finally { Math.random = r; } };

// ---------- 1) průchod seedů: kandidáti událostí ----------
const better = (a, b) => !b || a.score > b.score;   // striktně > : při shodě vyhrává dřívější (nižší seed, dřívější tick)
const best = {}; const carries = [];   // carries: nejlepší carry každého seedu (pro ring = druhý nejlepší)
for (let seed = 1; seed <= NSEEDS; seed++) {
  const m = newMatch(seed);
  const ents = m.world.entities;
  const pl = ents.filter(e => e.isPlayer), gk = ents.filter(e => e.isGoalie);
  const rec = [];
  let prevGoals = 0;
  for (let t = 0; t < SIM_TICKS; t++) {
    step(m);
    const car = pl.find(p => p.hasPuck);
    rec.push({
      px: m.puck.x, py: m.puck.y, sp: Math.hypot(m.puck.vx, m.puck.vy),
      car: car ? car.id : null, team: car ? car.team : null, dead: !!(m.setup || m.world._goalLock),
      goal: (m.score.home + m.score.away) > prevGoals,
      p: pl.map(p => [Math.hypot(p.vx, p.vy), p._downT || 0, (p._stagT || 0) + (p._knockT || 0), Math.atan2(p.vy, p.vx)]),
      g: gk.map(g => g._saveFlash || 0),
    });
    prevGoals = m.score.home + m.score.away;
  }
  lobbies.delete('DLOG1');
  const ok = (a, b) => a >= 0 && b <= SIM_TICKS;
  const live = (a, b) => { for (let u = Math.max(0, a); u < Math.min(b, SIM_TICKS); u++) if (rec[u].dead) return false; return true; };
  const goalIn = (a, b) => { for (let u = a; u < Math.min(b, SIM_TICKS); u++) if (rec[u].goal) return true; return false; };
  const put = (k, c) => { if (better(c, best[k])) best[k] = c; };
  let bestCarry = null;
  for (let t = 1; t < SIM_TICKS; t++) {
    const r = rec[t], q = rec[t - 1];
    // pass
    if (q.car && !r.car && r.sp >= 120) {
      for (let u = t + 1; u <= Math.min(SIM_TICKS - 1, t + 120); u++) if (rec[u].car) {
        if (rec[u].car !== q.car && rec[u].team === q.team) {
          const s = CLIPS.pass.pre, a = t - s;
          if (ok(a, a + LEN) && live(a, a + LEN)) put('pass', { seed, t, a, score: Math.hypot(rec[u].px - q.px, rec[u].py - q.py), focus: { kind: 'puck' } });
        }
        break;
      }
    }
    // goal
    if (r.goal) {
      const a = t - CLIPS.goal.pre;
      if (ok(a, a + LEN) && live(t - 150, t)) {
        let mx = 0; for (let u = t - 60; u < t; u++) mx = Math.max(mx, rec[u].sp);
        put('goal', { seed, t, a, score: mx, focus: { kind: 'puck' } });
      }
    }
    // save
    r.g.forEach((f, gi) => {
      if (f > 0 && q.g[gi] === 0) {
        const a = t - CLIPS.save.pre;
        if (ok(a, a + LEN) && live(a, t + 1) && !goalIn(t, t + 90)) put('save', { seed, t, a, score: q.sp, focus: { kind: 'goalie', i: gi } });
      }
    });
    // down + stop
    r.p.forEach((v, pi) => {
      if (v[1] > 0 && q.p[pi][1] === 0 && t >= 15) {
        const a = t - CLIPS.down.pre;
        if (ok(a, a + LEN) && live(a, t)) put('down', { seed, t, a, score: rec[t - 15].p[pi][0], focus: { kind: 'player', i: pi } });
      }
      if (t >= 15) {
        const b = rec[t - 15].p[pi];
        let hit = false; for (let u = t - 15; u <= t; u++) if (rec[u].p[pi][1] > 0 || rec[u].p[pi][2] > 0 || rec[u].car === pl[pi].id) hit = true;
        if (!hit && b[0] >= 140 && v[0] < 0.25 * b[0]) {
          const a = t - CLIPS.stop.pre;
          if (ok(a, a + LEN) && live(a, a + LEN)) put('stop', { seed, t, a, score: b[0], focus: { kind: 'player', i: pi } });
        }
      }
    });
  }
  // carry: okna LEN, kde jeden hráč drží puk celou dobu (posun po 30 ticích)
  for (let a = 0; a + LEN <= SIM_TICKS; a += 30) {
    const id = rec[a].car; if (!id) continue;
    let okc = !rec[a].dead; for (let u = a; u < a + LEN && okc; u++) if (rec[u].car !== id || rec[u].dead) okc = false;
    if (!okc) continue;
    const pi = pl.findIndex(p => p.id === id);
    let turn = 0, spd = 0;
    for (let u = a + 1; u < a + LEN; u++) {
      let d = rec[u].p[pi][3] - rec[u - 1].p[pi][3]; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (rec[u].p[pi][0] > 30) turn += Math.abs(d); spd += rec[u].p[pi][0];
    }
    const c = { seed, t: a, a, score: turn * (spd / LEN) / 100, focus: { kind: 'player', i: pi } };
    if (better(c, bestCarry)) bestCarry = c;
  }
  if (bestCarry) carries.push(bestCarry);
  console.log(`seed ${seed}: hotovo`);
}
carries.sort((x, y) => y.score - x.score || x.seed - y.seed);
if (carries[0]) best.carry = carries[0];
if (carries[1]) best.ring = carries[1];
for (const k of Object.keys(CLIPS)) {
  const b = best[k];
  console.log(b ? `${k}: seed ${b.seed} tick ${b.t} (okno ${b.a}..${b.a + LEN}) skóre ${b.score.toFixed(1)}` : `${k}: NENALEZENO`);
}

// ---------- 2) záznam okna: stavy entit + poloha ohniska ----------
const SKIP = new Set(['rng', 'brain', 'input', '_solids', 'world', '_others', '_puckView']);
function snapEnt(e) {
  const seen = new Set();
  return JSON.stringify(e, function (k, v) {
    if (SKIP.has(k) || typeof v === 'function') return undefined;
    if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); }
    return v;
  });
}
function capture(c) {
  const m = newMatch(c.seed);
  const ents = m.world.entities;
  const pl = ents.filter(e => e.isPlayer), gk = ents.filter(e => e.isGoalie);
  const F = c.focus.kind === 'puck' ? m.puck : c.focus.kind === 'goalie' ? gk[c.focus.i] : pl[c.focus.i];
  const focus = [], frames = [];
  for (let t = 0; t < c.a + LEN; t++) {
    step(m);
    if (t >= c.a) {
      focus.push([F.x, F.y, F.vx || 0, F.vy || 0]);
      if ((t - c.a) % 2 === 1) frames.push(ents.map(e => snapEnt(e)));
    }
  }
  const kinds = ents.map(e => e.isPlayer ? 'p' : e.isGoalie ? 'g' : e.isPuck ? 'k' : 'r');
  const gid = ents.map(e => e.isPlayer ? [e.id, e.team] : e.isGoalie ? [e.side || e.team || 'left', ''] : ['', '']);
  const fidx = ents.indexOf(F);
  lobbies.delete('DLOG1');
  return { focus, frames, kinds, gid, fidx, evFrame: Math.min(frames.length - 1, Math.floor((c.t - c.a) / 2)) };
}

function findFfmpeg() {
  const cands = [process.env.FFMPEG, 'ffmpeg'];
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0) cands.push(py.stdout.trim());
  for (const c of cands.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && /libx264/.test(r.stdout)) return c;
  }
  throw new Error('ffmpeg s libx264 nenalezen (pip install imageio-ffmpeg nebo env FFMPEG)');
}

// ---------- 3) kreslení herním kódem + kódování ----------
const FFMPEG = findFfmpeg();
const browser = await chromium.launch();
const report = {};
try {
  for (const [name, C] of Object.entries(CLIPS)) {
    if (only.length && !only.includes(name)) continue;
    const c = best[name]; if (!c) continue;
    const cap = capture(c);
    const dir = path.join(TMP, name);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://localhost:${PORT}/api/season`);
    await page.setContent(`<style>html,body{margin:0;background:#07090f}</style><canvas id=c width=${W} height=${H}></canvas>`);
    await page.evaluate(async ([cap, W, H, view, ring]) => {
      let fr = 0; const base = 1.8e12; Date.now = () => base + Math.round(fr * 1000 / 30);
      performance.now = () => Math.round(fr * 1000 / 30);
      let a = 20261114; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
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
      const players = ents.filter((_, i) => cap.kinds[i] === 'p'), goalies = ents.filter((_, i) => cap.kinds[i] === 'g');
      const ctx = document.getElementById('c').getContext('2d');
      // kamera: kriticky tlumená pružina (ω 5 rad/s, dt 1/60) na ohnisko + malý předstih podle rychlosti, drží se uvnitř hřiště
      const scale = W / view, vw = view, vh = H / scale, OM = 5, DT = 1 / 60, LEAD = 0.22;
      const cx0 = (x) => Math.min(Math.max(x, vw / 2), RINK.w - vw / 2), cy0 = (y) => Math.min(Math.max(y, vh / 2), RINK.h - vh / 2);
      const cams = []; let cx = cx0(cap.focus[0][0]), cy = cy0(cap.focus[0][1]), vx = 0, vy = 0;
      for (const [fx, fy, fvx, fvy] of cap.focus) {
        const tx = cx0(fx + Math.max(-vw * .15, Math.min(vw * .15, fvx * LEAD))), ty = cy0(fy + Math.max(-vh * .12, Math.min(vh * .12, fvy * LEAD)));
        vx += (OM * OM * (tx - cx) - 2 * OM * vx) * DT; vy += (OM * OM * (ty - cy) - 2 * OM * vy) * DT;
        cx += vx * DT; cy += vy * DT; cams.push([cx0(cx), cy0(cy)]);
      }
      window.__render = (g) => {
        fr = g;
        const [ccx, ccy] = cams[Math.min(cams.length - 1, 2 * g + 1)];
        const cam = { scale, ox: W / 2 - ccx * scale, oy: H / 2 - ccy * scale };
        ents.forEach((e, i) => Object.assign(e, JSON.parse(cap.frames[g][i])));
        ctx.globalAlpha = 1; ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
        rink.draw(ctx, cam);
        const solids = [...players, ...goalies].map(e => ({ ent: e, x: e.x, y: e.y, r: e.radius }));
        puck.draw(ctx, cam);
        for (const e of players) {
          e._solids = solids.filter(s => s.ent !== e); e._others = players; e._puckView = puck;
          e._isLocal = ring && ents.indexOf(e) === cap.fidx;
          e.draw(ctx, cam);
        }
        for (const gk of goalies) gk.draw(ctx, cam);
        rink.drawFront?.(ctx, cam, puck, goalies);
      };
    }, [cap, W, H, C.view, !!C.ring]);
    const pad = (n) => String(n).padStart(4, '0');
    for (let g = 0; g < cap.frames.length; g++) {
      const png = await page.evaluate((g) => { window.__render(g); return document.getElementById('c').toDataURL('image/png').slice(22); }, g);
      fs.writeFileSync(path.join(dir, `f${pad(g)}.png`), Buffer.from(png, 'base64'));
    }
    await page.close();
    if (errs.length) throw new Error(`${name}: chyba při kreslení: ${errs[0]}`);
    const mp4 = path.join(OUT, name + '.mp4'), jpg = path.join(OUT, name + '.jpg');
    let r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-threads', '1', mp4], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
    r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, `f${pad(cap.evFrame)}.png`), '-q:v', '4', jpg], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg jpg: ' + r.stderr);
    report[name] = { seed: c.seed, tick: c.t, kb: Math.round(fs.statSync(mp4).size / 1024), frames: cap.frames.length };
    console.log(`${name}.mp4: ${cap.frames.length} snímků, ${report[name].kb} kB`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report));
process.exit(0);
