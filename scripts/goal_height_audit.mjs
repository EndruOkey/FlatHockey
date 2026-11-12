// AUDIT VÝŠKY BRANKY — fyzika puku vs. kresba branky (Rink._drawGoal), deterministicky.
// Vizuální model (z kresby): přední horní hrana (břevno) H = PUCK.crossbarHeight u brankové čáry,
// zadní horní hrana HB = H × k (k se čte přímo z Rink.js), střecha se svažuje lineárně h(u) = H·(1 − (1−k)·u/d).
// Boční stěny = lichoběžník H→HB, zadní stěna výšky HB, ústí zepředu otevřené pod břevnem.
// Mřížka puků (zepředu / z boku / zezadu / shora) pro obě branky; každý tick se porovná s modelem.
// node scripts/goal_height_audit.mjs        (exit 1 = nějaký nesoulad)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
const { RINK, PUCK } = await import('../public/js/constants.js');
const { Puck } = await import('../public/js/entities/Puck.js');

const rinkSrc = readFileSync(fileURLToPath(new URL('../public/js/entities/Rink.js', import.meta.url)), 'utf8');
const km = rinkSrc.match(/HB\s*=\s*H\s*\*\s*([0-9.]+)/);
if (!km) { console.error('Nenašel jsem HB = H * k v Rink.js'); process.exit(2); }
const K = Number(km[1]);
const DT = 1 / 60, G = PUCK.gravity, R = PUCK.radius, TOL = 0.5, BAR = 2;   // BAR = tloušťka břevna (kresba 3,5 px → ±1,75)
const H = PUCK.crossbarHeight, HB = H * K, D = RINK.goalDepth, GY1 = RINK.goalY, GY2 = RINK.goalY + RINK.goalH;
const SLOPE = (H - HB) / D;
const hV = u => H - (H - HB) * Math.min(1, Math.max(0, u / D));      // vizuální výška stěny/střechy v hloubce u
const W = { authoritative: true, players: [], onGoal() {}, whistle() {} };
const GOALS = [[RINK.goalLineRight, +1], [RINK.goalLineLeft, -1]];

const CATS = {
  phantomWall: 'odraz od stěny/zad, která je na obrázku níž (puk je nad ní)',
  tunnel:      'puk prošel viditelnou stěnou/střechou dovnitř sítě (ne ústím)',
  escape:      'puk v síti prošel stěnou/ústím ven',
  insideNoGoal:'puk je na obrázku uvnitř sítě, ale gól nepadl',
  goalOverBar: 'gól, ačkoli puk letěl nad břevnem',
  phantomBar:  'odraz od břevna, ačkoli puk letěl vysoko nad ním',
  aboveRoof:   'puk v síti je výš než střecha sítě (prosvítá ven)',
  zJump:       'skok výšky za tick, který nevysvětlí rychlost/gravitace/střecha',
};
const count = Object.fromEntries(Object.keys(CATS).map(k => [k, 0]));
const examples = Object.fromEntries(Object.keys(CATS).map(k => [k, null]));
let maxDzNet = 0, maxDzNetEx = null, nCases = 0;

function run(desc, x, y, z, vx, vy, vz, ticks = 90) {
  nCases++;
  const p = new Puck(); p.faceoffTimer = 0; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
  p.prevX = x; p.prevY = y; p.prevZ = z;
  const hit = {}; let goal = false;
  for (let t = 0; t < ticks; t++) {
    const a = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, inNet: !!p._inNet };
    p.update(DT, W);
    const b = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, inNet: !!p._inNet, ev: p._ev || 0 };
    if (p.goalScored) goal = true;
    for (const [lineX, s] of GOALS) {
      const ua = s * (a.x - lineX), ub = s * (b.x - lineX);
      const inFa = ua > 0 && ua < D && a.y > GY1 && a.y < GY2, inFb = ub > 0 && ub < D && b.y > GY1 && b.y < GY2;
      const inVa = inFa && a.z < hV(ua) - TOL, inVb = inFb && b.z < hV(ub) - TOL;
      // průlet přední rovinou (ústím) pod břevnem?
      let front = false, zFront = null;
      if (ua <= 0 && ub > 0) { const k = -ua / (ub - ua); const yA = a.y + (b.y - a.y) * k; zFront = a.z + (b.z - a.z) * k; front = yA > GY1 && yA < GY2 && zFront <= H + TOL; }
      if (!inVa && inVb && !front && !a.inNet) hit.tunnel ??= `${desc} t=${t}`;
      if (a.inNet && b.inNet && inVa && !inVb && !(inFb && b.z >= hV(ub) - TOL - 1e-9)) hit.escape ??= `${desc} t=${t}`;
      if (inVb && !b.inNet) hit.insideNoGoal ??= `${desc} t=${t}`;
      if (b.inNet && inFb && b.z > hV(ub) + TOL) hit.aboveRoof ??= `${desc} t=${t} z=${b.z.toFixed(1)} h=${hV(ub).toFixed(1)}`;
      if (p.goalScored && zFront != null && zFront > H + TOL) hit.goalOverBar ??= `${desc} t=${t}`;
      if ((b.ev & 8) && ua <= 0 && ua + s * a.vx * DT >= 0) {   // břevno: z v okamžiku průletu čárou (volný let z předchozího stavu)
        const vz1 = a.vz - G * DT, un = ua + s * a.vx * DT, k = -ua / (un - ua);
        const zc = a.z + vz1 * DT * k; if (zc > H + BAR + TOL) hit.phantomBar ??= `${desc} t=${t} z=${zc.toFixed(1)}`;
      }
      // fantomová boční stěna: vy se otočí u boční roviny zvenku, puk nad viditelnou výškou stěny
      if (!(b.ev & 2) && a.vy * b.vy < 0 && Math.abs(a.vy) > 5 && ub > -R && ub < D + R) {
        const nearTop = a.y < GY1 && b.y <= GY1 && b.y >= GY1 - R - 1.5, nearBot = a.y > GY2 && b.y >= GY2 && b.y <= GY2 + R + 1.5;
        const Yp = nearTop ? GY1 - R : GY2 + R, yn = a.y + a.vy * DT, k = Math.abs(yn - a.y) > 1e-9 ? Math.min(1, Math.max(0, (Yp - a.y) / (yn - a.y))) : 1;
        const uc = ua + s * a.vx * DT * k, zc = a.z + (a.vz - G * DT) * DT * k;   // bod dotyku disku se stěnou
        if ((nearTop || nearBot) && zc > hV(uc) + TOL) hit.phantomWall ??= `${desc} t=${t} bok z=${zc.toFixed(1)} h=${hV(uc).toFixed(1)}`;
      }
      // fantomová zadní stěna: vx se otočí u zadní roviny zvenku, puk nad HB
      if (a.vx * b.vx < 0 && Math.abs(a.vx) > 5 && b.y > GY1 - R && b.y < GY2 + R && ua > D && ub >= D && ub <= D + R + 1.5) {
        const un = ua + s * a.vx * DT, k = Math.abs(un - ua) > 1e-9 ? Math.min(1, Math.max(0, (ua - (D + R)) / (ua - un))) : 1, zc = a.z + (a.vz - G * DT) * DT * k;
        if (zc > HB + TOL) hit.phantomWall ??= `${desc} t=${t} záda z=${zc.toFixed(1)} HB=${HB.toFixed(1)}`;
      }
      // skok z: víc než rychlost + gravitace + svah střechy (po střeše × uražená dráha)
      const dz = Math.abs(b.z - a.z), allow = Math.abs(a.vz) * DT + G * DT * DT + SLOPE * Math.hypot(b.x - a.x, b.y - a.y) + 0.5;
      const near = ub > -R - 2 && ub < D + R + 2 && b.y > GY1 - R - 2 && b.y < GY2 + R + 2;
      if (near && dz > allow) hit.zJump ??= `${desc} t=${t} Δz=${dz.toFixed(1)} (povoleno ${allow.toFixed(1)})`;
      if (b.inNet && a.inNet && inFb && dz > maxDzNet) { maxDzNet = dz; maxDzNetEx = `${desc} t=${t}`; }
      if (b.inNet && !a.inNet && dz > maxDzNet) { maxDzNet = dz; maxDzNetEx = `${desc} t=${t} (vstup)`; }
    }
  }
  for (const k of Object.keys(hit)) { count[k]++; examples[k] ??= hit[k]; }
  return goal;
}

const Z0 = [0, 3, 6, 9, 12, 15, 18, 20, 22, 25, 30];
const VZ0 = [-150, 0, 150];
const SPD = [200, 500, 900, 1400];
let goals = 0;
for (const [lineX, s] of GOALS) {
  const side = s > 0 ? 'P' : 'L', yc = (GY1 + GY2) / 2;
  // ZEPŘEDU: rána do ústí / k tyčkám, různé výšky
  for (const d0 of [30, 80]) for (const dy of [-24, -21, -18, -10, 0, 10, 18, 21, 24]) for (const z of Z0) for (const vz of VZ0) for (const v of SPD) for (const ang of [-0.3, 0, 0.3])
    if (run(`${side} zepředu d=${d0} dy=${dy} z=${z} vz=${vz} v=${v} a=${ang}`, lineX - s * d0, yc + dy - Math.sin(ang) * d0, z, s * v * Math.cos(ang), v * Math.sin(ang), vz)) goals++;
  // Z BOKU: kolmo na boční stěnu v různých hloubkách
  for (const u of [1, 4, 8, 12, 16, 19]) for (const top of [true, false]) for (const z of Z0) for (const vz of VZ0) for (const v of SPD) for (const ang of [-0.25, 0, 0.25]) {
    const y0 = top ? GY1 - 40 : GY2 + 40, dirY = top ? 1 : -1;
    run(`${side} z boku u=${u} ${top ? 'horní' : 'dolní'} z=${z} vz=${vz} v=${v} a=${ang}`, lineX + s * (u - Math.sin(ang) * 40), y0, z, s * v * Math.sin(ang), dirY * v * Math.cos(ang), vz);
  }
  // ZEZADU: na zadní stěnu
  for (const dy of [-18, -8, 0, 8, 18]) for (const z of Z0) for (const vz of VZ0) for (const v of SPD) for (const ang of [-0.3, 0, 0.3])
    run(`${side} zezadu dy=${dy} z=${z} vz=${vz} v=${v} a=${ang}`, lineX + s * (D + 30), yc + dy - Math.sin(ang) * 30, z, -s * v * Math.cos(ang), v * Math.sin(ang), vz);
  // SHORA: puk padá na střechu v různých hloubkách
  for (const u of [0.5, 3, 6, 10, 14, 17, 19.5]) for (const dy of [-20, -10, 0, 10, 20]) for (const z of [22, 26, 32, 40]) for (const vz of [0, -120]) for (const [hx, hy] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60], [200, 0]])
    run(`${side} shora u=${u} dy=${dy} z=${z} vz=${vz} h=${hx},${hy}`, lineX + s * u, yc + dy, z, s * hx, hy, vz, 120);
}

console.log(`AUDIT VÝŠKY BRANKY — ${nCases} případů (obě branky), gólů ${goals}`);
console.log(`Vizuál: břevno H=${H}, záda HB=${HB.toFixed(2)} (k=${K} z Rink.js), hloubka ${D}`);
let total = 0;
for (const k of Object.keys(CATS)) { total += count[k]; console.log(`${String(count[k]).padStart(6)}  ${k.padEnd(13)} ${CATS[k]}${examples[k] ? `\n          např.: ${examples[k]}` : ''}`); }
console.log(`max |Δz| za tick uvnitř sítě: ${maxDzNet.toFixed(2)} px${maxDzNetEx ? ` (${maxDzNetEx})` : ''}`);
console.log(`NESOULAD CELKEM: ${total}`);
process.exit(total ? 1 : 0);
