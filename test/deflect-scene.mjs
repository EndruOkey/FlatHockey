// Scéna TEČ (sdílená pro scripts/deflect_probe.mjs a test/deflect.test.mjs) — deterministicky přes match-core.
// Spoluhráč (h1) vystřelí od modré čáry na čepel/ústí, ty (h0) stojíš ve slotu d px před soupeřovou brankou (vpravo, x = 990).
// q: null = bez Q, číslo = tik stisku Q po ráně. ay = míření na brankové čáře (px od středu ústí), high = kurzor za brankou (teč nahoru). stance: 'shooter' (hůl k střelci, „v dráze") | 'goal' (kurzor na branku).
const { createMatch, stepMatch, makeInput, applyClientInput, faceoff } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK } = await import('../public/js/constants.js');
export const GX = RINK.goalLineRight, GY = RINK.goalY + RINK.goalH / 2, BASE = Object.getPrototypeOf(Player.prototype);
export const ev = { deflect: 0 };
const _td = BASE.tryDeflect;
BASE.tryDeflect = function (puck) { const r = _td.call(this, puck); if (r) ev.deflect++; return r; };

export function scene({ c = 0.6, d = 60, ly = 0, sy = 0, o = 0, q = null, stance = 'shooter', hold = false, oppShot = false, ay = 0, high = false, ticks = 150, seed = 7 } = {}) {
  const m = createMatch(seed, {});
  const me = new Player('h0', oppShot ? 'away' : 'home', makeInput()), sh = new Player('h1', 'home', makeInput());
  for (const p of [me, sh]) { m.players.set(p.id, p); m.inputs.set(p.id, p.input); m.world.entities.push(p); }
  faceoff(m); m.setup = false; m.stoppage = false; m.world._goalLock = false;
  me.x = GX - d; me.y = GY + ly; sh.x = RINK.blueLineRight + 25; sh.y = GY + sy;
  for (const p of [me, sh]) { p.vx = p.vy = 0; }
  const P = m.puck; P.x = 540; P.y = 30; P.vx = P.vy = P.vz = 0; P.z = 0; P.faceoffTimer = 0; P._carrier = null;
  const aimMe = () => stance === 'goal' ? Math.atan2(GY + ay - me.y, GX - me.x) : Math.atan2(sh.y - me.y, sh.x - me.x);
  const aimDist = Math.hypot(GX - me.x, GY + ay - me.y) + (high ? 80 : 0);   // kurzor na brankové čáře (po ledě) / 80 px za ní (nahoru)
  const inMe = (kq) => ({ dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq, aim: aimMe(), aimDist });
  const inSh = { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, kq: false, aim: Math.atan2(me.y - sh.y, me.x - sh.x), aimDist: 0 };
  for (const p of [me, sh]) { p.aimAngle = p.bodyAngle = p.skateAngle = p.carryAngle = p === me ? aimMe() : inSh.aim; }
  for (let t = 0; t < 40; t++) { applyClientInput(me.input, inMe(false)); applyClientInput(sh.input, inSh); stepMatch(m); me.x = GX - d; me.y = GY + ly; me.vx = me.vy = 0; }
  // cíl rány: čepel + kolmý posun o
  const T0 = me.stickTip;   // rána míří na čepel (hráč si nastaví hůl do dráhy; u stance goal hůl míří k brance)
  let ang = 0; for (let i = 0; i < 4; i++) { const st = sh.stickTip; ang = Math.atan2(T0.y - st.y, T0.x - st.x); sh.carryAngle = ang; }
  const T = { x: T0.x - Math.sin(ang) * o, y: T0.y + Math.cos(ang) * o };
  for (let i = 0; i < 4; i++) { const st = sh.stickTip; sh.carryAngle = Math.atan2(T.y - st.y, T.x - st.x); }
  sh.aimDist = 0; sh.shoot(P, c);
  if (oppShot) P._shot.team = 'home';   // ty jsi 'away' → rána soupeře
  const e0 = ev.deflect, r = { passive: 0, picked: false, goal: false, saved: false, redir: false, redirTick: -1, aimOk: false, v0: Math.hypot(P.vx, P.vy), vOut: 0, z: 0 };
  const g = m.goalieR;
  for (let t = 0; t < ticks; t++) {
    const kq = q != null && (hold ? t >= q && t < q + 12 : t === q);
    applyClientInput(me.input, inMe(kq)); applyClientInput(sh.input, inSh);
    const n0 = me._deflN || 0, sf0 = g._saveFlash || 0;
    stepMatch(m);
    if (!me.hasPuck && !r.picked) { const tp = me.stickTip, dt = Math.hypot(P.x - tp.x, P.y - tp.y); if (dt < (r.minTip ?? 1e9)) { r.minTip = dt; r.zAtMin = P.z; r.vAtMin = Math.hypot(P.vx, P.vy); } }
    me.x = GX - d; me.y = GY + ly; me.vx = me.vy = 0;   // stojí ve slotu (hrana: tělo nedrží jinak)
    if ((me._deflN || 0) > n0 && !r.redir) {
      const O = me._deflOut; r.redir = true; r.redirTick = t; r.vOut = Math.hypot(O.vx, O.vy); r.vIn = O.vin; r.tq = O.tq; r.zLine = O.zLine; r.z = P.z; r.vz = P.vz;
      const tt = (GX - O.x) / (O.vx || 1e-9), yAt = O.y + O.vy * tt;   // přímka k brankové čáře (hned po teči)
      r.aimOk = O.vx > 0 && yAt > RINK.goalY - 8 && yAt < RINK.goalY + RINK.goalH + 8; r.yAt = yAt;
    }
    if (me.hasPuck) r.picked = true;
    if ((g._saveFlash || 0) > sf0 + 0.05 || g.isHolding) r.saved = true;
    if (m.score.home + m.score.away > 0) { r.goal = true; break; }
  }
  r.passive = ev.deflect - e0;
  return r;
}
// okno: tiky stisku Q, které vedou k přesměrování (jedno ťuknutí)
export function windowTicks(opts) { const ts = []; for (let q = 0; q < 75; q++) { if (scene({ ...opts, q }).redir) ts.push(q); else if (ts.length) break; } return ts; }   // okno je souvislé
