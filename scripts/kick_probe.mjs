// Sonda přikopnutí (Q): kde je puk vůči tělu a bruslím v tiku, kdy přikopnutí zabere. Deterministicky (scénáře jako test/kick.test.mjs).
// Brusle = úsečka čepele (skin.js skinSkate: −0,66R … +0,72R podél brusle) v póze skatePose (K3, stojící hráč = klidová póza).
// Výstup: pro každý scénář okno (ms), min/max vzdálenost puku od středu těla a od nejbližší brusle při zabrání.
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), 'fh-kick-probe.db');
const { createMatch, stepMatch, makeInput, applyClientInput, faceoff, DT } = await import('../public/js/match-core.js');
const { Player, skatePose } = await import('../public/js/entities/Player.js');
const { PLAYER } = await import('../public/js/constants.js');
const R = PLAYER.radius;

function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return Math.hypot(px - ax - dx * u, py - ay - dy * u); }
function skateDist(p, P) {   // vzdálenost středu puku od nejbližší čepele brusle (svět. px)
  const spd = Math.hypot(p.vx, p.vy), ba = p.bodyAngle, cb = Math.cos(ba), sb = Math.sin(ba);
  const pose = skatePose({ k: 3, phase: 0, spd, mLoc: 0, stopT: 0 });
  let best = 1e9;
  for (const f of pose.feet) {
    const fx = p.x + f.x * cb - f.y * sb, fy = p.y + f.x * sb + f.y * cb, a = ba + f.a, ca = Math.cos(a), sa = Math.sin(a);
    best = Math.min(best, segDist(P.x, P.y, fx - ca * 0.66 * R, fy - sa * 0.66 * R, fx + ca * 0.72 * R, fy + sa * 0.72 * R));
  }
  return best;
}
function run(v, off, qAt) {
  const m = createMatch(11, {}); const p = new Player('h0', 'home', makeInput()); m.players.set('h0', p); m.inputs.set('h0', p.input); m.world.entities.push(p);
  faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false;
  p.x = 400; p.y = 228; p.vx = p.vy = 0; p.aimAngle = Math.PI;
  const P = m.puck; P.x = 310; P.y = 228 + off; P.z = 0; P.vx = v; P.vy = 0; P.vz = 0; P.faceoffTimer = 0; P._carrier = null; P.ownerId = null;
  let hit = null; const orig = p._doKick.bind(p);
  p._doKick = (pk) => { hit = { dc: Math.hypot(pk.x - p.x, pk.y - p.y), ds: skateDist(p, pk) }; return orig(pk); };
  for (let t = 0; t < 40; t++) { applyClientInput(p.input, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq: qAt === t, aim: Math.PI, aimDist: 60 }); stepMatch(m); }
  return hit;
}
const f1 = x => x.toFixed(1);
console.log('v px/s | odstup px | okno ms | puk od středu min–max | puk od brusle min–max');
for (const v of [300, 450, 600]) for (const off of [0, 8, 15, 20, 24]) {
  const hs = []; for (let q = 0; q < 40; q++) { const h = run(v, off, q); if (h) hs.push(h); }
  const dc = hs.map(h => h.dc), ds = hs.map(h => h.ds);
  console.log(`${v} | ${off} | ${(hs.length * DT * 1000).toFixed(0)} | ${hs.length ? f1(Math.min(...dc)) + '–' + f1(Math.max(...dc)) : '—'} | ${hs.length ? f1(Math.min(...ds)) + '–' + f1(Math.max(...ds)) : '—'}`);
}
