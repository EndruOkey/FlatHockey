// SONDA FINTY S NÁPŘAHEM (deterministicky, online simulace server.js).
// Scénář: nosič stojí X px před pravou brankou (pozice Y), napřahuje W s (LMB), pak RMB = zrušení (finta),
// hned pustí LMB, znovu stiskne a po R s od zrušení vypálí do rohu (strana side). Volitelně během R ujíždí bokem.
// Režimy: 'fake' = dnešní hra; 'ctrl' = stejné vstupy, ale gólman fintu nečte (_readWind vynulován před každým krokem)
// → rozdíl = čistý efekt finty. Rng gólmana seedován na scénář (makeRng(hashSeed(id))).
// Rubrika (cíl modelu „malého okna“, předem): v okně ≥ 60 % gólů · mimo okno ≤ ctrl + 10 p. b. · šířka okna ≤ 120 ms.
// node scripts/feint_probe.mjs [--slide=1] [--x=120,180] [--w=0.3,0.5,0.8]
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4698';
process.env.DB_PATH = join(tmpdir(), `fh-feint-${process.pid}.db`);
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { makeRng, hashSeed } = await import('../public/js/rng.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2, HALF = RINK.goalH / 2;
const XS = String(ARG.x || '120,180').split(',').map(Number);
const YS = [-40, 0, 40];
const WS = String(ARG.w || '0.3,0.5,0.8').split(',').map(Number);   // délka nápřahu před zrušením [s]
const RS = [0.05, 0.10, 0.15, 0.20, 0.30, 0.45, 0.60, 0.80, 1.00, 1.30];   // zrušení → výstřel [s]
const SLIDE = !!+(ARG.slide || 0);
const T = s => Math.round(s * 60);

function setup(id, x, y) {
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1, botFill: 0 }), members: new Map(), matchSeq: 1 };
  l.members.set('h0', makeMember({ name: 'A' }, 'home')); lobbies.set(l.id, l); startMatch(l);
  const m = l.match; clearInterval(m.loop); for (let i = 0; i < 600 && (m.setup || m.stoppage); i++) stepMatch(m);
  for (const g of [m.goalieL, m.goalieR]) g.rng = makeRng(hashSeed(id + ':g'));
  const pid = [...m.players.keys()][0], p = m.players.get(pid), inp = m.inputs.get(pid);
  Object.assign(p, { x, y, vx: 0, vy: 0 }); p.aimAngle = p.carryAngle = p.bodyAngle = p.skateAngle = 0;
  Object.assign(inp, { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aimDist: 120, aim: 0 });
  m.puck.x = p.stickTip.x; m.puck.y = p.stickTip.y; m.puck.vx = m.puck.vy = m.puck.vz = m.puck.z = 0; m.puck.faceoffTimer = 0;
  p._grabPuck(); p._possT = 5;
  for (let i = 0; i < 30; i++) { inp._stamp = 0; stepMatch(m); }   // gólman se usadí
  return { l, m, p, inp };
}

// Jeden pokus → 'goal' | 'save' | 'miss' | 'nofake' (gólman fintu nečetl) | 'noshot'
function run(mode, w, r, x, y, side) {
  const id = `FP:${mode}:${w}:${r}:${x}:${y}:${side}`;
  const { l, m, p, inp } = setup(id, GX - x, GY + y);
  const g = m.goalieR, g0 = m.score.home, tw = T(w), tc = tw, tr = tc + Math.max(2, T(r));
  let read = false, shotAt = -1, out = 'noshot';
  for (let t = 0; t < tr + 120; t++) {
    inp._stamp = 0; inp.rmb = false; inp.dx = 0; inp.dy = 0;
    inp.aim = Math.atan2(GY + side * (HALF - 3) - p.y, GX - p.x);
    if (t < tc) inp.lmb = true;                                   // nápřah
    else if (t === tc) { inp.lmb = true; inp.rmb = true; }        // RMB během nabíjení = zrušení (finta)
    else if (t === tc + 1) inp.lmb = false;                       // pustit LMB (odblokuje nápřah)
    else if (t < tr) { inp.lmb = true; if (SLIDE) inp.dy = side; } // nový nápřah (+ ujetí bokem)
    else inp.lmb = false;                                         // t === tr → výstřel
    if (mode === 'ctrl') g._readWind = false;
    const had = p.hasPuck; stepMatch(m);
    if (t === tc && g._fakeT > 0) read = true;
    if (had && !p.hasPuck && shotAt < 0) shotAt = t;
    if (m.score.home > g0) { out = 'goal'; break; }
    if (shotAt >= 0 && t > shotAt + 3 && g._holdTimer > 0) { out = 'save'; break; }
    if (shotAt >= 0 && t > shotAt + 90) { out = 'miss'; break; }
  }
  if (shotAt >= 0 && out === 'noshot') out = 'miss';
  lobbies.delete(l.id);
  if (mode === 'fake' && !read) return 'nofake';
  return out;
}

const tab = {}, OUT = { fake: {}, ctrl: {} }; let nofake = 0, total = 0;
const t0 = process.hrtime.bigint();
for (const w of WS) for (const r of RS) for (const mode of ['fake', 'ctrl']) {
  const k = `${w}|${r}|${mode}`; tab[k] = { goal: 0, n: 0 };
  for (const x of XS) for (const y of YS) for (const side of [-1, 1]) {
    const o = run(mode, w, r, x, y, side); total++;
    OUT[mode][o] = (OUT[mode][o] || 0) + 1;
    if (o === 'nofake') { nofake++; continue; }
    if (o === 'goal' || o === 'save') tab[k].n++; if (o === 'goal') tab[k].goal++;   // jen střely na branku (mimo = rozptyl, ne gólman)
  }
}
const pct = k => tab[k].n ? (100 * tab[k].goal / tab[k].n) : NaN;
console.log(`FINTA sonda | slide=${SLIDE ? 1 : 0} | pozice x=${XS} y=${YS} × 2 rohy | n/buňka=${XS.length * YS.length * 2} | gólman nečetl nápřah: ${nofake}/${total / 2}`);
console.log('% gólů ze střel NA BRANKU: fake (ctrl = gólman fintu ignoruje)');
console.log('R[ms]  ' + WS.map(w => `W=${w}s`.padEnd(14)).join(''));
for (const r of RS) console.log(String(Math.round(r * 1000)).padStart(5) + '  ' + WS.map(w => {
  const f = pct(`${w}|${r}|fake`), c = pct(`${w}|${r}|ctrl`);
  return `${isNaN(f) ? '  –' : f.toFixed(0).padStart(3)} (${c.toFixed(0).padStart(3)})`.padEnd(14);
}).join(''));
// Okno = R, kde fake − ctrl ≥ 25 p. b. (pevný práh)
for (const w of WS) {
  const win = RS.filter(r => pct(`${w}|${r}|fake`) - pct(`${w}|${r}|ctrl`) >= 25);
  console.log(`W=${w}s okno (fake−ctrl ≥ 25 p. b.): ${win.length ? `${Math.round(win[0] * 1000)}–${Math.round(win.at(-1) * 1000)} ms` : 'žádné'}`);
}
console.log('výsledky fake:', JSON.stringify(OUT.fake), '| ctrl:', JSON.stringify(OUT.ctrl));
console.error(`(čas ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)} s)`);
process.exit(0);
