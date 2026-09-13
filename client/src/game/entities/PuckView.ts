import { Container, Graphics } from 'pixi.js';
import { PUCK_R, COLORS } from '../../config/constants';
import type { PuckStateMsg } from '@flathockey/shared';

const TRAIL_MAX = 8;

export class PuckView {
  readonly container = new Container();
  private trail = new Graphics();
  private body  = new Graphics();

  private trailSamples: { x: number; y: number }[] = [];

  // Cached state for drawPuck
  private cachedOwnerId: string | null | undefined = undefined;
  private cachedX = NaN;
  private cachedY = NaN;

  constructor() {
    this.container.addChild(this.trail, this.body);
  }

  update(puck: PuckStateMsg) {
    const { x, y, vx = 0, vy = 0, radius = PUCK_R, ownerId } = puck;
    const r = Math.max(3, radius * 0.38);
    const speed = Math.hypot(vx, vy);

    // Trail — only when loose and moving fast
    if (!ownerId && speed > 30) {
      this.trailSamples.unshift({ x, y });
      if (this.trailSamples.length > TRAIL_MAX) this.trailSamples.pop();
    } else {
      this.trailSamples = [];
    }

    this.drawTrail(vx, vy, speed, r);

    // Always update body position (cheap)
    this.body.position.set(x, y);

    // Only rebuild puck visuals when ownerId changes or position moves > 0.5px
    const dx = x - this.cachedX;
    const dy = y - this.cachedY;
    if (ownerId !== this.cachedOwnerId || dx * dx + dy * dy > 0.25) {
      this.drawPuck(r, !!ownerId, speed);
      this.cachedOwnerId = ownerId ?? null;
      this.cachedX = x;
      this.cachedY = y;
    }
  }

  private drawTrail(vx: number, vy: number, speed: number, r: number) {
    const g = this.trail;
    g.clear();
    if (this.trailSamples.length < 2) return;

    const strength = Math.min(1, (speed - 30) / 300);
    const perpX = -vy / Math.max(1, speed);
    const perpY =  vx / Math.max(1, speed);

    for (let i = 1; i < this.trailSamples.length; i++) {
      const alpha = (1 - i / (this.trailSamples.length + 1)) * 0.35 * strength;
      const w = Math.max(0.8, r * (0.55 - i * 0.05));
      const s = this.trailSamples[i];
      const sw = w * 1.1;
      g.moveTo(s.x - perpX * sw, s.y - perpY * sw)
        .lineTo(s.x + perpX * sw, s.y + perpY * sw)
        .stroke({ color: 0xd5f0ff, width: Math.max(0.5, w), alpha });
    }
  }

  // Position is set externally via body.position.set — do NOT call g.position.set here
  private drawPuck(r: number, owned: boolean, speed: number) {
    const g = this.body;
    g.clear();

    const loose01 = owned ? 0 : Math.min(1, (speed - 10) / 300);

    if (loose01 > 0.05) {
      g.ellipse(0, 0, r * (1.2 + loose01), r * 0.85)
        .fill({ color: 0xd5f0ff, alpha: 0.06 + loose01 * 0.07 });
    }

    g.ellipse(1.5, 2, r * 0.9, r * 0.6)
      .fill({ color: 0x000000, alpha: 0.22 });

    g.circle(0, 0, r).fill(COLORS.puck);

    const rimColor = owned ? COLORS.puckOwned : COLORS.puckRim;
    g.circle(0, 0, r * 0.88).stroke({ color: rimColor, width: Math.max(0.8, r * 0.22), alpha: owned ? 0.8 : 0.55 });

    if (owned) {
      g.circle(0, 0, r * 1.35).stroke({ color: COLORS.puckOwned, width: 1.2, alpha: 0.3 });
    }

    g.circle(-r * 0.28, -r * 0.24, r * 0.2).fill({ color: 0xd0f0ff, alpha: 0.28 });
  }
}
