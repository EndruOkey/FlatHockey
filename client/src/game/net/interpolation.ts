import { lerp, lerpAngle } from '../util/math';

type Timed<T> = { t: number; value: T };
export type InterpolationSample<T> = {
  value: T;
  t0: number;
  t1: number;
};
export type LatestSample<T> = {
  t: number;
  value: T;
};

export class Interpolator<T> {
  private samples: Timed<T>[] = [];
  private readonly capacity: number;

  constructor(capacity = 30) {
    this.capacity = capacity;
  }

  push(value: T, t = performance.now()) {
    this.samples.push({ t, value });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  size() {
    return this.samples.length;
  }

  clear() {
    this.samples.length = 0;
  }

  newestTime() {
    if (this.samples.length === 0) return null;
    return this.samples[this.samples.length - 1].t;
  }

  oldestTime() {
    if (this.samples.length === 0) return null;
    return this.samples[0].t;
  }

  latest(): LatestSample<T> | null {
    if (this.samples.length === 0) return null;
    const last = this.samples[this.samples.length - 1];
    return { t: last.t, value: last.value };
  }

  sampleWithMeta(renderTime: number, lerpFn: (a: T, b: T, t: number) => T): InterpolationSample<T> | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1) {
      const only = this.samples[0];
      return { value: only.value, t0: only.t, t1: only.t };
    }

    let a = this.samples[0];
    let b = this.samples[this.samples.length - 1];

    for (let i = 0; i < this.samples.length - 1; i += 1) {
      const s0 = this.samples[i];
      const s1 = this.samples[i + 1];
      if (renderTime >= s0.t && renderTime <= s1.t) {
        a = s0;
        b = s1;
        break;
      }
    }

    const span = Math.max(1, b.t - a.t);
    const t = Math.max(0, Math.min(1, (renderTime - a.t) / span));
    return { value: lerpFn(a.value, b.value, t), t0: a.t, t1: b.t };
  }

  sample(renderTime: number, lerpFn: (a: T, b: T, t: number) => T): T | null {
    return this.sampleWithMeta(renderTime, lerpFn)?.value ?? null;
  }
}

export type LerpPlayer = {
  x: number;
  y: number;
  rot: number;
  aimRot?: number;
  moveRot?: number;
  baseRot?: number;
  speed?: number;
};
export const lerpPlayer = (a: LerpPlayer, b: LerpPlayer, t: number): LerpPlayer => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  rot: lerpAngle(a.rot, b.rot, t),
  aimRot: lerpAngle(a.aimRot ?? a.rot, b.aimRot ?? b.rot, t),
  moveRot: lerpAngle(a.moveRot ?? a.rot, b.moveRot ?? b.rot, t),
  baseRot: lerpAngle(a.baseRot ?? a.rot, b.baseRot ?? b.rot, t),
  speed: lerp(a.speed ?? 0, b.speed ?? 0, t)
});

export type LerpPuck = { x: number; y: number };
export const lerpPuck = (a: LerpPuck, b: LerpPuck, t: number): LerpPuck => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t)
});
