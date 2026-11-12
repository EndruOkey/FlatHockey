import { RINK } from './constants.js';

// HiDPI: backing store = CSS velikost × dpr (main.js resizeCanvas). Herní/UI souřadnice jsou v CSS px →
// rozměry plátna čti přes viewW/viewH, ne canvas.width/height (to jsou fyzické pixely).
export const viewW = c => c.cssW || c.width;
export const viewH = c => c.cssH || c.height;

export function computeCamera(canvas) {
  const pad = 48;
  const scale = Math.min(
    (viewW(canvas) - pad * 2) / RINK.w,
    (viewH(canvas) - pad * 2) / RINK.h
  );
  return {
    scale,
    ox: (viewW(canvas) - RINK.w * scale) / 2,
    oy: (viewH(canvas) - RINK.h * scale) / 2,
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
    this.onTick      = null; // (dt, cam) => void — pre-update hook for input/network
    this.onAfterTick = null; // (dt, cam) => void — post-physics hook (read puck._ev etc.)
    this.onDraw      = null; // (ctx, cam) => void — post-draw hook for HUD overlay
    this.cameraOverride = null; // (canvas) => cam — optional custom camera computation
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

    const cam = this.cameraOverride ? this.cameraOverride(this.canvas) : computeCamera(this.canvas);
    const ctx = this.canvas.getContext('2d');
    const dpr = this.canvas.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // kreslení v CSS px, ostré na HiDPI

    const sdt = dt * (this.tempo ?? 1);   // lokální simulace (trénink/tutoriál) běží v herním tempu
    this.onTick?.(sdt, cam);
    this._world.update(sdt);
    this.onAfterTick?.(sdt, cam);
    // HODINY VYKRESLOVÁNÍ: animace čtou cam.dt / cam.t (ne Date.now) → stejná sekvence snímků = stejný obraz
    this._rt = (this._rt || 0) + dt; cam.dt = dt; cam.t = this._rt;
    this._world.draw(ctx, cam);
    this.onDraw?.(ctx, cam);

    requestAnimationFrame(ts => this._loop(ts));
  }
}
