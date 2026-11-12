// MEZERA PŘI DOTYKU (Ondřej: „puk se odrazí od ničeho / je tam ještě prostor"): v okamžiku zákroku vzdálenost okraje puku
// od NAKRESLENÉHO brankáře (stejná geometrie jako Goalie.draw + skinGoalie, včetně animace rukou). Bot zápasy, deterministicky.
// Rubrika předem (2026-11-12): |mezera| medián ≤ 2 px, p90 ≤ 4 px; „od ničeho" (mezera > 3 px) ≤ 10 %; „do těla" (< −4 px) ≤ 10 %.
// node scripts/contact_gap.mjs [--seeds=12] [--sizes=2,3]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4699'; process.env.DB_PATH = join(tmpdir(), `fh-cg-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { PUCK } = await import('../public/js/constants.js');
const { Goalie, goalieSurface } = await import('../public/js/entities/Goalie.js');
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// znaménková vzdálenost bodu od elipsy / otočeného obdélníku (záporná = uvnitř)
const sdEll = (px, py, cx, cy, rx, ry) => { const nx = (px - cx) / rx, ny = (py - cy) / ry, n = Math.hypot(nx, ny); return (n - 1) * Math.min(rx, ry) * (n < 1 ? 1 : 1); };
const sdBox = (px, py, cx, cy, hw, hh, ang) => { const c = Math.cos(-ang), s = Math.sin(-ang), x = (px - cx) * c - (py - cy) * s, y = (px - cx) * s + (py - cy) * c;
  const dx = Math.abs(x) - hw, dy = Math.abs(y) - hh; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0); };

// nakreslený brankář: vrátí nejmenší vzdálenost bodu (svět) od výstroje + název části
function drawnSD(g, wx, wy) {
  const holding = false, spread = clamp(Math.abs(g._vy) / 110, 0, 1), drop = g.stance === 'stand' ? 1 : Math.min(1, g._stanceT / 0.12);
  const G = goalieGeom(g.stance, g._side, spread, drop), A = g._a;
  if (A) { G.handX += A.hx; G.gloveY += A.gy; G.blockY += A.by; G.bodyScale *= 1 - 0.05 * A.crouch;
    if (A.kick > 0) for (const pd of G.pads) if (Math.sign(pd.ky || pd.dir) === (A.stepSide || 1)) pd.kx -= 1.2 * A.kick; }
  const lx = -g.inX * (wx - g.x), ly = wy - g.y;   // lokál brankáře (−X k puku), kresba je scale(−inX, 1)
  // rámec těla (bez odskoku — měříme stav PŘED zákrokem)
  const t = g._tilt || 0, c = Math.cos(-t), s = Math.sin(-t), bx = (lx - G.bodyX) * c - (ly - G.bodyY) * s, by = (lx - G.bodyX) * s + (ly - G.bodyY) * c;
  const rb = 8 * G.bodyScale * 1.04;
  const parts = [
    ['tělo', sdEll(bx, by, 0, 0, rb * 0.88, rb * 1.12)],
    ['lapačka', sdEll(bx, by, G.handX, G.gloveY, 3.85, 4.18)],
    ['vyrážečka', sdBox(bx, by, G.handX - 1.76 + 1.54, G.blockY, 1.54, 3.85, 0)],
  ];
  for (const pd of G.pads) { const a = pd.angle * pd.dir, cy0 = pd.dir > 0 ? pd.ph / 2 : -pd.ph / 2;   // střed padu v jeho rámci
    const cx = pd.kx - Math.sin(a) * cy0, cy = pd.ky + Math.cos(a) * cy0; parts.push(['beton', sdBox(lx, ly, cx, cy, pd.pw / 2, pd.ph / 2, a)]); }
  let best = parts[0]; for (const p of parts) if (p[1] < best[1]) best = p; return best;
}

const sizes = String(ARG.sizes || '2,3').split(',').map(Number), SEEDS = +(ARG.seeds || 12);
for (const N of sizes) {
  const gaps = [], byPart = {};
  const _bp = Goalie.prototype.blockPuck;
  Goalie.prototype.blockPuck = function (puck, world) {
    const held = this._holdTimer > 0, n0 = this._hit?.n || 0;
    const r = _bp.call(this, puck, world);
    if (r && !held && (this._hit?.n || 0) !== n0) {   // nový dotyk: povrch NAKRESLENÉHO brankáře (s animací) v místě dotyku
      const { d, part } = goalieSurface(this, this._hit.x, this._hit.y, true); const gap = d - PUCK.radius; gaps.push(gap); (byPart[part] ||= []).push(gap);
    }
    return r;
  };
  for (let s = 1; s <= SEEDS; s++) {
    const l = { id: 'CG' + N + '_' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
    for (let i = 0; i < N; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    for (let t = 0; t < 5 * 3600; t++) stepMatch(m);
    lobbies.delete(l.id);
  }
  Goalie.prototype.blockPuck = _bp;
  const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
  const abs = gaps.map(Math.abs), far = gaps.filter(g => g > 3).length, deep = gaps.filter(g => g < -4).length;
  const R = { n: gaps.length, gap_med: q(gaps, 0.5), abs_med: q(abs, 0.5), abs_p90: q(abs, 0.9), from_nothing_pct: 100 * far / gaps.length, into_body_pct: 100 * deep / gaps.length };
  const RUB = { abs_med: 2, abs_p90: 4, from_nothing_pct: 10, into_body_pct: 10 };
  console.log(`== ${N}v${N} · ${SEEDS} seedů`);
  for (const [k, v] of Object.entries(R)) console.log(`${k in RUB ? (v <= RUB[k] ? 'OK  ' : 'NE  ') : 'info'} ${k.padEnd(18)} ${v.toFixed(2).padStart(8)}${k in RUB ? `  (≤ ${RUB[k]})` : ''}`);
  for (const [p, a] of Object.entries(byPart)) console.log(`info   ${p.padEnd(10)} n=${String(a.length).padStart(3)} mezera medián ${q(a, 0.5).toFixed(2)} px, p90 ${q(a.map(Math.abs), 0.9).toFixed(2)} px`);
}
process.exit(0);
