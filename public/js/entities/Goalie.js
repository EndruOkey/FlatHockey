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
  constructor(side = 'right') {
    this.isGoalie   = true;
    // Pravá branka = goal-home → brání away (červený); levá = goal-away → brání home (modrý)
    this.side       = side;
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
  }

  get isHolding() { return this._holdTimer > 0; }

  update(dt, world) {
    const puck = world.puck;
    if (!puck) return;

    if (this._pokeCooldown > 0) this._pokeCooldown -= dt;
    if (this._saveFlash   > 0) this._saveFlash = Math.max(0, this._saveFlash - dt);

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

    // Reakce je při cloně pomalejší (gólman puk hůř vidí)
    const lag = 8.5 * (1 - this._screen * 0.5);
    const pxClamp = this.side === 'right' ? Math.min(puck.x, netX - 1) : Math.max(puck.x, netX + 1);
    this._percX += (pxClamp - this._percX) * Math.min(1, lag * dt);
    this._percY += (puck.y - this._percY) * Math.min(1, lag * dt);

    // Anticipace (bite): čte pohyb puku a kousek ho předbíhá → klička jedním směrem
    // ho vytáhne, rychlá změna na druhou stranu ho obejde (deke skill, bez kláves).
    const rawVy = (puck.y - this._lastPuckY) / Math.max(dt, 1e-3);
    this._lastPuckY = puck.y;
    this._puckVy += (rawVy - this._puckVy) * Math.min(1, 9 * dt);
    const bite = clamp(this._puckVy, -240, 240) * 0.085;

    // ── Hra na úhel: stoj na spojnici puk → střed branky v dané hloubce ──
    const px = this._percX, py = this._percY;
    const dxN = Math.max(1, (netX - px) * -this.inX);   // vodorovná vzdálenost puku PŘED brankou
    const dyN = py - netY;                              // boční odchylka puku
    const distToPuck = Math.hypot(dxN, dyN);
    const angleAbs   = Math.atan2(Math.abs(dyN), dxN);  // 0 = frontální, velký = ostrý úhel

    // Hloubka (challenge vs. retreat): vyjeď proti frontální střele z dálky/slotu,
    // stáhni se na čáru v těsném i na ostrém úhlu → tím pohyb "žije".
    let depth;
    if (distToPuck > 150)      depth = MAX_OUT * 0.9;                       // daleko: výjezd
    else if (distToPuck > 70)  depth = MAX_OUT;                             // slot: plný challenge
    else                       depth = clamp(distToPuck * 0.30, 6, MAX_OUT * 0.65); // in-tight: stáhnout se
    depth *= 1 - Math.min(1, angleAbs / (Math.PI * 0.5)) * 0.6;            // ostrý úhel → blíž čáře/tyči

    // HROZBA: jak moc je puk nebezpečný (blízko branky). Daleko (>360px) = klid → gólman
    // nemíří furt na puk, drží pozici u čáry a hýbe se líně. Blízko = plně aktivní.
    const threat = clamp((360 - distToPuck) / 260, 0, 1);
    depth *= 0.28 + 0.72 * threat;                 // klid → mělko u čáry, hrozba → výjezd
    const targetX = netX + this.inX * depth;

    // Pravý úhlový bod: průsečík spojnice puk→střed branky s hloubkovou rovinou x=targetX.
    const denom = Math.abs(netX - px) < 1 ? -this.inX : (netX - px);
    const s = (targetX - px) / denom;
    const margin = COVER_H * 0.45;
    let targetY = py + s * (netY - py) + bite * threat;  // anticipace jen při hrozbě
    // při klidu drž střed branky (nezrcadli vzdálený puk laterálně) → přirozený, ne hyperaktivní
    targetY = netY + (targetY - netY) * (0.25 + 0.75 * threat);
    targetY = clamp(targetY, RINK.goalY + margin, RINK.goalY + RINK.goalH - margin);

    // Plynulý přesun: požadovaná rychlost = tah k cíli (easing → brzdí u cíle). Při klidu
    // pomaleji (líné dorovnání), při hrozbě plná rychlost → působí přirozeně.
    const effSpeed = SPEED * (0.38 + 0.62 * threat);
    let desVx = (targetX - this.x) * 11;
    let desVy = (targetY - this.y) * 11;
    const dspd = Math.hypot(desVx, desVy);
    if (dspd > effSpeed) { const f = effSpeed / dspd; desVx *= f; desVy *= f; }
    const acc = Math.min(1, 10 * dt);
    this._gvx += (desVx - this._gvx) * acc;
    this._gvy += (desVy - this._gvy) * acc;
    this.x += this._gvx * dt;
    this.y += this._gvy * dt;
    this._vy = (this.y - prevY) / Math.max(dt, 1e-3); // boční rychlost pro pětku

    // Natočení čelem k puku (square-up) — náklon dle výškové odchylky puku (symetrické, nezávislé na straně)
    let tilt = clamp(-Math.atan2(this._percY - this.y, Math.abs(this._percX - this.x) + 4), -0.42, 0.42);
    this._tilt += (tilt - this._tilt) * Math.min(1, 8 * dt);
  }

  // ── Zónový zákrok ─────────────────────────────────────────────────────
  blockPuck(puck, world) {
    if (this._holdTimer > 0) return true;

    const r = PUCK.radius;
    // Clona zmenší dosah krytí (hráč v zákrytu = hůř chytá)
    const sc = 1 - this._screen * 0.35;
    const reachX = (COVER_X + r) * sc, reachY = (COVER_H + r) * sc;
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

  _markSave(type, dur) { this._saveType = type; this._saveFlash = dur; this._saveFlashMax = dur; }

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

  // ── Vzhled: štíhlý, čitelný top-down gólman (čelem doleva, ke střelci) ──
  draw(ctx, cam) {
    const s  = cam.scale;
    const { ox, oy } = cam;
    const sx = ox + this.x * s;
    const sy = oy + this.y * s;

    const ch = COVER_H * s, cx = COVER_X * s, pad = PADLEN * s;
    const holding = this._holdTimer > 0;
    const flash   = this._saveFlashMax > 0 ? Math.max(0, this._saveFlash / this._saveFlashMax) : 0;
    const type    = this._saveType;

    ctx.save();
    ctx.translate(sx, sy);
    if (this.side === 'left') ctx.scale(-1, 1); // levý gólman = zrcadlo (čelem doprava)
    ctx.rotate(this._tilt); // natočení čelem k puku
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Stín
    ctx.beginPath();
    ctx.ellipse(2 * s, 0, pad + 3 * s, ch + 2 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // Tělo / dres — barva týmu (z lobby), jinak default home/away
    ctx.fillStyle = this.color ? _gdarken(this.color, 0.18)
                               : (this.team === 'home' ? '#2f6db0' : '#c0392b');
    _roundRect(ctx, -2 * s, -ch * 0.7, cx + 4 * s, ch * 1.4, 5 * s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4 * s; ctx.stroke();

    // Dvě betony (bílé) — přední stěna; mezi nimi tmavá spára = pětka. Rozklek je rozjede.
    const spread = type === 'pads' ? flash * ch * 0.45 : 0;
    const fhGap  = FIVEHOLE * s * 0.6;            // půlka spáry pětky
    const padW   = pad;
    const drawPad = (yTop, yBot) => {
      _roundRect(ctx, -pad, yTop, padW, yBot - yTop, 3 * s);
      ctx.fillStyle = '#f4f7fb'; ctx.fill();
      ctx.strokeStyle = 'rgba(40,60,90,0.4)'; ctx.lineWidth = 1.1 * s; ctx.stroke();
      // role po délce padu
      ctx.strokeStyle = 'rgba(70,90,120,0.3)'; ctx.lineWidth = 0.9 * s;
      for (const fx of [0.4, 0.72]) {
        const xx = -pad + padW * fx;
        ctx.beginPath(); ctx.moveTo(xx, yTop + 1.5 * s); ctx.lineTo(xx, yBot - 1.5 * s); ctx.stroke();
      }
    };
    drawPad(-ch - spread, -fhGap - spread);   // horní beton
    drawPad( fhGap + spread,  ch + spread);   // dolní beton

    // Lapačka — kruh s "C" kapsou otevřenou ke střelci (nahoře). Svítí při chytu.
    const gloveActive = holding || type === 'glove' || type === 'cover';
    const gReach = (type === 'glove' || type === 'cover') ? flash * 7 * s : 0;
    const gx = -pad - 1 * s - gReach, gy = -ch * 0.78 - gReach * 0.5;
    ctx.beginPath(); ctx.arc(gx, gy, 5 * s, 0, Math.PI * 2);
    ctx.fillStyle = gloveActive ? '#ffcf3a' : '#d2a23b'; ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,0,0.5)'; ctx.lineWidth = 1.2 * s; ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, gy, 5 * s, -Math.PI * 0.55, Math.PI * 0.55); // kapsa "C" doleva
    ctx.strokeStyle = 'rgba(60,40,0,0.45)'; ctx.lineWidth = 2 * s; ctx.stroke();

    // Vyrážečka — placatá deska (dole), čelem ke střelci. Vymrští se při zákroku.
    const blkReach = type === 'blocker' ? flash * 6 * s : 0;
    const bx = -pad - 2 * s - blkReach, by = ch * 0.78 + blkReach * 0.3;
    ctx.fillStyle = blkReach > 0 ? `rgba(255,220,140,${0.6 + 0.4 * flash})` : '#caa23a';
    _roundRect(ctx, bx - 2 * s, by - 5 * s, 4 * s, 10 * s, 1.2 * s);
    ctx.fill(); ctx.strokeStyle = 'rgba(60,40,0,0.5)'; ctx.lineWidth = 1.1 * s; ctx.stroke();

    // Maska — malý bílý kruh ve středu (hlava)
    ctx.beginPath(); ctx.arc(cx * 0.15, 0, cx * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = '#eef2f8'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1 * s; ctx.stroke();

    // Flash prstenec u lapačky
    if (flash > 0 && (type === 'glove' || type === 'cover')) {
      ctx.beginPath(); ctx.arc(gx, gy, (1 - flash) * 9 * s + 5 * s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,235,140,${0.8 * flash})`; ctx.lineWidth = 2 * s; ctx.stroke();
    }

    // Puk pod kontrolou
    if (holding) {
      ctx.beginPath(); ctx.arc(gx, gy, 2.3 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#111'; ctx.fill();
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
      ctx.beginPath();
      ctx.ellipse(0, 0, pad + 5 * s, ch + 5 * s, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,220,255,${0.35 + 0.4 * pulse})`;
      ctx.lineWidth = 2 * s; ctx.stroke();
    }

    ctx.restore();

    if (holding) {
      ctx.save();
      ctx.font = `bold ${Math.round(9 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(120,220,255,0.9)';
      ctx.fillText(t('covering'), sx, sy - (ch + 12 * s));
      ctx.restore();
    }
  }
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
