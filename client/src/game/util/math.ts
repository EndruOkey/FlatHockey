export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const wrapToPi = (angle: number) => {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
};
export const lerpAngle = (a: number, b: number, t: number) => {
  return a + wrapToPi(b - a) * t;
};
