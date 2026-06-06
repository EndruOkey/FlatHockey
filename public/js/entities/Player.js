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
    this._knockT    = 0;   // časovač knockbacku — zpomalí perp. útlum, aby náraz dojel
    this.handed     = team === 'away' ? -1 : 1; // pravák (+1) / levák (−1) → strana forehandu
    this._stickRel  = 0;   // úhel hole vůči tělu (scalar, drží se v předním kuželu)
    this.radius          = PLAYER.radius;
    this.hasPuck         = false;
    this.forehand        = true;
    this.charge          = 0;
    this.overcharged     = false;
    this.isPlayer        = true;
    this.crossCheck      = false;  // visible to world for collision
    this._crossCheckCool = 0;
    this._backhand       = false;  // auto fore/backhand (vůči směru jízdy, s hysterezí)
    this.carryAngle      = 0;      // úhel hole nesoucí puk (otáčí se omezeně → klička/anti-vrtulník)
    this.aimDist         = PLAYER.stickLen; // vzdálenost kurzoru od těla → dosah hole
    this._dispReach      = PLAYER.stickLen; // vyhlazený dosah pro vykreslení/cradle
    this._lean           = 0;      // náklon do zatáčky (vizuál)
    this._deflectCool    = 0;      // cooldown tečování (deflection)
    this._shootCooldown  = 0;
    this._passCooldown   = 0;     // prevents crossCheck flicker after pass
    this.passReq         = 0;     // pass-request visual timer
    this._stickDisp      = this.aimAngle; // vyhlazený úhel hole pro vykreslení (bez teleportů)
    this._dispCharge     = 0;             // vyhlazený charge pro wind-up vizuál
    this._cradleSide     = 1;             // plynulá strana puku na čepeli (+forhend / −bekhend)
  }

  // Plynulý úhel hole — dojíždí k cíli, takže přepnutí crosscheck / zrušení charge
  // nezpůsobí teleport. Crosscheck = před tělem (bodyAngle), jinak míření s wind-upem.
  _updateStickDisplay(dt) {
    // Charge se nabíjí svižně, ale po výstřelu klesá pomaleji → dohrání bez záškubu
    const tc = this.charge ?? 0;
    const cRate = tc > this._dispCharge ? 18 : 9;
    this._dispCharge += (tc - this._dispCharge) * Math.min(1, cRate * dt);
    // Vrstva C — STICKHANDLE: vzdálenost kurzoru řídí vysunutí hole/puku. Kurzor blízko =
    // puk schovaný u těla (chráníš, hbitější), daleko = natažená hůl (dosah, příprava střely).
    const reachMin = PLAYER.stickLen * 0.62, reachMax = PLAYER.stickLen * 1.28;
    const ad = this.aimDist ?? 60;
    const tReach = reachMin + (reachMax - reachMin) * clamp((ad - 22) / 95, 0, 1);
    this._dispReach += (tReach - this._dispReach) * Math.min(1, 14 * dt);
    // Základ hole je vždy carry-úhel (spojitý i po ztrátě puku) → žádný skok/záškub
    const target = this.crossCheck ? this.bodyAngle : (this.carryAngle - this._dispCharge * 0.52);
    this._stickDisp = lerpAngle(this._stickDisp, target, Math.min(1, 26 * dt));
    // Plynulé MÍCHÁNÍ puku: strana puku na čepeli plynule přejíždí forhend↔bekhend
    // (přes střed lopaty) místo skoku → vizuální dribling/kličkování.
    const sideTarget = (this.forehand !== false) ? 1 : -1;
    this._cradleSide += (sideTarget - this._cradleSide) * Math.min(1, 9 * dt);
  }

  // Úchop hole — ruce drží hůl VEDLE těla (na straně dle handedness, mírně vepřed),
  // ne v centru. Z tohoto bodu vychází dřík.
  get gripPoint() {
    // Úchop odsazený podle SMĚRU HOLE (ne těla) → při natočení těla hokejka neobíhá
    const dir   = this.carryAngle ?? this.aimAngle;
    const sideA = dir + this.handed * Math.PI / 2;
    const gs = this.radius * 0.5;  // do strany od osy hole (strana ruky)
    const gf = this.radius * 0.2;  // mírně podél hole ven
    return {
      x: this.x + Math.cos(dir) * gf + Math.cos(sideA) * gs,
      y: this.y + Math.sin(dir) * gf + Math.sin(sideA) * gs,
    };
  }

  get stickTip() {
    // Dřík vychází z úchopu (vedle těla) ve směru carry-úhlu (omezeného kuželem)
    const g = this.gripPoint;
    const gx = g.x, gy = g.y;
    const dir = this.carryAngle ?? this.aimAngle;
    const cos = Math.cos(dir);
    const sin = Math.sin(dir);
    let t = this._dispReach ?? PLAYER.stickLen;  // dosah dle vysunutí (vrstva C)
    const m = PUCK.radius;

    // Clip against rink walls
    if (cos < 0 && gx + cos * t < m)            t = Math.min(t, (m - gx) / cos);
    if (cos > 0 && gx + cos * t > RINK.w - m)   t = Math.min(t, (RINK.w - m - gx) / cos);
    if (sin < 0 && gy + sin * t < m)            t = Math.min(t, (m - gy) / sin);
    if (sin > 0 && gy + sin * t > RINK.h - m)   t = Math.min(t, (RINK.h - m - gy) / sin);

    // Clip against goal cage rectangles (slab method)
    t = _clipRayAABB(gx, gy, cos, sin, t,
      RINK.goalLineLeft - RINK.goalDepth, RINK.goalLineLeft, RINK.goalY, RINK.goalY + RINK.goalH);
    t = _clipRayAABB(gx, gy, cos, sin, t,
      RINK.goalLineRight, RINK.goalLineRight + RINK.goalDepth, RINK.goalY, RINK.goalY + RINK.goalH);

    // Clip against rounded corners — shrink until tip is inside valid arc
    t = _clipCorners(gx, gy, cos, sin, t);

    t = Math.max(0, t);
    return { x: gx + cos * t, y: gy + sin * t };
  }

  // Může tenhle hráč TEĎ sebrat puk? (geometrie + rychlost, bez mutace)
  canPickup(puck) {
    if (puck.isAirborne) return false;
    if (this._shootCooldown > 0) return false;
    const tip = this.stickTip;
    // Grab zóna kolem celé čepele — nejen špička, ale i podél lopaty (přesahuje za tip)
    const bladeDir = (this.carryAngle ?? this.aimAngle) + (this.handed ?? 1) * Math.PI / 6.5;
    const bx = tip.x + Math.cos(bladeDir) * 6;
    const by = tip.y + Math.sin(bladeDir) * 6;
    const dTip   = Math.hypot(puck.x - tip.x, puck.y - tip.y);
    const dBlade = Math.hypot(puck.x - bx,    puck.y - by);
    if (Math.min(dTip, dBlade) > PLAYER.pickupTipRadius) return false;
    // Při nabíjení (one-timer) přijmeš i rychlou nahrávku — usnadní načasování
    const maxRel = this.charge > 0 ? 9999 : PLAYER.pickupMaxRelSpeed;
    if (Math.hypot(puck.vx - this.vx, puck.vy - this.vy) > maxRel) return false;
    return true;
  }

  _grabPuck() {
    this.hasPuck    = true;
    this.forehand   = true;
    this.carryAngle = this.aimAngle; // puk navázán na aktuální směr hole
  }

  tryPickup(puck) {
    if (!this.canPickup(puck)) return false;
    this._grabPuck();
    return true;
  }

  shoot(puck, charge) {
    this.hasPuck = false;
    this._shootCooldown = 0.18;
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;

    // ŽABIČKA (lehký tap) → PRDEL (plné nabití): rychlost i zdvih plynule rostou s nabitím.
    // Žabička = malá umístěná rána po ledě; slap = tvrdá rána, zvedne se a je lehce nepřesná.
    const c = clamp(charge, 0, 1);
    const spd    = PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * Math.pow(c, 0.85);
    const spread = (Math.random() - 0.5) * c * 0.08;   // jen tvrdá rána je lehce nepřesná
    const dir    = this.carryAngle + spread;
    puck.vx = Math.cos(dir) * spd;
    puck.vy = Math.sin(dir) * spd;
    puck.vz = Math.pow(c, 1.6) * PUCK.maxShotVz;        // žabička po ledě, slap se zvedne
  }

  // Hůl relativně k TĚLU: úhel hole = bodyAngle + clamp(rel) v dosažitelném kuželu.
  // → rotuje s tělem, nejde za záda (ne 360°). Forehand/backhand dle strany těla a
  // handedness (pravák/levák), ne dle pohybu. Carry dojíždí omezenou rychlostí (klička).
  _updateStick(dt) {
    // Hůl je RELATIVNÍ k tělu (rotuje s tělem). Offset = myš, omezený kuželem → nejde
    // dokola (žádná helikoptéra). Za zády drží stranu; natočením těla (A/D) ji srovnáš.
    const cone = Math.PI * 0.55; // realistický dosah hole na každou stranu (~99°): k bokům,
                                 // sotva za rameno — ne za záda. Dozadu mířit = otočit tělo.
    const cursorRel = angleDiff(this.aimAngle, this.bodyAngle);
    const targetRel = Math.abs(cursorRel) <= cone
      ? cursorRel                                    // myš v dosahu → sleduj
      : (cursorRel >= 0 ? cone : -cone);             // mimo dosah → drž nejbližší kraj (ne za záda)

    const spd  = Math.hypot(this.vx, this.vy);
    const rate = (14 - Math.min(1, spd / 180) * 7) * dt;
    this._stickRel += clamp(targetRel - this._stickRel, -rate, rate);
    this._stickRel = clamp(this._stickRel, -cone, cone);

    this.carryAngle = this.bodyAngle + this._stickRel; // rotuje s tělem
    this.forehand   = (this._stickRel * this.handed) >= 0;
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
    // utlum přibližování
    const rel = (other.vx - this.vx) * nx + (other.vy - this.vy) * ny;
    if (rel < 0) {
      const imp = rel * 0.5;
      this.vx  += nx * imp; this.vy  += ny * imp;
      other.vx -= nx * imp; other.vy -= ny * imp;
    }
    // Lehký knockback — oba se od sebe symetricky odrazí (bumpnutí)
    const KB = 85;
    this.vx  -= nx * KB; this.vy  -= ny * KB;
    other.vx += nx * KB; other.vy += ny * KB;
    this._knockT = other._knockT = 0.2; // dočasně zpomalí útlum, aby náraz dojel
  }

  // aimOverride: volitelný směr nahrávky (predikce do jízdy); jinak míří kam ukazuje hůl
  pass(puck, aimOverride) {
    this.hasPuck = false;
    this._passCooldown  = 0.15;
    this._shootCooldown = 0.18; // ať si hráč hned NEteční/nesebere vlastní přihrávku
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;
    // Normální přihrávka — po ledě, plná rychlost (žádný backhand)
    const ang = (aimOverride !== undefined && aimOverride !== null) ? aimOverride : this.carryAngle;
    puck.vx = Math.cos(ang) * PUCK.passSpeed;
    puck.vy = Math.sin(ang) * PUCK.passSpeed;
    puck.vz = 0;
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

    // Náraz — VĚTŠÍ knockback při crosschecku: odhodí soupeře, checker se zbrzdí
    const nx = dx / dist;
    const ny = dy / dist;
    other.vx += nx * 300;
    other.vy += ny * 300;
    this.vx  -= nx * 100;
    this.vy  -= ny * 100;
    other._knockT = 0.35; this._knockT = 0.18; // náraz dojede, neutlumí se hned
  }

  _move(input, dt) {
    // Space = čistá tvrdá brzda (drž) — bez otáčení, puk si necháš. Tělo míří kam koukáš.
    if (input.keys && input.keys['Space']) {
      const spd = Math.hypot(this.vx, this.vy);
      if (spd > 0) {
        const newSpd = Math.max(0, spd - 620 * dt);
        this.vx = newSpd > 0 ? this.vx / spd * newSpd : 0;
        this.vy = newSpd > 0 ? this.vy / spd * newSpd : 0;
      }
      this.bodyAngle = this.skateAngle; // při brzdě tělo nepivotuje (žádné protáčení)
      this.x = clamp(this.x + this.vx * dt, PLAYER.radius, RINK.w - PLAYER.radius);
      this.y = clamp(this.y + this.vy * dt, PLAYER.radius, RINK.h - PLAYER.radius);
      _resolveGoalCage(this, PLAYER.radius);
      _resolveRinkCorners(this, PLAYER.radius);
      return;
    }

    const charging      = !!(input.lmb && this.hasPuck);
    const crossChecking = this.crossCheck;

    // TWIN-STICK: WASD bruslí ve SMĚRECH (world-space), myš míří hokejkou NEZÁVISLE
    // (turret) → skateuješ jedním směrem, střílíš/kličkuješ jiným. Pohyb má moment
    // (zrychlení + glide), tělo kouká kam bruslíš.
    let ix = input.dx, iy = input.dy;          // A/D = ±x, W/S = ±y
    const il = Math.hypot(ix, iy);
    if (il > 1) { ix /= il; iy /= il; }         // diagonála není rychlejší
    const hasInput = il > 0.01;

    let topSpeed = PLAYER.speed * (crossChecking ? 1.15 : 1);
    if (charging) topSpeed *= clamp(1 - (this.charge || 0) * 0.85, 0.12, 1);

    if (this._knockT > 0) this._knockT = Math.max(0, this._knockT - dt);
    const knocked = this._knockT > 0;            // po nárazu hráč skoro neřídí (náraz dojede)

    if (hasInput && !knocked) {
      // zrychluj k cílové rychlosti ve směru WASD; změna směru = přibrzdit staré +
      // nabrat nové → přirozený carve/moment (ne okamžitý obrat).
      const tvx = ix * topSpeed, tvy = iy * topSpeed;
      let dvx = tvx - this.vx, dvy = tvy - this.vy;
      const dl = Math.hypot(dvx, dvy);
      if (dl > 0) {
        const a = PLAYER.accel * (crossChecking ? 1.1 : 1) * (charging ? 0.5 : 1);
        const dv = Math.min(dl, a * dt);
        this.vx += dvx / dl * dv;
        this.vy += dvy / dl * dv;
      }
    } else {
      // glide — led nese, plynulé doklouzání (po nárazu slabší tření, ať knockback dojede)
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 0) {
        const dec = (knocked ? 0.3 : (sp < 60 ? 1.4 : 0.85)) * PLAYER.decel * dt;
        const ns = Math.max(0, sp - dec);
        this.vx = this.vx / sp * ns; this.vy = this.vy / sp * ns;
      }
    }

    // Tělo se otáčí JEN podle WASD (kam jedeš), NIKDY podle myši → žádné samovolné
    // protáčení. Myš ovládá pouze hokejku (turret). lerpAngle jde nejkratší cestou.
    const sp2 = Math.hypot(this.vx, this.vy);
    if (hasInput) this.skateAngle = lerpAngle(this.skateAngle, Math.atan2(iy, ix), Math.min(1, 9 * dt));
    this.bodyAngle = this.skateAngle;

    // Náklon do oblouku (vizuál)
    const leanTarget = hasInput
      ? clamp(angleDiff(Math.atan2(iy, ix), this.skateAngle) * 1.3, -1, 1) * Math.min(1, sp2 / 130)
      : 0;
    this._lean += (leanTarget - this._lean) * Math.min(1, 8 * dt);

    // Pohyb + WALL-SLIDE: u mantinelu zruš složku rychlosti DO zdi → sklouzneš podél,
    // nezasekneš se a netočíš se o band (heading se příští frame srovná podél zdi).
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < PLAYER.radius)               { this.x = PLAYER.radius;         if (this.vx < 0) this.vx = 0; }
    else if (this.x > RINK.w - PLAYER.radius) { this.x = RINK.w - PLAYER.radius; if (this.vx > 0) this.vx = 0; }
    if (this.y < PLAYER.radius)               { this.y = PLAYER.radius;         if (this.vy < 0) this.vy = 0; }
    else if (this.y > RINK.h - PLAYER.radius) { this.y = RINK.h - PLAYER.radius; if (this.vy > 0) this.vy = 0; }
    _resolveGoalCage(this, PLAYER.radius);
    _resolveRinkCorners(this, PLAYER.radius);
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
    // Hůl relativně k tělu (kužel) + forehand dle handedness
    this._updateStick(dt);
    if (this.passReq > 0) this.passReq = Math.max(0, this.passReq - dt);
    this.crossCheck = !!this.input.rmb && !this.hasPuck && this._passCooldown <= 0;
    if (this._crossCheckCool > 0) this._crossCheckCool -= dt;

    this._move(this.input, dt);
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

  // Dřík vychází z ÚCHOPU (ruce vedle těla), ne ze středu
  const grip = p.gripPoint;
  const gxw = grip.x, gyw = grip.y;
  const gx  = ox + gxw * s, gy = oy + gyw * s;

  // Display tip — clip dříku I ČEPELE proti všemu: klipuju délku dřík+čepel a pak
  // čepel odečtu zpět → ani zahnutá čepel nepřesahuje mantinel/roh/branku/hráče.
  const BLADE = 12; // world délka čepele
  let wt = windLen + BLADE;
  if (windCos < 0 && gxw + windCos * wt < 0)            wt = Math.min(wt, -gxw / windCos);
  if (windCos > 0 && gxw + windCos * wt > RINK.w)        wt = Math.min(wt, (RINK.w - gxw) / windCos);
  if (windSin < 0 && gyw + windSin * wt < 0)            wt = Math.min(wt, -gyw / windSin);
  if (windSin > 0 && gyw + windSin * wt > RINK.h)        wt = Math.min(wt, (RINK.h - gyw) / windSin);
  wt = _clipCorners(gxw, gyw, windCos, windSin, wt);
  // Branky (rám sítě)
  wt = _clipRayAABB(gxw, gyw, windCos, windSin, wt,
    RINK.goalLineLeft - RINK.goalDepth, RINK.goalLineLeft, RINK.goalY, RINK.goalY + RINK.goalH);
  wt = _clipRayAABB(gxw, gyw, windCos, windSin, wt,
    RINK.goalLineRight, RINK.goalLineRight + RINK.goalDepth, RINK.goalY, RINK.goalY + RINK.goalH);
  // Pevné objekty (ostatní hráči, gólmani)
  if (p._solids) for (const so of p._solids) wt = _clipRayCircle(gxw, gyw, windCos, windSin, wt, so.x, so.y, so.r);
  wt = Math.max(0, wt - BLADE);   // stáhni zpět o čepel → čepel skončí přesně u překážky

  const tipX = ox + (gxw + windCos * wt) * s;
  const tipY = oy + (gyw + windSin * wt) * s;

  // ── Shaft: same thickness as blade ─────────────────────────────────
  ctx.lineCap = 'round';
  // grip wrap (first 35%, darker)
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + windCos * windLen * 0.35 * s, gy + windSin * windLen * 0.35 * s);
  ctx.strokeStyle = '#2e1a04';
  ctx.lineWidth   = 2.8 * s;
  ctx.stroke();
  // main shaft
  ctx.beginPath();
  ctx.moveTo(gx + windCos * windLen * 0.30 * s, gy + windSin * windLen * 0.30 * s);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#7a5015';
  ctx.lineWidth   = 2.8 * s;
  ctx.stroke();

  // ── Blade: jemný ohyb na stranu dle ruky (levák/pravák curve opačně) ──
  const bladeAngle = (p.handed ?? 1) * Math.PI / 6.5; // ~28° off shaft, strana dle handedness
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

  // Jméno nad hráčem — v barvě týmu, jemný obrys pro čitelnost (tenké)
  if (p.name) {
    ctx.font = `${Math.round(9.5 * s)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const ny = sy - r - 7 * s;
    ctx.lineWidth = 1.4 * s;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(p.name, sx, ny);
    ctx.fillStyle = color;
    ctx.fillText(p.name, sx, ny);
    ctx.textAlign = 'left';
  }
}

// Zkrať paprsek hole tak, aby nevjel do kruhu (hráč/gólman) — vrátí nové tMax
function _clipRayCircle(px, py, cos, sin, tMax, cx, cy, rr) {
  const ox = px - cx, oy = py - cy;
  const b = ox * cos + oy * sin;          // D je jednotkový → kvadratika t²+2bt+c=0
  const c = ox * ox + oy * oy - rr * rr;
  const disc = b * b - c;
  if (disc < 0) return tMax;              // míjí kruh
  const t = -b - Math.sqrt(disc);         // bližší průsečík
  return (t > 0 && t < tMax) ? t : tMax;
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

// Clip ray against rounded rink corners (analyticky, stabilně) — vrátí zkrácené tMax.
// V rohovém kvadrantu je hrací plocha UVNITŘ oblouku; hůl ořízneme tam, kde paprsek
// z (uvnitř) vyjede ven přes oblouk.
function _clipCorners(px, py, cos, sin, tMax) {
  const Rc = RINK.cornerR - PUCK.radius;
  const centers = [
    [RINK.cornerR, RINK.cornerR], [RINK.w - RINK.cornerR, RINK.cornerR],
    [RINK.cornerR, RINK.h - RINK.cornerR], [RINK.w - RINK.cornerR, RINK.h - RINK.cornerR],
  ];
  for (const [cx, cy] of centers) {
    const ox = px - cx, oy = py - cy;
    const b = ox * cos + oy * sin;
    const c = ox * ox + oy * oy - Rc * Rc;
    const disc = b * b - c;
    if (disc <= 0) continue;
    const tExit = -b + Math.sqrt(disc);          // kde paprsek opustí oblouk
    if (tExit <= 0 || tExit >= tMax) continue;
    const ex = px + cos * tExit, ey = py + sin * tExit;
    const inQuad = (cx < RINK.w / 2 ? ex <= cx : ex >= cx) &&
                   (cy < RINK.h / 2 ? ey <= cy : ey >= cy);
    if (inQuad) tMax = tExit;                     // ořízni přesně na oblouk
  }
  return tMax;
}

// Push player circle out of goal cage rectangles (solid net)
// Zaoblené rohy arény — hráč nesmí projet rohem ven z hrací plochy (slide podél oblouku)
function _resolveRinkCorners(p, r) {
  const cR = RINK.cornerR;
  const corners = [
    [cR, cR], [RINK.w - cR, cR],
    [cR, RINK.h - cR], [RINK.w - cR, RINK.h - cR],
  ];
  for (const [cx, cy] of corners) {
    const inQuad = (cx < RINK.w / 2 ? p.x < cx : p.x > cx) &&
                   (cy < RINK.h / 2 ? p.y < cy : p.y > cy);
    if (!inQuad) continue;
    const dx = p.x - cx, dy = p.y - cy, dist = Math.hypot(dx, dy);
    if (dist === 0 || dist <= cR - r) continue;
    const nx = dx / dist, ny = dy / dist;       // ven od středu rohu
    p.x = cx + nx * (cR - r);
    p.y = cy + ny * (cR - r);
    const dot = p.vx * nx + p.vy * ny;
    if (dot > 0) { p.vx -= dot * nx; p.vy -= dot * ny; } // wall-slide podél mantinelu
  }
}

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

