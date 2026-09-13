import type { Application, Container } from 'pixi.js';
import { RINK } from '../../config/constants';

const PADDING = 0.98; // rink takes 98% of screen

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  private screenW = 0;
  private screenH = 0;

  constructor(app: Application) {
    this.resize(app.screen.width, app.screen.height);
  }

  resize(w: number, h: number) {
    this.screenW = w;
    this.screenH = h;
    const sx = (w / RINK.width)  * PADDING;
    const sy = (h / RINK.height) * PADDING;
    this.scale   = Math.min(sx, sy);
    this.offsetX = w / 2;
    this.offsetY = h / 2;
  }

  // Apply transform to a container so world(0,0) = screen center
  applyTo(container: Container) {
    container.position.set(this.offsetX, this.offsetY);
    container.scale.set(this.scale);
  }

  // World → screen
  worldToScreen(wx: number, wy: number) {
    return {
      x: wx * this.scale + this.offsetX,
      y: wy * this.scale + this.offsetY,
    };
  }

  // Screen → world
  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }
}
