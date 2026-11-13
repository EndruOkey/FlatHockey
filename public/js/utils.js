export function lerp(a, b, t) { return a + (b - a) * t; }

// Rozdíl úhlů vždy v [−π, π) i pro libovolně „rozbalené" úhly (2026-11-13: staré (x + 3π) % 2π selhalo pro |x| > 3π →
// po ~1,5 otáčce se tělo/míření otočilo opačným směrem; test/heli.test.mjs).
const _TAU = Math.PI * 2;
function _wrapPi(x) { return ((x + Math.PI) % _TAU + _TAU) % _TAU - Math.PI; }   // rozsah [−π, π) jako dřív
export function lerpAngle(a, b, t) {
  return a + _wrapPi(b - a) * Math.min(1, t);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function angleDiff(a, b) {
  return _wrapPi(a - b);
}

export function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  if (cur > target) return Math.max(cur - step, target);
  return cur;
}
