import { Container, Graphics, Text } from 'pixi.js';
import { PLAYER, COLORS } from '../../config/constants';
import type { PlayerStateMsg } from '@flathockey/shared';

export class PlayerView {
  readonly container   = new Container();
  private shadow       = new Graphics();
  private bodyGfx      = new Graphics();
  private bodyContainer = new Container();
  private stickGfx     = new Graphics();
  private stickContainer = new Container();
  private nameTag = new Text({
    text: '',
    style: { fontSize: 11, fill: COLORS.nameplate, fontFamily: 'monospace', fontWeight: 'bold' },
  });

  private isLocal: boolean;
  private teamColor: number = COLORS.teamA;

  // Cached state — only redraw when these change
  private cachedHasPuck: boolean | undefined    = undefined;
  private cachedTeamColor: number | undefined   = undefined;
  private cachedHandedness: string | undefined  = undefined;

  constructor(isLocal: boolean, teamColor: number = COLORS.teamA) {
    this.isLocal   = isLocal;
    this.teamColor = teamColor;

    this.nameTag.anchor.set(0.5, 1);
    this.nameTag.position.set(0, -PLAYER.radius - 10);
    this.nameTag.resolution = 2;

    this.bodyContainer.addChild(this.bodyGfx);
    this.stickContainer.addChild(this.stickGfx);

    // z-order: shadow → body → stick → nametag
    this.container.addChild(this.shadow, this.bodyContainer, this.stickContainer, this.nameTag);

    // Shadow never changes — draw once
    this.shadow.ellipse(2, 3, PLAYER.radius * 0.85, PLAYER.radius * 0.6)
      .fill({ color: 0x000000, alpha: 0.18 });
  }

  setTeamColor(color: number) {
    this.teamColor = color;
  }

  update(p: PlayerStateMsg) {
    // Position and rotation via containers — no graphics rebuild needed for movement
    this.container.position.set(p.x, p.y);
    this.bodyContainer.rotation  = p.angle;
    this.stickContainer.rotation = p.aimAngle ?? p.angle;

    const bodyDirty  = p.hasPuck !== this.cachedHasPuck || this.teamColor !== this.cachedTeamColor;
    const stickDirty = p.hasPuck !== this.cachedHasPuck || p.handedness !== this.cachedHandedness;

    if (bodyDirty) {
      this.drawBody(p.hasPuck ?? false);
      this.cachedTeamColor = this.teamColor;
    }
    if (stickDirty) {
      this.drawStick(p.hasPuck ?? false, p.handedness);
      this.cachedHandedness = p.handedness;
    }
    if (bodyDirty || stickDirty) {
      this.cachedHasPuck = p.hasPuck;
    }

    this.updateName(p);
  }

  // Drawn at angle=0 (facing right). bodyContainer.rotation handles direction.
  private drawBody(hasPuck: boolean) {
    const g  = this.bodyGfx;
    g.clear();

    const r  = PLAYER.radius;
    const tc = this.teamColor;

    if (this.isLocal) {
      g.circle(0, 0, r + 6).stroke({ color: COLORS.ownIndicator, width: 1.5, alpha: 0.22 });
    }

    if (hasPuck) {
      g.circle(0, 0, r + 5).stroke({ color: tc, width: 2.5, alpha: 0.55 });
    }

    // Pants (full circle, darker)
    g.circle(0, 0, r).fill({ color: darken(tc, 0.6) });

    // Jersey wedge — facing right at angle=0: arc from -0.6π to +0.6π
    g.moveTo(0, 0)
      .arc(0, 0, r, -Math.PI * 0.6, Math.PI * 0.6)
      .closePath()
      .fill(tc);

    // Helmet — at (r*0.22, 0) when facing right
    const helmetR = r * 0.52;
    const hx = r * 0.22;
    g.circle(hx, 0, helmetR).fill(0x1a1a2e);

    // Helmet stripe — perpendicular to forward (vertical when facing right)
    g.moveTo(hx, -helmetR * 0.7)
      .lineTo(hx,  helmetR * 0.7)
      .stroke({ color: tc, width: 3, alpha: 0.9 });

    // Visor glint — at angle=0: bx=1, by=0
    g.circle(hx + helmetR * 0.3, helmetR * 0.2, helmetR * 0.18)
      .fill({ color: 0xaaddff, alpha: 0.35 });

    // Body border
    g.circle(0, 0, r).stroke({ color: darken(tc, 0.4), width: 1.2, alpha: 0.6 });
  }

  // Drawn at aim=0 (pointing right). stickContainer.rotation handles direction.
  private drawStick(hasPuck: boolean, handedness: string | undefined) {
    const g    = this.stickGfx;
    g.clear();

    const r    = PLAYER.radius;
    const hand = handedness === 'left' ? -1 : 1;

    // At aim=0: perpX=0, perpY=hand
    const sx       = r * 0.8;
    const sy       = hand * r * 0.35;
    const shaftLen = r * 2.6;
    const ex       = sx + shaftLen;
    const ey       = sy;

    g.moveTo(sx, sy).lineTo(ex, ey)
      .stroke({ color: 0x6b3a1f, width: 2.8 });

    const bladeLen = r * 1.1;
    g.moveTo(ex, ey - hand * bladeLen * 0.2)
      .lineTo(ex, ey + hand * bladeLen * 0.8)
      .stroke({ color: hasPuck ? 0xffe080 : 0xc0c0c0, width: 3.5 });

    g.moveTo(ex, ey)
      .lineTo(ex, ey + hand * bladeLen * 0.5)
      .stroke({ color: 0x333333, width: 3.6 });
  }

  private updateName(p: PlayerStateMsg) {
    const name = p.name ?? p.id.slice(0, 8);
    if (this.nameTag.text !== name) this.nameTag.text = name;

    this.nameTag.style.fontWeight = p.hasPuck ? 'bold' : 'normal';
    this.nameTag.alpha = p.hasPuck ? 1 : 0.75;
    this.nameTag.style.fill = this.teamColor;
  }
}

function darken(color: number, factor: number): number {
  const r = ((color >> 16) & 0xff) * factor;
  const g = ((color >>  8) & 0xff) * factor;
  const b = ((color      ) & 0xff) * factor;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
