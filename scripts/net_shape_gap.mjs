// SÍŤ: FYZIKA vs. KRESBA G12 (půdorys, puk na ledu) — deterministicky, bez prohlížeče.
// Puky zvenku na boky, záda a rohy pravé branky; pro každý výstřel nejmenší znaménková mezera mezi okrajem puku a VNĚJŠÍ hranou
// nakreslené základny (trubka GOAL_NHL[12].tube) až do odrazu: + = odraz „od ničeho" (před sítí), − = puk vnikl do kresby sítě.
// Rubrika předem (2026-11-13): medián |mezera| ≤ 1 px, max |mezera| ≤ 3,5 px (≈ vyboulení rohu r·(1 − 1/√2) při r = 10 + rezerva).
// node scripts/net_shape_gap.mjs [--g=12]
const { RINK, PUCK } = await import('../public/js/constants.js');
const { Puck } = await import('../public/js/entities/Puck.js');
const { GOAL_NHL } = await import('../public/js/entities/Rink.js');
const A = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const G = GOAL_NHL[+(A.g || 12)], R = PUCK.radius, DT = 1 / 60, LX = RINK.goalLineRight, CY = RINK.goalY + RINK.goalH / 2, HALF = RINK.goalH / 2;
// obrys základny v lokálu (u = za čarou, v = od středu) — stejné křivky jako Rink._realPath(flare 0, bow)
const pts = [], quad = (p0, c, p1, n = 16) => { for (let i = 1; i <= n; i++) { const t = i / n; pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]]); } };
const d = G.depth, hb = G.halfBack, r = G.r;
pts.push([0, -HALF]); for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push([(d - 0.9 * r) * t, -HALF + (HALF - hb) * t]); }
quad([d - 0.9 * r, -hb], [d, -hb], [d, -hb + r]); quad([d, -hb + r], [d + (G.bow || 0), 0], [d, hb - r]); quad([d, hb - r], [d, hb], [d - 0.9 * r, hb]);
for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push([(d - 0.9 * r) * (1 - t), hb + (HALF - hb) * t]); }
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy); };
const inside = p => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const sdist = p => { let m = 1e9; for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segD(p, pts[i], pts[i + 1])); return inside(p) ? -m : m; };   // obrys bez ústí (ústí = otevřené)
const W = { authoritative: true, players: [], onGoal() {}, whistle() {} };
const shots = [];
const fire = (desc, x, y, vx, vy) => {
  const p = new Puck(); p.faceoffTimer = 0; Object.assign(p, { x, y, z: 0, vx, vy, vz: 0, prevX: x, prevY: y, prevZ: 0 });
  let gap = 1e9, hit = false;
  for (let t = 0; t < 120 && !hit; t++) {
    const v0x = p.vx, v0y = p.vy; p.update(DT, W);
    const u = p.x - LX, v = p.y - CY;
    if (u > -R) gap = Math.min(gap, sdist([u, v]) - R - G.tube / 2);
    if (Math.sign(p.vx) !== Math.sign(v0x) && Math.abs(v0x) > 1 || Math.sign(p.vy) !== Math.sign(v0y) && Math.abs(v0y) > 1) hit = true;
  }
  if (gap < 1e8) shots.push({ desc, gap: +gap.toFixed(2), hit });
};
const V = 300;
for (let u = 2; u <= 26; u += 2) { fire(`bok shora u=${u}`, LX + u, CY - 45, 0, V); fire(`bok zdola u=${u}`, LX + u, CY + 45, 0, -V); }
for (let v = -20; v <= 20; v += 4) fire(`záda v=${v}`, LX + 70, CY + v, -V, 0);
for (const [cu, cv] of [[d - 2, -hb + 2], [d - 2, hb - 2], [d - 4, -hb + 4], [d - 4, hb - 4]]) { const s = Math.SQRT1_2 * V, sx = Math.sign(cv); fire(`roh (${cu},${cv})`, LX + cu + 40, CY + cv + 40 * sx, -s, -s * sx); }
const hits = shots.filter(s => s.hit), abs = hits.map(s => Math.abs(s.gap)).sort((a, b) => a - b);
const med = abs[Math.floor(abs.length / 2)] ?? 99, mx = abs[abs.length - 1] ?? 99;
const worst = [...hits].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 5);
console.log(`goalDepth ${RINK.goalDepth} · G${A.g || 12} · výstřelů ${shots.length}, odrazů ${hits.length}, průletů kresbou bez odrazu ${shots.filter(s => !s.hit && s.gap < -R).length}`);
console.log(`${med <= 1 ? 'OK ' : 'NE '} medián |mezera| ${med.toFixed(2)} px (≤ 1)`);
console.log(`${mx <= 3.5 ? 'OK ' : 'NE '} max |mezera| ${mx.toFixed(2)} px (≤ 3,5)`);
console.log('nejhorší:', worst.map(s => `${s.desc}: ${s.gap}`).join(' · '));
process.exit(med <= 1 && mx <= 3.5 ? 0 : 1);
