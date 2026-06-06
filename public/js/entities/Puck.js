import { RINK, PUCK, PLAYER } from '../constants.js';

function _resolveCorners(puck) {
  const cR = RINK.cornerR, r = PUCK.radius;
  const corners = [
    [cR, cR], [RINK.w - cR, cR],
    [cR, RINK.h - cR], [RINK.w - cR, RINK.h - cR],
  ];
  for (const [cx, cy] of corners) {
    const inQuad = (cx < RINK.w / 2 ? puck.x < cx : puck.x > cx) &&
                   (cy < RINK.h / 2 ? puck.y < cy : puck.y > cy);
    if (!inQuad) continue;
    const dx = puck.x - cx, dy = puck.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist <= cR - r) continue;
    // Puck překročil rohový oblouk — odraz
    const nx = dx / dist, ny = dy / dist; // outward normal od středu rohu
    puck.x = cx + nx * (cR - r);
    puck.y = cy + ny * (cR - r);
    const dot = puck.vx * nx + puck.vy * ny;
    if (dot > 0) { // pohybuje se ven
      puck.vx = (puck.vx - 2 * dot * nx) * PUCK.bounce;
      puck.vy = (puck.vy - 2 * dot * ny) * PUCK.bounce;
    }
  }
}

export class Puck {
  constructor() {
    this.isPuck  = true;
    this.x       = RINK.centerX;
    this.y       = RINK.h / 2;
    this.vx      = 0;
    this.vy      = 0;
    this.z       = 0;   // height above ice
    this.vz      = 0;   // vertical velocity
    this.prevX   = this.x;
    this.prevY   = this.y;
    this.prevZ   = this.z;
    this.ownerId = null;
    this.goalScored = null;
  }

  reset() {
    this.x       = RINK.centerX;
    this.y       = RINK.h / 2;
    this.vx      = 0;
    this.vy      = 0;
    this.z       = 0;
    this.vz      = 0;
    this.prevX   = this.x;
    this.prevY   = this.y;
    this.prevZ   = this.z;
    this.ownerId = null;
    this.goalScored = null;
  }

  get isAirborne() { return this.z > 1.5; }

  // Puk přesně na vykreslené lopatě majitele — sdíleno hostem i klientem,
  // ať puk drží u hokejky stejně na obou obrazovkách (konzistence).
  _cradleTo(owner) {
    const stickAng   = owner._stickDisp ?? owner.carryAngle ?? owner.aimAngle;
    const dispCharge = owner._dispCharge ?? 0;
    const reach      = (owner._dispReach ?? PLAYER.stickLen) * (1 - dispCharge * 0.30);
    const grip       = owner.gripPoint ? owner.gripPoint : { x: owner.x, y: owner.y };
    const heelX = grip.x + Math.cos(stickAng) * reach;
    const heelY = grip.y + Math.sin(stickAng) * reach;
    const bladeAngle = (owner.handed ?? 1) * Math.PI / 6.5;
    const bladeDir   = stickAng + bladeAngle;
    const along      = (0.5 - dispCharge * 0.18) * 12;
    const bx = heelX + Math.cos(bladeDir) * along;
    const by = heelY + Math.sin(bladeDir) * along;
    const bladeSide = owner.forehand !== false ? 1 : -1;
    const perpX     = -Math.sin(bladeDir);
    const perpY     =  Math.cos(bladeDir);
    const snug      = 1 - dispCharge * 0.5;
    this.x = bx + perpX * PUCK.radius * bladeSide * snug;
    this.y = by + perpY * PUCK.radius * bladeSide * snug;
    this.vx = owner.vx; this.vy = owner.vy;
    this.z = 0; this.vz = 0;
  }

  // Klient (non-host): puk řídí stav od hosta. Drží-li puk hráč → cradle lokálně
  // (žádný lag/rozjezd). Volný puk → plynulá konvergence k poslední pozici od hosta.
  _interpolateNet(dt, world) {
    this.prevX = this.x; this.prevY = this.y;
    const owner = world.players.find(p => p.hasPuck);
    if (owner) { this._cradleTo(owner); this.ownerId = owner.id; return; }
    this.ownerId = null;
    if (this._netX === undefined) return;
    const k = Math.min(1, 24 * dt);
    this.x += (this._netX - this.x) * k;
    this.y += (this._netY - this.y) * k;
  }

  update(dt, world) {
    if (!world.authoritative) { this._interpolateNet(dt, world); return; }

    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;

    const owner = world.players.find(p => p.hasPuck);
    if (owner) {
      // Guest drží puk → jeho pozici diktuje guestův klient (přišla v jeho stavu jako
      // ppx/ppy a je už nastavená). Host ji NEpřepisuje cradlem → nulový lag/desync.
      if (owner.isRemote) {
        this.z = 0; this.vz = 0;
        this.ownerId = owner.id;
        return;
      }
      const tip = owner.stickTip;
      if (_insideCage(tip.x, tip.y)) {
        owner.hasPuck = false;
        this.ownerId  = null;
        return;
      }
      // Host drží puk → cradle na lopatu (sdílená geometrie s klientem i _renderPlayer)
      this._cradleTo(owner);
      this.ownerId = owner.id;
      return;
    }

    this.ownerId = null;

    // Height physics
    if (this.z > 0 || this.vz > 0) {
      this.vz -= PUCK.gravity * dt;
      this.z  += this.vz * dt;
      if (this.z <= 0) {
        this.z  = 0;
        this.vz = this.vz < -60 ? -this.vz * 0.12 : 0; // tiny bounce on hard impact
      }
    }

    const spd = Math.hypot(this.vx, this.vy);
    if (spd > 0) {
      // Airborne puck has less ice friction
      const friction = this.isAirborne ? PUCK.decel * 0.05 : PUCK.decel;
      const newSpd = Math.max(0, spd - friction * dt);
      this.vx = this.vx / spd * newSpd;
      this.vy = this.vy / spd * newSpd;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.y < PUCK.radius)          { this.y = PUCK.radius;          this.vy =  Math.abs(this.vy) * PUCK.bounce; }
    if (this.y > RINK.h - PUCK.radius) { this.y = RINK.h - PUCK.radius; this.vy = -Math.abs(this.vy) * PUCK.bounce; }
    if (this.x < PUCK.radius)          { this.x = PUCK.radius;          this.vx =  Math.abs(this.vx) * PUCK.bounce; }
    if (this.x > RINK.w - PUCK.radius) { this.x = RINK.w - PUCK.radius; this.vx = -Math.abs(this.vx) * PUCK.bounce; }

    // Rounded corner arcs — puk se odráží od zakřivených rohů
    _resolveCorners(this);

    // Player body blocks puck — prevents passing through
    if (!this.isAirborne) {
      for (const p of world.players) {
        if (p.hasPuck) continue;
        const dx = this.x - p.x, dy = this.y - p.y;
        const dist = Math.hypot(dx, dy);
        const minD = (p.radius ?? PLAYER.radius) + PUCK.radius;
        if (dist < minD && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          this.x = p.x + nx * (minD + 0.5);
          this.y = p.y + ny * (minD + 0.5);
          const dot = this.vx * nx + this.vy * ny;
          if (dot < 0) {
            this.vx = (this.vx - 2 * dot * nx) * 0.45;
            this.vy = (this.vy - 2 * dot * ny) * 0.45;
          }
        }
      }
    }

    // Pevné stěny sítě (vršek/spodek/záda) — puk projde dovnitř JEN ústím zepředu
    _resolveNetWalls(this);
    // Jednotná branková mechanika: tyčky+břevno → detekce → udržení v síti
    this.goalScored = _resolveGoals(this);
  }

  draw(ctx, cam) {
    const s    = cam.scale;
    const { ox, oy } = cam;
    const sx   = ox + this.x * s;
    const sy   = oy + this.y * s;
    const r    = PUCK.radius * s;
    const elev = this.z * s;

    if (this.z > 0.5) {
      // Shadow on ice (grows and fades as puck rises)
      const shadowScale = 1 + this.z / 25;
      ctx.beginPath();
      ctx.ellipse(sx + 2, sy + 2.5, r * shadowScale, r * shadowScale * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.3 - this.z / 60)})`;
      ctx.fill();

      // Puck drawn elevated
      ctx.beginPath();
      ctx.arc(sx, sy - elev, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    } else {
      // Ground-level puck
      ctx.beginPath();
      ctx.ellipse(sx + 1.5, sy + 2, r * 0.9, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1 * s;
      ctx.stroke();
    }
  }
}

function _insideCage(x, y) {
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  if (y <= gy1 || y >= gy2) return false;
  const d = RINK.goalDepth;
  return (x > RINK.goalLineLeft - d && x < RINK.goalLineLeft) ||
         (x > RINK.goalLineRight  && x < RINK.goalLineRight + d);
}

// Pevné stěny sítě z VNĚJŠKU — vršek, spodek a zadní stěna jsou pevné; otevřené je
// jen ústí (přední čára mezi tyčkami). Puk se tak nedostane do branky přes mřížku.
function _resolveNetWalls(puck) {
  const r   = PUCK.radius;
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  const d   = RINK.goalDepth;
  const pxPrev = puck.prevX ?? puck.x, pyPrev = puck.prevY ?? puck.y;
  const railTop = gy1 - r, railBot = gy2 + r;
  const nets = [
    { lineX: RINK.goalLineRight, backX: RINK.goalLineRight + d, dir: +1 },
    { lineX: RINK.goalLineLeft,  backX: RINK.goalLineLeft  - d, dir: -1 },
  ];
  for (const { lineX, backX, dir } of nets) {
    const lo = Math.min(lineX, backX), hi = Math.max(lineX, backX);
    const inDepthX = puck.x > lo - r && puck.x < hi + r;   // v hloubkovém rozsahu branky
    const inNetY   = puck.y > gy1 && puck.y < gy2;          // ve výškovém rozsahu branky
    // Vrchní mantinel (swept, z vnějšku shora) — neprojde mřížkou shora
    if (inDepthX && puck.vy > 0 && pyPrev <= railTop && puck.y > railTop) {
      puck.y = railTop; puck.vy = -Math.abs(puck.vy) * PUCK.bounce;
    }
    // Spodní mantinel (swept, zdola)
    if (inDepthX && puck.vy < 0 && pyPrev >= railBot && puck.y < railBot) {
      puck.y = railBot; puck.vy = Math.abs(puck.vy) * PUCK.bounce;
    }
    // Zadní stěna (swept, z vnějšku) — puk zezadu se odrazí, neprojde zády
    if (inNetY) {
      if (dir > 0 && puck.vx < 0 && pxPrev >= hi + r && puck.x < hi + r) { puck.x = hi + r; puck.vx = Math.abs(puck.vx) * PUCK.bounce; }
      if (dir < 0 && puck.vx > 0 && pxPrev <= lo - r && puck.x > lo - r) { puck.x = lo - r; puck.vx = -Math.abs(puck.vx) * PUCK.bounce; }
    }
  }
}

// ── Jednotná branková mechanika ──────────────────────────────────────────
// Jeden průchod per gól, jedna geometrie: (1) tyčky + břevno odrazí, (2) detekce
// gólu při průletu čárou mezi tyčkami pod břevnem, (3) síť puk udrží uvnitř.
const POST_R = 2.5; // tloušťka tyčky

function _resolveGoals(puck) {
  const d = RINK.goalDepth;
  return _resolveOneGoal(puck, RINK.goalLineRight, RINK.goalLineRight + d, +1, 'goal-home')
      || _resolveOneGoal(puck, RINK.goalLineLeft,  RINK.goalLineLeft  - d, -1, 'goal-away');
}

// lineX = branková čára, backX = zadní stěna sítě, dir = směr do branky (+1 vpravo)
function _resolveOneGoal(puck, lineX, backX, dir, result) {
  const r    = PUCK.radius;
  const gy1  = RINK.goalY;
  const gy2  = RINK.goalY + RINK.goalH;
  const cbar = PUCK.crossbarHeight;

  // (1) Tyčky — pevná kolečka v rozích ústí; odrazí puk, který je trefí
  for (const py of [gy1, gy2]) {
    const dx = puck.x - lineX, dy = puck.y - py;
    const dist = Math.hypot(dx, dy);
    const minD = r + POST_R;
    if (dist > 0 && dist < minD && puck.z <= cbar) {
      const nx = dx / dist, ny = dy / dist;
      puck.x = lineX + nx * minD;
      puck.y = py + ny * minD;
      const dot = puck.vx * nx + puck.vy * ny;
      if (dot < 0) {
        puck.vx = (puck.vx - 2 * dot * nx) * PUCK.bounce;
        puck.vy = (puck.vy - 2 * dot * ny) * PUCK.bounce;
      }
    }
  }

  // (2) Detekce gólu — swept průlet čárou dovnitř, mezi tyčkami, pod břevnem
  let goal = false;
  const prevX = puck.prevX ?? puck.x;
  const prevSide = dir * (prevX - lineX);
  const curSide  = dir * (puck.x - lineX);
  if (prevSide <= 0 && curSide > 0) {
    const dxm = puck.x - prevX;
    const t   = Math.abs(dxm) > 1e-9 ? (lineX - prevX) / dxm : 0;
    const yAt = (puck.prevY ?? puck.y) + (puck.y - (puck.prevY ?? puck.y)) * t;
    const zAt = (puck.prevZ ?? puck.z) + (puck.z - (puck.prevZ ?? puck.z)) * t;
    if (yAt > gy1 + POST_R && yAt < gy2 - POST_R) {
      if (zAt <= cbar) {
        goal = true;
      } else {
        // Trefil břevno — odraz zpět a dolů, není gól
        puck.x  = lineX - dir * (r + 0.5);
        puck.vx = -dir * Math.abs(puck.vx) * PUCK.bounce;
        puck.z  = cbar;
        puck.vz = -Math.abs(puck.vz) * 0.4;
      }
    }
  }

  // (3) Síť — puk uvnitř branky se utlumí (mesh) a drží, nevyletí zpět ústím
  const lo = Math.min(lineX, backX);
  const hi = Math.max(lineX, backX);
  if (puck.x > lo && puck.x < hi && puck.y > gy1 && puck.y < gy2) {
    puck.vx *= 0.5; puck.vy *= 0.5; puck.vz = 0; puck.z = 0;
    // zadní stěna
    if (dir > 0) { if (puck.x + r > backX) { puck.x = backX - r; if (puck.vx > 0) puck.vx *= -0.2; } }
    else         { if (puck.x - r < backX) { puck.x = backX + r; if (puck.vx < 0) puck.vx *= -0.2; } }
    // boční tyče zevnitř
    if (puck.y - r < gy1) { puck.y = gy1 + r; if (puck.vy < 0) puck.vy *= -0.2; }
    if (puck.y + r > gy2) { puck.y = gy2 - r; if (puck.vy > 0) puck.vy *= -0.2; }
    // jednosměrné ústí — puk neproklouzne zpět přes čáru ven
    if (dir > 0) { if (puck.x < lineX + r) { puck.x = lineX + r; if (puck.vx < 0) puck.vx = 0; } }
    else         { if (puck.x > lineX - r) { puck.x = lineX - r; if (puck.vx > 0) puck.vx = 0; } }
  }

  return goal ? result : null;
}
