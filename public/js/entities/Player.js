import { RINK, PLAYER, PUCK } from '../constants.js';
import { clamp, lerpAngle, angleDiff } from '../utils.js';

export class PlayerBase {
  constructor(id, team) {
    this.id = id;
    this.team = team;
    this.x = team === 'home' ? 200 : 880;
    this.y = RINK.h / 2;
    this.vx = 0;
    this.vy = 0;
    this.bodyAngle = 0;
    this.aimAngle  = 0;
    this.skateAngle = 0;   // směr bruslení (řízený A/D); tělo kouká sem, hokejku míří myš
    this.radius          = PLAYER.radius;
    this.hasPuck         = false;
    this.forehand        = true;
    this.charge          = 0;
    this.overcharged     = false;
    this.isPlayer        = true;
    this._hockeyStop     = false;
    this._stopTimer      = 0;
    this._stopAngle      = 0;
    this._spaceWas       = false;
    this.crossCheck      = false;  // visible to world for collision
    this._crossCheckCool = 0;
    this._backhand       = false;  // auto fore/backhand (vůči směru jízdy, s hysterezí)
    this.carryAngle      = 0;      // úhel hole nesoucí puk (otáčí se omezeně → klička/anti-vrtulník)
    this.aimDist         = PLAYER.stickLen; // vzdálenost kurzoru od těla → dosah hole
    this._dispReach      = PLAYER.stickLen; // vyhlazený dosah pro vykreslení/cradle
    this._carveLoad      = 0;      // nabraná energie v zatáčce → crossover výbuch
    this._lean           = 0;      // náklon do zatáčky (vizuál)
    this._overTurnT      = 0;      // jak dlouho míříš mimo hůl (slip až po chvíli)
    this._deflectCool    = 0;      // cooldown tečování (deflection)
    this._shootCooldown  = 0;
    this._passCooldown   = 0;     // prevents crossCheck flicker after pass
    this.passReq         = 0;     // pass-request visual timer
    this._stickDisp      = this.aimAngle; // vyhlazený úhel hole pro vykreslení (bez teleportů)
    this._dispCharge     = 0;             // vyhlazený charge pro wind-up vizuál
  }

  // Plynulý úhel hole — dojíždí k cíli, takže přepnutí crosscheck / zrušení charge
  // nezpůsobí teleport. Crosscheck = před tělem (bodyAngle), jinak míření s wind-upem.
  _updateStickDisplay(dt) {
    // Charge se nabíjí svižně, ale po výstřelu klesá pomaleji → dohrání bez záškubu
    const tc = this.charge ?? 0;
    const cRate = tc > this._dispCharge ? 18 : 9;
    this._dispCharge += (tc - this._dispCharge) * Math.min(1, cRate * dt);
    // Dosah hole dle kurzoru: u těla = přitažení (tight), dál = natažení (max stickLen)
    const MIN_REACH = 13;
    const targetReach = this.hasPuck
      ? clamp(this.aimDist, MIN_REACH, PLAYER.stickLen)
      : PLAYER.stickLen;
    this._dispReach += (targetReach - this._dispReach) * Math.min(1, 16 * dt);
    // Základ hole je vždy carry-úhel (spojitý i po ztrátě puku) → žádný skok/záškub
    const target = this.crossCheck ? this.bodyAngle : (this.carryAngle - this._dispCharge * 0.52);
    this._stickDisp = lerpAngle(this._stickDisp, target, Math.min(1, 26 * dt));
  }

  get stickTip() {
    const cos = Math.cos(this.aimAngle);
    const sin = Math.sin(this.aimAngle);
    let t = PLAYER.stickLen;
    const m = PUCK.radius;

    // Clip against rink walls
    if (cos < 0 && this.x + cos * t < m)            t = Math.min(t, (m - this.x) / cos);
    if (cos > 0 && this.x + cos * t > RINK.w - m)   t = Math.min(t, (RINK.w - m - this.x) / cos);
    if (sin < 0 && this.y + sin * t < m)            t = Math.min(t, (m - this.y) / sin);
    if (sin > 0 && this.y + sin * t > RINK.h - m)   t = Math.min(t, (RINK.h - m - this.y) / sin);

    // Clip against goal cage rectangles (slab method)
    t = _clipRayAABB(this.x, this.y, cos, sin, t,
      RINK.goalLineLeft - RINK.goalDepth, RINK.goalLineLeft, RINK.goalY, RINK.goalY + RINK.goalH);
    t = _clipRayAABB(this.x, this.y, cos, sin, t,
      RINK.goalLineRight, RINK.goalLineRight + RINK.goalDepth, RINK.goalY, RINK.goalY + RINK.goalH);

    // Clip against rounded corners — shrink until tip is inside valid arc
    t = _clipCorners(this.x, this.y, cos, sin, t);

    t = Math.max(0, t);
    return { x: this.x + cos * t, y: this.y + sin * t };
  }

  tryPickup(puck) {
    if (puck.isAirborne) return false;
    if (this._shootCooldown > 0) return false;
    const tip = this.stickTip;
    if (Math.hypot(puck.x - tip.x, puck.y - tip.y) > PLAYER.pickupTipRadius) return false;
    // Při nabíjení (one-timer) přijmeš i rychlou nahrávku — usnadní načasování
    const maxRel = this.charge > 0 ? 9999 : PLAYER.pickupMaxRelSpeed;
    if (Math.hypot(puck.vx - this.vx, puck.vy - this.vy) > maxRel) return false;
    this.hasPuck    = true;
    this.forehand   = true;
    this.carryAngle = this.aimAngle; // puk navázán na aktuální směr hole
    this._overTurnT = 0;
    return true;
  }

  shoot(puck, charge, forehand = this.forehand) {
    this.hasPuck = false;
    this.forehand = forehand !== false;
    this._shootCooldown = 0.18;
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;

    if (this.forehand !== false) {
      // Forehand: full speed, flat release, small lift only near max charge
      const spd = PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * charge;
      puck.vx = Math.cos(this.aimAngle) * spd;
      puck.vy = Math.sin(this.aimAngle) * spd;
      puck.vz = Math.max(0, (charge - 0.45) / 0.35) * PUCK.maxShotVz * 0.62;
    } else {
      // Backhand = rychlé zakončení (snap): slušná rychlost i bez nabití, nižší strop.
      // I "ťuknutí" je reálná střela → překvapí gólmana zblízka. Mírný lift.
      const spd = PUCK.maxShotSpeed * (0.58 + 0.18 * charge); // ~296→388 px/s
      puck.vx = Math.cos(this.aimAngle) * spd;
      puck.vy = Math.sin(this.aimAngle) * spd;
      puck.vz = (0.2 + charge * 0.5) * PUCK.maxShotVz * 0.5;
    }
  }

  // Puk na holi: hokejka se otáčí jen omezeně (klička), moc rychlá otočka = slip.
  // Střední feel: běžné míření OK; mlácení myší (>~100° napřed) → puk sklouzne.
  _updateCarry(dt, world) {
    const spd       = Math.hypot(this.vx, this.vy);
    const MAX_TURN  = 14 - Math.min(1, spd / 180) * 7; // 14 v klidu → 7 ve sprintu: tight dangle na místě
    const SLIP      = Math.PI * 0.66; // ~119° — práh pro slip
    const HOLD_SLIP = 0.20;           // musí trvat → krátké cuknutí myší puk neztratí
    const puck = world && world.puck;
    const d = angleDiff(this.aimAngle, this.carryAngle);

    // Anti-vrtulník: jen VYTRVALÉ kroužení mířením (ne cuknutí) → puk sklouzne
    this._overTurnT = Math.abs(d) > SLIP ? this._overTurnT + dt : 0;
    if (this._overTurnT > HOLD_SLIP) {
      this._overTurnT = 0;
      this.hasPuck = false; this._shootCooldown = 0.12;
      if (puck) {
        const tang = this.carryAngle + Math.sign(d) * Math.PI / 2;
        puck.vx = this.vx * 0.5 + Math.cos(tang) * 120;
        puck.vy = this.vy * 0.5 + Math.sin(tang) * 120;
        puck.z = 0; puck.vz = 0;
      }
      return;
    }

    // Klička: hůl se otáčí omezeně (puk se po čepeli plynule přesouvá)
    const step = MAX_TURN * dt;
    this.carryAngle += clamp(d, -step, step);
  }

  // Auto forehand/backhand vůči směru jízdy: backhand = míříš napříč/proti bruslení
  // (sáhneš si přes tělo). Hystereze brání blikání; v klidu vždy forehand.
  _updateHand() {
    const spd = Math.hypot(this.vx, this.vy);
    if (spd < 40) { this._backhand = false; this.forehand = true; return; }
    const skating = Math.atan2(this.vy, this.vx);
    const d = Math.abs(angleDiff(this.aimAngle, skating));
    if (!this._backhand && d > Math.PI * 0.64) this._backhand = true;
    if ( this._backhand && d < Math.PI * 0.52) this._backhand = false;
    this.forehand = !this._backhand;
  }

  // Tečování (deflection) — letící puk u čepele se odrazí pod jiným úhlem (gól z dorážky)
  tryDeflect(puck) {
    if (this.hasPuck || puck.isAirborne) return false;
    if (this.charge > 0) return false; // nabíjí one-timer → puk chytí, netečuje
    if (this._shootCooldown > 0 || this._deflectCool > 0) return false;
    const inSpeed = Math.hypot(puck.vx, puck.vy);
    if (inSpeed < 150) return false;                 // jen letící střela/pas
    const tip = this.stickTip;
    if (Math.hypot(puck.x - tip.x, puck.y - tip.y) > PLAYER.pickupTipRadius + 2) return false;
    // Výchylka kolem aktuálního směru — částečně k hokejce/tělu (tečované góly)
    const dir    = Math.atan2(puck.vy, puck.vx);
    const jitter = (Math.random() - 0.5) * 0.9;      // ±~26°
    const nd     = dir + jitter;
    puck.vx = Math.cos(nd) * inSpeed * 0.92;
    puck.vy = Math.sin(nd) * inSpeed * 0.92;
    puck.z = 0; puck.vz = 0;
    this._deflectCool = 0.3;
    return true;
  }

  // Souboj těl — dva hráči se přetlačí (clona, box-out, scramble před brankou)
  collideWith(other) {
    const minDist = this.radius + other.radius;
    const dx = other.x - this.x, dy = other.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist || dist === 0) return;
    const nx = dx / dist, ny = dy / dist, pen = minDist - dist;
    this.x  -= nx * pen * 0.5; this.y  -= ny * pen * 0.5;
    other.x += nx * pen * 0.5; other.y += ny * pen * 0.5;
    const rel = (other.vx - this.vx) * nx + (other.vy - this.vy) * ny;
    if (rel < 0) {
      const imp = rel * 0.5;
      this.vx  += nx * imp; this.vy  += ny * imp;
      other.vx -= nx * imp; other.vy -= ny * imp;
    }
  }

  // aimOverride: volitelný směr nahrávky (predikce do jízdy); jinak míří kam ukazuje hůl
  pass(puck, aimOverride, forehand = this.forehand) {
    this.hasPuck = false;
    this.forehand = forehand !== false;
    this._passCooldown = 0.15;
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;

    const ang = (aimOverride !== undefined && aimOverride !== null) ? aimOverride : this.aimAngle;
    if (this.forehand) {
      // Forhend — po ledě, plná rychlost
      puck.vx = Math.cos(ang) * PUCK.passSpeed;
      puck.vy = Math.sin(ang) * PUCK.passSpeed;
      puck.vz = 0;
    } else {
      // Bakhand žabička (Shift) — pomalejší, letí vzduchem
      puck.vx = Math.cos(ang) * PUCK.passSpeed * 0.72;
      puck.vy = Math.sin(ang) * PUCK.passSpeed * 0.72;
      puck.vz = 115;
    }
  }

  // Called each frame — check if this player's cross-check hits another
  tryCrossCheck(other) {
    if (!this.crossCheck || this._crossCheckCool > 0) return;
    const dx   = other.x - this.x;
    const dy   = other.y - this.y;
    const dist = Math.hypot(dx, dy);
    const reach = this.radius + other.radius + 18;
    if (dist > reach || dist === 0) return;
    // Must be roughly in front (within ~70° of bodyAngle)
    if (Math.abs(angleDiff(Math.atan2(dy, dx), this.bodyAngle)) > Math.PI * 0.4) return;

    this._crossCheckCool = 0.55;

    // Strip puck
    if (other.hasPuck) {
      other.hasPuck    = false;
      other.charge     = 0;
      other.overcharged = false;
    }

    // Impact impulse — shove other back, checker slows slightly
    const nx = dx / dist;
    const ny = dy / dist;
    other.vx += nx * 160;
    other.vy += ny * 160;
    this.vx  -= nx * 55;
    this.vy  -= ny * 55;
  }

  _move(input, dt) {
    // Hockey stop — hard brake, body swings perpendicular
    if (this._hockeyStop) {
      this._stopTimer -= dt;
      if (this._stopTimer <= 0) this._hockeyStop = false;

      const spd = Math.hypot(this.vx, this.vy);
      if (spd > 0) {
        const newSpd = Math.max(0, spd - 420 * dt);
        this.vx = newSpd > 0 ? this.vx / spd * newSpd : 0;
        this.vy = newSpd > 0 ? this.vy / spd * newSpd : 0;
      }
      this.bodyAngle = lerpAngle(this.bodyAngle, this._stopAngle, Math.min(1, 14 * dt));
      this.x = clamp(this.x + this.vx * dt, PLAYER.radius, RINK.w - PLAYER.radius);
      this.y = clamp(this.y + this.vy * dt, PLAYER.radius, RINK.h - PLAYER.radius);
      _resolveGoalCage(this, PLAYER.radius);
      return;
    }

    const charging      = !!(input.lmb && this.hasPuck);
    const crossChecking = this.crossCheck;
    const steer    = input.dx;   // A/D = řízení: D=+1 doprava, A=-1 doleva
    const throttle = -input.dy;  // W/S = plyn:   W=+1 dopředu, S=-1 brzda
    const spd = Math.hypot(this.vx, this.vy);

    let topSpeed = PLAYER.speed * (crossChecking ? 1.15 : 1);
    if (this.hasPuck) {
      const reachT = clamp((this._dispReach - 13) / (PLAYER.stickLen - 13), 0, 1);
      topSpeed *= 0.55 + reachT * 0.45;
    }
    if (charging) topSpeed *= clamp(1 - (this.charge || 0) * 0.85, 0.12, 1);

    const turnMult = crossChecking ? 0.62 : 1;
    const speedT   = Math.min(1, spd / Math.max(1, topSpeed));

    // A/D stáčí heading (řízení). Agilní při nízké rychlosti, široký oblouk v rychlosti.
    const steerRate = PLAYER.turnRate * (1.7 - speedT) * turnMult * (charging ? 0.3 : 1);
    this.skateAngle += steer * steerRate * dt;
    this.bodyAngle = this.skateAngle; // tělo kouká kam bruslíš; hokejku míří myš zvlášť (turret)

    if (throttle !== 0 || spd > 1) {
      const heading   = spd > 4 ? Math.atan2(this.vy, this.vx) : this.skateAngle;
      // Couvání: S držené a (skoro stojíš nebo už jedeš pozpátku) → bruslení vzad
      const fwdAlign  = Math.cos(angleDiff(this.skateAngle, heading));
      const reversing = throttle < 0 && (spd < 35 || fwdAlign < -0.3);
      const desiredHeading = reversing ? this.skateAngle + Math.PI : this.skateAngle;

      const hdiff     = angleDiff(desiredHeading, heading);
      const turnSharp = Math.min(1, 1 - Math.cos(hdiff));

      // Crossover: nabírej energii v oblouku (plyn + zatáčka), uvolni při narovnání
      if (!charging && throttle > 0 && turnSharp > 0.35 && spd > 60) this._carveLoad = Math.min(1, this._carveLoad + dt * 1.6);
      let burst = 0;
      if (!charging && turnSharp < 0.18 && this._carveLoad > 0.02) { burst = this._carveLoad; this._carveLoad = Math.max(0, this._carveLoad - dt * 2.4); }
      else this._carveLoad = Math.max(0, this._carveLoad - dt * 0.8);

      // velocity heading carvuje k požadovanému směru (momentum/drift)
      const carveRate = PLAYER.turnRate * (1.7 - speedT) * turnMult;
      const nh    = heading + Math.sign(hdiff) * Math.min(Math.abs(hdiff), carveRate * dt);
      const along = Math.cos(hdiff);

      let ns;
      if (throttle > 0) {
        // W: zrychluj po hraně; ostrá zatáčka srazí cílovou rychlost (carve scrub)
        const targetSpd = Math.max(0, topSpeed * (0.45 + 0.55 * Math.max(0, along))) * (1 + 0.22 * burst);
        const aMag = PLAYER.accel * (1.4 - 0.4 * speedT) * (1 + 0.5 * burst);
        ns = spd < targetSpd ? Math.min(targetSpd, spd + aMag * dt) : Math.max(targetSpd, spd - PLAYER.decel * 1.6 * dt);
      } else if (reversing) {
        // S (couvání): pomalejší max rychlost vzad
        const targetSpd = topSpeed * 0.5 * Math.max(0, along);
        ns = spd < targetSpd ? Math.min(targetSpd, spd + PLAYER.accel * 0.6 * dt) : Math.max(targetSpd, spd - PLAYER.decel * 1.6 * dt);
      } else if (throttle < 0) {
        ns = Math.max(0, spd - PLAYER.decel * 2.6 * dt); // S: brzda dopředného pohybu
      } else {
        const gdec = charging ? PLAYER.decel * (1.6 + (this.charge || 0) * 2.8)
                              : (spd < 70 ? PLAYER.decel * 1.8 : PLAYER.decel);
        ns = Math.max(0, spd - gdec * dt); // glide
      }
      this.vx = Math.cos(nh) * ns;
      this.vy = Math.sin(nh) * ns;
      this._lean += (clamp(steer * Math.min(1, spd / 130), -1, 1) - this._lean) * Math.min(1, 8 * dt);
    } else {
      this._carveLoad = Math.max(0, this._carveLoad - dt * 1.2);
      this._lean += (0 - this._lean) * Math.min(1, 6 * dt);
    }

    // Pohyb + WALL-SLIDE: u mantinelu zruš složku rychlosti DO zdi → sklouzneš podél,
    // nezasekneš se a netočíš se o band (heading se příští frame srovná podél zdi).
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < PLAYER.radius)               { this.x = PLAYER.radius;         if (this.vx < 0) this.vx = 0; }
    else if (this.x > RINK.w - PLAYER.radius) { this.x = RINK.w - PLAYER.radius; if (this.vx > 0) this.vx = 0; }
    if (this.y < PLAYER.radius)               { this.y = PLAYER.radius;         if (this.vy < 0) this.vy = 0; }
    else if (this.y > RINK.h - PLAYER.radius) { this.y = RINK.h - PLAYER.radius; if (this.vy > 0) this.vy = 0; }
    _resolveGoalCage(this, PLAYER.radius);
  }

  draw(ctx, cam) {
    _renderPlayer(ctx, this, cam);
  }
}

export class Player extends PlayerBase {
  constructor(id, team, input) {
    super(id, team);
    this.input = input;
  }

  update(dt, world) {
    if (this._shootCooldown > 0) this._shootCooldown -= dt;
    if (this._passCooldown  > 0) this._passCooldown  -= dt;
    if (this._deflectCool   > 0) this._deflectCool   -= dt;
    // Automatický forehand/backhand vůči směru jízdy (backhand = sáhnutí přes tělo)
    if (this.hasPuck) { this._updateHand(); this._updateCarry(dt, world); }
    else this.carryAngle = lerpAngle(this.carryAngle, this.aimAngle, Math.min(1, 22 * dt)); // spojitý základ hole → bez záškubu
    if (this.passReq > 0) this.passReq = Math.max(0, this.passReq - dt);
    this.crossCheck = !!this.input.rmb && !this.hasPuck && !this._hockeyStop && this._passCooldown <= 0;
    if (this._crossCheckCool > 0) this._crossCheckCool -= dt;

    const spaceDown = !!this.input.keys['Space'];
    if (spaceDown && !this._spaceWas && !this._hockeyStop) {
      const spd = Math.hypot(this.vx, this.vy);
      if (spd > 55) {
        this._hockeyStop = true;
        this._stopTimer  = 0.30;
        // Body turns perpendicular to velocity — toward whichever side the aim points
        const velAngle = Math.atan2(this.vy, this.vx);
        const perpA = velAngle + Math.PI / 2;
        const perpB = velAngle - Math.PI / 2;
        this._stopAngle = Math.abs(angleDiff(this.aimAngle, perpA)) < Math.abs(angleDiff(this.aimAngle, perpB))
          ? perpA : perpB;
        // Drop puck — can't hold it during a stop
        this.hasPuck = false;
        this.charge  = 0;
        this.overcharged = false;
      }
    }
    this._spaceWas = spaceDown;
    this._move(this.input, dt);
    this._updateStickDisplay(dt);
  }
}

export class RemotePlayer extends PlayerBase {
  constructor(id, team) {
    super(id, team);
    this._tx = this.x;
    this._ty = this.y;
    this._tBodyAngle = 0;
    this._tAimAngle  = 0;
  }

  applyState(msg) {
    this._tx         = msg.x;
    this._ty         = msg.y;
    this.vx          = msg.vx;
    this.vy          = msg.vy;
    this._tBodyAngle = msg.ba;
    this._tAimAngle  = msg.aa;
    this.hasPuck     = !!msg.hp;
    this.charge      = msg.ch ?? 0;
    this.forehand    = msg.fh !== 0;
    this.crossCheck  = !!msg.cc;
  }

  update(dt) {
    this.x         = this.x + (this._tx - this.x) * Math.min(1, 18 * dt);
    this.y         = this.y + (this._ty - this.y) * Math.min(1, 18 * dt);
    this.bodyAngle = lerpAngle(this.bodyAngle, this._tBodyAngle, Math.min(1, 14 * dt));
    this.aimAngle  = lerpAngle(this.aimAngle,  this._tAimAngle,  Math.min(1, 14 * dt));
    this.carryAngle = this.aimAngle; // remote nesimuluje carry; puk drží podle míření
    if (this._deflectCool > 0) this._deflectCool -= dt;
    this._updateStickDisplay(dt);
  }
}

function _renderPlayer(ctx, p, cam) {
  const s     = cam.scale;
  const { ox, oy } = cam;
  const sx    = ox + p.x * s;
  const sy    = oy + p.y * s;
  const r     = PLAYER.radius * s;
  const color = PLAYER.colors[p.team];

  const vmag  = Math.hypot(p.vx, p.vy);
  const vdir  = Math.atan2(p.vy, p.vx);

  // Sprint trail — mizející stopa za bruslařem při rychlosti
  if (vmag > 120) {
    const tt = Math.min(1, (vmag - 120) / 80);
    for (let i = 1; i <= 3; i++) {
      const bx = sx - Math.cos(vdir) * i * 6 * s;
      const by = sy - Math.sin(vdir) * i * 6 * s;
      ctx.beginPath();
      ctx.arc(bx, by, r * (0.55 - i * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.12 * tt * (1 - i * 0.25)})`;
      ctx.fill();
    }
  }

  // Hockey-stop spray — odlétávající led
  if (p._hockeyStop) {
    const perp = vdir + Math.PI / 2;
    for (let i = 0; i < 7; i++) {
      const side   = i % 2 === 0 ? 1 : -1;
      const spread = Math.random() * r * 2.0;
      const fx = sx - Math.cos(vdir) * r * 0.4 + Math.cos(perp) * side * spread;
      const fy = sy - Math.sin(vdir) * r * 0.4 + Math.sin(perp) * side * spread;
      ctx.beginPath();
      ctx.arc(fx, fy, (1.0 + Math.random() * 1.6) * s, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.35})`;
      ctx.fill();
    }
  }

  // Shadow (posun opačně k náklonu = přenos váhy do zatáčky)
  const lean = p._lean ?? 0;
  ctx.beginPath();
  ctx.ellipse(sx + 2 - Math.cos(vdir + Math.PI / 2) * lean * r * 0.4,
              sy + 3 - Math.sin(vdir + Math.PI / 2) * lean * r * 0.4,
              r * 0.9, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // Cross-check: hůl držená napříč PŘED TĚLEM. Kreslí se přes vyhlazený úhel
  // _stickDisp (dojíždí k bodyAngle), takže přepnutí RMB hokejku neteleportuje.
  if (p.crossCheck) {
    ctx.lineCap = 'round';
    const baseDir   = p._stickDisp;            // dojíždí k bodyAngle (před tělem)
    const stickDir  = baseDir + Math.PI / 2;
    const sDirCos   = Math.cos(stickDir);
    const sDirSin   = Math.sin(stickDir);
    const halfLen   = PLAYER.stickLen * s * 0.7; // kratší při crosschecku
    // Offset center to front edge of player body, podél _stickDisp
    const fwdCos    = Math.cos(baseDir);
    const fwdSin    = Math.sin(baseDir);
    const cx        = sx + fwdCos * (r + 2 * s);
    const cy        = sy + fwdSin * (r + 2 * s);

    const gripX     = cx - sDirCos * halfLen;
    const gripY     = cy - sDirSin * halfLen;
    const bladeX    = cx + sDirCos * halfLen;
    const bladeY    = cy + sDirSin * halfLen;

    // Grip (dark, ~35%)
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(cx - sDirCos * halfLen * 0.3, cy - sDirSin * halfLen * 0.3);
    ctx.strokeStyle = '#2e1a04';
    ctx.lineWidth   = 2.8 * s;
    ctx.stroke();

    // Main shaft
    ctx.beginPath();
    ctx.moveTo(cx - sDirCos * halfLen * 0.35, cy - sDirSin * halfLen * 0.35);
    ctx.lineTo(bladeX, bladeY);
    ctx.strokeStyle = '#7a5015';
    ctx.lineWidth   = 2.8 * s;
    ctx.stroke();

    // Blade bezier at blade end (same curve as normal stick)
    const bladeAngle = Math.PI / 6.5;
    const bladeL     = 12 * s;
    const bEndX  = bladeX + Math.cos(stickDir + bladeAngle) * bladeL;
    const bEndY  = bladeY + Math.sin(stickDir + bladeAngle) * bladeL;
    const bCtrlX = bladeX + Math.cos(stickDir) * bladeL * 0.55;
    const bCtrlY = bladeY + Math.sin(stickDir) * bladeL * 0.55;

    ctx.beginPath();
    ctx.moveTo(bladeX + sDirCos * 1.2 * s, bladeY + sDirSin * 1.2 * s);
    ctx.quadraticCurveTo(bCtrlX + sDirCos * 1.2 * s, bCtrlY + sDirSin * 1.2 * s,
                          bEndX  + sDirCos * 1.2 * s, bEndY  + sDirSin * 1.2 * s);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 4 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bladeX, bladeY);
    ctx.quadraticCurveTo(bCtrlX, bCtrlY, bEndX, bEndY);
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = 2.8 * s;
    ctx.stroke();
  }

  if (!p.crossCheck) {
  // ── Stick ──────────────────────────────────────────────────────────────
  // Vyhlazený úhel + charge → wind-up i zrušení charge jsou plynulé (bez skoku)
  const windAngle = p._stickDisp;
  const windLen   = (p._dispReach ?? PLAYER.stickLen) * (1 - (p._dispCharge ?? 0) * 0.30);
  const windCos   = Math.cos(windAngle);
  const windSin   = Math.sin(windAngle);

  // Display tip — clipped against walls AND rounded corners
  let wt = windLen;
  if (windCos < 0 && p.x + windCos * wt < 0)            wt = Math.min(wt, -p.x / windCos);
  if (windCos > 0 && p.x + windCos * wt > RINK.w)        wt = Math.min(wt, (RINK.w - p.x) / windCos);
  if (windSin < 0 && p.y + windSin * wt < 0)            wt = Math.min(wt, -p.y / windSin);
  if (windSin > 0 && p.y + windSin * wt > RINK.h)        wt = Math.min(wt, (RINK.h - p.y) / windSin);
  wt = _clipCorners(p.x, p.y, windCos, windSin, wt);
  wt = Math.max(0, wt);

  const tipX = ox + (p.x + windCos * wt) * s;
  const tipY = oy + (p.y + windSin * wt) * s;

  // ── Shaft: same thickness as blade ─────────────────────────────────
  ctx.lineCap = 'round';
  // grip wrap (first 35%, darker)
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + windCos * windLen * 0.35 * s, sy + windSin * windLen * 0.35 * s);
  ctx.strokeStyle = '#2e1a04';
  ctx.lineWidth   = 2.8 * s;
  ctx.stroke();
  // main shaft
  ctx.beginPath();
  ctx.moveTo(sx + windCos * windLen * 0.30 * s, sy + windSin * windLen * 0.30 * s);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#7a5015';
  ctx.lineWidth   = 2.8 * s;
  ctx.stroke();

  // ── Blade: gentle curve — always same side (right-handed convention)
  // blade is fixed ~28° clockwise from shaft; only puck position changes for fore/backhand
  const bladeAngle = Math.PI / 6.5; // ~28° off shaft, always same direction
  const bladeL     = 12 * s;

  // Blade drawn as a bezier curve from tip: starts along shaft, fixed gentle curve
  const bStartX = tipX;
  const bStartY = tipY;
  const bEndX   = tipX + Math.cos(windAngle + bladeAngle) * bladeL;
  const bEndY   = tipY + Math.sin(windAngle + bladeAngle) * bladeL;
  // Control point pulls toward the angled end, creating a gentle arc
  const bCtrlX  = tipX + Math.cos(windAngle) * bladeL * 0.55;
  const bCtrlY  = tipY + Math.sin(windAngle) * bladeL * 0.55;

  // Blade shadow
  ctx.beginPath();
  ctx.moveTo(bStartX + windCos * 1.2 * s, bStartY + windSin * 1.2 * s);
  ctx.quadraticCurveTo(bCtrlX + windCos * 1.2 * s, bCtrlY + windSin * 1.2 * s,
                        bEndX  + windCos * 1.2 * s, bEndY  + windSin * 1.2 * s);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth   = 4 * s;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Blade face (tape)
  ctx.beginPath();
  ctx.moveTo(bStartX, bStartY);
  ctx.quadraticCurveTo(bCtrlX, bCtrlY, bEndX, bEndY);
  ctx.strokeStyle = '#111';
  ctx.lineWidth   = 2.8 * s;
  ctx.lineCap     = 'round';
  ctx.stroke();

  } // end !crossCheck stick

  // ── Hokejista (top-down) — orientovaný podle facingu (bodyAngle) ──
  const ba   = p.bodyAngle;
  const fcos = Math.cos(ba), fsin = Math.sin(ba);
  const pcos = Math.cos(ba + Math.PI / 2), psin = Math.sin(ba + Math.PI / 2);
  const darker = _shade(color, -0.28);

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ba); // lokálně: +x dopředu (facing), +y doprava

  // Ramena / trup — širší napříč, kratší dopředu (dres)
  ctx.beginPath();
  ctx.ellipse(-1 * s, 0, r * 1.05, r * 1.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  // číslo/náznak zad (tmavší pruh)
  ctx.fillStyle = darker;
  ctx.beginPath();
  ctx.ellipse(-r * 0.5, 0, r * 0.5, r * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Helma (vepředu, ve směru facingu) — naznačí směr
  const hx = sx + fcos * r * 0.55;
  const hy = sy + fsin * r * 0.55;
  ctx.beginPath();
  ctx.arc(hx, hy, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = '#e9edf3';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();
  // hledí
  ctx.beginPath();
  ctx.moveTo(hx + pcos * r * 0.3, hy + psin * r * 0.3);
  ctx.lineTo(hx - pcos * r * 0.3, hy - psin * r * 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1 * s;
  ctx.stroke();

  // Pass-request rings (žádost o nahrávku)
  if (p.passReq > 0) {
    const t = 1 - p.passReq; // 0→1 as animation progresses
    for (let i = 0; i < 2; i++) {
      const phase  = (t + i * 0.35) % 1;
      const radius = r + phase * 22 * s;
      const alpha  = (1 - phase) * 0.85;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 220, 60, ${alpha})`;
      ctx.lineWidth   = 2 * s;
      ctx.stroke();
    }
  }

  // Charge arc
  if (p.charge > 0.05) {
    const blink = p.overcharged && Math.floor(Date.now() / 100) % 2 === 0;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
    ctx.strokeStyle = p.overcharged
      ? `rgba(255, 30, 0, ${blink ? 0.95 : 0.25})`
      : `rgba(255, ${220 - p.charge * 200}, 0, 0.85)`;
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// Shorten stick ray to not enter an AABB — returns new tMax
function _clipRayAABB(px, py, cos, sin, tMax, x1, x2, y1, y2) {
  let txEnter, txExit, tyEnter, tyExit;
  if (Math.abs(cos) < 1e-9) {
    if (px <= x1 || px >= x2) return tMax;
    txEnter = -Infinity; txExit = Infinity;
  } else {
    const a = (x1 - px) / cos, b = (x2 - px) / cos;
    txEnter = Math.min(a, b); txExit = Math.max(a, b);
  }
  if (Math.abs(sin) < 1e-9) {
    if (py <= y1 || py >= y2) return tMax;
    tyEnter = -Infinity; tyExit = Infinity;
  } else {
    const a = (y1 - py) / sin, b = (y2 - py) / sin;
    tyEnter = Math.min(a, b); tyExit = Math.max(a, b);
  }
  const tEnter = Math.max(txEnter, tyEnter);
  const tExit  = Math.min(txExit,  tyExit);
  if (tEnter < tExit && tEnter < tMax && tExit > 0)
    return Math.min(tMax, Math.max(0, tEnter));
  return tMax;
}

// Ztmavení/zesvětlení hex barvy (amt < 0 ztmaví, > 0 zesvětlí) → 'rgb(...)'
function _shade(hex, amt) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const n = parseInt(full, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { const f = 1 + amt; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
  else         { r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt); }
  return `rgb(${r},${g},${b})`;
}

// Clip ray against rounded rink corners — returns shortened tMax
function _clipCorners(px, py, cos, sin, tMax) {
  const cR = RINK.cornerR;
  const centers = [
    [cR, cR], [RINK.w - cR, cR],
    [cR, RINK.h - cR], [RINK.w - cR, RINK.h - cR],
  ];
  for (const [cx, cy] of centers) {
    // Only shrink if the tip ends up in this corner's quadrant
    let t = tMax;
    for (let i = 0; i < 8 && t > 0; i++) {
      const tx = px + cos * t, ty = py + sin * t;
      const inQuad = (cx < RINK.w / 2 ? tx < cx : tx > cx) &&
                     (cy < RINK.h / 2 ? ty < cy : ty > cy);
      if (!inQuad || Math.hypot(tx - cx, ty - cy) <= cR - PUCK.radius) break;
      t *= 0.78;
    }
    tMax = Math.min(tMax, t);
  }
  return tMax;
}

// Push player circle out of goal cage rectangles (solid net)
function _resolveGoalCage(p, r) {
  const d   = RINK.goalDepth;
  const gy1 = RINK.goalY;
  const gy2 = RINK.goalY + RINK.goalH;
  const cages = [
    { x1: RINK.goalLineLeft - d,  x2: RINK.goalLineLeft,  y1: gy1, y2: gy2 },
    { x1: RINK.goalLineRight,     x2: RINK.goalLineRight + d, y1: gy1, y2: gy2 },
  ];
  for (const { x1, y1, x2, y2 } of cages) {
    const cx   = clamp(p.x, x1, x2);
    const cy   = clamp(p.y, y1, y2);
    const dx   = p.x - cx;
    const dy   = p.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist >= r) continue;
    if (dist === 0) {
      // Dead center — push toward nearest face
      const dL = p.x - x1, dR = x2 - p.x, dT = p.y - y1, dB = y2 - p.y;
      const m  = Math.min(dL, dR, dT, dB);
      if (m === dL) p.x = x1 - r;
      else if (m === dR) p.x = x2 + r;
      else if (m === dT) p.y = y1 - r;
      else p.y = y2 + r;
    } else {
      const pen = r - dist;
      p.x += (dx / dist) * pen;
      p.y += (dy / dist) * pen;
    }
  }
}

