// ŽIVÉ POZADÍ MENU (2026-11-13): za menu hrají boti 3v3 skutečný offline zápas (match-core) a kreslí ho
// TENTÝŽ renderer jako hra (NetGame._draw → Rink, Player, Goalie, branka) → vzhled se aktualizuje sám s hrou.
// Deterministicky: pevný seed, každý vykreslený snímek = přesně 2 ticky simulace (60 Hz sim / 30 fps kresba),
// hodiny kresby z počtu snímků (cam.t), žádný Math.random ani reálný čas ve scéně.
// Výkon: max 30 fps, nižší rozlišení (blur je stejně přes CSS), stop při skryté záložce a ve hře.
// Ztlumení řeší CSS závoj (.scene3::after v ui3.css) + poloviční rozlišení — nikdy ctx.filter ani CSS filter/backdrop-filter
// nad živým plátnem (měřeno headless 1440×900: CSS blur + backdrop-filter tlačítek = 10 fps celé stránky, bez nich 58).
import { NetGame } from './game.js';
import { SFX } from './sound.js';
import { stepMatch } from './match-core.js';
import { RINK } from './constants.js';

const SEED = 20261113;          // pevný seed scény: stejný seed = stejný zápas snímek po snímku
const FPS = 30, TICKS_PER_FRAME = 2;
const RES = 0.5;               // backing store = 50 % CSS px: zvětšení v prohlížeči = měkká scéna (lehký „blur" zdarma, 1/4 pixelů)
const RESTART_TICKS = 60 * 60 * 4;   // po 4 min scény znovu od buly (stejný seed) — zápas nikdy „neskončí" za menu

export function initMenuBg(host) {
  if (!host) return { start() {}, stop() {} };
  const canvas = document.createElement('canvas');
  canvas.className = 'scene3-live';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const stat = { frames: 0, ticks: 0, running: false, drawMs: 0, drawMax: 0, stepMs: 0, seed: SEED, marks: {} };
  globalThis.__fhMenuBg = stat;   // měřicí háček (scripts/menu_bg_shots.mjs)

  let game = null, raf = null, active = false, lastT = 0;
  const noop = () => {};
  const sfxKeys = Object.keys(SFX).filter(k => typeof SFX[k] === 'function');

  function build() {
    game = new NetGame(canvas, null, null, {
      offline: true, attract: true, seed: SEED, botFill: 3, periods: 1, minutes: 60, rules: false, difficulty: 'casual',
      teams: { home: { name: 'HOME', color: '#3a9fff', style: 'solid' }, away: { name: 'AWAY', color: '#ff4455', style: 'solid' } },
    });
    stat.frames = 0; stat.ticks = 0; stat.marks = {};
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || host.clientWidth), h = Math.max(1, canvas.clientHeight || host.clientHeight);
    const bw = Math.round(w * RES), bh = Math.round(h * RES);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    canvas.cssW = w; canvas.cssH = h;
  }

  // Pevná kamera (žádný pohyb): celé kluziště vidět, obě branky.
  function camera() {
    const W = canvas.cssW, H = canvas.cssH, pad = 24;
    const scale = Math.min((W - pad * 2) / RINK.w, (H - pad * 2) / RINK.h);
    return { scale, ox: (W - RINK.w * scale) / 2, oy: (H - RINK.h * scale) / 2 };
  }

  function frame() {
    const m = game.match, s0 = performance.now();
    for (let i = 0; i < TICKS_PER_FRAME; i++) { stepMatch(m); stat.ticks++; }
    stat.stepMs = stat.stepMs ? stat.stepMs * 0.9 + (performance.now() - s0) * 0.1 : performance.now() - s0;
    // otisk scény v pevných ticích (test determinismu: stejný seed → stejný otisk)
    if (stat.ticks === 120 || stat.ticks === 360) stat.marks[stat.ticks] = [...m.players.values(), m.puck]
      .map(o => `${o.x.toFixed(3)},${o.y.toFixed(3)}`).join(';');
    if (m._fx) m._fx.length = 0;                 // hlášky skillu se za menu nekreslí
    if (m.ended || stat.ticks >= RESTART_TICKS) { build(); return; }
    resize();
    const cam = camera();
    stat.frames++;
    cam.dt = 1 / FPS; cam.t = stat.frames / FPS;  // hodiny kresby z počtu snímků → deterministický obraz
    const t0 = performance.now();
    // Renderer hry občas pustí zvuk (brzda brusle) — za menu ticho: SFX dočasně na noop, synchronně vráceno.
    const saved = sfxKeys.map(k => SFX[k]);
    for (const k of sfxKeys) SFX[k] = noop;
    try {
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      game._draw(ctx, cam);
    } finally { sfxKeys.forEach((k, i) => { SFX[k] = saved[i]; }); }
    const dtMs = performance.now() - t0;
    stat.drawMs = stat.drawMs ? stat.drawMs * 0.9 + dtMs * 0.1 : dtMs;
    if (stat.frames > 5) stat.drawMax = Math.max(stat.drawMax, dtMs);
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - lastT < 1000 / FPS - 2) return;     // strop 30 fps (rAF běží dál, kreslí se jen každý ~2. snímek na 60 Hz)
    lastT = ts;
    try { frame(); } catch (e) { stop(); host.classList.remove('live'); throw e; }
  }

  function run() {
    if (raf || !active || document.hidden) return;
    lastT = 0; stat.running = true; host.classList.add('run');
    raf = requestAnimationFrame(loop);
  }
  function pause() { if (raf) cancelAnimationFrame(raf); raf = null; stat.running = false; host.classList.remove('run'); }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else run(); });
  addEventListener('resize', () => { if (active && game) { resize(); } });

  // start: (znovu) spustí scénu od buly; keep=true jen obnoví běh bez restartu (návrat z podobrazovky)
  function start(keep = false) {
    if (!game || !keep) build();
    active = true; host.classList.add('live');
    run();
  }
  // stop: pozastaví; release=true uvolní zápas i plátno (start hry / tréninku)
  function stop(release = false) {
    active = false; pause();
    if (release) { game = null; canvas.width = 1; canvas.height = 1; host.classList.remove('live'); }
  }
  return { start, stop };
}
