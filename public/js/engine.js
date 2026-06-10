import { RINK } from './constants.js';

export function computeCamera(canvas) {
  const pad = 48;
  const scale = Math.min(
    (canvas.width  - pad * 2) / RINK.w,
    (canvas.height - pad * 2) / RINK.h
  );
  return {
    scale,
    ox: (canvas.width  - RINK.w * scale) / 2,
    oy: (canvas.height - RINK.h * scale) / 2,
  };
}

export function toScreen(wx, wy, cam) {
  return { x: cam.ox + wx * cam.scale, y: cam.oy + wy * cam.scale };
}

export function fromScreen(sx, sy, cam) {
  return { x: (sx - cam.ox) / cam.scale, y: (sy - cam.oy) / cam.scale };
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.onTick = null; // (dt, cam) => void — pre-update hook for input/network
    this.onDraw = null; // (ctx, cam) => void — post-draw hook for HUD overlay
    this._lastTime = null;
  }

  run(world) {
    this._world = world;
    this._running = true;
    requestAnimationFrame(t => this._loop(t));
  }

  stop() { this._running = false; }

  _loop(t) {
    if (!this._running) return;
    if (this._lastTime === null) this._lastTime = t;
    const dt = Math.min((t - this._lastTime) / 1000, 0.05);
    this._lastTime = t;

    const cam = computeCamera(this.canvas);
    const ctx = this.canvas.getContext('2d');

    this.onTick?.(dt, cam);
    this._world.update(dt);
    this._world.draw(ctx, cam);
    this.onDraw?.(ctx, cam);

    requestAnimationFrame(ts => this._loop(ts));
  }
}
