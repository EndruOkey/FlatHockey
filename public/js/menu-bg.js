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
    cine.rng = SEED >>> 0; cine.left = 0; cine.n = 0; cine.kind = 'wide'; cine.deck = null;   // restart scény = stejný sestřih
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || host.clientWidth), h = Math.max(1, canvas.clientHeight || host.clientHeight);
    const bw = Math.round(w * RES), bh = Math.round(h * RES);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    canvas.cssW = w; canvas.cssH = h;
  }

  // FILMOVÁ KAMERA (2026-11-13, Ondřej: „víc filmatický, kamera na hráče různě se měnící"): záběry 5–8 s se střihem.
  // Pořadí a délky záběrů z LCG se seedem → stejný seed = stejný sestřih. Kamera se dotahuje plynule (pevné dt 1/30),
  // jemné chvění „z ruky" je sinus z čísla snímku. Předmět záběru je uprostřed = v mezeře mezi panely menu.
  const SHOT = { carrier: { z: 2.6, lead: 0.45 }, puck: { z: 2.0, lead: 0.25 }, goal: { z: 2.2, lead: 0 }, wide: { z: 1.15, z1: 1.45, lead: 0 }, player: { z: 3.0, lead: 0.35 } };
  const KINDS = Object.keys(SHOT);
  const cine = { rng: SEED >>> 0, shot: null, left: 0, n: 0, cx: RINK.w / 2, cy: RINK.h / 2, z: 1, kind: 'wide', who: 0, f: 0 };
  const lcg = () => (cine.rng = (Math.imul(cine.rng, 1664525) + 1013904223) >>> 0) / 4294967296;
  function nextShot() {
    // balíček: každé kolo všech 5 typů v zamíchaném pořadí (Fisher–Yates z LCG), bez opakování přes hranici kola
    if (!cine.deck || !cine.deck.length) { const d = KINDS.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(lcg() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      if (d[0] === cine.kind) d.push(d.shift()); cine.deck = d; }
    const k = cine.deck.shift();
    cine.kind = k; cine.left = cine.len = 150 + Math.floor(lcg() * 90); cine.who = Math.floor(lcg() * 6); cine.n++; cine.f = 0;
    return true;
  }
  function subject(m) {
    const pl = [...m.players.values()].sort((a, b) => (a.id > b.id ? 1 : -1)), pk = m.puck, S = SHOT[cine.kind];
    let o = pk, vx = pk.vx || 0, vy = pk.vy || 0;
    if (cine.kind === 'carrier') { o = pl.find(p => p.hasPuck) || pl.reduce((b, p) => (Math.hypot(p.x - pk.x, p.y - pk.y) < Math.hypot(b.x - pk.x, b.y - pk.y) ? p : b), pl[0]); vx = o.vx || 0; vy = o.vy || 0; }
    else if (cine.kind === 'player' && pl.length) { o = pl[cine.who % pl.length]; vx = o.vx || 0; vy = o.vy || 0; }
    let x = o.x + vx * S.lead, y = o.y + vy * S.lead;
    if (cine.kind === 'goal') { const gx = pk.x < RINK.w / 2 ? RINK.goalLineLeft : RINK.goalLineRight; x = gx * 0.6 + pk.x * 0.4; y = RINK.h / 2 * 0.6 + pk.y * 0.4; }
    const z = S.z1 ? S.z + (S.z1 - S.z) * (1 - cine.left / cine.len) : S.z;
    return { x, y, z };
  }
  function camera(m) {
    const W = canvas.cssW, H = canvas.cssH, pad = 24, dt = 1 / FPS;
    const base = Math.min((W - pad * 2) / RINK.w, (H - pad * 2) / RINK.h);
    let cut = false;
    if (cine.left <= 0) cut = nextShot();
    cine.left--; cine.f++;
    const t = subject(m);
    if (cut) { cine.cx = t.x; cine.cy = t.y; cine.z = t.z; }       // střih: kamera rovnou na novém záběru
    else { const kp = 1 - Math.exp(-3 * dt), kz = 1 - Math.exp(-1.5 * dt); cine.cx += (t.x - cine.cx) * kp; cine.cy += (t.y - cine.cy) * kp; cine.z += (t.z - cine.z) * kz; }
    const scale = base * cine.z, hw = W / 2 / scale, hh = H / 2 / scale, f = stat.frames;
    // „z ruky": pomalé chvění ±3 px obrazovky (dvě nesoudělné frekvence)
    let cx = cine.cx + (Math.sin(f * 0.031) * 2 + Math.sin(f * 0.017 + 1.3)) / scale, cy = cine.cy + (Math.cos(f * 0.023) * 2 + Math.sin(f * 0.013)) / scale;
    // nevyjet z kluziště: když je záběr menší než kluziště, střed drž uvnitř; jinak střed kluziště
    // smí vyjet za mantinel o 45 % poloviny záběru (tmavá aréna) → předmět zůstane uprostřed, v mezeře mezi panely menu
    const mx = hw * 0.45, my = hh * 0.45;
    cx = hw * 2 >= RINK.w + 2 * mx ? RINK.w / 2 : Math.max(hw - mx, Math.min(RINK.w - hw + mx, cx));
    cy = hh * 2 >= RINK.h + 2 * my ? RINK.h / 2 : Math.max(hh - my, Math.min(RINK.h - hh + my, cy));
    stat.shot = cine.kind; stat.shotN = cine.n;
    return { scale, ox: W / 2 - cx * scale, oy: H / 2 - cy * scale };
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
    const cam = camera(m);
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
