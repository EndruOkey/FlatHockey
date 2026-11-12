// AUDIT FYZIKY PUKU — výška × síla × odrazy, deterministicky. Pevná kritéria K1–K10 (ANO/NE + čísla).
// Puk se krokuje SAMOSTATNĚ (Puck.update bez hráčů a gólmana) = čistá fyzika; střela/pas podle vzorců
// Player.shoot / passSpeedFor / doPass. Na konci frekvence v reálných zápasech botů (2v2, 10 seedů).
// node scripts/puck_physics_audit.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4695';
process.env.DB_PATH = join(tmpdir(), `fh-ppa-${process.pid}.db`);
const { RINK, PUCK, PLAYER, passSpeedFor } = await import('../public/js/constants.js');
const { Puck } = await import('../public/js/entities/Puck.js');
const DT = 1 / 60, W = { authoritative: true, players: [], onGoal() {}, whistle() {} };
const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2;
const shotV = c => PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * Math.pow(c, 0.85);
const shotVz = c => Math.pow(c, 1.4) * PUCK.maxShotVz;
function fly(x, y, ang, v, vz, maxT = 3, hook) {
  const p = new Puck(); p.x = x; p.y = y; p.z = 0; p.vx = Math.cos(ang) * v; p.vy = Math.sin(ang) * v; p.vz = vz; p.faceoffTimer = 0;
  const tr = []; let ev = 0;
  for (let t = 0; t < maxT * 60; t++) { p.prevX = p.x; p.prevY = p.y; p.update(DT, W); ev |= p._ev || 0; tr.push({ x: p.x, y: p.y, z: p.z, v: Math.hypot(p.vx, p.vy), ev: p._ev || 0, over: p._overNet }); if (hook && hook(p, t)) break; if (p._out) break; }
  return { tr, ev, p };
}
// Lidská rána míří i výšku: vz podle vzdálenosti kurzoru (= Player.shoot pro !isBot)
const humanVz = (c, aim) => { const zT = Math.min(PUCK.crossbarHeight - 2, shotVz(c) ** 2 / (2 * PUCK.gravity)); const t = Math.min(aim, 320) / shotV(c); return Math.min(PUCK.maxShotVz * 1.2, (zT + PUCK.gravity * t * t / 2) / t); };
const zAtX = (tr, X) => { for (let i = 1; i < tr.length; i++) if ((tr[i - 1].x - X) * (tr[i].x - X) <= 0 && tr[i - 1].x !== tr[i].x) { const k = (X - tr[i - 1].x) / (tr[i].x - tr[i - 1].x); return tr[i - 1].z + k * (tr[i].z - tr[i - 1].z); } return null; };
const out = []; const R = (k, ok, txt) => { out.push(`${ok ? 'ANO' : 'NE '}  ${k}  ${txt}`); };
const f1 = v => (v == null ? '—' : v.toFixed(1));

// ── Tabulka střel: nabití × vzdálenost → výška v brankové čáře ──
console.log('VÝŠKA PUKU V BRANKOVÉ ČÁŘE (px; lapačka >' + PUCK.gloveHeight + ', břevno ' + PUCK.crossbarHeight + ', mantinel ' + PUCK.boardHeight + ')');
console.log('nabití  rychlost  vz   vrchol |  d=60   d=100  d=150  d=200  d=250');
const table = {};
for (const c of [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
  const row = [];
  for (const d of [60, 100, 150, 200, 250]) { const { tr } = fly(GX - d, GY, 0, shotV(c), shotVz(c), 2); row.push(zAtX(tr, GX)); }
  table[c] = row;
  const peak = shotVz(c) ** 2 / (2 * PUCK.gravity);
  console.log(`${c.toFixed(2).padStart(5)}  ${shotV(c).toFixed(0).padStart(7)}  ${shotVz(c).toFixed(0).padStart(4)}  ${peak.toFixed(1).padStart(6)} | ${row.map(z => f1(z).padStart(5)).join('  ')}`);
}
// K1 žabička nízko
R('K1 žabička (nabití ≤ 0,2) letí nízko (pod lapačkou) ze všech vzdáleností', [0.1, 0.2].every(c => table[c].every(z => z == null || z <= PUCK.gloveHeight)), `max ${f1(Math.max(...[0.1, 0.2].flatMap(c => table[c].filter(z => z != null))))} px`);
// K2 plný slap z 150–200 px trefí výšku horního rohu (lapačka..břevno)
const k2 = [0.9, 1].flatMap(c => [100, 150, 200, 250].map(d => zAtX(fly(GX - d, GY, 0, shotV(c), humanVz(c, d), 2).tr, GX)));
R('K2 plná rána člověka (kurzor na brance) ze 100–250 px míří do výšky horního rohu (lapačka < z < břevno)', k2.every(z => z != null && z > PUCK.gloveHeight && z < PUCK.crossbarHeight), `z = ${k2.map(f1).join(', ')}`);
// K3 monotónie
let mono = true; const cs = Object.keys(table).map(Number).sort((a, b) => a - b);   // klíč '1' by jinak šel první
for (let i = 1; i < cs.length; i++) if (shotV(cs[i]) < shotV(cs[i - 1]) || shotVz(cs[i]) < shotVz(cs[i - 1])) mono = false;
R('K3 víc nabití = vždy rychlejší i vyšší rána (žádný skok)', mono, `rychlost ${shotV(0.1).toFixed(0)}→${shotV(1).toFixed(0)} px/s, vrchol ${(shotVz(0.1) ** 2 / 1160).toFixed(1)}→${(shotVz(1) ** 2 / 1160).toFixed(1)} px`);
// K4 přes břevno jen výjimečně
const overBar = Object.values(table).flat().filter(z => z != null && z >= PUCK.crossbarHeight).length, cells = Object.values(table).flat().length;
R('K4 přes břevno jde jen málo kombinací (≤ 15 %) — riziko plné rány, ne běžný výsledek', overBar / cells <= 0.15, `${overBar}/${cells} kombinací nabití×vzdálenost`);
// K5 sklo dosažitelné, ale ne běžně: plná rána k bočnímu mantinelu z různých vzdáleností
let glassHits = 0, glassN = 0;
for (const c of [0.6, 0.75, 0.9, 1]) for (const d of [40, 80, 120, 160, 200]) { glassN++; const { ev } = fly(300, RINK.h - d, Math.PI / 2, shotV(c), shotVz(c), 1.5, (p, t) => t > 0 && (p._ev & 33)); if (ev & 32) glassHits++; }
R('K5 plexisklo je dosažitelné tvrdou zvednutou ranou (10–60 % kombinací)', glassHits / glassN >= 0.1 && glassHits / glassN <= 0.6, `${glassHits}/${glassN} (nabití 0,6–1 × 40–200 px od mantinelu)`);
// K6 střídačky: vysoká rána nahoru v neutrální zóně může vyletět
let outs = 0, outN = 0;
for (const c of [0.6, 0.75, 0.9, 1]) for (const d of [40, 80, 120, 160, 200]) { outN++; const { p } = fly(RINK.centerX - 60, d, -Math.PI / 2, shotV(c), shotVz(c), 1.5, (q, t) => t > 0 && (q._ev & 97)); if (p._out) outs++; }
R('K6 u střídaček může vysoký puk vyletět ze hry (stejné rány jako K5 → ven)', outs === glassHits, `${outs}/${outN} ven (K5 sklo ${glassHits}/${glassN})`);
// K7 NAHRÁVKA PŘES BRANKU: hráč za brankou (x mezi brankou a zadním mantinelem), rána do zadního mantinelu
let ok7 = 0, n7 = 0, overOnly = 0; const lands = [];
const wallX = RINK.w, behindX = [GX + 30, GX + 50, GX + 70];
for (const bx of behindX) for (const dy of [-50, -25, 0, 25, 50]) for (const c of [0.3, 0.45, 0.6, 0.8, 1]) for (const a of [-0.35, 0, 0.35]) {
  n7++;
  const { tr } = fly(bx, GY + dy, a, shotV(c), shotVz(c), 2.5);
  const iOver = tr.findIndex(s => s.over); if (iOver < 0) continue;
  // dopad = první z==0 po odrazu, za brankovou čárou směrem do ledu
  let land = null; for (let i = iOver + 1; i < tr.length; i++) if (tr[i].z <= 0 && tr[i].x < GX) { land = tr[i]; break; }
  const crossedNet = zAtX(tr.slice(iOver), GX + RINK.goalDepth) ?? 0;
  if (!land) continue;
  overOnly++;
  const inSlot = GX - land.x >= 30 && GX - land.x <= 140 && Math.abs(land.y - GY) < 80;
  lands.push({ d: GX - land.x, y: land.y - GY, v: land.v, net: crossedNet, a, c, dy });
  if (inSlot && land.v <= PLAYER.pickupMaxRelSpeed && crossedNet > PUCK.crossbarHeight) ok7++;
}
const avg = (a, k) => (a.reduce((s, x) => s + x[k], 0) / Math.max(1, a.length));
// K7 přepsáno: rovná zvednutá rána (a = 0, nabití ≥ 0,45) musí dopadnout do slotu; šikmá rána musí jít OVLÁDAT (dopad na stranu úhlu)
// 2026-11-12 skill shot (scripts/overnet_skill.mjs): vyjít musí DOBRÁ rána (rovně, nabití ≥ 0,8, přímo za sítí |dy| ≤ 25), ne každá
const straight = lands.filter(l => l.a === 0 && l.c >= 0.8 && Math.abs(l.dy) <= 25), nStraight = behindX.length * 3 * [0.8, 1].length;
const okStraight = straight.filter(l => l.d >= 30 && l.d <= 140 && Math.abs(l.y) < 80 && l.v <= PLAYER.pickupMaxRelSpeed && l.net > PUCK.crossbarHeight).length;
const angled = lands.filter(l => l.a !== 0), steer = angled.filter(l => Math.sign(l.y) === Math.sign(l.a)).length;   // zadní zeď otočí jen vx, boční složka zůstává
R('K7 nahrávka přes branku (skill shot): dobrá rána — rovně, nabití ≥ 0,8, přímo za sítí — dopadne do slotu (30–140 px, |y| < 80) zpracovatelně ≥ 80 %', okStraight / nStraight >= 0.8, `${okStraight}/${nStraight}; dopad prům. ${avg(straight, 'd').toFixed(0)} px před čarou, rychlost ${avg(straight, 'v').toFixed(0)} px/s (limit ${PLAYER.pickupMaxRelSpeed}), výška nad sítí ${avg(straight, 'net').toFixed(1)}`);
R('K7c směr nahrávky přes branku jde řídit úhlem rány (šikmá rána dopadne na odpovídající stranu)', angled.length > 0 && steer / angled.length >= 0.9, `${steer}/${angled.length}`);
// K7b po ledě (žabička) do zadního mantinelu se NEodrazí přes branku
let wrongOver = 0; for (const bx of behindX) for (const dy of [-25, 0, 25]) { const { tr } = fly(bx, GY + dy, 0, 380, 0, 1.5); if (tr.some(s => s.over)) wrongOver++; }
R('K7b rána po ledě do zadního mantinelu přes branku NEletí (jen zvednutá)', wrongOver === 0, `${wrongOver}/9`);
// K8 odraz: mantinel ubere energii, sklo víc, nikdy nepřidá
const bounce = (z0) => { const { tr } = fly(500, 200, -Math.PI / 2, 300, z0 ? 200 : 0, 1.2, (p, t) => t > 2 && (p._ev & 33)); const i = tr.findIndex(s => s.ev & 33); return i > 0 ? tr[i].v / tr[i - 1].v : null; };
const bb = bounce(false), bg = bounce(true);
R('K8 odraz ubírá rychlost (mantinel < 1, sklo < mantinel)', bb != null && bg != null && bb < 1 && bg < bb, `mantinel ×${f1(bb && bb * 100)} %, sklo ×${f1(bg && bg * 100)} %`);
// K9 pas po ledě vs limity převzetí
const pv = [80, 150, 220].map(d => passSpeedFor(d));
R('K9 pas po ledě je pro soupeře v dráze moc rychlý na čisté převzetí (> limit soupeře), pro adresáta zpracovatelný', pv.every(v => v > PLAYER.pickupMaxRelSpeed * 0.9 && v <= PLAYER.passRecvMaxRel), `rychlost ${pv.map(v => v.toFixed(0)).join('/')} px/s; limit soupeř ${PLAYER.pickupMaxRelSpeed}, adresát ${PLAYER.passRecvMaxRel}`);
// K10 nadzvednutý pas: vrchol pod břevnem, letí nad hokejkou (z > 1,5 v polovině dráhy)
let k10 = true; const sp = [];
for (const d of [80, 150, 220]) { const t = 0.85 * d / 270, vz = Math.min(150, PUCK.gravity * t / 2); const peak = vz * vz / (2 * PUCK.gravity); const { tr } = fly(300, 228, 0, 270, vz, 2); const zm = zAtX(tr, 300 + d / 2); sp.push(`${d}px: vrchol ${peak.toFixed(1)}, v půlce ${f1(zm)}`); if (peak >= PUCK.crossbarHeight || !(zm > 1.5)) k10 = false; }
R('K10 nadzvednutý pas: nad holemi v půlce dráhy, vrchol pod břevnem', k10, sp.join(' | '));

console.log('\n' + out.join('\n'));
const fails = out.filter(l => l.startsWith('NE')).length;
console.log(`\n${out.length - fails}/${out.length} kritérií ANO`);

// ── Frekvence v zápasech botů (2v2, 10 seedů × 5 min) ──
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
let g = 0, o = 0, b = 0, ov = 0, liveT = 0;
for (let s = 1; s <= 10; s++) {
  const l = { id: 'PA' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: true, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < 2; i++) { l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home')); l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away')); }
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  let wasOver = false;
  for (let t = 0; t < 5 * 3600; t++) { stepMatch(m); const e = m.puck._ev || 0; if (e & 32) g++; if (e & 64) o++; if (e & 1) b++; if (m.puck._overNet && !wasOver) ov++; wasOver = !!m.puck._overNet; if (!(m.setup || m.stoppage)) liveT++; }
  lobbies.delete(l.id);
}
const min = liveT / 3600;
console.log(`\nZÁPASY BOTŮ (2v2): mantinel ${(b / min).toFixed(1)}/min | sklo ${(g / min).toFixed(2)}/min | puk ven ${(o / 10).toFixed(2)}/zápas | přes branku ${(ov / 10).toFixed(2)}/zápas`);
process.exit(0);
