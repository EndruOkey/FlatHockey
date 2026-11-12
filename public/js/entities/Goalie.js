import { RINK, PUCK } from '../constants.js';
import { clamp } from '../utils.js';
import { t } from '../i18n.js';
import { defaultRng } from '../rng.js';
import { skinGoalie, goalieKit } from './skin.js';

// ── Save profil (naškálováno na reálnou branku 6 ft = 32px) ───────────────
const COVER_H  = 14;  // vizuální pady sahají ~13px od středu + puk radius 3 = ~16px effective
const COVER_X  = 10;
const FIVEHOLE = 4;
const TOP_EDGE = 3;
const MAX_OUT  = 28;
const SPEED    = 170;  // sníženo ze 220 — méně robotické boční přesuny
const MAX_SPEED_CAP = 310;  // absolutní strop efektivní rychlosti
const PADLEN   = 9;
// Nejvyšší dosažitelná výška puku (max. střela): vz²/(2g). Práh horního rohu se měří vůči ní, ne vůči výšce břevna.
const PEAK_Z   = PUCK.maxShotVz ** 2 / (2 * PUCK.gravity);

const _genv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) ? Number(process.env[k]) : d;
// POSTOJE GÓLMANA (2026-11-11): stoj / motýlek / RVH (u tyčky) / roztažení. Deterministická pravidla ze stavu puku.
// Každý postoj kryje jinou část branky (viz STANCE_COVER) → víc způsobů, jak skórovat. FH_GSTANCE=0 = staré chování (A/B měření).
const GSTANCE   = _genv('FH_GSTANCE', 1);
const DROP_T    = 0.12;   // s — pád do motýlka / roztažení (do té doby kryje jen částečně)
const RECOVER_T = 0.25;   // s — vstávání z motýlka/roztažení do stoje (horší dosah i přesun)
const STANCE_MIN = { butterfly: 0.45, stretch: 0.6, rvh: 0.2, stand: 0 };   // s — závazek: pád nejde hned zrušit (doraz/finta)
const STRETCH_OFF = _genv('FH_GSOFF', 20);   // px — přízemní rána mimo gólmana dál než tohle → roztažení
// Naladěno sweepem scripts/goalie_stance_audit.mjs (32 seedů 2v2, 2026-11-11): góly 6,59 → 7,25, vysoko 59 %. Násobky dosahu [nízko (z ≤ gloveHeight), vysoko] pro stranu postoje (near) a druhou stranu (far). Průběh pádu k = 0..1.
export const STANCE_COVER = {
  stand:     { near: [_genv('FH_GSTLO', 0.85), 1.00], far: [_genv('FH_GSTLO', 0.85), 1.00] },   // pady nejsou na ledě → spodní rohy
  butterfly: { near: [_genv('FH_GBFLO', 1.05), _genv('FH_GBFHI', 0.85)], far: [_genv('FH_GBFLO', 1.05), _genv('FH_GBFHI', 0.85)] },   // led zavřený, ramena níž → horní rohy
  rvh:       { near: [1.30, 0.55], far: [0.60, 0.60] },   // přilepený k bližší tyčce; nad ramenem a na druhou stranu
  stretch:   { near: [_genv('FH_GSXLO', 1.70), 0.50], far: [0.50, 0.50] },   // dlouhý dosah po ledě na jednu stranu, nahoře otevřený
};
// FINTA v malém okně (2026-11-12, scripts/feint_probe.mjs): po zrušení nápřahu FAKE_D s gólman ještě stojí na ránu, pak FAKE_W s
// „skočí" (plný trest), pak FAKE_R s návrat. Dřív FAKE_T = 1 s plného trestu → finta vyšla vždy (okno ~1 s).
const FAKE_D = _genv('FH_FAKED', 0.08), FAKE_W = _genv('FH_FAKEW', 0.07), FAKE_R = _genv('FH_FAKER', 0.06);
const FAKE_LOCK = _genv('FH_FAKELOCK', 0.6);   // rána vypuštěná, když je gólman „chycený" (trest ≥ 0,5) → trest drží až do konce rány
const FAKE_T = FAKE_D + FAKE_W + FAKE_R, FAKE_LAG = _genv('FH_FAKELAG', 0.2), FAKE_SCREEN = _genv('FH_FAKESCR', 1.8);   // 1,8: rána v okně finty vyjde ~62 % (feint_probe sweep 2026-11-12)   // FAKE_LAG = násobek rychlosti sledování puku při plném trestu

// Odraz a rozehrání (2026-11-12, scripts/chain_save.mjs + chain_restart.mjs): RB_X/RB_Y poloha puku po zákroku, RB_U0/U1 boční úhel odrazu (°)
// střed→kraj, RB_MIN min. rychlost ven, RB_NOGRAB s bez přikrytí; G_COV px krytí spoluhráče, G_DUMP px/s odložení puku
const RB_X = _genv('FH_RBX', 15), RB_Y = _genv('FH_RBY', 0.8), RB_U0 = _genv('FH_RBU0', 5), RB_U1 = _genv('FH_RBU1', 50), RB_MIN = _genv('FH_RBMIN', 60), RB_NOGRAB = _genv('FH_RBNG', 0.15);
const DEKE_D = _genv('FH_DEKED', 90), DEKE_V = _genv('FH_DEKEV', 90);   // klička: vzdálenost nosiče a rychlost napříč pro rozklek
const LOW_COVER_V = _genv('FH_LCV', 420), LOW_COVER_Y = _genv('FH_LCY', 8);   // sweep: chyceno 25 → 39/48 %   // přízemní puk do těla → přikrytí
const RB_CAP = _genv('FH_RBCAP', 150);   // sweep 2026-11-12: U 5–50°, strop 150 → nebezpečné odrazy 16/19 %, dorážka 3,3/1,8 %
const G_COV = _genv('FH_GCOV', 50), G_DUMP = _genv('FH_GDUMP', 130);

// Animace brankáře (jen kresba): FH_GANIM=0 vypne (A/B měření); latence reakce rukou na výstřel (s) — ODHAD dle reakční doby ~0,2 s
const GANIM = (typeof process !== 'undefined' && process.env?.FH_GANIM != null) ? process.env.FH_GANIM !== '0' : true;
const ANIM_LAT = 0.12;

// Střed brankáře nejblíž POST_IN px od tyčky: kreslené tělo má ±11,5 px → přes tyčku přesáhne jen beton (~3 px), ne půlka těla (2026-11-12)
const POST_IN = (typeof process !== 'undefined' && process.env?.FH_POSTIN != null) ? +process.env.FH_POSTIN : 8.5;

export class Goalie {
  rng = defaultRng;
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
    this._formPhase    = 0; this._form = 0.5; this._formInit = false;   // náhodná část se dolosuje v prvním update (world.rng)

    this.stance        = 'stand';   // 'stand' | 'butterfly' | 'rvh' | 'stretch' (vizuál 'cover' = držení)
    this._stanceT      = 0;
    this._side         = 1;         // strana postoje: +1 = k větší y (dolní tyčka na obrazovce)
    this._recover      = 0;
    this._pokeT        = 0;

    this._retrieving   = false;
    this._boardClear   = false;
    this._passedGate   = false;
    this._returnTimer  = 0;    // sprint zpět do branky po retrieve
  }

  get isHolding() { return this._holdTimer > 0; }

  update(dt, world) {
    if (!this._formInit) { this._formInit = true; this._formPhase = this.rng.next() * Math.PI * 6; this._form = 0.5 + (this.rng.next() - 0.5) * 0.3; }
    const puck = world.puck;
    if (!puck) return;

    if (this._pokeCooldown > 0) this._pokeCooldown -= dt;
    if (this._saveFlash   > 0) this._saveFlash = Math.max(0, this._saveFlash - dt);
    if (this._saveRecoil  > 0) this._saveRecoil = Math.max(0, this._saveRecoil - dt * 4);
    if (this._rbT > 0) this._rbT -= dt;

    // ── Forma: pomalý drift výkonnosti (hot/cold streaks) ────────────────
    // Perioda ~90s → zápasové vlny. Form 0=špatný den, 1=skvělý den.
    this._formPhase += dt * 0.042;
    const formTarget = 0.5 + 0.45 * Math.sin(this._formPhase) * Math.cos(this._formPhase * 0.61);
    this._form += (formTarget - this._form) * Math.min(1, 0.25 * dt);

    if (this._noGrab > 0) this._noGrab -= dt;
    if (this._holdTimer > 0) {
      this._holdTimer -= dt;
      if (GSTANCE) { this.stance = 'stand'; this._stanceT = 0; this._recover = RECOVER_T; }   // po držení se zvedá
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
    let lag             = baseLag * distLagFactor * Math.max(0.05, 1 - this._screen * 0.55);
    // FINTA (2026-11-09): gólman čte nápřah soupeře s pukem (charge > 0,35 do 300 px). Zruší-li ho nosič bez rány
    // (stále drží puk), gólman „skočí" na fintu: FAKE_T s sleduje puk do strany jen zlomkem rychlosti.
    {
      let car = null; for (const p of world.players) if (p.hasPuck && p.team !== this.team && !p.isDefender && !p.isPasser) { car = p; break; }
      const winding = !!car && (car.charge || 0) > 0.35 && rawDist < 300;
      if (this._readWind && car && car === this._windBy && !(car.charge > 0.05)) { this._fakeT = FAKE_T; this._fakeEv = true; }   // nápřah zmizel, puk pořád u nosiče = finta
      this._readWind = winding; this._windBy = car;
      // po fintě jako clona: horší sledování, reakce i dosah (existující cesta _screen) — doznívá s časem
      // výstřel = puk bez nosiče náhle letí k brance (stejné pravidlo jako animace)
      const vInF = puck.vx * -this.inX, shot = !car && vInF > 160 && (this._fkPrevVIn ?? 0) < 80; this._fkPrevVIn = vInF;
      let pen = 0;
      if (this._fakeT > 0) {
        const a = FAKE_T - this._fakeT;   // stáří finty
        pen = a < FAKE_D ? 0 : a < FAKE_D + FAKE_W ? 1 : Math.max(0, 1 - (a - FAKE_D - FAKE_W) / FAKE_R);
        this._fakeT -= dt;
        if (shot && pen >= 0.5) this._fakeLock = FAKE_LOCK;   // trefil okno → gólman zůstane chycený, než rána doletí
      }
      if (this._fakeLock > 0) { this._fakeLock -= dt; pen = 1; if (vInF < 40) this._fakeLock = 0; }
      if (pen > 0) { lag *= 1 - pen * (1 - FAKE_LAG); this._screen = Math.max(this._screen, FAKE_SCREEN * pen); }
    }
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
    const margin    = Math.max(COVER_H * 0.45, POST_IN);
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
    // Chyba zrcadlí stranu puku (jinak by časový šum posouval gólmana jedním směrem → asymetrie nahoře/dole)
    const errSide = clamp(dyN / 10, -1, 1);
    targetY    = clamp(targetY + this._errY * errSide, RINK.goalY + POST_IN, RINK.goalY + RINK.goalH - POST_IN);   // tělo uvnitř ústí (dřív margin × 0,35 = 2,2 px → půlka těla za tyčkou)

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
        targetY = clamp(targetY, RINK.goalY + POST_IN, RINK.goalY + RINK.goalH - POST_IN);   // opřený o tyčku zevnitř
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

    if (GSTANCE) this._updateStance(dt, world, puck, wrapOverride, carrier, angleAbs, dyN, rawDist);
    // Motýlek se posouvá klouzáním, roztažený/RVH skoro stojí, vstávání zpomalí
    const stanceSpeed = !GSTANCE ? 1 : (this.stance === 'butterfly' ? 0.7 : this.stance === 'stretch' ? 0.3 : this.stance === 'rvh' ? 0.6 : 1)
                      * (this._recover > 0 ? 0.55 : 1);

    // ── Pohyb (spring-damper) ────────────────────────────────────────────
    const diffSpeedMult  = this.difficulty === 'competitive' ? 1.15 : this.difficulty === 'easy' ? 0.72 : 1.0;
    const wrapSpeedBoost = wrapOverride ? 1.35 : 1.0;
    const retrieveBoost  = this._retrieving ? 1.15 : 1.0;
    const returnBoost    = this._returnTimer > 0 ? 1.25 : 1.0;
    const moveThreat     = this._retrieving ? Math.max(threat, 0.55) : threat;
    const formSpeed      = 0.92 + 0.16 * this._form;
    const effSpeedRaw    = SPEED * (0.32 + 0.68 * moveThreat) * diffSpeedMult * wrapSpeedBoost * formSpeed * retrieveBoost * returnBoost;
    const effSpeed       = Math.min(effSpeedRaw, MAX_SPEED_CAP) * (wrapOverride || this._retrieving ? 1 : stanceSpeed);
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
    if (GANIM) this._animUpdate(dt, world, puck);
  }

  // Ruka k místu dotyku (sf = goalieSurface v místě dotyku). Volá server při zákroku i klient při novém zásahu ze snapshotu.
  _snapHand(sf) {
    if (!this._a) return;
    const A = this._a, ly = sf.ly - sf.G.bodyY;
    if (sf.part === 'glove' || (sf.part === 'body' && ly < 0)) A.gy = clamp(ly - sf.G.gloveY, -6, 6);
    else if (sf.part === 'blocker' || sf.part === 'body') A.by = clamp(ly - sf.G.blockY, -6, 6);
    A.react = null;
  }

  // ── ANIMACE (2026-11-12, jen vizuál): sledování → příprava (nápřah) → reakce rukou na výstřel → zákrok → návrat.
  // Čte stav simulace, zapisuje jen _a* (simulace je nečte), bez rng → góly i zákroky beze změny (goalie_anim_metrics R8).
  _animUpdate(dt, world, puck) {
    const A = this._a || (this._a = { hx: 0, gy: 0, by: 0, crouch: 0, rec: 0, kick: 0, stepPh: 0, lastY: this.y, react: null, prevVIn: 0 });
    const k = (w) => Math.min(1, w * dt), cap = 150 * dt;
    const spring = (v, tgt, w) => v + clamp((tgt - v) * k(w), -cap, cap);
    const free = !puck.ownerId && !(world.players || []).some(p => p.hasPuck);
    const vIn = (puck.vx || 0) * -this.inX, dyP = puck.y - this.y;
    // výstřel: puk náhle letí k brance (bez nosiče) → předpověď místa a výšky na brankové čáře
    if (free && vIn > 160 && A.prevVIn < 80) {
      const t = Math.max(0, (this.netX - puck.x) / (puck.vx || 1e-6));
      const yAt = puck.y + puck.vy * t, zAt = Math.max(0, (puck.z || 0) + (puck.vz || 0) * t - 0.5 * PUCK.gravity * t * t);
      A.react = { t: 0, y: clamp(yAt - this.y, -16, 16), high: zAt > PUCK.gloveHeight };
    }
    A.prevVIn = vIn;
    if (A.react) { A.react.t += dt; if (A.react.t > ANIM_LAT + 0.4 || !free) A.react = null; }
    // cíle rukou (lokál: −X k puku, +Y dolů): sledování ±1,5 px, příprava = ruce vpřed a od těla, reakce = ruka na straně puku k místu dopadu
    const set = this._readWind ? 1 : 0;
    let hx = -1.0 * set, gy = clamp(dyP / 20, -1, 1) * 1.5 - 0.8 * set, by = clamp(dyP / 20, -1, 1) * 1.5 + 0.8 * set;
    if (A.react && A.react.t >= ANIM_LAT) {
      const r = A.react; hx -= r.high ? 3 : 2;
      if (r.y < 0 || r.high) gy += clamp(r.y + 7.5, -4, 4) - (r.high ? 1.5 : 0); else by += clamp(r.y - 7.5, -4, 4);
    }
    A.hx = spring(A.hx, hx, A.react ? 40 : 12); A.gy = spring(A.gy, gy, A.react ? 40 : 12); A.by = spring(A.by, by, A.react ? 40 : 12);
    A.crouch += (set - A.crouch) * k(1 / 0.15 * 3);
    A.rec = Math.max(0, A.rec - 6 * dt * Math.max(0.3, A.rec));
    // mikrokroky: každé 3 px posunu jeden krok (střídavě pady „kopnou")
    A.stepPh += Math.abs(this.y - A.lastY) / 3; A.lastY = this.y;
    A.kick = Math.max(0, A.kick - dt / 0.08);
    if (A.stepPh >= 1) { A.stepPh -= Math.floor(A.stepPh); A.kick = 1; A.stepSide = -(A.stepSide || 1); }
  }

  // ── Volba postoje (deterministicky ze stavu puku, bez náhody) ──────────
  _updateStance(dt, world, puck, wrapOverride, carrier, angleAbs, dyN, rawDist) {
    this._stanceT += dt;
    if (this._recover > 0) this._recover = Math.max(0, this._recover - dt);
    const front = this.inX < 0 ? puck.x <= this.netX + 5 : puck.x >= this.netX - 5;
    const free  = !world.players.some(p => p.hasPuck);
    const vIn   = puck.vx * -this.inX;                       // rychlost k brance
    let want = 'stand', side = this._side;
    if (wrapOverride && carrier) { want = 'rvh'; side = carrier.y >= RINK.goalY + RINK.goalH / 2 ? 1 : -1; }
    else if (front && angleAbs > 1.1 && rawDist < 70) { want = 'rvh'; side = dyN >= 0 ? 1 : -1; }
    else if (free && front && vIn > 160 && rawDist < 280) {
      const tt  = Math.abs(puck.x - this.x) / Math.max(1, vIn);
      const yAt = puck.y + puck.vy * tt;
      const zAt = Math.max(0, puck.z + puck.vz * tt - 0.5 * PUCK.gravity * tt * tt);
      if (yAt > RINK.goalY - 6 && yAt < RINK.goalY + RINK.goalH + 6) {
        const low = zAt <= PUCK.gloveHeight * 1.5, off = yAt - this.y;
        if (low && Math.abs(off) > STRETCH_OFF) { want = 'stretch'; side = off >= 0 ? 1 : -1; }
        else if (low) want = 'butterfly';
      }
    } else if (carrier && carrier.team !== this.team && front && rawDist < DEKE_D) {
      // KLIČKA zblízka (2026-11-12): nosič jede rychle napříč → rozklek s vedoucím betonem ve směru kličky; pomalý blízko → motýlek
      const vyC = carrier.vy || 0;
      const inSplit = this.stance === 'stretch' || this.stance === 'butterfly';
      if (Math.abs(vyC) > DEKE_V) { want = 'stretch'; side = vyC >= 0 ? 1 : -1; if (this.stance === 'stretch' && this._stanceT < 0.25) side = this._side; }
      else if (inSplit && (Math.abs(vyC) > DEKE_V * 0.55 || this._stanceT < 0.25)) { want = this.stance; side = this._side; }   // hystereze: necukej kolem prahu
      else if (rawDist < DEKE_D * 0.6) want = 'butterfly';
    } else if (free && front && Math.hypot(puck.x - this.x, puck.y - this.y) < 40 && Math.hypot(puck.vx, puck.vy) < 140) want = 'butterfly';   // skrumáž: zavři led
    if (want === this.stance) { if (want === 'rvh') this._side = side; return; }
    const committed = this._stanceT < (STANCE_MIN[this.stance] ?? 0);
    if (committed && !(this.stance === 'butterfly' && want === 'stretch')) return;   // z motýlka jde roztáhnout, jinak závazek
    if (want === 'stand' && this.stance !== 'stand') this._recover = RECOVER_T;
    this.stance = want; this._side = side; this._stanceT = 0;
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
    if (this._rbT > 0 && vxTowardGoal < 120) return false;   // čerstvý odraz neblokuj znovu (jen nová rána)
    if (vxTowardGoal < -120) return false;

    const r = PUCK.radius;
    // Clona zmenší dosah krytí (hráč v zákrytu = hůř chytá)
    // Competitive = lepší pokrytí, casual = snadněji se dostaneš ke gólu
    const screenPenalty = this.difficulty === 'competitive' ? 0.30 : this.difficulty === 'easy' ? 0.68 : 0.42;
    const sc = Math.max(0.15, 1 - this._screen * screenPenalty);   // clona po fintě může být > 1 → dosah nikdy záporný
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
    const shotRand = 1.0 - reactionSway + this.rng.next() * reactionSway * 2;

    const reachX = (COVER_X + r) * sc * coverXMult * speedFactor * distFactor;
    let   reachY = (COVER_H + r) * sc * coverYMult * speedFactor * distFactor * formMult * shotRand;

    // Padáček (puk klesá): golman čte trajektorii a rozšíří krytí → těžší ho přehodit
    if (puck.z > 5 && puck.vz < -25) {
      const dropRead = clamp((-puck.vz - 25) / 120, 0, 1);
      reachY *= 1 + dropRead * 0.18;  // max +18% reach pro rychle klesající puk
    }

    // Chytré vertikální čtení HORNÍHO ROHU: zdvižená rána (vysoké z) → gólman zvedne krytí
    // úměrně výšce. Přízemní rány (z≈0) nedotčené → nízké rohy/po ledě zůstávají stejné.
    if (puck.z > PUCK.gloveHeight) {
      const highRead = clamp((puck.z - PUCK.gloveHeight) / Math.max(1, PEAK_Z - PUCK.gloveHeight), 0, 1);
      reachY *= 1 + highRead * (this.difficulty === 'competitive' ? 0.28 : this.difficulty === 'easy' ? 0.10 : 0.20);
    }
    // Boční střela (přichází víc z boku než čelně) → menší boční dosah
    const shotFrontFrac = shotSpeed > 10 ? clamp(Math.max(0, vxTowardGoal) / shotSpeed, 0, 1) : 1.0;
    reachY *= 0.60 + 0.40 * shotFrontFrac;
    // Floor = minimum pad body (bez debuffů) — nízký, aby one-timer/clona skutečně fungovaly
    const netHalf = RINK.goalH / 2;  // 22px
    const reachFloor = this.difficulty === 'competitive' ? netHalf * 0.55 : this.difficulty === 'easy' ? netHalf * 0.40 : netHalf * 0.48;
    reachY = Math.max(reachY, reachFloor);
    // POSTOJ: dosah zvlášť nahoru/dolů (strana postoje vs. druhá) a nízko/vysoko; vstávání = horší dosah
    let reachUp = reachY, reachDn = reachY;
    const st = GSTANCE ? this.stance : null;
    if (st) {
      const k = st === 'stand' ? 1 : Math.min(1, this._stanceT / DROP_T);
      const C = STANCE_COVER[st] || STANCE_COVER.stand, hi = puck.z > PUCK.gloveHeight ? 1 : 0;
      const mix = m => 1 + (m - 1) * k;
      const nearM = mix(C.near[hi]), farM = mix(C.far[hi]);
      const rec = 1 - 0.2 * (this._recover / RECOVER_T);
      reachDn = reachY * (this._side > 0 ? nearM : farM) * rec;
      reachUp = reachY * (this._side > 0 ? farM : nearM) * rec;
    }
    let relX = puck.x - this.x, relY = puck.y - this.y;
    let hitX = null, hitY = null;

    if (Math.abs(relX) > reachX || relY < -reachUp || relY > reachDn) {
      // Swept test (rychlá střela mezi framy) — bod vstupu, puk zatím neposouvej
      const hit = _segmentAabbHit(
        puck.prevX ?? puck.x, puck.prevY ?? puck.y, puck.x, puck.y,
        this.x - reachX, this.y - reachUp, this.x + reachX, this.y + reachDn
      );
      if (!hit) return false;            // minul → gól (roh / nad gólmanem)
      hitX = hit.x; hitY = hit.y;
      relX = hitX - this.x; relY = hitY - this.y;
    }

    reachY = relY < 0 ? reachUp : reachDn;     // dál se počítá se stranou, kam puk letí
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
      const cornerHigh  = puck.z > PEAK_Z * chBase;
      // Corner window = horní TOP_EDGE px z aktuálního reachY (závisí na rychlosti/formě)
      const cornerEdge  = reachY - TOP_EDGE - (dropping ? 2.0 : 0);
      if (cornerHigh && absY > cornerEdge) return false;
      // Pětka: nízká rána středem, jen když gólman rozjetý (rozhýbat ho)
      // Pětka: na kolenou (motýlek/RVH/roztažení) zavřená; ve stoji otevřená při přesunu nebo tvrdé přízemní ráně
      const fiveOpen = !st ? moving : (st === 'stand' && (moving || shotSpeed > 360));
      if (!high && absY < FIVEHOLE && fiveOpen) return false;
    }

    // ── Zákrok (na save teprve doraz puk na bod vstupu) ──
    if (hitX !== null) { puck.x = hitX; puck.y = hitY; }
    // DOTYK NA POVRCHU: vrať puk po jeho dráze, dokud se jen nedotýká nakreslené výstroje (dřív zajel ~4 px dovnitř a pak
    // vyskočil o 15 px před brankáře → „odraz od ničeho / mezera"). Max 10 px zpět, krok 0,5 px; deterministické.
    { const sp = Math.hypot(puck.vx, puck.vy) || 1, ux = puck.vx / sp, uy = puck.vy / sp;
      for (let k = 0; k < 20 && goalieSurface(this, puck.x, puck.y).d < PUCK.radius; k++) { puck.x -= ux * 0.5; puck.y -= uy * 0.5; } }
    const _sf = goalieSurface(this, puck.x, puck.y);
    this._hit = { x: puck.x, y: puck.y, z: puck.z, part: _sf.part, n: (this._hit?.n || 0) + 1 };   // místo dotyku (měření + záblesk zásahu)
    this._snapHand(_sf);   // animace: zasahující ruka je V TU CHVÍLI u puku (dřív dojela až 0,12 s po ráně, tedy po odrazu)

    // Lapačka — vysoká střela do horní (lapačkové) půlky → chycení
    if (high && relY <= 0) {
      this._holdTimer = GSTANCE ? 1.1 : 0.7;
      this._heldPuck  = puck;
      this._markSave('glove', 0.42);
      puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0;
      return true;
    }

    // Přízemní pomalejší puk přímo do těla → přikryje (dřív se puk po ledě nikdy nepodržel: chyceno jen 25 %, chain_save)
    if (!high && Math.hypot(puck.vx, puck.vy) < LOW_COVER_V && Math.abs(relY) < LOW_COVER_Y) {
      this._holdTimer = GSTANCE ? 1.1 : 0.7;
      this._heldPuck  = puck;
      this._markSave('cover', 0.4);
      puck.vx = 0; puck.vy = 0; puck.vz = 0; puck.z = 0;
      return true;
    }
    // Zákrok = fyzikální odraz od padu + rozehrávka na spoluhráče
    // odraz začíná v místě dotyku na povrchu výstroje (puk tam už je); jen pojistka, ať nezůstane za čárou brankáře
    if (this.inX * (puck.x - this.x) < 2) puck.x = this.x + this.inX * 2;
    puck.z = 0; puck.vz = 0;
    // 2026-11-11: dřív puk po zákroku letěl rovnou přesnou přihrávkou na spoluhráče (ťuk do betonu = okamžitá rozehrávka).
    // Teď fyzikální odraz → doraz je šance; gólman rozehrává jen z držení (_release). FH_GSTANCE=0 = staré.
    const mate = (!GSTANCE && world) ? _nearestMate(world, this.team, this) : null;
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
      if (this.inX * puck.vx < RB_MIN) puck.vx = this.inX * RB_MIN;   // dřív 28 → pomalý odraz zůstal v dosahu a gólman ho ve stejném snímku přikryl
      // Y složka: odraz DO STRANY — úhel roste s tím, jak daleko od středu puk trefil (střed 20°, kraj 50°); dřív vy × 0,45 → 83 % do slotu
      const reachN = clamp(Math.abs(relY) / Math.max(1, COVER_H + PUCK.radius), 0, 1);
      const U = (RB_U0 + (RB_U1 - RB_U0) * reachN) * Math.PI / 180;
      puck.vy = (relY >= 0 ? 1 : -1) * Math.abs(puck.vx) * Math.tan(U);
      // Clamp celkové výstupní rychlosti
      const exitSpd = Math.hypot(puck.vx, puck.vy);
      if (exitSpd > RB_CAP) { const f = RB_CAP / exitSpd; puck.vx *= f; puck.vy *= f; }
    }
    this._markSave(high ? 'blocker' : 'pads', 0.3);
    this._rbT = RB_NOGRAB; this._noGrab = Math.max(this._noGrab || 0, RB_NOGRAB);   // odražený puk hned neblokuj ani nepřikrývej (dřív 14,5 % ve 3v3 týž snímek)
    return true;
  }

  controlLoosePuck(puck) {
    if (this._holdTimer > 0 || this._heldPuck) return true;
    if (!puck || puck.isAirborne) return false;
    if (this._retrieving) return false;  // retrieve logika to řeší sama
    if (this._noGrab > 0) return false;   // čerstvě vypuštěný puk (pas spoluhráči v brankovišti) hned nezachytávej zpět
    if (Math.hypot(puck.vx, puck.vy) > 90) return false;
    // Za brankou neber volný puk — hráč má prioritu
    const behindLine = this.inX < 0 ? puck.x > this.netX + 5 : puck.x < this.netX - 5;
    if (behindLine) return false;
    if (Math.hypot(puck.x - this.x, puck.y - this.y) > this.radius + 9) return false;
    this._holdTimer = GSTANCE ? 1.2 : 0.85;
    this._heldPuck  = puck;
    this._markSave('cover', 0.5); this._hit = { x: puck.x, y: puck.y, z: 0, part: 'pads', n: (this._hit?.n || 0) + 1 };   // přikrytí volného puku = zásah (záblesk)
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
    if (dist > pokeDist) { this._pokeT = 0; return; }
    if (this.inX * (player.x - this.x) < -4) return;   // jen zepředu (ne zezadu od branky)
    if (GSTANCE && (this.stance === 'stretch' || this.stance === 'rvh')) return;   // z roztažení / u tyčky nevypíchne

    // Body occlusion: puck must be on the goalie-facing side of the player body.
    // Dot product of (puck - player_center) vs (goalie - player_center).
    const toPuckX = puck.x - player.x, toPuckY = puck.y - player.y;
    const toGoalX = this.x  - player.x, toGoalY = this.y - player.y;
    const exposed = (toPuckX * toGoalX + toPuckY * toGoalY)
                  / ((Math.hypot(toPuckX, toPuckY) || 1) * (Math.hypot(toGoalX, toGoalY) || 1));
    if (exposed < -0.10) { this._pokeT = 0; return; }  // player shielding puck with body
    // 2026-11-11: dřív okamžitě (ťuk do gólmana = puk pryč). Teď nápřah 0,2 s → útočník stihne kličku / ránu.
    if (GSTANCE) { this._pokeT += 1 / 60; if (this._pokeT < 0.2) return; this._pokeT = 0; }

    player.hasPuck = false;
    player._shootCooldown = 0.50;  // prevent instant re-pickup
    this._pokeCooldown = 0.7;
    const grabDist = this.radius + (player.radius ?? 11) + 2;
    const puckOnBody = Math.hypot(puck.x - this.x, puck.y - this.y) <= this.radius + PUCK.radius + 3;
    if (dist <= grabDist && (!GSTANCE || puckOnBody)) {
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
    this.rng.next();          // zachovej spotřebu rng (sekvence simulace beze změny)
    this._saveRecoilX = 1;    // vizuál: tělo odskočí VŽDY od puku (+X lokálně), ne náhodně
    if (this._a) this._a.rec = 1;   // animace: viditelný odskok 1,5 px s útlumem
  }

  _release(world) {
    if (!this._heldPuck) return;
    // Pod tlakem (soupeř u gólmana) puk PODRŽ → píšťalka a buly v obranném pásmu (jako v hokeji).
    // Jen jednou za držení (_froze) a jen v online zápase (world.allowFreeze) — trénink/tutoriál beze změny.
    if (!this._froze && world?.allowFreeze && _underPressure(world, this)) {
      this._froze = true;
      this._holdTimer = 1.6;                 // drž dál, než přijde buly (stoppage 1.3 s)
      world.whistle('freeze', this.team);
      return;
    }
    this._froze = false;
    const p = this._heldPuck;
    this._heldPuck = null;
    this._noGrab = 0.6;   // bez toho pas na spoluhráče <15 px dojel pomalu (<90 px/s) a gólman ho hned znovu chytil → držel navždy
    p.x = this.x + this.inX * 16; p.y = this.y; p.z = 0; p.vz = 0;

    // Bez tlaku: měkká přihrávka jen VOLNÉMU blízkému spoluhráči (dřív laser na kohokoli = okamžitá rozehrávka),
    // jinak puk jen odloží do strany pro obránce.
    const mate = world ? _nearestMate(world, this.team, this) : null;
    const mDist = mate ? Math.hypot(mate.x - p.x, mate.y - p.y) : Infinity;
    const mateOpen = mate && (!GSTANCE || (mDist < 170 && !world.players.some(o => o.team !== this.team && Math.hypot(o.x - mate.x, o.y - mate.y) < G_COV)));
    if (mateOpen) {
      const ang  = Math.atan2(mate.y - p.y, mate.x - p.x);
      const sp = GSTANCE ? Math.min(230, Math.sqrt(2 * PUCK.decel * mDist) + 15) : Math.min(PUCK.passSpeed, Math.sqrt(2 * PUCK.decel * mDist) + 35);
      p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
    } else {
      // odlož na stranu DÁL od nejbližšího soupeře (dřív vždy k bližšímu mantinelu 80 px/s → 94 % rozeher, soupeř střílel stejně často jako vlastní tým)
      let opp = null, od = Infinity; if (world) for (const o of world.players) if (o.team !== this.team) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < od) { od = d; opp = o; } }
      const toBoard = opp ? (opp.y < this.y ? 1 : -1) : (this.y < RINK.h / 2 ? -1 : 1);
      const angle = Math.atan2(toBoard * 60, this.inX * 120);
      const vs = GSTANCE ? G_DUMP : 130;
      p.vx = Math.cos(angle) * vs; p.vy = Math.sin(angle) * vs;
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

    // ── POSTOJ (2026-11-11): geometrie padů/těla podle stance (stejná funkce měří scripts/goalie_stance_audit.mjs)
    const spread = clamp(Math.abs(this._vy) / 110, 0, 1);
    const drop   = this.stance === 'stand' ? 1 : Math.min(1, this._stanceT / DROP_T);
    const G      = goalieGeom(holding ? 'cover' : this.stance, this._side, spread, drop);
    const A = GANIM && this._a;
    if (A && !holding) {   // animace rukou, přikrčení a mikrokroků (jen kresba)
      G.handX += A.hx; G.gloveY += A.gy; G.blockY += A.by; G.bodyScale *= 1 - 0.05 * A.crouch;
      if (A.kick > 0) for (const pd of G.pads) if (Math.sign(pd.ky || pd.dir) === (A.stepSide || 1)) pd.kx -= 1.2 * A.kick;
    }

    // Přepneme na lokální souřadnice golmana (−X = směr k puku)
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(-this.inX, 1);

    // ── KRESBA C-d2 (skin.js): pady podle goalieGeom (beze změny), stehna, vesta, paže, maska „kočičí oči", lapačka
    //    (palec, T-web, kapsa, manžeta), vyrážečka, hokejka — jeden obrys kolem celku, jedno stínování. Světové jednotky.
    ctx.save();
    ctx.scale(s, s);
    skinGoalie(ctx, G, goalieKit(this, baseColor), {
      stance: holding ? 'cover' : this.stance, tilt: this._tilt, recoil: recoil + (A ? A.rec * 1.5 : 0), holding, inX: this.inX, drawPuck: false,
      padFlash: type === 'pads' ? flash : 0, blockFlash: type === 'blocker' ? flash : 0, gloveFlash: (type === 'glove' || type === 'cover') ? flash : 0,
    });
    ctx.restore();

    ctx.translate(G.bodyX * s, G.bodyY * s);
    ctx.rotate(this._tilt);

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
      const pulse = 0.5 + 0.5 * Math.sin(((cam && cam.t != null) ? cam.t * 1000 : 0) / 130);
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
      ctx.fillStyle = `rgba(255,140,90,${0.6 * Math.min(1, this._screen)})`;
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
      const pulse = 0.5 + 0.5 * Math.sin(((cam && cam.t != null) ? cam.t * 1000 : 0) / 1100);

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

// GEOMETRIE POSTOJE (lokálně, px, −X = k puku, +Y = dolů na obrazovce; side = strana postoje ±1).
// Pohled shora: STOJ = pady svisle → shora krátké (zkrácené), u sebe, V k puku; MOTÝLEK = kolena u sebe, pady naplocho
// po ledě do stran (dlouhé, špičky mírně dozadu), trup níž (menší), ruce výš a do stran; RVH = pad u tyčky naplocho po
// brankové čáře, druhá noha stojí; ROZTAŽENÍ = jeden pad natažený daleko do strany, druhý složený, trup se nakloní;
// COVER = motýlek, ruce u sebe nad pukem. Vrací i hodnoty, které měří audit (šířka/asymetrie siluety).
export function goalieGeom(stance, side = 1, spread = 0, drop = 1) {
  const L = (a, b) => a + (b - a) * drop;   // přechod stoj → postoj (pád)
  const stand = { pads: [
      { kx: -spread * 1.5, ky: -2.5, dir: -1, angle: 0.26 + spread * spread * 0.55, ph: 8, pw: 6.5 },
      { kx: -spread * 1.5, ky:  2.5, dir:  1, angle: 0.26 + spread * spread * 0.55, ph: 8, pw: 6.5 } ],
    bodyX: 0, bodyY: 0, bodyScale: 1, gloveY: -7.5, blockY: 7.5, handX: -5.5 };
  if (stance === 'stand' || !stance) return stand;
  if (stance === 'butterfly' || stance === 'cover') {
    const cov = stance === 'cover';
    return { pads: [
        { kx: L(0, -1.5), ky: L(-2.5, -1.5), dir: -1, angle: L(0.26, -0.22), ph: L(8, 15), pw: L(6.5, 7) },
        { kx: L(0, -1.5), ky: L( 2.5,  1.5), dir:  1, angle: L(0.26, -0.22), ph: L(8, 15), pw: L(6.5, 7) } ],
      bodyX: L(0, -1), bodyY: 0, bodyScale: L(1, 0.86), gloveY: cov ? -3.5 : L(-7.5, -10), blockY: cov ? 3.5 : L(7.5, 10), handX: cov ? -8 : L(-5.5, -4) };
  }
  if (stance === 'rvh') {
    return { pads: [
        { kx: 0,  ky: side * 2.5,  dir:  side, angle: L(0.26, -0.35), ph: L(8, 15), pw: L(6.5, 7) },   // pad u tyčky naplocho
        { kx: -1, ky: -side * 2.5, dir: -side, angle: 0.3, ph: 8, pw: 6.5 } ],                          // stojná noha
      bodyX: L(0, 1), bodyY: L(0, side * 2.5), bodyScale: L(1, 0.92),
      gloveY: L(-7.5, side < 0 ? -9 : -7), blockY: L(7.5, side > 0 ? 9 : 7), handX: -5 };
  }
  if (stance === 'stretch') {
    return { pads: [
        { kx: -1, ky: side * 3,  dir:  side, angle: L(0.26, -0.05), ph: L(8, 21), pw: L(6.5, 7) },     // natažený pad
        { kx: 0,  ky: -side * 2, dir: -side, angle: L(0.26, 0.9), ph: L(8, 7), pw: 6.5 } ],             // složená noha
      bodyX: 0, bodyY: L(0, side * 3), bodyScale: L(1, 0.9),
      gloveY: L(-7.5, side < 0 ? -12 : -6), blockY: L(7.5, side > 0 ? 12 : 6), handX: L(-5.5, -3) };
  }
  return stand;
}
// Silueta (pro audit): krajní body padů v ose Y vůči středu gólmana
// ── POVRCH NAKRESLENÉHO BRANKÁŘE (2026-11-12, scripts/contact_gap.mjs): znaménková vzdálenost bodu (svět) od výstroje
// stejně jako skinGoalie (tělo, lapačka, vyrážečka, betony). anim = s animačními posuny rukou (jen měření/kresba), jinak základní póza.
const _sdEll = (px, py, cx, cy, rx, ry) => { const nx = (px - cx) / rx, ny = (py - cy) / ry; return (Math.hypot(nx, ny) - 1) * Math.min(rx, ry); };
const _sdBox = (px, py, cx, cy, hw, hh, ang) => { const c = Math.cos(-ang), s = Math.sin(-ang), x = (px - cx) * c - (py - cy) * s, y = (px - cx) * s + (py - cy) * c;
  const dx = Math.abs(x) - hw, dy = Math.abs(y) - hh; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0); };
export function goalieSurface(g, wx, wy, anim = false) {
  const spread = clamp(Math.abs(g._vy || 0) / 110, 0, 1), drop = g.stance === 'stand' ? 1 : Math.min(1, (g._stanceT || 0) / DROP_T);
  const G = goalieGeom(g.stance, g._side, spread, drop), A = anim ? g._a : null;
  if (A) { G.handX += A.hx; G.gloveY += A.gy; G.blockY += A.by; G.bodyScale *= 1 - 0.05 * A.crouch; }
  const lx = -g.inX * (wx - g.x), ly = wy - g.y;
  const t = g._tilt || 0, c = Math.cos(-t), s = Math.sin(-t), bx = (lx - G.bodyX) * c - (ly - G.bodyY) * s, by = (lx - G.bodyX) * s + (ly - G.bodyY) * c;
  const rb = 8 * G.bodyScale * 1.04;
  let part = 'body', d = _sdEll(bx, by, 0, 0, rb * 0.88, rb * 1.12), q;
  if ((q = _sdEll(bx, by, G.handX, G.gloveY, 3.85, 4.18)) < d) { d = q; part = 'glove'; }
  if ((q = _sdBox(bx, by, G.handX - 0.22, G.blockY, 1.54, 3.85, 0)) < d) { d = q; part = 'blocker'; }
  for (const pd of G.pads) { const a = pd.angle * pd.dir, cy0 = pd.dir > 0 ? pd.ph / 2 : -pd.ph / 2;
    if ((q = _sdBox(lx, ly, pd.kx - Math.sin(a) * cy0, pd.ky + Math.cos(a) * cy0, pd.pw / 2, pd.ph / 2, a)) < d) { d = q; part = 'pads'; } }
  return { d, part, lx, ly, G };
}

export function goalieSilhouette(g) {
  let lo = 0, hi = 0;
  for (const p of g.pads) {
    const y0 = p.dir > 0 ? 0 : -p.ph, y1 = p.dir > 0 ? p.ph : 0;
    for (const yy of [y0, y1]) for (const xx of [-p.pw / 2, p.pw / 2]) {
      const a = p.angle * p.dir, Y = p.ky + xx * Math.sin(a) + yy * Math.cos(a);
      lo = Math.min(lo, Y); hi = Math.max(hi, Y);
    }
  }
  return { up: -lo, down: hi, span: hi - lo };
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


// Tlak na gólmana: soupeř blíž než 60 px od gólmana (deterministické, jen z pozic)
const PRESSURE_R = 60;
function _underPressure(world, g) {
  for (const p of world.players) {
    if (p.team === g.team) continue;
    if (Math.hypot(p.x - g.x, p.y - g.y) < PRESSURE_R) return true;
  }
  return false;
}
