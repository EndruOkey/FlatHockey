// Ovládání B2 „za kurzorem + zámek kurzu" (scripts/control_study.mjs: 18/24, konflikt 6,5 %, skill gap 1,15).
// W = jeď ke kurzoru (plynule, ne 8 směrů), S = od kurzoru, A/D = bokem vůči kurzoru.
// Držíš LMB/RMB (nápřah, pas, crosscheck) → kurz se zamkne na úhel ve chvíli stisku a kurzor jen míří,
// klávesy pak jedou 8 směry VŮČI zamčenému kurzu. Čistá funkce stavu + vstupu → deterministické.
export const STEER_DEAD = 24;   // px ve světě — kurzor blíž k hráči = drž poslední kurz (úhel by skákal)

export function makeSteer() { return { course: null, lock: null }; }

// keys: { w, a, s, d } (bool); me: { x, y, vx, vy }; mouse: { x, y } ve světě. Vrací { dx, dy } (jednotkový nebo 0).
export function steerB2(st, keys, me, mouse, lmb, rmb) {
  const mx = mouse.x - me.x, my = mouse.y - me.y;
  if (Math.hypot(mx, my) >= STEER_DEAD) st.course = Math.atan2(my, mx);
  else if (st.course == null) st.course = Math.hypot(me.vx || 0, me.vy || 0) > 5 ? Math.atan2(me.vy, me.vx) : -Math.PI / 2;
  if (lmb || rmb) { if (st.lock == null) st.lock = st.course; } else st.lock = null;
  const fwd = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), side = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  if (!fwd && !side) return { dx: 0, dy: 0 };
  const a = (st.lock ?? st.course) + Math.atan2(side, fwd);
  return { dx: Math.cos(a), dy: Math.sin(a) };
}
