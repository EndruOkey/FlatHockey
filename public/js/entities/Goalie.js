import { RINK, PUCK } from '../constants.js';
import { clamp } from '../utils.js';
import { t } from '../i18n.js';

// ── Save profil (naškálováno na reálnou branku 6 ft = 32px) ───────────────
// Gólman kryje centrální pásmo, ale má zranitelnosti: horní růžky, pětku, vyrážečka
// pouští dorážky. Z postavení neprostřelíš, z pohybu/výškou ano.
const COVER_H  = 14;   // vertikální poloviční dosah krytí (±14 ze 44px ústí → uličky u tyček)
const COVER_X  = 9;    // poloviční tloušťka (X)
const FIVEHOLE = 5;    // poloviční šířka pětky (nízký střed)
const TOP_EDGE = 2;    // užší růžek u tyče → těžší trefit
const MAX_OUT  = 30;   // max výjezd z brankové čáry (~6 ft, challenge k vršku brankoviště)
const SPEED    = 170;  // boční rychlost (živé přesuny) — z ní plyne otevřený vzdálený roh
const PADLEN   = 9;    // délka betonů dopředu (vizuál)

export class Goalie {
  constructor(side = 'right', difficulty = 'casual') {
    this.isGoalie   = true;
    // Pravá branka = goal-home → brání away (červený); levá = goal-away → brání home (modrý)
    this.side       = side;
    this.difficulty = difficulty;  // 'casual' (public) nebo 'competitive'
    this.netX       = side === 'right' ? RINK.goalLineRight : RINK.goalLineLeft;
    this.inX        = side === 'right' ? -1 : 1;   // směr do hřiště (kam gólman kouká/vyjíždí)
    this.team       = side === 'right' ? 'away' : 'home';
    this.x          = this.netX;
    this.y          = RINK.goalY + RINK.goalH / 2;
    this.radius     = 8;
    this._percX     = this.netX + this.inX;
    this._percY     = RINK.goalY + RINK.goalH / 2;
    this._vy        = 0;     // boční rychlost (pro pětku/živost)
    this._gvx       = 0;     // vyhlazená rychlost přesunu (plynulý pohyb)
    this._gvy       = 0;
    this._tilt      = 0;     // natočení čelem k puku (vizuál)
    this._screen    = 0;     // clona: hráč v zákrytu zhoršuje reakci/dosah
    this._lastPuckY = this.y;// pro čtení pohybu puku (anticipace/bite na kličku)
    this._puckVy    = 0;
    this._holdTimer = 0;
    this._heldPuck  = null;
    this._pokeCooldown = 0;
    this._saveType     = '';
    this._saveFlash    = 0;
    this._saveFlashMax = 0.3;
    this._saveRecoil   = 0;     // recoil effect na bodyč
    this._saveRecoilX  = 0;     // recoil směr
  }

  get isHolding() { return this._holdTimer > 0; }

  update(dt, world) {
    const puck = world.puck;
    if (!puck) return;

    if (this._pokeCooldown > 0) this._pokeCooldown -= dt;
    if (this._saveFlash   > 0) this._saveFlash = Math.max(0, this._saveFlash - dt);
    if (this._saveRecoil  > 0) this._saveRecoil = Math.max(0, this._saveRecoil - dt * 4);  // fade recoil effect

    if (this._holdTimer > 0) {
      this._holdTimer -= dt;
      if (this._heldPuck) {
        this._heldPuck.x  = this.x + this.inX * 6;
        this._heldPuck.y  = this.y - COVER_H * 0.45;
        this._heldPuck.vx = 0; this._heldPuck.vy = 0;
        this._heldPuck.z  = 0; this._heldPuck.vz = 0;
      }
      if (this._holdTimer <= 0) this._release(world);
      this._vy = 0;
      return;
    }

    const netX = this.netX;
    const netY = RINK.goalY + RINK.goalH / 2;
    const prevY = this.y;

    // Clona — hráč v zákrytu mezi gólmanem a pukem zhoršuje reakci i dosah
    let screen = 0;
    const dpx = puck.x - this.x, dpy = puck.y - this.y;
    const L2 = dpx * dpx + dpy * dpy;
    if (L2 > 1) {
      for (const p of world.players) {
        const oxp = p.x - this.x, oyp = p.y - this.y;
        const t = (oxp * dpx + oyp * dpy) / L2;
        if (t < 0.12 || t > 0.92) continue;            // jen mezi gólmanem a pukem
        const perp = Math.abs(oxp * -dpy + oyp * dpx) / Math.sqrt(L2);
        if (perp < 16) screen = Math.max(screen, (1 - perp / 16) * Math.min(1, t * 1.5));
      }
    }
    this._screen += (screen - this._screen) * Math.min(1, 6 * dt);

    // ── Vzdálenost puku (raw, pro lag) ─────────────────────────────────────
    const rawDxN = Math.max(1, (netX - puck.x) * -this.inX);
    const rawDist = Math.hypot(rawDxN, puck.y - netY);

    // ── Percepce puku ────────────────────────────────────────────────────
    // Z dálky (modrá čára+) golman sleduje puk pomaleji → méně chaotický pohyb
    const diffMult      = this.difficulty === 'competitive' ? 0.75 : 1.2;
    const baseLag       = 5.8 * diffMult;
    const distLagFactor = rawDist > 170 ? Math.max(0.28, 1 - (rawDist - 170) / 220) : 1.0;
    const lag           = baseLag * distLagFactor * (1 - this._screen * 0.55);
    const pxClamp       = this.side === 'right' ? Math.min(puck.x, netX - 1) : Math.max(puck.x, netX + 1);
    this._percX += (pxClamp - this._percX) * Math.min(1, lag * dt);
    this._percY += (puck.y  - this._percY) * Math.min(1, lag * dt);

    // Anticipace pohybu puku
    const rawVy = (puck.y - this._lastPuckY) / Math.max(dt, 1e-3);
    this._lastPuckY = puck.y;
    this._puckVy += (rawVy - this._puckVy) * Math.min(1, 9 * dt);
    const biteMult = this.difficulty === 'competitive' ? 0.60 : 0.38;
    const bite     = clamp(this._puckVy, -240, 240) * 0.055 * biteMult;

    // ── Zónová vzdálenost puku ──────────────────────────────────────────
    const px = this._percX, py = this._percY;
    const dxN        = Math.max(1, (netX - px) * -this.inX);
    const dyN        = py - netY;
    const distToPuck = Math.hypot(dxN, dyN);
    const angleAbs   = Math.atan2(Math.abs(dyN), dxN);
    const depthMult  = this.difficulty === 'competitive' ? 1.12 : 0.88;

    // ── Hloubka výjezdu (NHL zóny) ───────────────────────────────────────
    // Slot/kruh (50-140): max výjezd; modrá (140-230): ustup; střed hřiště: drž branku
    //   ~ odpovídá NHL heatmap: >80% gólů padá ze slotu/kruhů
    let depth;
    if      (distToPuck < 50)  depth = MAX_OUT * 0.65 * (distToPuck / 50);        // v bráně: scale s dist
    else if (distToPuck < 140) depth = MAX_OUT * 0.92;                            // slot / kruh: max výjezd
    else if (distToPuck < 240) depth = MAX_OUT * 0.92 * (1 - (distToPuck - 140) / 200); // modrá: ustup
    else                       depth = MAX_OUT * 0.04;                            // střed/konec: seď v brance
    depth *= depthMult;
    depth *= 1 - Math.min(1, angleAbs / (Math.PI * 0.5)) * (this.difficulty === 'competitive' ? 0.45 : 0.60);

    // Threat: relevantní pouze v nebezpečném pásmu (slot + kruh + část modré)
    // competitive: ohrožení cítí do 250px, casual do 210px
    const threatRange   = this.difficulty === 'competitive' ? (250 - distToPuck) / 195 : (210 - distToPuck) / 165;
    const threat        = clamp(threatRange, 0, 1);
    const depthBaseline = this.difficulty === 'competitive' ? 0.38 : 0.28;
    depth *= depthBaseline + (1 - depthBaseline) * threat;
    let targetX = netX + this.inX * depth;

    // ── Cílová Y: úhlová hra bez singularity ────────────────────────────
    const denomRaw  = netX - px;
    const denomSafe = Math.sign(denomRaw || -this.inX) * Math.max(Math.abs(denomRaw), 30);
    const s         = clamp((targetX - px) / denomSafe, -0.15, 1.05);
    const margin    = COVER_H * 0.45;
    let targetY = py + s * (netY - py) + bite * threat;
    // Při nízkém ohrožení tahej ke středu branky
    targetY = netY + (targetY - netY) * (0.18 + 0.82 * threat);
    targetY = clamp(targetY, RINK.goalY + margin, RINK.goalY + RINK.goalH - margin);

    // ── Chybovost: vrchol v nebezpečném pásmu (slot/kruh ~70-150px) ──────
    // Z modré / středu hřiště je golman přesný → tam góly nepadají
    // Ze slotu/kruhů má větší chybu → realistické NHL statistiky
    this._errPhase = ((this._errPhase ?? 0) + dt * 0.60);
    const errZone    = clamp(1 - Math.pow((distToPuck - 100) / 105, 2), 0, 1); // bell curve, vrchol ~100px
    const errAmpBase = this.difficulty === 'competitive' ? 2.0 : 4.8;
    const errAmp     = errAmpBase * (0.08 + 0.92 * errZone);
    const errRaw     = Math.sin(this._errPhase * 0.88) * errAmp
                     + Math.cos(this._errPhase * 1.47) * errAmp * 0.52;
    this._errY = ((this._errY ?? 0) + (errRaw - (this._errY ?? 0)) * Math.min(1, 1.0 * dt));
    targetY    = clamp(targetY + this._errY, RINK.goalY + margin * 0.35, RINK.goalY + RINK.goalH - margin * 0.35);

    // ── Wraparound: hráč s pukem za brankou → přilepíme k bližší tyčce ──
    const carrier = world.players.find(p => p.hasPuck);
    if (carrier && this.inX * (carrier.x - netX) > 8) {
      targetX = netX;
      targetY = carrier.y < netY ? RINK.goalY + 4 : RINK.goalY + RINK.goalH - 4;
    }

    // ── Pohyb (spring-damper) ────────────────────────────────────────────
    // Z dálky (nízký threat) golman hýbe pomalu → nechybuje se zbytečně
    const speedMult = this.difficulty === 'competitive' ? 1.22 : 0.85;
    const effSpeed  = SPEED * (0.12 + 0.88 * threat) * speedMult;
    let desVx = (targetX - this.x) * 10;
    let desVy = (targetY - this.y) * 10;
    const dspd = Math.hypot(desVx, desVy);
    if (dspd > effSpeed) { const f = effSpeed / dspd; desVx *= f; desVy *= f; }
    const accMult = this.difficulty === 'competitive' ? 1.18 : 0.72;
    const acc = Math.min(1, 10 * dt * accMult);
    this._gvx += (desVx - this._gvx) * acc;
    this._gvy += (desVy - this._gvy) * acc;
    this.x += this._gvx * dt;
    this.y += this._gvy * dt;
    this._vy = (this.y - prevY) / Math.max(dt, 1e-3);

    // Natočení čelem k puku
    let tilt = clamp(-Math.atan2(this._percY - this.y, Math.abs(this._percX - this.x) + 4), -0.42, 0.42);
    this._tilt += (tilt - this._tilt) * Math.min(1, 8 * dt);
  }

  // ── Zónový zákrok ─────────────────────────────────────────────────────
  blockPuck(puck, world) {
    if (this._holdTimer > 0) return true;

    const r = PUCK.radius;
    // Clona zmenší dosah krytí (hráč v zákrytu = hůř chytá)
    // Competitive = lepší pokrytí, casual = snadněji se dostaneš ke gólu
    const screenPenalty = this.difficulty === 'competitive' ? 0.30 : 0.42;
    const sc = 1 - this._screen * screenPenalty;
    const coverXMult = this.difficulty === 'competitive' ? 1.08 : 0.95;
    const coverYMult = this.difficulty === 'competitive' ? 1.06 : 0.88;

    // Síla střely: rychlý puk = méně reakčního času = menší zone (max −25 %)
    const shotSpeed = Math.hypot(puck.vx, puck.vy);
    const speedFactor = clamp(1 - (shotSpeed - 150) / 520, 0.75, 1.0);
    // Vzdálenost střely: z blízka = kratší čas na read = menší zone (max −20 %)
    const prevPx = puck.prevX ?? puck.x;
    const shotDist = Math.abs(prevPx - this.x);
    const distFactor = clamp(0.80 + shotDist / 700, 0.80, 1.0);

    const reachX = (COVER_X + r) * sc * coverXMult * speedFactor * distFactor;
    const reachY = (COVER_H + r) * sc * coverYMult * speedFactor * distFactor;
    let relX = puck.x - this.x, relY = puck.y - this.y;
    let hitX = null, hitY = null;

    if (Math.abs(relX) > reachX || Math.abs(relY) > reachY) {
      // Swept test (rychlá střela mezi framy) — bod vstupu, puk zatím neposouvej
      const hit = _segmentAabbHit(
        puck.prevX ?? puck.x, puck.prevY ?? puck.y, puck.x, puck.y,
        this.x - reachX, this.y - reachY, this.x + reachX, this.y + reachY
      );
      if (!hit) return false;            // minul → gól (roh / nad gólmanem)
      hitX = hit.x; hitY = hit.y;
      relX = hitX - this.x; relY = hitY - this.y;
    }

    const high   = puck.z > PUCK.gloveHeight;
    const moving  = Math.abs(this._vy) > 55;   // gólman se přesouvá → otevřená pětka
    const absY = Math.abs(relY);

    // ── Zranitelnosti (ne zadarmo) ──
    // Horní růžek: jen FAKT vysoká rána (těsně pod břevno) a přesně u tyče — ne ledajaká
    // nadzvednutá střela. Musíš puk zvednout skoro k břevnu a trefit roh.
    const cornerHigh = puck.z > (PUCK.gloveHeight + PUCK.crossbarHeight) * 0.5; // ~13.5 (z 21)
    if (cornerHigh && absY > COVER_H - TOP_EDGE) return false;
    // Pětka: nízká rána středem, ale jen když je gólman rozjetý (musíš ho rozhýbat)
    if (!high && absY < FIVEHOLE && moving) return false;

    // ── Zákrok (na save teprve doraz puk na bod vstupu) ──
    if (hitX !== null) { puck.x = hitX; puck.y = hitY; }

    // Lapačka — vysoká střela do horní (lapačkové) půlky → chycení
    if (high && relY <= 0) {
      this._holdTimer = 0.7;
      this._heldPuck  = puck;
      this._markSave('glove', 0.42);
      puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0;
      return true;
    }

    // Zákrok = KONTROLOVANÁ ROZEHRÁVKA na spoluhráče (přesná nahrávka), ne divoký odraz.
    puck.x  = this.x + this.inX * (COVER_X + PUCK.radius + 2);
    puck.y  = this.y + relY * 0.35;
    puck.z = 0; puck.vz = 0;
    const mate = world ? _nearestMate(world, this.team, this) : null;
    if (mate) {
      const ang  = Math.atan2(mate.y - puck.y, mate.x - puck.x);
      const dist = Math.hypot(mate.x - puck.x, mate.y - puck.y);
      // síla dle vzdálenosti → dorazí ke spoluhráči s rozumným tempem, ne přepal přes celé hřiště
      const sp = Math.min(PUCK.passSpeed, Math.sqrt(2 * PUCK.decel * dist) + 35);
      puck.vx = Math.cos(ang) * sp;                // přesná nahrávka stylem pasu
      puck.vy = Math.sin(ang) * sp;
    } else {
      puck.vx = this.inX * 120;                    // bez spoluhráče → měkké vyhození do hřiště
      puck.vy = (relY >= 0 ? 1 : -1) * 55;
    }
    this._markSave(high ? 'blocker' : 'pads', 0.3);
    return true;
  }

  controlLoosePuck(puck) {
    if (this._holdTimer > 0 || this._heldPuck) return true;
    if (!puck || puck.isAirborne) return false;
    if (Math.hypot(puck.vx, puck.vy) > 90) return false;
    if (Math.hypot(puck.x - this.x, puck.y - this.y) > this.radius + 9) return false;
    this._holdTimer = 0.85;
    this._heldPuck  = puck;
    this._markSave('cover', 0.5);
    puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0;
    return true;
  }

  blockPlayer(player) {
    const minDist = this.radius + (player.radius ?? 11);
    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist || dist === 0) return;
    const nx = dx / dist, ny = dy / dist;
    const pen = minDist - dist;
    player.x += nx * pen; player.y += ny * pen;
    const dot = player.vx * nx + player.vy * ny;
    if (dot < 0) { player.vx -= dot * nx; player.vy -= dot * ny; }
  }

  pokeCheck(player, puck) {
    if (!player.hasPuck) return;
    if (this._holdTimer > 0 || this._pokeCooldown > 0) return;
    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const pokeDist = this.radius + 20;
    if (dist > pokeDist) return;
    if (this.inX * (player.x - this.x) < -4) return;   // jen zepředu (ne zezadu od branky)
    player.hasPuck = false;
    this._pokeCooldown = 0.7;
    const grabDist = this.radius + (player.radius ?? 11) + 2;
    if (dist <= grabDist) {
      this._holdTimer = 0.85; this._heldPuck = puck; this._markSave('cover', 0.5);
      puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0; puck.x = this.x; puck.y = this.y;
    } else {
      const nx = dx / (dist || 1), ny = dy / (dist || 1);
      puck.x = this.x + nx * (pokeDist + PUCK.radius + 2);
      puck.y = this.y + ny * (pokeDist + PUCK.radius + 2);
      puck.vx = nx * 150; puck.vy = ny * 150; puck.z = 0; puck.vz = 0;
      this._markSave('pads', 0.26);
    }
  }

  _markSave(type, dur) {
    this._saveType = type;
    this._saveFlash = dur;
    this._saveFlashMax = dur;
    this._saveRecoil = 0.15;
    this._saveRecoilX = Math.random() < 0.5 ? -1 : 1;  // alternating recoil
  }

  _release(world) {
    if (!this._heldPuck) return;
    const p = this._heldPuck;
    this._heldPuck = null;
    p.x = this.x + this.inX * 16; p.y = this.y; p.z = 0; p.vz = 0;
    // Rozehrávka: nahraj spoluhráči (přeměřeně dle vzdálenosti). Bez spoluhráče → měkce k mantinelu.
    const mate = world ? _nearestMate(world, this.team, this) : null;
    if (mate) {
      const ang  = Math.atan2(mate.y - p.y, mate.x - p.x);
      const dist = Math.hypot(mate.x - p.x, mate.y - p.y);
      const sp = Math.min(PUCK.passSpeed, Math.sqrt(2 * PUCK.decel * dist) + 35);
      p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
    } else {
      const toBoard = this.y < RINK.h / 2 ? -1 : 1;     // do bližšího rohu, pryč od brány
      const angle = Math.atan2(toBoard * 60, this.inX * 120);
      p.vx = Math.cos(angle) * 130; p.vy = Math.sin(angle) * 130;
    }
  }

  draw(ctx, cam) {
    const s   = cam.scale;
    const { ox, oy } = cam;
    const sx  = ox + this.x * s;
    const sy  = oy + this.y * s;
    const r   = this.radius * s;  // ~8*s — mírně větší než hráč (7*s)

    const holding   = this._holdTimer > 0;
    const flash     = this._saveFlashMax > 0 ? Math.max(0, this._saveFlash / this._saveFlashMax) : 0;
    const type      = this._saveType;
    const recoil    = this._saveRecoil * this._saveRecoilX;
    const baseColor = this.color || (this.team === 'home' ? '#2f6db0' : '#c0392b');

    // ── Shadow (stejný styl jako hráč) ──
    ctx.beginPath();
    ctx.ellipse(sx + 2, sy + 3, r * 0.9, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();

    // ── Animace padů: kotva = kolena (těsně pod tělem), otevírají se pohybem ──
    const spread   = clamp(Math.abs(this._vy) / 110, 0, 1);
    const kneeY    = 2.5 * s;
    // spread² = nelineární nárůst — při pomalém pohybu malý, při rychlém výrazný
    const padTilt  = 0.26 + spread * spread * 0.55;
    const padFwdX  = -spread * 1.5 * s;

    // Přepneme na lokální souřadnice golmana (−X = směr k puku)
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(-this.inX, 1);
    ctx.rotate(this._tilt);

    const bx = recoil * s;

    // ── PADY — oba se stejným kladným úhlem → špičky k bráně, V-tvar otevřen k puku ──
    _gPad(ctx, s, padFwdX, -kneeY, -1, padTilt, type === 'pads' ? flash : 0);
    _gPad(ctx, s, padFwdX,  kneeY, +1, padTilt, type === 'pads' ? flash : 0);

    // Strana lapačky závisí na tom, která strana je "levá ruka" golmana.
    // Po scale(-inX, 1) se Y NEFLIPUJE, takže musíme stranu explicitně korigovat.
    //   Pravý golman (inX=-1) čelí vlevo → levá ruka = +Y (spodek obrazovky)
    //   Levý golman  (inX=+1) čelí vpravo → levá ruka = -Y (vršek obrazovky)
    const gY = -this.inX * 7.5 * s;   // Y pozice lapačky (catch glove = levá ruka)
    const bkY =  this.inX * 7.5 * s;  // Y pozice vyrážečky (blocker = pravá ruka)

    // ── PAŽE (za tělem, vedou k lapačce a vyrážečce) ──
    _gArm(ctx, s, bx - r * 0.45, -this.inX * r * 0.3,  -5.5 * s, gY);
    _gArm(ctx, s, bx - r * 0.45,  this.inX * r * 0.3,  -5.5 * s, bkY);

    // ── TĚLO — stejný kruh jako hráč ──
    ctx.beginPath();
    ctx.arc(bx, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    // ── Direction dot — bílý puntík na přední straně (k puku = −X) ──
    ctx.beginPath();
    ctx.arc(bx - r * 0.52, 0, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    // ── LAPAČKA (levá ruka, strana dle golmana) ──
    _gGlove(ctx, s, -5.5 * s, gY, holding || type === 'glove' || type === 'cover');

    // ── VYRÁŽEČKA (pravá ruka, opačná strana) ──
    _gBlocker(ctx, s, -5.5 * s, bkY, type === 'blocker' ? flash : 0);

    // ── IMPACT FLASH ──
    if (flash > 0) {
      const fade = 1 - flash;
      ctx.beginPath();
      ctx.ellipse(0, 0, (r + 6 * s) + fade * 4 * s, (r + 4 * s) + fade * 2 * s, 0, 0, Math.PI * 2);
      ctx.strokeStyle =
        type === 'glove'   ? `rgba(255,200,80,${0.55 * flash})`  :
        type === 'pads'    ? `rgba(120,170,255,${0.55 * flash})` :
        type === 'blocker' ? `rgba(220,160,60,${0.55 * flash})`  :
        `rgba(160,160,160,${0.35 * flash})`;
      ctx.lineWidth = 2 * s;
      ctx.stroke();
    }

    ctx.restore();

    // ── HOLDING INDICATOR (mimo lokální transform, ve screen coords) ──
    if (holding) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 130);
      ctx.beginPath();
      ctx.ellipse(sx, sy, r + 8 * s, r + 6 * s, this._tilt, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100,200,255,${0.35 + 0.25 * pulse})`;
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      ctx.save();
      ctx.font = `bold ${Math.round(6 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(100,200,255,0.85)';
      ctx.fillText(t('covering'), sx, sy - r - 8 * s);
      ctx.restore();
    }

    if (this._screen > 0.15) {
      ctx.save();
      ctx.font = `bold ${Math.round(6 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,140,90,${0.6 * this._screen})`;
      ctx.fillText('BLOCKED', sx, sy + r + 8 * s);
      ctx.restore();
    }
  }
}

// ── Goalie draw helpers ────────────────────────────────────────────────────

// kx/ky = koleno (anchor bod u těla), dir = +1 dolní pad / -1 horní, angle = rotace kolem kolena
function _gPad(ctx, s, kx, ky, dir, angle, flash) {
  const pw = 6.5 * s, ph = 12 * s, r = 2.5 * s;
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(angle);
  // Pad jde OD kolena směrem dir — koleno je na y=0, špička na y=dir*ph
  _roundRect(ctx, -pw / 2, dir > 0 ? 0 : -ph, pw, ph, r);
  ctx.fillStyle = flash > 0 ? 'rgba(200,220,255,0.98)' : '#f2f4f6';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,80,110,0.75)';
  ctx.lineWidth = 1.1 * s;
  ctx.stroke();
  // dělicí pruh v 1/3 délky od kolena
  const stripe = dir * ph * 0.33;
  ctx.beginPath();
  ctx.moveTo(-pw / 2 + 0.8 * s, stripe);
  ctx.lineTo( pw / 2 - 0.8 * s, stripe);
  ctx.strokeStyle = 'rgba(60,80,110,0.22)';
  ctx.lineWidth = 0.7 * s;
  ctx.stroke();
  ctx.restore();
}

function _gArm(ctx, s, x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const w   = 1.9 * s;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  _roundRect(ctx, -len / 2, -w / 2, len, w, w / 2);
  ctx.fillStyle = 'rgba(18,22,36,0.72)';
  ctx.fill();
  ctx.restore();
}

function _gGlove(ctx, s, cx, cy, active) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.5 * s, 2.2 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = active ? '#e8a020' : '#2a2a2a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.8 * s;
  ctx.stroke();
  ctx.restore();
}

function _gBlocker(ctx, s, cx, cy, flash) {
  ctx.save();
  ctx.translate(cx, cy);
  _roundRect(ctx, -2 * s, -2 * s, 4 * s, 4 * s, 1 * s);
  ctx.fillStyle = flash > 0 ? 'rgba(200,150,50,0.95)' : '#2a2a2a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,80,80,0.5)';
  ctx.lineWidth = 0.8 * s;
  ctx.stroke();
  ctx.restore();
}

function _gHelmet(ctx, s, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  // Jednoduchá helma — plochý oval (jako z vrchu)
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.2 * s, 2.8 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d8dde2';
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,55,70,0.7)';
  ctx.lineWidth = 1 * s;
  ctx.stroke();
  // mřížka/štít — dva svislé pruhy vpředu
  ctx.strokeStyle = 'rgba(30,40,50,0.55)';
  ctx.lineWidth = 0.6 * s;
  for (const dx of [-0.9 * s, 0.9 * s]) {
    ctx.beginPath();
    ctx.moveTo(dx, -2.2 * s);
    ctx.lineTo(dx,  2.2 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function _nearestMate(world, team, goalie) {
  let best = null, bd = Infinity;
  for (const p of world.players) {
    if (p.team !== team) continue;
    const d = Math.hypot(p.x - goalie.x, p.y - goalie.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function _gdarken(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

function _segmentAabbHit(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, x0 - minX) && clip(dx, maxX - x0) &&
      clip(-dy, y0 - minY) && clip(dy, maxY - y0)) {
    return { x: x0 + dx * t0, y: y0 + dy * t0 };
  }
  return null;
}

function _roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x,     y + h, rad);
  ctx.arcTo(x,     y + h, x,     y,     rad);
  ctx.arcTo(x,     y,     x + w, y,     rad);
  ctx.closePath();
}
