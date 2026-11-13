// NOHA PŘIPOJENÁ K TĚLU — deterministické měření (bez canvasu, stejné čisté funkce jako draw: skatePose + skinHip).
// node scripts/leg_attach_metrics.mjs
// RUBRIKA (předem, 2026-11-13, Ondřej: „nohy/hips jsou trochu mimo tělo"):
//  L1 Vzdálenost kyčel (jak ji kreslí skin) → kotník ≤ 1,5 R při jízdě 165 px/s ve všech 24 směrech × 48 fází kroku (stop se neměří).
//  L2 Kyčel leží pod kalhotami: kotník nikdy nevede „přes trup" — úhel nohy vůči směru boků ≤ 100° (noha nejde z kyčle dopředu-napříč).
// Viditelnost bruslí ve hře hlídá zvlášť scripts/skate_visibility.py (nesmí klesnout).
const { PLAYER } = await import('../public/js/constants.js');
const { skatePose } = await import('../public/js/entities/Player.js');
const skin = await import('../public/js/entities/skin.js');
const R = PLAYER.radius;
const hipOf = (side, hh) => skin.skinHip ? skin.skinHip(side, hh) : { x: -R * 0.6, y: side * R * 0.58 };   // před opravou: kyčel pevná
const groups = { 'vpřed': [], 'bokem': [], 'vzad': [] };
let over = 0, n = 0, bad2 = 0;
for (let i = 0; i < 24; i++) {
  const m = -Math.PI + (i + 0.5) * Math.PI / 12, g = Math.abs(m) < 0.6 ? 'vpřed' : Math.abs(m) > 2.2 ? 'vzad' : 'bokem';
  for (let j = 0; j < 48; j++) {
    const P = skatePose({ k: 3, phase: j / 48 * Math.PI * 2, spd: 165, mLoc: m, stopT: 0, stopLoc: 0, rotSf: 0, lean: 0, hs: 1, thr: 0 });
    const hh = P.body.hh ?? P.body.h ?? 0;   // kyčel, jak ji kreslí skin (B.hh)
    for (const f of P.feet) {
      const h = hipOf(f.side, hh), d = Math.hypot(f.x - h.x, f.y - h.y) / R;
      groups[g].push(d); n++; if (d > 1.5) over++;
      // L2: směr kyčel→kotník vůči ose boků (natočená −x = dozadu je přirozené; noha mířící k opačné straně trupu = přes tělo)
      const lx = (f.x - h.x) * Math.cos(hh) + (f.y - h.y) * Math.sin(hh), ly = -(f.x - h.x) * Math.sin(hh) + (f.y - h.y) * Math.cos(hh);
      if (ly * f.side < 0 && Math.abs(Math.atan2(ly * f.side, lx)) > 100 * Math.PI / 180) bad2++;
    }
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const [g, a] of Object.entries(groups)) console.log(g.padEnd(6), 'kyčel→kotník (×R)  p50', q(a, 0.5).toFixed(2), ' p95', q(a, 0.95).toFixed(2), ' max', Math.max(...a).toFixed(2));
console.log(`L1 nad 1,5 R: ${over}/${n}  ${over === 0 ? 'OK' : 'NEPROŠLO'}`);
console.log(`L2 noha přes trup: ${bad2}/${n}  ${bad2 === 0 ? 'OK' : 'NEPROŠLO'}`);
console.log(skin.skinHip ? '(kyčel natočená s boky)' : '(kyčel pevná — stav před opravou)');
process.exit(over === 0 && bad2 === 0 ? 0 : 1);
