export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapToPi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  const d = wrapToPi(b - a);
  return wrapToPi(a + d * t);
}

export function expBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-Math.max(0, rate) * dt);
}

export function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = wrapToPi(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return wrapToPi(current + Math.sign(d) * maxStep);
}

export function approachScalar(current: number, target: number, maxStep: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

