import { RINK, PUCK, PLAYER } from '../constants.js';
import { PlayerBase } from './Player.js';

const RECEIVE_RADIUS   = 35;
const RETURN_DELAY     = 1.3;
const ICE_PAD          = 22;
const RECEIVE_COOLDOWN = 0.55; // prevents re-catching own return pass

export class Passer extends PlayerBase {
  constructor() {
    super('passer', 'passer');
    this.x = 350;
    this.y = RINK.h / 2;
    this.vx = 0;
    this.vy = 0;
    this.isPlayer      = false;
    this.isPasser      = true;
    this._returnTimer  = 0;
    this._shouldReturn = false;
    this._receiveCooldown = 0;
    this.isDragging    = false;
  }

  dragTo(x, y) {
    this.x = Math.max(ICE_PAD, Math.min(RINK.w - ICE_PAD, x));
    this.y = Math.max(ICE_PAD, Math.min(RINK.h - ICE_PAD, y));
    this.vx = this.vy = 0;
    this.hasPuck          = false;
    this._returnTimer     = 0;
    this._shouldReturn    = false;
    this._receiveCooldown = 0;
  }

  tryReceive(puck) {
    if (this.hasPuck || this._receiveCooldown > 0) return false;
    const dist = Math.hypot(puck.x - this.x, puck.y - this.y);
    if (dist > RECEIVE_RADIUS) return false;
    this.hasPuck       = true;
    this._returnTimer  = RETURN_DELAY;
    this._shouldReturn = false;
    puck.vx = puck.vy = puck.vz = 0;
    puck.z  = 0;
    return true;
  }

  // Player requests the puck (E or MMB)
  forceReturn() {
    if (!this.hasPuck) return;
    this._wantsToReturn = true;
  }

  update(dt, world) {
    if (this._receiveCooldown > 0) this._receiveCooldown -= dt;
    if (this._shootCooldown   > 0) this._shootCooldown   -= dt;
    if (this.passReq          > 0) this.passReq = Math.max(0, this.passReq - dt);

    // Knockback drift — když ho netáhneš Tabem, odsune ho náraz hráče a dojede s třením
    if (!this.isDragging && (this.vx || this.vy)) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const f = Math.max(0, 1 - 5 * dt);
      this.vx *= f; this.vy *= f;
      if (Math.hypot(this.vx, this.vy) < 2) this.vx = this.vy = 0;
      this.x = Math.max(ICE_PAD, Math.min(RINK.w - ICE_PAD, this.x));
      this.y = Math.max(ICE_PAD, Math.min(RINK.h - ICE_PAD, this.y));
    }

    // Aim toward local player when holding, otherwise track puck
    if (world) {
      const local  = world.players.find(p => 'input' in p);
      const puck   = world.puck;
      const target = (this.hasPuck && local) ? local : puck;
      if (target) {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        this.aimAngle  = Math.atan2(dy, dx);
        this.bodyAngle = this.aimAngle;
      }
    }
    // No auto-return timer — passer waits for explicit request (E / MMB)
  }

  draw(ctx, cam) {
    super.draw(ctx, cam); // renders full player visual (body, stick, etc.)

    const s  = cam.scale;
    const { ox, oy } = cam;
    const sx = ox + this.x * s;
    const sy = oy + this.y * s;
    const r  = PLAYER.radius * s;

    // Pulsing ring when holding puck (waiting for E/MMB request)
    if (this.hasPuck) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5 * s + pulse * 2 * s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(61,216,112,${0.5 + pulse * 0.4})`;
      ctx.lineWidth   = 2 * s;
      ctx.stroke();
    }

    // Drag-mode: dashed outline
    if (this.isDragging) {
      ctx.setLineDash([5 * s, 3 * s]);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 9 * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100,220,150,0.9)';
      ctx.lineWidth   = 2 * s;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // "Tab" label below when not dragging
    if (!this.isDragging) {
      ctx.font         = `${Math.round(8 * s)}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = 'rgba(34,204,136,0.75)';
      ctx.fillText('Tab', sx, sy + r + 2 * s);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
