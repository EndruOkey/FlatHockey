export function lerp(a, b, t) { return a + (b - a) * t; }

export function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * Math.min(1, t);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function angleDiff(a, b) {
  return ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

export function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  if (cur > target) return Math.max(cur - step, target);
  return cur;
}
