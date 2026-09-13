import { RINK, PUCK } from '../constants.js';
import { clamp } from '../utils.js';
import { t } from '../i18n.js';

// ── Save profil (naškálováno na reálnou branku 6 ft = 32px) ───────────────
const COVER_H  = 14;  // vizuální pady sahají ~13px od středu + puk radius 3 = ~16px effective
const COVER_X  = 10;
const FIVEHOLE = 4;
const TOP_EDGE = 3;
const MAX_OUT  = 28;
const SPEED    = 170;  // sníženo ze 220 — méně robotické boční přesuny
const MAX_SPEED_CAP = 310;  // absolutní strop efektivní rychlosti
const PADLEN   = 9;

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
    this._saveRecoil   = 0;
    this._saveRecoilX  = 0;
    this._wrapReact    = 0;
    this._formPhase    = Math.random() * Math.PI * 6;
    this._form         = 0.5 + (Math.random() - 0.5) * 0.3;
    this._retrieving   = false;
    this._boardClear   = false;
    this._passedGate   = false;
    this._returnTimer  = 0;    // sprint zpět do branky po retrieve
  }

  get isHolding() { return this._holdTimer > 0; }

  update(dt, world) {
    const puck = world.puck;
    if (!puck) return;

    if (this._pokeCooldown > 0) this._pokeCooldown -= dt;
    if (this._saveFlash   > 0) this._saveFlash = Math.max(0, this._saveFlash - dt);
    if (this._saveRecoil  > 0) this._saveRecoil = Math.max(0, this._saveRecoil - dt * 4);

    // ── Forma: pomalý drift výkonnosti (hot/cold streaks) ────────────────
    // Perioda ~90s → zápasové vlny. Form 0=špatný den, 1=skvělý den.
    this._formPhase += dt * 0.042;
    const formTarget = 0.5 + 0.45 * Math.sin(this._formPhase) * Math.cos(this._formPhase * 0.61);
    this._form += (formTarget - this._form) * Math.min(1, 0.25 * dt);

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
        if (p.isDefender || p.isPasser || p.isGoalie) continue; // AI objekty neclonují
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
    const diffMult      = this.difficulty === 'competitive' ? 0.75 : this.difficulty === 'easy' ? 1.40 : 1.0;
    const baseLag       = 5.8 * diffMult;
    const distLagFactor = rawDist > 170 ? Math.max(0.28, 1 - (rawDist - 170) / 220) : 1.0;
    const lag           = baseLag * distLagFactor * (1 - this._screen * 0.55);
    // Percepce X: za brankou puk fixuj na goal line (golman nesleduje puk za sebou),
    // ale jen pokud NENÍ v retrieve fázi — tam potřebujeme skutečnou pozici.
    const pxRaw   = this._retrieving
      ? puck.x
      : (this.side === 'right' ? Math.min(puck.x, netX - 1) : Math.max(puck.x, netX + 1));
    this._percX += (pxRaw - this._percX) * Math.min(1, lag * dt);
    this._percY += (puck.y  - this._percY) * Math.min(1, lag * dt);

    // Anticipace pohybu puku
    const rawVy = (puck.y - this._lastPuckY) / Math.max(dt, 1e-3);
    this._lastPuckY = puck.y;
    this._puckVy += (rawVy - this._puckVy) * Math.min(1, 9 * dt);
    const biteMult = this.difficulty === 'competitive' ? 0.60 : this.difficulty === 'easy' ? 0.20 : 0.38;
    const bite     = clamp(this._puckVy, -240, 240) * 0.055 * biteMult;

    // ── Zónová vzdálenost puku ──────────────────────────────────────────
    const px = this._percX, py = this._percY;
    const dxN        = Math.max(1, (netX - px) * -this.inX);
    const dyN        = py - netY;
    const distToPuck = Math.hypot(dxN, dyN);
    const angleAbs   = Math.atan2(Math.abs(dyN), dxN);
    // ── Hloubka výjezdu — NHL zóny (5.3 px/ft, crease edge ≈ 32px) ──────
    // Klíč: zóna sama zajišťuje ústup z dálky — žádný threat multiplikátor na depth.
    // Tím se eliminuje problém stacked multiplikátorů, které golmana držely na čáře.
    // Depth se neškáluje difficulty — obě úrovně stojí na stejném místě geometricky.
    // Difficulty ovlivňuje přesnost (errAmp) a rychlost přesunu, ne výchozí pozici.
    let depth;
    if      (distToPuck < 25)  depth = MAX_OUT * 0.22 * Math.sqrt(distToPuck / 25); // záros: ustupuje, reaktivní
    else if (distToPuck < 100) depth = MAX_OUT * 0.72;                              // slot: challenge
    else if (distToPuck < 200) depth = MAX_OUT * (0.72 - 0.22 * (distToPuck - 100) / 100); // kruhy: 0.72→0.50
    else if (distToPuck < 340) depth = MAX_OUT * (0.50 - 0.18 * (distToPuck - 200) / 140); // modrá: 0.50→0.32
    else if (distToPuck < 520) depth = MAX_OUT * (0.32 - 0.14 * (distToPuck - 340) / 180); // neutral: 0.32→0.18
    else                       depth = MAX_OUT * 0.12;                              // za středem: mírně vpředu
    // Ostrý úhel → méně vpřed (golman krytý tyčkou, zaujímá near-post pozici)
    depth *= 1 - clamp(angleAbs / (Math.PI * 0.5), 0, 1) * (this.difficulty === 'competitive' ? 0.35 : 0.48);

    // Threat: jen pro Y pohyb a rychlost (ne pro depth — to obstarává zone)
    const threatRange = this.difficulty === 'competitive' ? (300 - distToPuck) / 240
                      : this.difficulty === 'easy'        ? (220 - distToPuck) / 230
                      :                                     (260 - distToPuck) / 210;
    const threat      = clamp(threatRange, 0, 1);
    let targetX = netX + this.inX * depth;

    // ── Cílová Y: bisektriz úhlu (NHL angle play) ────────────────────────
    const denomRaw  = netX - px;
    const denomSafe = Math.sign(denomRaw || -this.inX) * Math.max(Math.abs(denomRaw), 30);
    const s         = clamp((targetX - px) / denomSafe, -0.15, 1.05);
    const margin    = COVER_H * 0.45;
    let targetY = py + s * (netY - py) + bite * threat;
    // Y tracking: 60% vždy — sleduje úhel přiměřeně i z dálky
    targetY = netY + (targetY - netY) * (0.60 + 0.40 * threat);
    // Near-post play: gólman se přichyluje k bližší tyčce
    // 1) Ostrý úhel (≥43°): silný commit, zahrnuje wraparound situace
    // 2) Poziční shadow: i při mělkém úhlu hráč stojící výrazně nad/pod brankou nutí gólmana posunout se
    const puckActuallyFront = this.inX < 0 ? puck.x <= this.netX + 5 : puck.x >= this.netX - 5;
    const nearPostY = dyN >= 0 ? RINK.goalY + RINK.goalH : RINK.goalY;
    if (puckActuallyFront) {
      // Úhlový commit (ostrý úhel)
      if (angleAbs > 0.75) {
        const nearCommit = clamp((angleAbs - 0.75) / 0.65, 0, 1) * (this.difficulty === 'competitive' ? 0.48 : this.difficulty === 'easy' ? 0.18 : 0.36);
        targetY = targetY + (nearPostY - targetY) * nearCommit;
      }
      // Poziční shadow (mělký úhel, ale hráč je výrazně mimo osu branky)
      // postDy: 0=střed, 1=u tyčky, 2+=daleko mimo
      const postDy = dyN / (RINK.goalH / 2);
      if (Math.abs(postDy) > 0.5) {
        const shadowMax  = this.difficulty === 'competitive' ? 0.50 : this.difficulty === 'easy' ? 0.20 : 0.36;
        const posCommit  = clamp((Math.abs(postDy) - 0.5) / 4.0, 0, 1) * shadowMax;
        targetY = targetY + (nearPostY - targetY) * posCommit;
      }
    }
    targetY = clamp(targetY, RINK.goalY + margin, RINK.goalY + RINK.goalH - margin);

    // ── Chybovost modulovaná formou ─────────────────────────────────────
    // Dobrá forma (_form→1): méně chyb. Špatná forma (_form→0): větší odchylky.
    this._errPhase = ((this._errPhase ?? 0) + dt * 0.58);
    const errZone    = clamp(1 - Math.pow((distToPuck - 100) / 105, 2), 0, 1);
    const formFactor = 1.0 + (0.5 - this._form) * 0.8;  // špatná forma = mírnější chyby
    const errAmpBase = (this.difficulty === 'competitive' ? 1.0 : this.difficulty === 'easy' ? 2.8 : 1.6) * formFactor;
    const errAmp     = errAmpBase * (0.08 + 0.92 * errZone);
    const errRaw     = Math.sin(this._errPhase * 0.88) * errAmp
                     + Math.cos(this._errPhase * 1.47) * errAmp * 0.52;
    this._errY = ((this._errY ?? 0) + (errRaw - (this._errY ?? 0)) * Math.min(1, 0.9 * dt));
    targetY    = clamp(targetY + this._errY, RINK.goalY + margin * 0.35, RINK.goalY + RINK.goalH - margin * 0.35);

    // ── Wraparound: hráč s pukem za brankou ─────────────────────────────
    // Reálný golman sleduje pohyb hráče podél brankové čáry (neskočí na fixní tyčku)
    // + reakční lag: první 0.15s po detekci je golman ještě v přechodu → lze dát gól včas
    const carrier = world.players.find(p => p.hasPuck);
    const carrierBehind = carrier && this.inX * (netX - carrier.x) > 8;
    if (!carrierBehind) {
      this._wrapReact = 0;  // reset, hráč vpředu
    }
    let wrapOverride = false;
    if (carrierBehind) {
      this._wrapReact = (this._wrapReact ?? 0) + dt;
      // Po reakčním zpoždění (0.12-0.18s dle difficulty) golman začne dynamicky sledovat Y nosiče
      const reactDelay = this.difficulty === 'competitive' ? 0.06 : 0.10;
      if (this._wrapReact > reactDelay) {
        targetX = netX;
        const wrapY = clamp(carrier.y, RINK.goalY - 1, RINK.goalY + RINK.goalH + 1);
        // Maximální přitlačení k tyčce — žádná mezírka
        const wrapBias = this.difficulty === 'competitive' ? 0.99 : 0.96;
        targetY = netY + (wrapY - netY) * wrapBias;
        targetY = clamp(targetY, RINK.goalY + 1, RINK.goalY + RINK.goalH - 1);
        wrapOverride = true;
      }
    }

    // ── Trapézová rozehrávka: golman jede pro volný puk za brankou ───────
    const puckBehindLine = this.inX < 0 ? puck.x > this.netX + 5 : puck.x < this.netX - 5;
    const puckSpeedTotal = Math.hypot(puck.vx, puck.vy);

    // Predikce: kam puk doklouzne (bez odrazů, přibližně)
    const stopDx = (puck.vx * Math.abs(puck.vx)) / (2 * PUCK.decel);
    const stopDy = (puck.vy * Math.abs(puck.vy)) / (2 * PUCK.decel);
    const predX  = puck.x + stopDx;
    const predY  = puck.y + stopDy;
    const predBehind = this.inX < 0 ? predX > this.netX + 5 : predX < this.netX - 5;

    // Soupeř v nebezpečné zóně = golman neopouští bránu
    const ZONE_CIRCLE_DIST = 200;  // rozšířeno: celé útočné pásmo + část neutrálního
    const opponentNearNet = world.players.some(p => {
      if (p.team === this.team || p.isDefender) return false;
      const frontDist = (this.netX - p.x) * -this.inX;
      return frontDist > -35 && frontDist < ZONE_CIRCLE_DIST;
    });

    const nearestSkaterDist = world.players.reduce((min, p) =>
      Math.min(min, Math.hypot(p.x - puck.x, p.y - puck.y)), Infinity);

    const anyoneHasPuck = world.players.some(p => p.hasPuck);

    // Puk je "volný": nikdo ho nenese, žádný hráč není do 60px od puku, v pásmu klid
    // Rychlostní filtr: rychlý puk (>200) se odrazí od zadní stěny sám — nejet pro něj
    const puckFreeBack = puckBehindLine
      && !anyoneHasPuck
      && !puck.isAirborne
      && this._holdTimer <= 0
      && nearestSkaterDist > 60
      && !opponentNearNet
      && puckSpeedTotal < 200;

    // Časná anticipace: pomalý puk míří za bránu, golman se předem přesune k tyčce
    // Ještě přísnější: hráči musí být 130px+ od puku, puk max 120px/s
    const vxTowardBehind = this.inX < 0 ? puck.vx : -puck.vx;
    const puckApproachingSlow = !puckBehindLine
      && predBehind
      && vxTowardBehind > 10
      && puckSpeedTotal < 120
      && !anyoneHasPuck
      && !puck.isAirborne
      && nearestSkaterDist > 130
      && !opponentNearNet
      && this._inTrapezoid(predX, predY);

    // Puk v síti = gól — 2D check (X uvnitř klece A Y v ústí branky)
    const behindGoal = this.inX < 0 ? puck.x - this.netX : this.netX - puck.x;
    const puckInGoal = behindGoal > 0
      && behindGoal < RINK.goalDepth + 2
      && puck.y > RINK.goalY - 2
      && puck.y < RINK.goalY + RINK.goalH + 2;

    const retrieveCandidate = (puckFreeBack && !puckInGoal && this._inTrapezoid(puck.x, puck.y))
      || puckApproachingSlow;

    if (retrieveCandidate) {
      // Confirmation delay — nereagovat okamžitě na krátké okno (hráč o krok ustoupil)
      this._retrieveReadyTimer = (this._retrieveReadyTimer ?? 0) + dt;
      if (this._retrieveReadyTimer >= 0.28 && !this._retrieving) {
        this._passedGate = false;
        this._retrieving = true;
      }
    } else {
      this._retrieveReadyTimer = 0;
      if (!puckBehindLine || opponentNearNet || puckInGoal || puckSpeedTotal >= 200) {
        if (this._retrieving && opponentNearNet) {
          this._gvx *= 0.2;
          this._gvy *= 0.2;
          this._returnTimer = 1.4;
        }
        this._retrieving = false;
      }
    }

    if (this._retrieving && !wrapOverride) {
      const bMax = this.inX < 0 ? this.netX + 82 : this.netX;
      const bMin = this.inX < 0 ? this.netX      : this.netX - 82;
      const rawTX = clamp(puck.x, bMin, bMax);
      const rawTY = clamp(puck.y, RINK.trapTopLine - 4, RINK.trapBotLine + 4);

      // Waypoint kolem tyčky: nejdřív ven z Y rozsahu branky, pak za bránu.
      // _passedGate = true jakmile goalie jednou vyjede z netY rozsahu → žádná oscilace.
      const POST_GAP = 10;
      const netTop   = RINK.goalY - POST_GAP;
      const netBot   = RINK.goalY + RINK.goalH + POST_GAP;
      const inNetY   = this.y > netTop && this.y < netBot;

      if (!this._passedGate && inNetY) {
        const gateY = Math.abs(puck.y - netTop) <= Math.abs(puck.y - netBot) ? netTop : netBot;
        targetX = this.netX - this.inX * 10;  // krok za síť + Y = oblouková cesta kolem tyčky
        targetY = gateY;
      } else {
        this._passedGate = true;  // jednou ven → přímá cesta k puku, bez návratu
        targetX = rawTX;
        targetY = rawTY;
      }

      // One-touch clear v pohybu
      if (Math.hypot(puck.x - this.x, puck.y - this.y) < this.radius + PUCK.radius + 4) {
        this._retrieving  = false;
        this._passedGate  = false;
        this._returnTimer = 1.6;   // sprint zpět do branky
        this._gvx *= 0.12;
        this._gvy *= 0.12;

        // Board clear: výběr směru podle toho, kde puk leží za bránou
        // Pokud je puk za zadní stěnou sítě (x > goalLine+depth), střílíme NA zadní mantinel
        // → přirozený odraz do rohu podél boční mantinelu (jako reálné NHL).
        // Pokud je puk mezi brankovou čárou a zadní stěnou, střílíme přímo nahoru po ledu.
        const toBoard  = puck.y < RINK.h / 2 ? -1 : 1;
        const boardY   = toBoard > 0 ? RINK.h - 8 : 8;
        const backWall = this.inX < 0 ? this.netX + RINK.goalDepth : this.netX - RINK.goalDepth;
        const pastBack = this.inX < 0 ? puck.x > backWall : puck.x < backWall;
        const endX = pastBack
          ? (this.inX < 0 ? RINK.w - 8 : 8)
          : (this.inX < 0 ? RINK.blueLineRight - 40 : RINK.blueLineLeft + 40);
        const cdx = endX - puck.x, cdy = boardY - puck.y;
        const cdist = Math.hypot(cdx, cdy) || 1;
        puck.vx = (cdx / cdist) * 360;
        puck.vy = (cdy / cdist) * 360;
        puck.z = 0; puck.vz = 0;
      }
    }

    // ── Sprint zpět po retrieve: přebij target na střed branky ────────────
    if (this._returnTimer > 0 && !wrapOverride && !this._retrieving) {
      this._returnTimer -= dt;
      targetX = netX;
      targetY = netY;
    }

    // ── Pohyb (spring-damper) ────────────────────────────────────────────
    const diffSpeedMult  = this.difficulty === 'competitive' ? 1.15 : this.difficulty === 'easy' ? 0.72 : 1.0;
    const wrapSpeedBoost = wrapOverride ? 1.35 : 1.0;
    const retrieveBoost  = this._retrieving ? 1.15 : 1.0;
    const returnBoost    = this._returnTimer > 0 ? 1.25 : 1.0;
    const moveThreat     = this._retrieving ? Math.max(threat, 0.55) : threat;
    const formSpeed      = 0.92 + 0.16 * this._form;
    const effSpeedRaw    = SPEED * (0.32 + 0.68 * moveThreat) * diffSpeedMult * wrapSpeedBoost * formSpeed * retrieveBoost * returnBoost;
    const effSpeed       = Math.min(effSpeedRaw, MAX_SPEED_CAP);
    let desVx = (targetX - this.x) * 10;
    let desVy = (targetY - this.y) * 10;
    const dspd = Math.hypot(desVx, desVy);
    if (dspd > effSpeed) { const f = effSpeed / dspd; desVx *= f; desVy *= f; }
    const returning = this._returnTimer > 0;
    const accMult = (this._retrieving || returning || wrapOverride) ? 1.0 : (this.difficulty === 'competitive' ? 1.18 : 0.72);
    const acc = Math.min(1, 10 * dt * accMult);
    this._gvx += (desVx - this._gvx) * acc;
    this._gvy += (desVy - this._gvy) * acc;
    this.x += this._gvx * dt;
    this.y += this._gvy * dt;
    this._vy = (this.y - prevY) / Math.max(dt, 1e-3);

    // Natočení: při wrapu — postCommit tilt (RVH styl, přitlačen k tyčce)
    //           jinak — standard angle play
    let tilt;
    if (wrapOverride && carrier) {
      const postCommit = (carrier.y - netY) / (RINK.goalH / 2);  // −1=horní tyčka, +1=dolní
      tilt = clamp(-postCommit * 0.88, -0.88, 0.88);
    } else {
      tilt = clamp(-Math.atan2(this._percY - this.y, Math.abs(this._percX - this.x) + 4), -0.42, 0.42);
    }
    this._tilt += (tilt - this._tilt) * Math.min(1, (wrapOverride ? 12 : 8) * dt);
  }

  // ── Trapézová zóna: je bod (x,y) v golmanově povoleném území za bránou? ─
  _inTrapezoid(x, y) {
    const behind = this.inX < 0 ? x - this.netX : this.netX - x;
    if (behind <= 0) return false;
    const t         = Math.min(behind / 90, 1.0);
    const netCY     = RINK.goalY + RINK.goalH / 2;
    const halfLine  = netCY - RINK.trapTopLine;   // 228 - 174 = 54px
    const halfBoard = netCY - RINK.trapTopBoard;  // 228 - 154 = 74px
    return Math.abs(y - netCY) <= halfLine + (halfBoard - halfLine) * t;
  }

  // ── Zónový zákrok ─────────────────────────────────────────────────────
  blockPuck(puck, world) {
    if (this._holdTimer > 0) return true;

    // Puk musí přicházet z přední strany těla — nelze vyrazit přes záda
    // inX < 0 (pravá brána): puk musí být vlevo od golmana (x ≤ this.x + 5)
    // inX > 0 (levá brána):  puk musí být vpravo od golmana (x ≥ this.x − 5)
    const fromFront = this.inX < 0 ? puck.x <= this.x + 5 : puck.x >= this.x - 5;
    if (!fromFront) return false;

    // Puk letící silně OD branky (odraz/přihrávka pryč) nelze zachytit
    const vxTowardGoal = puck.vx * (-this.inX);  // kladné = k brance
    if (vxTowardGoal < -120) return false;

    const r = PUCK.radius;
    // Clona zmenší dosah krytí (hráč v zákrytu = hůř chytá)
    // Competitive = lepší pokrytí, casual = snadněji se dostaneš ke gólu
    const screenPenalty = this.difficulty === 'competitive' ? 0.30 : this.difficulty === 'easy' ? 0.68 : 0.42;
    const sc = 1 - this._screen * screenPenalty;
    const coverXMult = this.difficulty === 'competitive' ? 1.08 : this.difficulty === 'easy' ? 0.82 : 1.0;
    // COVER_H=14 → base=17px. Vyšší mults → debuffs (one-timer/clona/forma) skutečně sníží reachY pod floor
    const coverYMult = this.difficulty === 'competitive' ? 1.55 : this.difficulty === 'easy' ? 1.05 : 1.28;

    // Síla střely: rychlý puk = méně reakčního času = menší zone (max −25 %)
    const shotSpeed = Math.hypot(puck.vx, puck.vy);
    let speedFactor = clamp(1 - (shotSpeed - 150) / 520, 0.65, 1.0);
    // One-timer: gólman nestihne reagovat na rychlý přechod nahrávka→střela (−28 %)
    if (this._oneTimerHint) speedFactor = Math.max(0.55, speedFactor * 0.72);
    // Vzdálenost střely: z blízka = kratší čas na read = menší zone (max −20 %)
    const prevPx = puck.prevX ?? puck.x;
    const shotDist = Math.abs(prevPx - this.x);
    const distFactor = clamp(0.80 + shotDist / 700, 0.80, 1.0);

    // Forma: golman má dobré a špatné dny → variance na každé obtížnosti
    // Easy: větší výkyvy (0.82–1.18), Casual: střední (0.88–1.12), Competitive: malé (0.93–1.07)
    const formSwing = this.difficulty === 'competitive' ? 0.07 : this.difficulty === 'easy' ? 0.18 : 0.12;
    const formMult  = 1.0 - formSwing + this._form * formSwing * 2;

    // Per-střela reakce: každý zákrok má malý náhodný výkyv → golman nevypadá jako stroj
    // Easy: ±12%, Casual: ±7%, Competitive: ±4%
    const reactionSway = this.difficulty === 'competitive' ? 0.04 : this.difficulty === 'easy' ? 0.12 : 0.07;
    const shotRand = 1.0 - reactionSway + Math.random() * reactionSway * 2;

    const reachX = (COVER_X + r) * sc * coverXMult * speedFactor * distFactor;
    let   reachY = (COVER_H + r) * sc * coverYMult * speedFactor * distFactor * formMult * shotRand;

    // Padáček (puk klesá): golman čte trajektorii a rozšíří krytí → těžší ho přehodit
    if (puck.z > 5 && puck.vz < -25) {
      const dropRead = clamp((-puck.vz - 25) / 120, 0, 1);
      reachY *= 1 + dropRead * 0.18;  // max +18% reach pro rychle klesající puk
    }

    // Boční střela (přichází víc z boku než čelně) → menší boční dosah
    const shotFrontFrac = shotSpeed > 10 ? clamp(Math.max(0, vxTowardGoal) / shotSpeed, 0, 1) : 1.0;
    reachY *= 0.60 + 0.40 * shotFrontFrac;
    // Floor = minimum pad body (bez debuffů) — nízký, aby one-timer/clona skutečně fungovaly
    const netHalf = RINK.goalH / 2;  // 22px
    const reachFloor = this.difficulty === 'competitive' ? netHalf * 0.55 : this.difficulty === 'easy' ? netHalf * 0.40 : netHalf * 0.48;
    reachY = Math.max(reachY, reachFloor);
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
    const moving  = Math.abs(this._vy) > 90;   // gólman se aktivně přesouvá → otevřená pětka
    const absY = Math.abs(relY);

    // ── Zranitelnosti ──
    if (this.difficulty === 'easy') {
      // Easy: větší pětka + roh dostupný — ale ne triviálně (puk musí být víc zvednutý)
      const cornerOk = puck.z > PUCK.gloveHeight * 0.85 && absY > reachY * 0.72;
      if (cornerOk) return false;
      if (!high && absY < FIVEHOLE * 2.0) return false;
    } else {
      // Padáček: klesající puk má bonus krytí → corner práh vyšší (těžší projít obloukem)
      const dropping    = puck.z > 5 && puck.vz < -20;
      // Horní růžek: musí být SKUTEČNĚ těsně pod břevno — padáček středního oblouku nestačí
      const chBase      = this.difficulty === 'competitive' ? 0.72 : 0.78; // frakce (glove+cross)
      const cornerHigh  = puck.z > (PUCK.gloveHeight + PUCK.crossbarHeight) * chBase;
      // Corner window = horní TOP_EDGE px z aktuálního reachY (závisí na rychlosti/formě)
      const cornerEdge  = reachY - TOP_EDGE - (dropping ? 2.0 : 0);
      if (cornerHigh && absY > cornerEdge) return false;
      // Pětka: nízká rána středem, jen když gólman rozjetý (rozhýbat ho)
      if (!high && absY < FIVEHOLE && moving) return false;
    }

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

    // Zákrok = fyzikální odraz od padu + rozehrávka na spoluhráče
    puck.x  = this.x + this.inX * (COVER_X + PUCK.radius + 2);
    puck.y  = this.y + relY * 0.35;
    puck.z = 0; puck.vz = 0;
    const mate = world ? _nearestMate(world, this.team, this) : null;
    if (mate) {
      const ang  = Math.atan2(mate.y - puck.y, mate.x - puck.x);
      const dist = Math.hypot(mate.x - puck.x, mate.y - puck.y);
      const sp = Math.min(PUCK.passSpeed, Math.sqrt(2 * PUCK.decel * dist) + 35);
      puck.vx = Math.cos(ang) * sp;
      puck.vy = Math.sin(ang) * sp;
    } else {
      // Fyzikální odraz: reflexe složky X (od plochy padu) + utlumení Y
      const inSpd  = Math.hypot(puck.vx, puck.vy);
      const damp   = clamp(0.28 + inSpd / 1500, 0.28, 0.52);
      puck.vx = -puck.vx * damp;
      // Zajistit minimální rychlost směrem od branky
      if (this.inX * puck.vx < 28) puck.vx = this.inX * 28;
      // Y složka: částečná reflexe + malý boční koponent dle místa dopadu
      puck.vy = puck.vy * -damp * 0.45 + (relY >= 0 ? 1 : -1) * inSpd * 0.06;
      // Clamp celkové výstupní rychlosti
      const exitSpd = Math.hypot(puck.vx, puck.vy);
      if (exitSpd > 240) { const f = 240 / exitSpd; puck.vx *= f; puck.vy *= f; }
    }
    this._markSave(high ? 'blocker' : 'pads', 0.3);
    return true;
  }

  controlLoosePuck(puck) {
    if (this._holdTimer > 0 || this._heldPuck) return true;
    if (!puck || puck.isAirborne) return false;
    if (this._retrieving) return false;  // retrieve logika to řeší sama
    if (Math.hypot(puck.vx, puck.vy) > 90) return false;
    // Za brankou neber volný puk — hráč má prioritu
    const behindLine = this.inX < 0 ? puck.x > this.netX + 5 : puck.x < this.netX - 5;
    if (behindLine) return false;
    if (Math.hypot(puck.x - this.x, puck.y - this.y) > this.radius + 9) return false;
    this._holdTimer = 0.85;
    this._heldPuck  = puck;
    this._markSave('cover', 0.5);
    puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0;
    return true;
  }

  blockPlayer(player) {
    const minDist = this.radius + (player.radius ?? 7);
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
    if (!player.hasPuck || !puck) return;
    if (this._holdTimer > 0 || this._pokeCooldown > 0) return;
    const dx = player.x - this.x, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    const pokeDist = this.radius + 20;
    if (dist > pokeDist) return;
    if (this.inX * (player.x - this.x) < -4) return;   // jen zepředu (ne zezadu od branky)

    // Body occlusion: puck must be on the goalie-facing side of the player body.
    // Dot product of (puck - player_center) vs (goalie - player_center).
    const toPuckX = puck.x - player.x, toPuckY = puck.y - player.y;
    const toGoalX = this.x  - player.x, toGoalY = this.y - player.y;
    const exposed = (toPuckX * toGoalX + toPuckY * toGoalY)
                  / ((Math.hypot(toPuckX, toPuckY) || 1) * (Math.hypot(toGoalX, toGoalY) || 1));
    if (exposed < -0.10) return;  // player shielding puck with body

    player.hasPuck = false;
    player._shootCooldown = 0.50;  // prevent instant re-pickup
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

    // Normální hold (po zákroku): nahraj spoluhráči, nebo měkce do hřiště
    const mate = world ? _nearestMate(world, this.team, this) : null;
    if (mate) {
      const ang  = Math.atan2(mate.y - p.y, mate.x - p.x);
      const dist = Math.hypot(mate.x - p.x, mate.y - p.y);
      const sp = Math.min(PUCK.passSpeed, Math.sqrt(2 * PUCK.decel * dist) + 35);
      p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
    } else {
      const toBoard = this.y < RINK.h / 2 ? -1 : 1;
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

    // ── PADY před tilt rotací — vždy zarovnané na osu Y (kryjí výšku branky)
    // _tilt by je jinak natočil do ledu, což je vizuálně nesmysl
    _gPad(ctx, s, padFwdX, -kneeY, -1, padTilt, type === 'pads' ? flash : 0);
    _gPad(ctx, s, padFwdX,  kneeY, +1, padTilt, type === 'pads' ? flash : 0);

    ctx.rotate(this._tilt);

    const bx = recoil * s;

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

    // ── D1: Weak spot overlay (easy difficulty, training mode) ──
    if (this.showWeakSpots) {
      const gy1 = cam.oy + RINK.goalY * s;
      const gy2 = cam.oy + (RINK.goalY + RINK.goalH) * s;
      const gcy = (gy1 + gy2) / 2;
      const gH  = gy2 - gy1;
      const gxGoalLine = cam.ox + this.netX * s;
      const gxEntrance = gxGoalLine + this.inX * RINK.goalDepth * s;
      const gxL = Math.min(gxGoalLine, gxEntrance);
      const gW  = Math.abs(gxEntrance - gxGoalLine);
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 1100);

      ctx.save();

      // 5-hole — zelená zóna ve středu
      const fhH = FIVEHOLE * 2.2 * s * 2;
      ctx.fillStyle = `rgba(60,220,100,${0.12 + 0.05 * pulse})`;
      ctx.fillRect(gxL, gcy - fhH / 2, gW, fhH);

      // Horní roh — oranžová
      const cH = gH * 0.30;
      ctx.fillStyle = `rgba(255,150,30,${0.10 + 0.04 * pulse})`;
      ctx.fillRect(gxL, gy1, gW, cH);

      // Dolní roh
      ctx.fillStyle = `rgba(255,150,30,${0.10 + 0.04 * pulse})`;
      ctx.fillRect(gxL, gy2 - cH, gW, cH);

      ctx.restore();
    }
  }
}

// ── Goalie draw helpers ────────────────────────────────────────────────────

// kx/ky = koleno (anchor bod u těla), dir = +1 dolní pad / -1 horní, angle = rotace kolem kolena
function _gPad(ctx, s, kx, ky, dir, angle, flash) {
  const pw = 7 * s, ph = 13 * s, r = 2.5 * s;
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(angle * dir);  // dir=-1 horní, +1 dolní → oba pady míří k hráči (V-tvar)
  // Pad jde OD kolena směrem dir — koleno je na y=0, špička na y=dir*ph
  const y0 = dir > 0 ? 0 : -ph;
  _roundRect(ctx, -pw / 2, y0, pw, ph, r);
  ctx.fillStyle = flash > 0 ? 'rgba(200,220,255,0.98)' : '#eef0f3';
  ctx.fill();
  // výrazný tmavý obrys — viditelný na světlém ledě
  ctx.strokeStyle = flash > 0 ? 'rgba(120,160,255,0.9)' : 'rgba(40,55,80,0.90)';
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  // barevný pruh (team color) — vždy uvnitř padu, 30-55% délky od špičky
  const stripeH  = ph * 0.22;
  const stripeY  = y0 + (dir > 0 ? ph * 0.33 : ph * 0.45);  // uvnitř obou padů
  _roundRect(ctx, -pw / 2 + 0.5 * s, stripeY, pw - 1 * s, stripeH, 1 * s);
  ctx.fillStyle = flash > 0 ? 'rgba(100,160,255,0.7)' : 'rgba(40,80,160,0.55)';
  ctx.fill();
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
