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
      const e = _reb(dot) * 0.8;   // rohy tlumenější než rovné mantinely (nevystřelí puk)
      puck.vx = (puck.vx - 2 * dot * nx) * e;
      puck.vy = (puck.vy - 2 * dot * ny) * e;
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
    this._inNet  = false;   // usazený v brance (po gólu) → tvrdě držen v boxu sítě
    this.trailColor = null; // barva stopy/overlaye (dle posledního střelce; null = default)
    this.faceoffTimer = 0;  // bully freeze — po dobu > 0 nikdo nemůže sebrat puk
  }

  reset() {
    this.x       = RINK.centerX;
    this.y       = RINK.h / 2;
    // Drobný náhodný kopanec — jako rozhoz rozhodčího, ne přesně statický puk
    const kickAngle = Math.random() * Math.PI * 2;
    this.vx      = Math.cos(kickAngle) * 22;
    this.vy      = Math.sin(kickAngle) * 22;
    this.z       = 0;
    this.vz      = 0;
    this.prevX   = this.x;
    this.prevY   = this.y;
    this.prevZ   = this.z;
    this.ownerId = null;
    this.goalScored = null;
    this.faceoffTimer = 0.7;  // bully freeze: ~0.7s nikdo nesmí sebrat
    this._inNet  = false;   // usazený v brance (po gólu) → tvrdě držen v boxu sítě
    this.trailColor = null; // barva stopy/overlaye (dle posledního střelce; null = default)
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
    // Spojitá strana puku na čepeli → plynulé míchání forhend↔bekhend (dribling)
    const bladeSide = owner._cradleSide ?? (owner.forehand !== false ? 1 : -1);
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
    if (this.faceoffTimer > 0) this.faceoffTimer -= dt;

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
      // alreadyCarried: přeskočí první frame sběru (prevX = volný puk na ledě)
      const alreadyCarried = (this.ownerId === owner.id);
      this._cradleTo(owner);
      this.ownerId = owner.id;
      if (alreadyCarried) {
        // Lightweight swept check BEZ kolizí tyček — _resolveGoals nesmíme volat
        // protože post-collision kód by odstrčil puk.x za čáru → falešný gól každý frame
        const g = _carryGoalCheck(this);
        if (g) { this.goalScored = g; owner.hasPuck = false; this.ownerId = null; return; }
      }
      // Zahoď puk jen když je TĚLO hráče uvnitř sítě (ne jen lopata/špička)
      // Kontrola puku (this.x/y) způsobovala jitter: lopata sahala do klece →
      // hasPuck=false → tryPickup → hasPuck=true → každý frame
      if (_insideCage(owner.x, owner.y)) { owner.hasPuck = false; this.ownerId = null; }
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

    if (this.y < PUCK.radius)          { this.y = PUCK.radius;          this.vy =  Math.abs(this.vy) * _reb(this.vy); }
    if (this.y > RINK.h - PUCK.radius) { this.y = RINK.h - PUCK.radius; this.vy = -Math.abs(this.vy) * _reb(this.vy); }
    if (this.x < PUCK.radius)          { this.x = PUCK.radius;          this.vx =  Math.abs(this.vx) * _reb(this.vx); }
    if (this.x > RINK.w - PUCK.radius) { this.x = RINK.w - PUCK.radius; this.vx = -Math.abs(this.vx) * _reb(this.vx); }

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
            const e = _reb(dot);   // rychlá rána do těla se utlumí (žádný obří odraz)
            this.vx = (this.vx - 2 * dot * nx) * e;
            this.vy = (this.vy - 2 * dot * ny) * e;
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
    const tcol = this.trailColor || '#9aa3b2';   // barva stopy/overlaye (dle hráče, jinak default šedá)

    // Trail — větší a širší, ale jemná (méně výrazná)
    const tr = this._trail || (this._trail = []);
    tr.push({ x: this.x, y: this.y, z: this.z });
    if (tr.length > 14) tr.shift();
    for (let i = 0; i < tr.length - 1; i++) {
      const p = tr[i], f = i / tr.length;
      ctx.beginPath();
      ctx.arc(ox + p.x * s, oy + (p.y - p.z) * s, r * (0.35 + 0.65 * f), 0, Math.PI * 2);
      ctx.fillStyle = _alpha(tcol, f * 0.15);
      ctx.fill();
    }

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

    // Overlay — jemnější, méně výrazná záře
    ctx.save();
    ctx.shadowColor = tcol;
    ctx.shadowBlur  = 1.5 * s;
    ctx.beginPath();
    ctx.arc(sx, sy - elev, r + 1.5 * s, 0, Math.PI * 2);
    ctx.strokeStyle = _alpha(tcol, 0.22);
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
    ctx.restore();
  }
}

function _alpha(col, a) {
  if (typeof col !== 'string' || col[0] !== '#' || col.length < 7) return col;
  const n = parseInt(col.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Odraz závislý na rychlosti — rychlá rána ztratí víc energie (žádné obří odrazy),
// pomalý puk se odrazí živě. (sp = složka rychlosti do překážky)
// Realističtější odrazy: max 0.82 (rychlý puk 80%), min 0.45 (extrémní nárazy)
function _reb(sp) { return Math.max(0.45, 0.82 - Math.abs(sp) / 1800); }

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
  const px  = puck.prevX ?? puck.x, py = puck.prevY ?? puck.y;
  const nets = [
    { lineX: RINK.goalLineRight, backX: RINK.goalLineRight + d, dir: +1 },
    { lineX: RINK.goalLineLeft,  backX: RINK.goalLineLeft  - d, dir: -1 },
  ];
  for (const { lineX, backX, dir } of nets) {
    const lo = Math.min(lineX, backX), hi = Math.max(lineX, backX);
    // Použij sjednocení prev+cur pro X/Y rozsah — zachytí diagonální průnik
    const inX = (puck.x > lo - r && puck.x < hi + r) || (px > lo - r && px < hi + r);
    const inY = (puck.y > gy1    && puck.y < gy2)    || (py > gy1    && py < gy2);

    // Vrchní mantinel — blokuj puk přicházející ZESHORA (py < gy1)
    if (inX && py < gy1 && puck.y >= gy1 - r) {
      puck.y = gy1 - r;
      if (puck.vy > 0) puck.vy = -Math.abs(puck.vy) * _reb(puck.vy);
    }
    // Spodní mantinel — blokuj zdola (py > gy2)
    if (inX && py > gy2 && puck.y <= gy2 + r) {
      puck.y = gy2 + r;
      if (puck.vy < 0) puck.vy = Math.abs(puck.vy) * _reb(puck.vy);
    }
    // Zadní stěna — blokuj z vnějšku (za brankou)
    if (inY) {
      if (dir > 0 && px > hi && puck.x <= hi + r) { puck.x = hi + r; if (puck.vx < 0) puck.vx =  Math.abs(puck.vx) * _reb(puck.vx); }
      if (dir < 0 && px < lo && puck.x >= lo - r) { puck.x = lo - r; if (puck.vx > 0) puck.vx = -Math.abs(puck.vx) * _reb(puck.vx); }
    }
  }
}

// Při nesení puku — jen swept průlet čárou, BEZ kolizí tyček ani containmentu.
// _resolveGoals nesmíme volat: post-collision kód by odstrčil puk za čáru → falešný gól.
function _carryGoalCheck(puck) {
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  const cbar = PUCK.crossbarHeight;
  const prevX = puck.prevX ?? puck.x, prevY = puck.prevY ?? puck.y;
  const POST_R = 2.5;
  for (const [lineX, dir, result] of [
    [RINK.goalLineRight, +1, 'goal-home'],
    [RINK.goalLineLeft,  -1, 'goal-away'],
  ]) {
    const prevSide = dir * (prevX - lineX);
    const curSide  = dir * (puck.x  - lineX);
    if (prevSide > 0 || curSide <= 0) continue;  // nešel přes čáru
    const dxm = puck.x - prevX;
    const t   = Math.abs(dxm) > 1e-9 ? (lineX - prevX) / dxm : 0;
    const yAt = prevY + (puck.y - prevY) * t;
    if (yAt > gy1 + POST_R && yAt < gy2 - POST_R && puck.z <= cbar) {
      puck._inNet = true;
      puck._netLo = dir > 0 ? lineX : lineX - RINK.goalDepth;
      puck._netHi = dir > 0 ? lineX + RINK.goalDepth : lineX;
      return result;
    }
  }
  return null;
}

// ── Jednotná branková mechanika ──────────────────────────────────────────
// Jeden průchod per gól, jedna geometrie: (1) tyčky + břevno odrazí, (2) detekce
// gólu při průletu čárou mezi tyčkami pod břevnem, (3) síť puk udrží uvnitř.
const POST_R = 2.5; // tloušťka tyčky

function _resolveGoals(puck) {
  const d = RINK.goalDepth;
  const g = _resolveOneGoal(puck, RINK.goalLineRight, RINK.goalLineRight + d, +1, 'goal-home')
         || _resolveOneGoal(puck, RINK.goalLineLeft,  RINK.goalLineLeft  - d, -1, 'goal-away');
  _containInNet(puck);   // drž usazený puk v brance (po gólu)
  return g;
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
        const e = _reb(dot);
        puck.vx = (puck.vx - 2 * dot * nx) * e;
        puck.vy = (puck.vy - 2 * dot * ny) * e;
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
        puck._inNet = true;                       // od teď puk tvrdě držíme v boxu sítě
        puck._netLo = Math.min(lineX, backX);
        puck._netHi = Math.max(lineX, backX);
      } else {
        // Trefil břevno — odraz zpět a dolů, není gól
        puck.x  = lineX - dir * (r + 0.5);
        puck.vx = -dir * Math.abs(puck.vx) * _reb(puck.vx);
        puck.z  = cbar;
        puck.vz = -Math.abs(puck.vz) * 0.4;
      }
    }
  }

  return goal ? result : null;
}

// Puk usazený v brance — TVRDÝ box (žádné tunelování): vletí dovnitř, odrazí se od
// zadní/boční stěny a mesh ho během ~1 s utlumí. Ústím ven nevyletí.
function _containInNet(puck) {
  if (!puck._inNet) return;
  const r   = PUCK.radius;
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  const xLo = puck._netLo + r, xHi = puck._netHi - r;
  const yLo = gy1 + r,         yHi = gy2 - r;
  const MESH = 0.92, REST = 0.45;
  puck.vx *= MESH; puck.vy *= MESH; puck.vz = 0; puck.z = 0;
  if (puck.x < xLo) { puck.x = xLo; if (puck.vx < 0) puck.vx = -puck.vx * REST; }
  if (puck.x > xHi) { puck.x = xHi; if (puck.vx > 0) puck.vx = -puck.vx * REST; }
  if (puck.y < yLo) { puck.y = yLo; if (puck.vy < 0) puck.vy = -puck.vy * REST; }
  if (puck.y > yHi) { puck.y = yHi; if (puck.vy > 0) puck.vy = -puck.vy * REST; }
}
