// ROZEHRÁVKA BRANKÁŘE — deterministické měření (serverový simulátor, 3v3 boti, seedy 1..20, 180 s každý).
// node test/goalie-pass.mjs   (PORT volitelně; --diag = rozpad výsledků)
// Ondřej 2026-11-15: „golman nahrává blbě, nebo vůbec — někam to hodí a čus".
// Rozehrávka = brankář pustí držený puk (Goalie._release, puk opravdu opustí brankáře; podržení na buly se nepočítá).
// Sleduje se do prvního převzetí puku bruslařem (hasPuck), nového chycení brankářem, přerušení nebo 3 s.
// Zamýšlený spoluhráč = puck._passTo (adresát), jinak spoluhráč do 400 px nejblíž směru puku (odchylka ≤ 15°).
// RUBRIKA (předem, 2026-11-15):
//  G1 rozehrávka skončí u spoluhráče (první převzetí = spoluhráč) ≥ 70 %.
//  G2 rozehrávka skončí u soupeře (první převzetí = soupeř) ≤ 10 %.
//  G3 průměrná vzdálenost puku od středu těla zamýšleného spoluhráče v okamžiku převzetí (kýmkoli; poloha puku v posledním
//     ticku, kdy byl ještě volný — po převzetí ho hra přesune na hůl nosiče ~30–40 px před tělo; bez převzetí konec okna) ≤ 20 px
//     — zdůvodnění: adresát převezme puk do 18 px od čepele (PLAYER.passRecvRadius) nebo do R+8 = 15 px od těla;
//       čepel je ~10 px od středu těla, tedy puk do ~20 px od středu = přesná přihrávka „na hůl".
//  REVIZE G3 (2026-11-15, po 1. měření): střed těla byl špatná vztažná značka — čepel (stickTip) je ~25 px od středu těla
//     (úchop + PLAYER.stickLen 16) a i přesně přijatý pas leží v okamžiku převzetí 33–40 px od těla. Měří se tedy od čepele
//     (špička nebo lopatka, bližší — přesně geometrie Player.canPickup) v okamžiku převzetí;
//     práh 20 px = zóna převzetí adresáta (PLAYER.passRecvRadius 18) + poloměr puku. Původní číslo (od těla) se dál tiskne.
//  G4 deterministické: dva běhy seedů 1..4 (90 s) dají stejný otisk (počty + součet vzdáleností).
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PORT = process.env.PORT || '4171';
process.env.DB_PATH = join(tmpdir(), `fh-gkp-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { Goalie } = await import('../public/js/entities/Goalie.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;

let pending = [], freezes = 0;
const orig = Goalie.prototype._release;
Goalie.prototype._release = function (world) {
  const had = this._heldPuck;
  const fr = this._froze; orig.call(this, world); if (!fr && this._froze) freezes++;
  if (had && !this._heldPuck) pending.push({ g: this, team: this.team, puck: had, world });
};

// vzdálenost puku od čepele = stejná geometrie jako Player.canPickup (špička hole nebo bod lopatky 6 px za ní, bližší z nich)
const bladeD = (pk, q) => { const t = q.stickTip, a = (q.carryAngle ?? q.aimAngle) + (q.handed ?? 1) * Math.PI / 6.5, bx = t.x + Math.cos(a) * 6, by = t.y + Math.sin(a) * 6; return Math.min(Math.hypot(pk.x - t.x, pk.y - t.y), Math.hypot(pk.x - bx, pk.y - by)); };
function intentOf(ev) {
  const p = ev.puck, mates = ev.world.players.filter(q => q.team === ev.team);
  if (p._passTo != null) { const m = mates.find(q => q.id === p._passTo); if (m) return m; }
  const sp = Math.hypot(p.vx, p.vy); if (sp < 1) return null;
  let best = null, ba = 15 * Math.PI / 180;
  for (const q of mates) {
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy); if (d > 400 || d < 1) continue;
    const a = Math.acos(Math.max(-1, Math.min(1, (dx * p.vx + dy * p.vy) / (d * sp))));
    if (a < ba) { ba = a; best = q; }
  }
  return best;
}

function run(seeds, secs) {
  const S = { tip: 0, rel: 0, mate: 0, opp: 0, none: 0, gk: 0, stop: 0, pass: 0, dist: 0, distN: 0, intendedGot: 0, why: {} };
  for (const seed of seeds) {
    const l = { id: 'GP_' + seed, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: seed - 1 };
    for (let i = 0; i < 3; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
    for (let i = 0; i < 3; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
    lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
    for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
    pending = []; const live = [];
    for (let t = 0; t < secs * 60; t++) {
      stepMatch(m);
      for (const ev of pending) { ev.mate = intentOf(ev); ev.t = 0; live.push(ev); S.rel++; if (ev.mate) S.pass++; }
      pending = [];
      for (let i = live.length - 1; i >= 0; i--) {
        const ev = live[i]; ev.t++;
        const car = [...m.players.values()].find(p => p.hasPuck);
        let end = null;
        if (car) end = car.team === ev.team ? 'mate' : 'opp';
        else if (m.goalieL._heldPuck || m.goalieR._heldPuck) end = 'gk';
        else if (m.setup || m.stoppage || m.world._goalLock) end = 'stop';
        else if (ev.t >= 180) end = 'none';
        if (!end) continue;
        S[end]++;
        if (ev.mate) { S.dist += Math.hypot(m.puck.x - ev.mate.x, m.puck.y - ev.mate.y); S.tip += bladeD(m.puck, ev.mate); S.distN++; if (car === ev.mate) S.intendedGot++; }
        const k = `${ev.mate ? 'pas' : 'bez adresáta'} → ${end}`; S.why[k] = (S.why[k] || 0) + 1;
        live.splice(i, 1);
      }
    }
    lobbies.delete(l.id);
  }
  return S;
}

const S = run(Array.from({ length: 20 }, (_, i) => i + 1), 180);
const fp = s => [s.rel, s.mate, s.opp, s.none, s.gk, s.stop, s.pass, s.dist.toFixed(6), s.tip.toFixed(6)].join('/');
const d1 = fp(run([1, 2, 3, 4], 90)), d2 = fp(run([1, 2, 3, 4], 90));
const pc = (a, b) => b ? a / b : 0, avg = pc(S.dist, S.distN), avgT = pc(S.tip, S.distN);
const R = [
  ['G1 rozehrávka skončí u spoluhráče ≥ 70 %', pc(S.mate, S.rel) >= 0.70, `${(pc(S.mate, S.rel) * 100).toFixed(1)} % (${S.mate}/${S.rel})`],
  ['G2 rozehrávka skončí u soupeře ≤ 10 %', pc(S.opp, S.rel) <= 0.10, `${(pc(S.opp, S.rel) * 100).toFixed(1)} % (${S.opp}/${S.rel})`],
  ['G3 vzdálenost od čepele adresáta ≤ 20 px (rev.)', S.distN > 0 && avgT <= 20, `původní (od těla) ${avg.toFixed(1)} px · revize (od čepele) ${avgT.toFixed(1)} px (n=${S.distN})`],
  ['G4 deterministické (2 běhy stejně)', d1 === d2, d1 === d2 ? d1 : `${d1} ≠ ${d2}`],
];
let ok = 0; for (const [n, p, v] of R) { if (p) ok++; console.log(`  ${p ? 'OK' : 'NE'}   ${n.padEnd(46)} ${v}`); }
console.log(`  info: s adresátem ${S.pass}/${S.rel}, převzal přímo adresát ${S.intendedGot}, podržení na buly ${freezes}, brankář znovu ${S.gk}, přerušení ${S.stop}, nikdo ${S.none}`);
console.log(`rozehrávka brankáře: ${ok}/${R.length}`);
if (process.argv.includes('--diag')) Object.entries(S.why).sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`   ${String(c).padStart(4)}  ${k}`));
process.exit(ok === R.length ? 0 : 1);
