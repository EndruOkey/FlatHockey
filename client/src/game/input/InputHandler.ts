import { PLAYER } from '../../config/constants';
import type { Camera } from '../camera/Camera';

const FULL_DIST = 110; // world units at which full speed is reached
const INERTIA   = 8;   // velocity lerp speed per second (higher = less sliding)

export type RawInput = {
  moveX:    number;   // -1..1 analog
  moveY:    number;   // -1..1 analog
  aimAngle: number;
  aimDist:  number;
  shoot:    boolean;
  pass:     boolean;
  drop:     boolean;
  stop:     boolean;
};

export class InputHandler {
  private mouseX = 0;
  private mouseY = 0;
  private lmb    = false;
  private rmb    = false;
  private mmb    = false;
  private _space = false;

  // Smoothed velocity for ice-momentum feel
  private smoothX = 0;
  private smoothY = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.lmb = true;
      if (e.button === 1) { this.mmb = true; e.preventDefault(); }
      if (e.button === 2) this.rmb = true;
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 1) this.mmb = false;
      if (e.button === 2) this.rmb = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => { if (e.code === 'Space') this._space = true; });
    window.addEventListener('keyup',   (e) => { if (e.code === 'Space') this._space = false; });
  }

  buildInput(playerX: number, playerY: number, camera: Camera, dtMs = 16): RawInput {
    const world = camera.screenToWorld(this.mouseX, this.mouseY);
    const dx    = world.x - playerX;
    const dy    = world.y - playerY;
    const dist  = Math.hypot(dx, dy);
    const aimAngle = Math.atan2(dy, dx);

    // Distance-based speed: 0 in deadzone, linear ramp to 1 at FULL_DIST
    const speed = dist <= PLAYER.deadzone
      ? 0
      : Math.min(1, (dist - PLAYER.deadzone) / (FULL_DIST - PLAYER.deadzone));

    const targetX = speed > 0 ? Math.cos(aimAngle) * speed : 0;
    const targetY = speed > 0 ? Math.sin(aimAngle) * speed : 0;

    // Frame-rate independent lerp for ice-momentum feel
    const alpha = 1 - Math.exp(-INERTIA * dtMs / 1000);
    this.smoothX += (targetX - this.smoothX) * alpha;
    this.smoothY += (targetY - this.smoothY) * alpha;

    // Snap to zero to avoid float drift when stopped
    if (speed === 0 && Math.hypot(this.smoothX, this.smoothY) < 0.015) {
      this.smoothX = 0;
      this.smoothY = 0;
    }

    return {
      moveX:    this.smoothX,
      moveY:    this.smoothY,
      aimAngle,
      aimDist:  dist,
      shoot:    this.lmb,
      pass:     this.rmb && !this.lmb,
      drop:     this.mmb,
      stop:     this._space,
    };
  }
}
