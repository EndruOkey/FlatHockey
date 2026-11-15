// Krátké klipy k devlogu (hover/klepnutí), vykreslené HERNÍM RENDEREREM — stejnou cestou jako živé pozadí menu
// (menu-bg.js): offline zápas botů (NetGame attract + match-core) běží přímo ve stránce, každý snímek = 2 ticky
// simulace + game._draw s hodinami cam.dt = 1/30, cam.t = snímky/30. Animace (krok, brusle, náklon) tak navazuje
// snímek po snímku jako ve hře. Před oknem klipu se 2 s kreslí naprázdno, aby se animace rozběhla.
// Deterministické: pevný seed zápasu, pevná pravidla výběru, žádný reálný čas ve scéně. Stejný kód hry = stejné klipy.
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
const SIM_TICKS = 90 * 60, LEN = 180, PREROLL = 120, FPS = 30, W = 640, H = 360;
fs.mkdirSync(OUT, { recursive: true });

// klip: kolik ticků před událostí okno začíná, šířka záběru v px hřiště, kamera na „tvého" hráče
const CLIPS = {
  pass:  { pre: 50,  view: 250 },
  goal:  { pre: 120, view: 210 },
  save:  { pre: 100, view: 200 },
  down:  { pre: 60,  view: 190 },
  stop:  { pre: 80,  view: 190 },
  carry: { pre: 0,   view: 190 },
  ring:  { pre: 0,   view: 220, ring: true },
};
const only = process.argv.slice(2);

// server jen kvůli statickým souborům (public/js) na stejném originu
process.env.PORT = PORT;
process.env.DB_PATH = path.join(os.tmpdir(), `fh-devlog-${PORT}.db`);
await import(pathToFileURL(path.join(ROOT, 'server.js')).href);

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

// ---------- kód běžící ve stránce ----------
async function pageSetup(W, H) {
  const B = location.origin + '/js/';
  const { NetGame } = await import(B + 'game.js');
  const { SFX } = await import(B + 'sound.js');
  const { stepMatch } = await import(B + 'match-core.js');
  const { RINK } = await import(B + 'constants.js');
  for (const k of Object.keys(SFX)) if (typeof SFX[k] === 'function') SFX[k] = () => {};   // ticho
  const canvas = document.getElementById('c'); canvas.cssW = W; canvas.cssH = H;
  const ctx = canvas.getContext('2d');
  const build = (seed) => new NetGame(canvas, null, null, {
    offline: true, attract: true, seed, botFill: 3, periods: 1, minutes: 60, rules: false, difficulty: 'casual',
    teams: { home: { name: 'HOME', color: '#3a9fff', style: 'solid' }, away: { name: 'AWAY', color: '#ff4455', style: 'solid' } },
  });
  const plist = (m) => [...m.players.values()].sort((a, b) => (a.id > b.id ? 1 : -1));
  const goalies = (m) => [m.goalieL, m.goalieR];
  const dead = (m) => !!(m.setup || m.world?._goalLock);

  // průchod jednoho seedu → kandidáti událostí (stejná pravidla jako v hlavičce)
  window.__scan = (seed, SIM_TICKS, LEN, PRE) => {
    const g = build(seed), m = g.match, pl = plist(m), gk = goalies(m);
    const rec = []; let prev = 0;
    for (let t = 0; t < SIM_TICKS; t++) {
      stepMatch(m);
      const car = pl.find(p => p.hasPuck), sc = m.score.home + m.score.away;
      rec.push({ px: m.puck.x, py: m.puck.y, sp: Math.hypot(m.puck.vx, m.puck.vy), car: car ? car.id : null, team: car ? car.team : null,
        dead: dead(m), goal: sc > prev,
        p: pl.map(p => [Math.hypot(p.vx, p.vy), p._downT || 0, (p._stagT || 0) + (p._knockT || 0), Math.atan2(p.vy, p.vx)]),
        g: gk.map(x => x._saveFlash || 0) });
      prev = sc;
      if (m.ended) break;
    }
    const N = rec.length, out = {};
    const ok = (a, b) => a >= 0 && b <= N;
    const live = (a, b) => { for (let u = Math.max(0, a); u < Math.min(b, N); u++) if (rec[u].dead) return false; return true; };
    const goalIn = (a, b) => { for (let u = a; u < Math.min(b, N); u++) if (rec[u].goal) return true; return false; };
    const put = (k, c) => { if (!out[k] || c.score > out[k].score) out[k] = c; };
    for (let t = 1; t < N; t++) {
      const r = rec[t], q = rec[t - 1];
      if (q.car && !r.car && r.sp >= 120) for (let u = t + 1; u <= Math.min(N - 1, t + 120); u++) if (rec[u].car) {
        if (rec[u].car !== q.car && rec[u].team === q.team) { const a = t - PRE.pass;
          if (ok(a, a + LEN) && live(a, a + LEN)) put('pass', { seed, t, a, score: Math.hypot(rec[u].px - q.px, rec[u].py - q.py), focus: { kind: 'puck' } }); }
        break;
      }
      if (r.goal) { const a = t - PRE.goal;
        if (ok(a, a + LEN) && live(t - 150, t)) { let mx = 0; for (let u = t - 60; u < t; u++) mx = Math.max(mx, rec[u].sp);
          put('goal', { seed, t, a, score: mx, focus: { kind: 'puck' } }); } }
      r.g.forEach((f, gi) => { if (f > 0 && q.g[gi] === 0) { const a = t - PRE.save;
        if (ok(a, a + LEN) && live(a, t + 1) && !goalIn(t, t + 90)) put('save', { seed, t, a, score: q.sp, focus: { kind: 'goalie', i: gi } }); } });
      r.p.forEach((v, pi) => {
        if (v[1] > 0 && q.p[pi][1] === 0 && t >= 15) { const a = t - PRE.down;
          if (ok(a, a + LEN) && live(a, t)) put('down', { seed, t, a, score: rec[t - 15].p[pi][0], focus: { kind: 'player', id: pl[pi].id } }); }
        if (t >= 15) { const b = rec[t - 15].p[pi]; let hit = false;
          for (let u = t - 15; u <= t; u++) if (rec[u].p[pi][1] > 0 || rec[u].p[pi][2] > 0 || rec[u].car === pl[pi].id) hit = true;
          if (!hit && b[0] >= 140 && v[0] < 0.25 * b[0]) { const a = t - PRE.stop;
            if (ok(a, a + LEN) && live(a, a + LEN)) put('stop', { seed, t, a, score: b[0], focus: { kind: 'player', id: pl[pi].id } }); } }
      });
    }
    for (let a = 0; a + LEN <= N; a += 30) {
      const id = rec[a].car; if (!id) continue;
      let okc = !rec[a].dead; for (let u = a; u < a + LEN && okc; u++) if (rec[u].car !== id || rec[u].dead) okc = false;
      if (!okc) continue;
      const pi = pl.findIndex(p => p.id === id); let turn = 0, spd = 0;
      for (let u = a + 1; u < a + LEN; u++) { let d = rec[u].p[pi][3] - rec[u - 1].p[pi][3]; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (rec[u].p[pi][0] > 30) turn += Math.abs(d); spd += rec[u].p[pi][0]; }
      put('carry', { seed, t: a, a, score: turn * (spd / LEN) / 100, focus: { kind: 'player', id } });
    }
    return out;
  };

  // vykreslení okna: 1) průchod pro dráhu ohniska → kamera, 2) nový zápas se stejným seedem: předjezd + snímky
  window.__clip = (c, LEN, PREROLL, view, ring) => {
    const focusOf = (m) => c.focus.kind === 'puck' ? m.puck : c.focus.kind === 'goalie' ? goalies(m)[c.focus.i] : m.players.get(c.focus.id);
    let g = build(c.seed), m = g.match;
    const fpos = [];
    for (let t = 0; t < c.a + LEN; t++) { stepMatch(m); if (t >= c.a) { const F = focusOf(m); fpos.push([F.x, F.y, F.vx || 0, F.vy || 0]); } }
    const scale = W / view, vw = view, vh = H / scale, OM = 5, DT = 1 / 60, LEAD = 0.12;
    const cx0 = (x) => Math.min(Math.max(x, vw / 2), RINK.w - vw / 2), cy0 = (y) => Math.min(Math.max(y, vh / 2), RINK.h - vh / 2);
    const cams = []; let cx = cx0(fpos[0][0]), cy = cy0(fpos[0][1]), vx = 0, vy = 0;
    for (const [fx, fy, fvx, fvy] of fpos) {
      const tx = cx0(fx + Math.max(-vw * .08, Math.min(vw * .08, fvx * LEAD))), ty = cy0(fy + Math.max(-vh * .08, Math.min(vh * .08, fvy * LEAD)));
      vx += (OM * OM * (tx - cx) - 2 * OM * vx) * DT; vy += (OM * OM * (ty - cy) - 2 * OM * vy) * DT;
      cx += vx * DT; cy += vy * DT; cams.push([cx0(cx), cy0(cy)]);
    }
    g = build(c.seed); m = g.match;
    if (ring) for (const [id, e] of g.players) e.isMe = id === c.focus.id;
    const start = Math.max(0, c.a - PREROLL);
    for (let t = 0; t < start; t++) stepMatch(m);
    let frames = 0, t = start;
    window.__frame = () => {           // 2 ticky + kresba; vrací PNG jen uvnitř okna klipu
      stepMatch(m); stepMatch(m); t += 2; frames++;
      if (m._fx) m._fx.length = 0;
      const k = t - c.a;              // tick v okně (1..LEN)
      const [ccx, ccy] = k >= 1 ? cams[Math.min(cams.length - 1, k - 1)] : cams[0];
      const cam = { scale, ox: W / 2 - ccx * scale, oy: H / 2 - ccy * scale, dt: 1 / 30, t: frames / 30 };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      g._draw(ctx, cam);
      return k >= 1 ? canvas.toDataURL('image/png').slice(22) : null;
    };
    return Math.ceil((c.a + LEN - start) / 2);
  };
}

// ---------- hlavní běh ----------
const FFMPEG = findFfmpeg();
const browser = await chromium.launch();
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/api/season`);
  await page.setContent(`<style>html,body{margin:0;background:#07090f}</style><canvas id=c width=${W} height=${H}></canvas>`);
  await page.evaluate(`(${pageSetup.toString()})(${W}, ${H})`);
  const PRE = Object.fromEntries(Object.entries(CLIPS).map(([k, v]) => [k, v.pre]));
  const best = {}; const carries = [];
  for (let seed = 1; seed <= NSEEDS; seed++) {
    const out = await page.evaluate(([s, n, l, p]) => window.__scan(s, n, l, p), [seed, SIM_TICKS, LEN, PRE]);
    for (const [k, c] of Object.entries(out)) {
      if (k === 'carry') carries.push(c);
      else if (!best[k] || c.score > best[k].score) best[k] = c;
    }
    process.stdout.write(`seed ${seed} `);
  }
  console.log();
  carries.sort((x, y) => y.score - x.score || x.seed - y.seed);
  if (carries[0]) best.carry = carries[0];
  if (carries[1]) best.ring = { ...carries[1] };
  for (const k of Object.keys(CLIPS)) {
    const b = best[k];
    console.log(b ? `${k}: seed ${b.seed} tick ${b.t} (okno ${b.a}..${b.a + LEN}) skóre ${b.score.toFixed(1)}` : `${k}: NENALEZENO`);
  }
  for (const [name, C] of Object.entries(CLIPS)) {
    if (only.length && !only.includes(name)) continue;
    const c = best[name]; if (!c) continue;
    const dir = path.join(TMP, name);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const total = await page.evaluate(([c, l, p, v, r]) => window.__clip(c, l, p, v, r), [c, LEN, PREROLL, C.view, !!C.ring]);
    let n = 0;
    for (let i = 0; i < total; i++) {
      const png = await page.evaluate(() => window.__frame());
      if (png) fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
    }
    if (errs.length) throw new Error(`${name}: chyba ve stránce: ${errs[0]}`);
    const evFrame = Math.min(n - 1, Math.floor((c.t - c.a) / 2));
    const mp4 = path.join(OUT, name + '.mp4'), jpg = path.join(OUT, name + '.jpg');
    let r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-threads', '1', mp4], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
    r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, `f${String(evFrame).padStart(4, '0')}.png`), '-q:v', '4', jpg], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('ffmpeg jpg: ' + r.stderr);
    report[name] = { seed: c.seed, tick: c.t, frames: n, kb: Math.round(fs.statSync(mp4).size / 1024) };
    console.log(`${name}.mp4: ${n} snímků, ${report[name].kb} kB`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report));
process.exit(0);
