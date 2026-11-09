// Zasekávání člověka u gólmana/branky: hráč najede z N úhlů k ústí branky, 1 s drží směr do branky,
// pak 0,5 s zkusí ujet BOKEM (a zvlášť ZPĚT). Zaseknutí = za 0,5 s ujel < 20 px. Deterministické.
// node scripts/crease_stuck.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4681';
process.env.DB_PATH = join(tmpdir(), `fh-crease-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const GY = RINK.goalY + RINK.goalH / 2, GX = process.env.CS_OPEN ? RINK.centerX : RINK.goalLineRight;   // CS_OPEN=1 = kontrola na volném ledu
const res = { side: [], back: [] }; const fails = [];
let n = 0;
for (const ang of [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(a => a * Math.PI / 180)) {
  for (const esc of ['side', 'back']) {
    const l = { id: 'CS' + (n++), hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
    l.members.set('h0', makeMember({ name: 'H' }, 'home')); lobbies.set(l.id, l); startMatch(l);
    const m = l.match; clearInterval(m.loop); m.setup = null; m.stoppage = null;
    for (let i = 0; i < 400 && (m.setup || m.stoppage); i++) stepMatch(m);
    const p = [...m.players.values()][0], id = [...m.players.keys()][0];
    m.puck.x = 200; m.puck.y = 60; m.puck.vx = m.puck.vy = 0;   // puk daleko
    // start 70 px od středu ústí, úhel 0 = přímo před brankou (směr do ledu = -x)
    p.x = GX - Math.cos(ang) * 70; p.y = GY + Math.sin(ang) * 70; p.vx = p.vy = 0;
    const inp = m.inputs.get(id) || {}; m.inputs.set(id, inp); inp._p = inp._p || {};
    const set = (dx, dy) => { Object.assign(inp, { dx, dy, aim: Math.atan2(dy, dx), aimDist: 80, lmb: false, rmb: false, mmb: false, _stamp: Date.now() }); };
    const tx = GX - p.x, ty = GY - p.y, tl = Math.hypot(tx, ty);
    const sgn = v => Math.abs(v) < 0.38 ? 0 : Math.sign(v);
    set(sgn(tx / tl), sgn(ty / tl));
    for (let t = 0; t < 60; t++) stepMatch(m);
    const x0 = p.x, y0 = p.y;
    if (esc === 'side') set(sgn(-ty / tl), sgn(tx / tl)); else set(sgn(-tx / tl), sgn(-ty / tl));
    for (let t = 0; t < 30; t++) stepMatch(m);
    const moved = Math.hypot(p.x - x0, p.y - y0);
    res[esc].push(moved);
    if (moved < 20) fails.push(`${Math.round(ang * 180 / Math.PI)}° ${esc}: ${moved.toFixed(0)} px @(${x0.toFixed(0)},${y0.toFixed(0)})`);
    lobbies.delete(l.id);
  }
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
console.log(`únik bokem: prům ${avg(res.side)} px | únik zpět: prům ${avg(res.back)} px | zaseknutí (<20 px za 0,5 s): ${fails.length}/${res.side.length + res.back.length}`);
for (const f of fails) console.log('  ZASEKNUTÍ', f);
process.exit(0);
