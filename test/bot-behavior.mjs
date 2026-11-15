// CHOVÁNÍ BOTŮ „jako hráč" — deterministické měření (serverový simulátor, 3v3 boti, seedy 1..20, 60 s každý).
// node test/bot-behavior.mjs   (PORT volitelně)
// Ondřej 2026-11-14: „jezdí jak idioti, chasují, nepůsobí jako hráč".
// Taktika 3v3 (předloha: hokejová taktika 3 na 3 — jeden napadá puk, druhý podporuje / nabízí přihrávku, třetí jistí branku).
// RUBRIKA (předem, 2026-11-14; prahy jsou odhad z taktiky, ne z měření hráčů):
//  B1 rozestup: dva spoluhráči blíž než 60 px (≈ 4 R) ≤ 10 % času (nehloučí se).
//  B2 honění puku: 2+ hráči jednoho týmu do 90 px od volného / soupeřova puku ≤ 10 % času.
//  B3 plynulá jízda: prudká změna směru jízdy (> 90° během 0,25 s při rychlosti > 60 px/s) ≤ 0,5× za s na hráče.
//  B4 obrana: když má puk soupeř, aspoň jeden bránící hráč je mezi pukem a vlastní brankou (blíž brance po ose x a do 120 px od osy puk–branka) ≥ 80 % času.
//  REVIZE 2026-11-15 (B1, B2; původní číslo se dál tiskne):
//   R1 prvních 60 ticků (1,0 s) po buly se nepočítá: rozestavení na buly určují pravidla (centr 16 px, křídla 54 px od puku),
//      ne rozhodnutí bota, a křídla do vhazování legitimně najíždějí (souboj o vhazovaný puk).
//   R2 B2 v obranném pásmu (puk do 200 px od vlastní brankové čáry, soupeř ho drží): hráč blíž k vlastní brance než puk
//      a do 40 px od osy puk–branka „kryje před brankou" (box-out / slot), nehoní; honičem je jen napadající.
//  B5 podpora: když má puk spoluhráč, jiný spoluhráč je 120–320 px od něj s volnou přihrávkovou linií (žádný soupeř do 18 px od úsečky) ≥ 60 % času.
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4161';
process.env.DB_PATH = join(tmpdir(), `fh-botb-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const ad = a => Math.atan2(Math.sin(a), Math.cos(a));
const FO_T = 60;   // revize R1: ticky po buly
const segD = (px, py, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)); return Math.hypot(px - ax - vx * t, py - ay - vy * t); };
const A = { clump: [0, 0], chase: [0, 0], clumpR: [0, 0], chaseR: [0, 0], sharp: 0, botSec: 0, def: [0, 0], sup: [0, 0] }, DG = { b1: {}, b2: {}, b4: {} };   // DG = rozpad (--diag)
for (let seed = 1; seed <= 20; seed++) {
  const l = { id: 'B3_' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
  for (let i = 0; i < 3; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < 3; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const hist = new Map();
  for (let t = 0; t < 60 * 60; t++) {
    stepMatch(m);
    if (m.setup || m.stoppage || m.world._goalLock) { hist.clear(); m._sinceFo = 0; continue; } m._sinceFo = (m._sinceFo ?? 0) + 1;
    const P = [...m.players.values()].filter(p => !p.isGoalie), pk = m.puck, owner = P.find(p => p.hasPuck);
    for (const team of ['home', 'away']) {
      const T = P.filter(p => p.team === team), own = team === 'home' ? RINK.goalLineLeft : RINK.goalLineRight, gy = RINK.goalY + RINK.goalH / 2;
      // B1
      let cl = false; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (Math.hypot(T[i].x - T[j].x, T[i].y - T[j].y) < 60) { cl = true; const k = [T[i]._botMode, T[j]._botMode].sort().join('+') + (owner ? (owner.team === team ? ' (my puk)' : ' (soupeř puk)') : ' (volný)'); DG.b1[k] = (DG.b1[k] || 0) + 1; }
      A.clump[0] += cl ? 1 : 0; A.clump[1]++;
      if (m._sinceFo > FO_T) { A.clumpR[0] += cl ? 1 : 0; A.clumpR[1]++; }
      // B2 (puk volný nebo u soupeře)
      if (!owner || owner.team !== team) { const near = T.filter(p => Math.hypot(p.x - pk.x, p.y - pk.y) < 90), n = near.length; A.chase[0] += n >= 2 ? 1 : 0; A.chase[1]++;
        if (m._sinceFo > FO_T) { const dz = owner && Math.abs(pk.x - own) < 200, cover = q => dz && Math.hypot(q.x - own, q.y - gy) < Math.hypot(pk.x - own, pk.y - gy) && segD(q.x, q.y, pk.x, pk.y, own, gy) < 40; const nR = near.filter(q => !cover(q)).length; A.chaseR[0] += nR >= 2 ? 1 : 0; A.chaseR[1]++; }
        if (n >= 2) { const dg = Math.abs(pk.x - own) < 200 ? 'u vlastní branky' : Math.abs(pk.x - own) < 540 ? 'vlastní polovina' : 'útok'; const k = near.map(q => q._botMode).sort().join('+') + ` · ${owner ? 'soupeř má' : 'volný'} · ${dg}` + (m._sinceFo < 120 ? ' · do 2 s po buly' : ''); DG.b2[k] = (DG.b2[k] || 0) + 1; } }
      // B4
      if (owner && owner.team !== team) { const ok = T.some(p => Math.abs(p.x - own) < Math.abs(pk.x - own) && segD(p.x, p.y, pk.x, pk.y, own, gy) < 120); A.def[0] += ok ? 1 : 0; A.def[1]++;
        if (!ok) { const gs = T.filter(p => Math.abs(p.x - own) < Math.abs(pk.x - own)).length, dg = (team === 'home' ? pk.x < own : pk.x > own) ? 'za brankou' : Math.abs(pk.x - own) < 200 ? 'u vlastní branky' : Math.abs(pk.x - own) < 540 ? 'vlastní polovina' : 'útok'; const k = `${gs} na brankové straně · ${dg} · ` + T.map(q => q._botMode).sort().join('+'); DG.b4[k] = (DG.b4[k] || 0) + 1; } }
      // B5
      if (owner && owner.team === team) { const opp = P.filter(p => p.team !== team);
        const ok = T.some(p => p !== owner && (d => d >= 120 && d <= 320)(Math.hypot(p.x - owner.x, p.y - owner.y)) && !opp.some(o => segD(o.x, o.y, owner.x, owner.y, p.x, p.y) < 18));
        A.sup[0] += ok ? 1 : 0; A.sup[1]++; }
    }
    // B3
    for (const p of P) { const sp = Math.hypot(p.vx, p.vy), h = hist.get(p.id) || []; h.push({ a: Math.atan2(p.vy, p.vx), sp }); if (h.length > 16) h.shift(); hist.set(p.id, h);
      A.botSec += 1 / 60; if (h.length === 16 && h[0].sp > 60 && sp > 60 && Math.abs(ad(h[15].a - h[0].a)) > Math.PI / 2 && !p._sharpCd) { A.sharp++; p._sharpCd = 15; } if (p._sharpCd) p._sharpCd--; }
  }
  lobbies.delete(l.id);
}
const pc = x => x[1] ? x[0] / x[1] : 0;
const R = [
  ['B1 nahloučení spoluhráčů ≤ 10 % (rev.)', pc(A.clumpR) <= 0.10, `původní ${(pc(A.clump) * 100).toFixed(1)} % · revize ${(pc(A.clumpR) * 100).toFixed(1)} %`],
  ['B2 2+ honí puk ≤ 10 % (rev.)', pc(A.chaseR) <= 0.10, `původní ${(pc(A.chase) * 100).toFixed(1)} % · revize ${(pc(A.chaseR) * 100).toFixed(1)} %`],
  ['B3 prudké obraty ≤ 0,5/s na hráče', A.sharp / A.botSec <= 0.5, `${(A.sharp / A.botSec).toFixed(2)} /s`],
  ['B4 obránce mezi pukem a brankou ≥ 80 %', pc(A.def) >= 0.80, `${(pc(A.def) * 100).toFixed(1)} %`],
  ['B5 volný spoluhráč na přihrávku ≥ 60 %', pc(A.sup) >= 0.60, `${(pc(A.sup) * 100).toFixed(1)} %`],
];
let ok = 0; for (const [n, p, v] of R) { if (p) ok++; console.log(`  ${p ? 'OK' : 'NE'}   ${n.padEnd(40)} ${v}`); }
console.log(`chování botů: ${ok}/${R.length}`);
if (process.argv.includes('--diag')) for (const k of ['b1', 'b2', 'b4']) { const t = Object.values(DG[k]).reduce((a, b) => a + b, 0); console.log(k.toUpperCase() + ' rozpad:'); Object.entries(DG[k]).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([n, c]) => console.log(`   ${(c / t * 100).toFixed(0).padStart(3)} %  ${n}`)); } process.exit(ok === R.length ? 0 : 1);
