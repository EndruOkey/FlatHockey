// ODRAZ PŘES BRANKU jako skill shot — deterministická rubrika S1–S4 nad mřížkou ran ze zadního prostoru.
// node scripts/overnet_skill.mjs           → aktuální OVERNET z Puck.js
// node scripts/overnet_skill.mjs --sweep   → prohledá prahy, seřadí podle rubriky (body, pak S2, pak S1 nejblíž 22 %)
import { tmpdir } from 'os'; import { join } from 'path';
process.env.DB_PATH = join(tmpdir(), `fh-ons-${process.pid}.db`);
const { RINK, PUCK, PLAYER } = await import('../public/js/constants.js');
const { Puck, OVERNET } = await import('../public/js/entities/Puck.js');
const DT = 1 / 60, W = { authoritative: true, players: [], onGoal() {}, whistle() {} };
const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2;
const shotV = c => PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * Math.pow(c, 0.85);   // = Player.shoot
const shotVz = c => Math.pow(c, 1.4) * PUCK.maxShotVz;

function fly(x, y, ang, v, vz, maxT) {
  const p = new Puck(); p.x = x; p.y = y; p.z = 0; p.vx = Math.cos(ang) * v; p.vy = Math.sin(ang) * v; p.vz = vz; p.faceoffTimer = 0;
  const tr = [];
  for (let t = 0; t < maxT * 60; t++) { p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z; p.update(DT, W); tr.push({ x: p.x, y: p.y, z: p.z, v: Math.hypot(p.vx, p.vy), over: p._overNet }); if (p._out) break; }
  return tr;
}
const zAtX = (tr, X) => { for (let i = 1; i < tr.length; i++) if ((tr[i - 1].x - X) * (tr[i].x - X) <= 0) return tr[i].z; return null; };

const BX = [GX + 30, GX + 50, GX + 70], DY = [-50, -25, 0, 25, 50], CH = [0.3, 0.45, 0.6, 0.8, 1], AN = [-0.35, 0, 0.35];
function evaluate() {
  const shots = [];
  for (const bx of BX) for (const dy of DY) for (const c of CH) for (const a of AN) {
    const tr = fly(bx, GY + dy, a, shotV(c), shotVz(c), 2.5);
    const iO = tr.findIndex(s => s.over); let ok = false, over = iO >= 0, land = null;
    if (over) { for (let i = iO + 1; i < tr.length; i++) if (tr[i].z <= 0 && tr[i].x < GX) { land = tr[i]; break; }
      const net = zAtX(tr.slice(iO), GX + RINK.goalDepth) ?? 0;
      ok = !!land && GX - land.x >= 30 && GX - land.x <= 140 && Math.abs(land.y - GY) < 80 && land.v <= PLAYER.pickupMaxRelSpeed && net > PUCK.crossbarHeight; }
    shots.push({ dy, c, a, over, ok, ly: land ? land.y - GY : null });
  }
  const rate = f => { const s = shots.filter(f); return s.length ? s.filter(x => x.ok).length / s.length : 0; };
  const S1 = rate(() => true), S2 = rate(s => s.a === 0 && s.c >= 0.8 && Math.abs(s.dy) <= 25), S3 = rate(s => s.c <= 0.6 || Math.abs(s.dy) === 50);
  let low = 0; for (const bx of BX) for (const dy of [-25, 0, 25]) if (fly(bx, GY + dy, 0, 380, 0, 1.5).some(s => s.over)) low++;
  const ang = shots.filter(s => s.over && s.a !== 0 && s.ly != null), steer = ang.length ? ang.filter(s => Math.sign(s.ly) === Math.sign(s.a)).length / ang.length : 1;
  const pass = [S1 >= 0.10 && S1 <= 0.35, S2 >= 0.70, S3 <= 0.20, low === 0 && steer >= 0.9];
  return { S1, S2, S3, low, steer, pts: pass.filter(Boolean).length, pass };
}
const pct = x => (x * 100).toFixed(1).padStart(5) + ' %';
const line = (r, cfg) => `${cfg}  S1 ${pct(r.S1)}  S2 ${pct(r.S2)}  S3 ${pct(r.S3)}  po ledě ${r.low}  řízení ${pct(r.steer)}  → ${r.pts}/4`;

if (process.argv.includes('--sweep')) {
  const res = [];
  for (const minV of [220, 300, 340, 380, 410]) for (const minZ of [0.5, 4, 8, 12]) for (const band of [60, 30, 15, 0]) {
    Object.assign(OVERNET, { minV, minZ, band }); const r = evaluate(); res.push({ cfg: { minV, minZ, band }, r });
  }
  res.sort((a, b) => b.r.pts - a.r.pts || b.r.S2 - a.r.S2 || Math.abs(a.r.S1 - 0.22) - Math.abs(b.r.S1 - 0.22) || a.cfg.minV - b.cfg.minV || a.cfg.minZ - b.cfg.minZ || b.cfg.band - a.cfg.band);
  for (const { cfg, r } of res.slice(0, 12)) console.log(line(r, `minV ${String(cfg.minV).padStart(3)} minZ ${String(cfg.minZ).padStart(4)} pás ${String(cfg.band).padStart(2)}`));
} else {
  const r = evaluate();
  console.log(line(r, `minV ${OVERNET.minV} minZ ${OVERNET.minZ} pás ${OVERNET.band}`));
  console.log(['S1 celkem 10–35 %', 'S2 dobrá rána ≥ 70 %', 'S3 odbytá ≤ 20 %', 'S4 po ledě 0 a řízení ≥ 90 %'].map((n, i) => (r.pass[i] ? 'ANO ' : 'NE  ') + n).join('\n'));
  process.exit(r.pts === 4 ? 0 : 1);
}
