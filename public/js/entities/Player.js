import { RINK, PLAYER, PUCK } from '../constants.js';
import { clamp, lerpAngle, angleDiff } from '../utils.js';
import { SFX } from '../sound.js';
import { defaultRng } from '../rng.js';
import { skaterKit, skinSkate, skinBody, skinHip, SKIN_OUT, shade, luma, drawTextCached } from './skin.js';
import { VIS } from '../vis.js';
import { downPose, drawDownBody, RISE_K } from './downBody.js';
const RISE_S = 0.8, RISE_CUT = RISE_K[1];   // zvedání: od RISE_CUT (podíl upT; RISE_K[1] = na čtyřech / sed) normální kresba, v tu chvíli velikost RISE_S (shora menší = níž u ledu)
// 2026-11-16 Ondřej: „pořád se při zvedání roztáhne a působí jako flek" → sed a klek kloubovou postavou vynechány (shora shluk tvarů)

const _NO_INPUT = { dx: 0, dy: 0, keys: {} };   // ležící hráč: vstup se ignoruje

export class PlayerBase {
  rng = defaultRng;
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
    this._downT = 0; this._upT = 0; this._stagT = 0; this._hitImm = 0; this._fallA = 0; this._fallN = 0; this._fallB = 0; this._stagDir = 1;   // odstupňovaný knockback (sim čas s, krok = pevné DT)
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
    this._skatePhase     = (Array.from(String(id)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 628, 7) / 100); // fáze kroku (vizuál, náhodný start)
    this._lastSkateT     = 0;            // timestamp posledního renderování brusle
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
    // Nápřah: hůl se „natáhne" do strany dle ruky (zrcadlí se pro leváka) → čitelnější a správně i pro lefty
    // SIM (fyzika puku v nápřahu, balanc): původní geometrie. Vizuál nápřahu/švihu řeší jen render (_visStick).
    const windBack = (this.handed ?? 1) * this._dispCharge * 0.85;
    const target = this.crossCheck ? this.bodyAngle : (this.carryAngle - windBack);
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

    // Ostatní hráči: hokejka neprojde tělem ani dříkem cizí hokejky (dřív šla skrz — scripts/stick_contact.mjs)
    if (this._others) for (const o of this._others) {
      if (o === this) continue;
      if (_STK_BODY && !(_STK_MODE === 'opp' && o.team === this.team) && !(_STK_MODE === 'nopuck' && this.hasPuck)) t = _clipRayCircle(gx, gy, cos, sin, t, o.x, o.y, PLAYER.bodyRadius + _STK_BODY_PAD);
      if (_STK_STICK && !o.crossCheck && !o.isDown && !(PLAYER.fight && o.hasPuck)) { const q = o.gripPoint, qd = o.carryAngle ?? o.aimAngle;
        t = _clipRayStick(gx, gy, cos, sin, t, q.x, q.y, Math.cos(qd), Math.sin(qd), o._dispReach ?? PLAYER.stickLen); }
    }

    t = Math.max(0, t);
    return { x: gx + cos * t, y: gy + sin * t };
  }

  // Může tenhle hráč TEĎ sebrat puk? (geometrie + rychlost, bez mutace)
  canPickup(puck) {
    if (puck.isAirborne) return false;
    if (puck.faceoffTimer > 0) return false;  // bully freeze
    if (this._shootCooldown > 0) return false;
    if (this.crossCheck || this.isDown) return false;   // crosscheck = ignoruje pickup; ležící hráč puk nehraje
    if (this._deflQ > 0 && this.deflectWindow(puck) >= 0) return false;   // Q na teč je nachystané → puk neber, tečuj
    // Rozehrávka vlastního gólmana letí jinému spoluhráči → bot ji pustí (nechytá ji adresátovi před hokejkou; test/goalie-pass.mjs)
    if (this.isBot && puck._passTo != null && puck._passTo === puck._gkTo && puck._passTo !== this.id && puck._gkTeam === this.team) return false;
    const tip = this.stickTip;
    // Grab zóna kolem celé čepele — nejen špička, ale i podél lopaty (přesahuje za tip)
    const bladeDir = (this.carryAngle ?? this.aimAngle) + (this.handed ?? 1) * Math.PI / 6.5;
    const bx = tip.x + Math.cos(bladeDir) * 6;
    const by = tip.y + Math.sin(bladeDir) * 6;
    const dTip   = Math.hypot(puck.x - tip.x, puck.y - tip.y);
    const dBlade = Math.hypot(puck.x - bx,    puck.y - by);
    const intended = puck._passTo != null && puck._passTo === this.id;   // přihrávka je pro mě
    const dBody = Math.hypot(puck.x - this.x, puck.y - this.y);
    if (intended ? (Math.min(dTip, dBlade) > PLAYER.passRecvRadius && dBody > this.radius + 8)
                 : Math.min(dTip, dBlade) > PLAYER.pickupTipRadius) return false;
    // Při nabíjení (one-timer) přijmeš i rychlou nahrávku — usnadní načasování
    let maxRel = this.charge > 0 ? 9999 : (intended ? PLAYER.passRecvMaxRel : PLAYER.pickupMaxRelSpeed);
    // Čerstvá rána SOUPEŘE (≤ SHOT_EAT_T s): čistě převezmeš jen pomalý puk, i při nabíjení — jinak se od hole odrazí jako tečka
    // (dřív 7,8 % ran soupeř „snědl" hned v 1. tiku: limit 420 / při nabíjení 9999 px/s, rána má medián 381; scripts/chain_shot.mjs)
    if (puck._shot && puck._shot.team !== this.team) {
      const age = puck._shotAge ?? 9;
      if (age < SHOT_NOPICK) return false;                         // v tiku rány čepele soupeřů splývají → puk nejdřív čepel opustí
      if (age < SHOT_EAT_T) maxRel = Math.min(maxRel, SHOT_EAT_V);
    }
    if (Math.hypot(puck.vx - this.vx, puck.vy - this.vy) > maxRel) return false;
    return true;
  }

  // ── PŘIKOPNUTÍ (Q, 2026-11-12; okno „pod nohama" 2026-11-13): volný puk na ledě do KICK_R px od středu těla
  // (= tělo 7 + puk 3 + 1 px; brusle stojí do ~6 px od středu → puk od čepele ≤ ~11 px, scripts/kick_probe.mjs) → zpracuješ
  // bruslí a jedeš dál, i když je rychlý (hokejkou čistě jen do 420 px/s). Stisk o chvilku dřív se podrží KICK_BUF s (puk do
  // okna dojede). Mimo okno: KICK_CD s nic. Čerstvou ránu soupeře nejde (jako hokejkou).
  // Vrací −1 = nic, 0 = puk míří pod nohy a dorazí do KICK_HINT s (nápověda), 1 = puk pod nohama.
  kickWindow(puck) {
    if (this.hasPuck || this.isDown || !puck || puck.isAirborne || puck.z > 1.5 || puck.faceoffTimer > 0) return -1;
    if (puck._carrier && puck._carrier.hasPuck) return -1;
    if (puck._shot && puck._shot.team !== this.team && (puck._shotAge ?? 9) < SHOT_EAT_T) return -1;
    const dx = puck.x - this.x, dy = puck.y - this.y;
    if (Math.hypot(dx, dy) <= KICK_R) return 1;
    return this.kickEta(puck) <= KICK_HINT ? 0 : -1;
  }
  // za kolik s puk (relativní rychlostí, po přímce) vjede do okna KICK_R; Infinity = mine / vzdaluje se
  kickEta(puck) {
    const dx = puck.x - this.x, dy = puck.y - this.y, rvx = puck.vx - this.vx, rvy = puck.vy - this.vy, vv = rvx * rvx + rvy * rvy;
    if (vv < 1) return Infinity;
    const b = dx * rvx + dy * rvy, c = dx * dx + dy * dy - KICK_R * KICK_R, disc = b * b - vv * c;
    if (b >= 0 || disc < 0) return Infinity;
    return Math.max(0, (-b - Math.sqrt(disc)) / vv);
  }
  // ── TEČ NA Q (2026-11-12): čerstvá rána SPOLUHRÁČE (≤ DEFL_AGE s) a ty do DEFL_ZONE px od soupeřovy branky →
  // Q puk přesměruje holí kam míříš (kurzor; výška podle kurzoru za brankou), rychlost × 0,70–0,85 a chyba úhlu
  // deterministicky podle načasování (doba podržení stisku) a místa zásahu na čepeli. Bez rng. Mimo situaci Q = přikopnutí.
  // Vrací −1 = není situace teče, 0 = puk se blíží (stisk se podrží), 1 = puk na dosah čepele.
  deflectWindow(puck) {
    if (this.hasPuck || !puck || puck.faceoffTimer > 0 || (puck._carrier && puck._carrier.hasPuck)) return -1;
    const sh = puck._shot;
    if (!sh || sh.team !== this.team || sh.id === this.id || (puck._shotAge ?? 9) > DEFL_AGE) return -1;
    const gx = this.team === 'home' ? RINK.goalLineRight : RINK.goalLineLeft, gy = RINK.goalY + RINK.goalH / 2;
    if (Math.hypot(this.x - gx, this.y - gy) > DEFL_ZONE) return -1;
    const v = Math.hypot(puck.vx, puck.vy);
    if (v < DEFL_VMIN || puck.z > DEFL_Z) return -1;
    // vzdálenost puku od čepele (úsečka úchop→špička); i průlet během tiku (puk ≤ 8 px/tik)
    const g = this.gripPoint, t = this.stickTip, d0 = _segDist(puck.x, puck.y, g.x, g.y, t.x, t.y),
      d1 = _segDist(puck.x + puck.vx / 60, puck.y + puck.vy / 60, g.x, g.y, t.x, t.y);
    if (Math.min(d0, d1) <= DEFL_R) return 1;
    // blíží se: nejbližší přiblížení ke špičce do DEFL_R a za ≤ DEFL_SOON s
    const rx = t.x - puck.x, ry = t.y - puck.y, tc = (rx * puck.vx + ry * puck.vy) / (v * v);
    if (tc > 0 && tc <= DEFL_SOON && Math.hypot(puck.x + puck.vx * tc - t.x, puck.y + puck.vy * tc - t.y) <= DEFL_R + 4) return 0;
    return -1;
  }
  _doDeflect(puck) {
    const held = this._deflHeld || 0; this._deflQ = 0; this._deflHeld = 0; this._kickQ = 0;
    const tq = clamp(1 - (held - DEFL_SWEET) / (DEFL_BUF - DEFL_SWEET), 0, 1);   // 1 = stisk těsně před dotekem
    const v = Math.hypot(puck.vx, puck.vy) || 1;
    const gx = this.team === 'home' ? RINK.goalLineRight : RINK.goalLineLeft, gy = RINK.goalY + RINK.goalH / 2;
    // cíl = bod na paprsku kurzoru (od hráče), nejméně v hloubce brankové čáry
    const a = this.aimAngle, ca = Math.cos(a), sa = Math.sin(a);
    const toLine = Math.abs(ca) > 0.05 ? (gx - this.x) / ca : 0, reach = Math.max(this.aimDist ?? 60, toLine > 0 ? toLine : 0, 30);
    const tx = this.x + ca * reach, ty = this.y + sa * reach;
    // místo zásahu: kolmý odstup puku od špičky vůči směru letu (−1..1) → strana chyby
    const t = this.stickTip, side = clamp(((puck.x - t.x) * -puck.vy + (puck.y - t.y) * puck.vx) / v / DEFL_R, -1, 1);
    const err = side * DEFL_ERR_S + (side >= 0 ? 1 : -1) * (1 - tq) * DEFL_ERR_T;
    const dir = Math.atan2(ty - puck.y, tx - puck.x) + err, out = v * (DEFL_KEEP - DEFL_LOSS * (1 - tq));
    puck.vx = Math.cos(dir) * out; puck.vy = Math.sin(dir) * out;
    // výška: kurzor za brankovou čarou zvedá teč (až pod břevno), bot/kurzor na čáře = po ledě
    const dl = Math.max(8, Math.hypot(gx - puck.x, gy - puck.y)), tt = dl / out, over = Math.max(0, (this.aimDist ?? 0) - Math.hypot(gx - this.x, gy - this.y));
    const zT = this.isBot ? 0 : clamp(over / 80, 0, 1) * (PUCK.crossbarHeight - 5), z0 = Math.max(0, puck.z);
    puck.z = z0; puck.vz = Math.max(0, (zT - z0 + PUCK.gravity * tt * tt / 2) / tt);
    if (zT <= 0 && z0 <= 1.5) puck.vz = 0;
    this._deflOut = { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy, vin: v, tq, zLine: puck.z + puck.vz * tt - PUCK.gravity * tt * tt / 2 };   // pro sondy/testy
    puck._passTo = null;
    puck._shot = { id: this.id, team: this.team, ot: false, pf: false, defl: true }; puck._shotAge = 0;   // gól z teče = tvůj gól
    this._shootCooldown = 0.12; this._deflectCool = 0.3;
    this._deflFx = 0.3; this._deflN = (this._deflN || 0) + 1; this._deflQ_tq = tq;
    return true;
  }
  trySkateKick(puck) {
    const dw = this.deflectWindow(puck);   // teč má přednost před přikopnutím (jen rána spoluhráče u soupeřovy branky)
    if (dw === 1) { this._deflHeld = 0; return this._doDeflect(puck); }
    if (dw === 0) { this._deflQ = DEFL_BUF; this._deflHeld = 0; return false; }
    if ((this._kickCd || 0) > 0 || this.hasPuck || this.isDown) return false;
    this._kickSwing(puck);   // kresba: brusle máchne (při zabrání ji hned převezme animace přikopnutí)
    const w = this.kickWindow(puck);
    if (w === 1) return this._doKick(puck);
    if (w === 0 && this.kickEta(puck) <= KICK_BUF) { this._kickQ = KICK_BUF; return false; }   // o chvilku dřív: stisk podržíme, než puk dojede
    this._kickCd = KICK_CD; return false;
  }
  // máchnutí naprázdno: noha na straně puku (bez puku na straně dolní ruky); jen časová osa pro kresbu
  _kickSwing(puck) {
    const dx = puck ? puck.x - this.x : 0, dy = puck ? puck.y - this.y : 0, ba = this.bodyAngle ?? 0;
    const ly = -Math.sin(ba) * dx + Math.cos(ba) * dy;
    this._kickSide = Math.abs(ly) > 0.5 ? (ly > 0 ? 1 : -1) : (this.handed ?? 1);
    this._kickSw = KICK_SW; this._kickSwN = (this._kickSwN || 0) + 1;
  }
  _doKick(puck) {
    this._kickQ = 0;
    const dx = puck.x - this.x, dy = puck.y - this.y, ba = this.bodyAngle ?? 0, ly = -Math.sin(ba) * dx + Math.cos(ba) * dy;
    this._kickOx = dx; this._kickOy = dy; this._kickSide = ly >= 0 ? 1 : -1;   // kde puk zastavila brusle (vůči tělu, svět.) + která noha
    puck._passTo = null; this._grabPuck(); puck._carrier = this;
    this._kickFx = KICK_FX; this._kickSw = 0; this._kickN = (this._kickN || 0) + 1;
    return true;
  }

  _grabPuck() {
    if (!this.hasPuck) this._possT = 0;   // čerstvé převzetí → běží ochrana (PLAYER.stealGrace)
    this.hasPuck    = true;
    this.forehand   = true;
    this.carryAngle = this.aimAngle; // puk navázán na aktuální směr hole
  }

  tryPickup(puck) {
    if (!this.canPickup(puck)) return false;
    puck._passTo = null;
    this._grabPuck();
    return true;
  }

  // Obrání: soupeřova hůl na puku (puk je u nositelovy hole) → vezme puk.
  canSteal(puck, carrier) {
    if (this._shootCooldown > 0 || puck.isAirborne || this.isDown) return false;
    // KRYTÍ TĚLEM (2026-11-09): puk za nosičovým tělem (z mé strany) nejde obrat — stejný test jako Goalie.pokeCheck.
    if (carrier && PLAYER.shield > -1) {
      const px = puck.x - carrier.x, py = puck.y - carrier.y, ox = this.x - carrier.x, oy = this.y - carrier.y;
      const exposed = (px * ox + py * oy) / ((Math.hypot(px, py) || 1) * (Math.hypot(ox, oy) || 1));
      const contact = PLAYER.shContact > 0 && Math.hypot(ox, oy) < PLAYER.bodyRadius * 2 + 6;
      if (exposed < PLAYER.shield - (contact ? PLAYER.shContact : 0)) {   // kryto → zablokovaný pokus (jen v dosahu čepele) rozsvítí štít nosiče
        const tip = this.stickTip;
        if (Math.hypot(puck.x - tip.x, puck.y - tip.y) <= PLAYER.stealR) { carrier._shieldT = 0.35; carrier._shieldA = Math.atan2(oy, ox); }
        return false;
      }
    }
    const tip = this.stickTip;
    const bladeDir = (this.carryAngle ?? this.aimAngle) + (this.handed ?? 1) * Math.PI / 6.5;
    const bx = tip.x + Math.cos(bladeDir) * 6, by = tip.y + Math.sin(bladeDir) * 6;
    const d = Math.min(Math.hypot(puck.x - tip.x, puck.y - tip.y), Math.hypot(puck.x - bx, puck.y - by));
    return d <= PLAYER.stealR;
  }

  stealFrom(carrier, puck) {
    carrier.hasPuck = false;
    carrier.charge = 0; carrier._chargeDecaying = false; carrier.overcharged = false; carrier._oneTimer = false;
    carrier._shootCooldown = 0.55;
    // Puk se uvolní v náhodném směru (50-50 battle) — žádný instant transfer (čisté převzetí chaos zvyšovalo, změřeno)
    const tip = carrier.stickTip;
    const kickDir = carrier.carryAngle + (this.rng.next() - 0.5) * 1.1;
    puck.x  = tip.x;
    puck.y  = tip.y;
    puck.vx = Math.cos(kickDir) * 70;
    puck.vy = Math.sin(kickDir) * 70;
    puck.vz = 0;
    this._shootCooldown = 0.14;
    puck.trailColor = null;
  }

  // Propásnuté okno přesné rány: puk sklouzne z čepele dopředu (volný puk), krátce ho nejde znovu vzít.
  loseBlade(puck) {
    this.hasPuck = false;
    this.charge = 0; this._shootCooldown = 0.4;
    const tip = this.stickTip, a = this.carryAngle ?? this.aimAngle;
    puck.x = tip.x; puck.y = tip.y; puck.z = 0; puck.vz = 0;
    puck.vx = this.vx + Math.cos(a) * 60; puck.vy = this.vy + Math.sin(a) * 60;
  }

  shoot(puck, charge, perfect = false) {
    this.hasPuck = false;
    puck._shot = { id: this.id, team: this.team, ot: !!this._oneTimer, pf: !!perfect }; puck._shotAge = 0;   // pro hlášky (match-core: ONE-TIMER / PŘESNĚ / kombo gól)
    this._shootCooldown = 0.18;
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;

    // ŽABIČKA (lehký tap) → PRDEL (plné nabití): rychlost i zdvih plynule rostou s nabitím.
    // Žabička = malá umístěná rána po ledě; slap = tvrdá rána, zvedne se a je lehce nepřesná.
    const c = clamp(charge, 0, 1);
    const spd    = PUCK.minShotSpeed + (PUCK.maxShotSpeed - PUCK.minShotSpeed) * Math.pow(c, 0.85);
    const r = this.rng.next();                           // vždy odeber 1 číslo (determinismus nezávislý na perfect)
    const spread = perfect ? 0 : (r - 0.5) * c * 0.10;   // tvrdá rána je nepřesnější; v okně přesné rány bez rozptylu
    const dir    = this.carryAngle + spread;
    puck.vx = Math.cos(dir) * spd;
    puck.vy = Math.sin(dir) * spd;
    puck.vz = Math.pow(c, 1.4) * PUCK.maxShotVz;        // zdvih nabíhá dřív: snap přes betony, plný slap do horního rohu
    // ČLOVĚK MÍŘÍ I VÝŠKU (audit K2, 2026-11-09): vrchol rány podle nabití, ale zdvih se dopočítá tak, aby puk v místě
    // kurzoru (aimDist) byl ve výšce vrcholu → horní roh jde trefit z 100–250 px, ne jen ze ~150. Bot beze změny (balanc).
    if (!this.isBot && (this.aimDist ?? 0) > 60) {
      const zT = Math.min(PUCK.crossbarHeight - 2, Math.pow(c, 1.4) * PUCK.maxShotVz ** 2 / (2 * PUCK.gravity));
      const t = Math.min(this.aimDist, 320) / spd;
      puck.vz = Math.min(PUCK.maxShotVz * 1.2, (zT + PUCK.gravity * t * t / 2) / t);
    }
    puck.trailColor = this.trail || null;               // stopa v barvě střelce
  }

  // Hůl relativně k TĚLU: úhel hole = bodyAngle + clamp(rel) v dosažitelném kuželu.
  // → rotuje s tělem, nejde za záda (ne 360°). Forehand/backhand dle strany těla a
  // handedness (pravák/levák), ne dle pohybu. Carry dojíždí omezenou rychlostí (klička).
  _updateStick(dt) {
    const cone = Math.PI * 0.55;
    const cursorRel = angleDiff(this.aimAngle, this.bodyAngle);
    const clampedRel = clamp(cursorRel, -cone, cone);
    const targetAbs = this.bodyAngle + clampedRel;

    // aimDist blízko = rychlejší rotace hole (kratší páka → hbitější klička)
    const ad = this.aimDist ?? 60;
    const manoeuvrability = clamp(ad / 60, 0, 1);  // 0=kurzor na hráči, 1=kurzor daleko
    const spd  = Math.hypot(this.vx, this.vy);
    const baseRate = 14 - Math.min(1, spd / 180) * 7;
    const rate = baseRate * (1.4 - 0.4 * manoeuvrability) * dt * ((this.charge ?? 0) > 0.05 ? PLAYER.chargeTurnK : 1);  // blízko = rychlejší rotace hole; nápřah = pomaleji
    const prevCarry = this.carryAngle;
    this.carryAngle += clamp(angleDiff(targetAbs, this.carryAngle), -rate, rate);
    const rel = angleDiff(this.carryAngle, this.bodyAngle);
    if (Math.abs(rel) > cone) this.carryAngle = this.bodyAngle + (rel > 0 ? cone : -cone);

    // Anti-helikoptéra: rychlé šermování holí = puk sklouzne.
    // Při nabíjení threshold výrazně vyšší — otáčení těla s charge je záměrná mechanika.
    if (this.hasPuck && PLAYER.softCarry) {
      const relNow = angleDiff(this.carryAngle, this.bodyAngle);
      const dA = PLAYER.softRel ? (this._relPrev != null ? angleDiff(relNow, this._relPrev) : 0) : angleDiff(this.carryAngle, prevCarry), reach = this._dispReach ?? PLAYER.stickLen;
      this._relPrev = relNow;
      const tv = Math.abs(dA) / Math.max(dt, 0.001) * reach;                        // obvodová rychlost čepele px/s
      const grip = PLAYER.gripV * ((this.charge ?? 0) > 0.05 ? 2.5 : 1);
      let ex = Math.max(0, tv - grip) * dt;
      if (ex > 0) { this._lag = (this._lag || 0) + ex; if (dA) this._lagDir = Math.sign(dA); }
      else this._lag = Math.max(0, (this._lag || 0) - PLAYER.lagRecover * dt);
      if (this._lag > PLAYER.loseLag) { this.hasPuck = false; this._shootCooldown = 0.25; this._lag = 0; this._slipT = 0.4; }
    } else if (!this.hasPuck) { this._lag = 0; this._relPrev = null; }
    if (this.hasPuck && !PLAYER.softCarry) {
      const stickDelta = Math.abs(angleDiff(this.carryAngle, prevCarry)) / Math.max(dt, 0.001);
      const spinThreshold = (this.charge ?? 0) > 0.05 ? 22 : 7.5;
      if (stickDelta > spinThreshold) {
        const slipChance = clamp((stickDelta - spinThreshold) / 6, 0, 1);
        if (this.rng.next() < slipChance * dt * 4) {
          this.hasPuck = false;
          this._shootCooldown = 0.25;
        }
      }
    }

    this._stickRel = angleDiff(this.carryAngle, this.bodyAngle);
    this.forehand  = (this._stickRel * this.handed) >= 0;
  }

  // Tečování (deflection) — letící puk u čepele se odrazí pod jiným úhlem (gól z dorážky)
  tryDeflect(puck) {
    if (this.hasPuck || puck.isAirborne || this.isDown) return false;
    if (this._deflQ > 0) return false;   // Q na teč nachystané → řídí to _doDeflect, ne náhodný odraz
    if (this.charge > 0) return false; // nabíjí one-timer → puk chytí, netečuje
    if (this._shootCooldown > 0 || this._deflectCool > 0) return false;
    const inSpeed = Math.hypot(puck.vx, puck.vy);
    if (inSpeed < 150) return false;                 // jen letící střela/pas
    if (PLAYER.receiveFirst && this.canPickup(puck)) return false;   // zpracovatelný puk (pas) převezmi, netečuj
    const tip = this.stickTip;
    if (Math.hypot(puck.x - tip.x, puck.y - tip.y) > PLAYER.pickupTipRadius + 2) return false;
    // Výchylka kolem aktuálního směru — částečně k hokejce/tělu (tečované góly)
    const dir    = Math.atan2(puck.vy, puck.vx);
    const jitter = (this.rng.next() - 0.5) * 0.9;      // ±~26°
    const nd     = dir + jitter;
    puck.vx = Math.cos(nd) * inSpeed * 0.92;
    puck.vy = Math.sin(nd) * inSpeed * 0.92;
    puck.z = 0; puck.vz = 0;
    this._deflectCool = 0.3;
    return true;
  }

  // Ležící / zvedající se hráč nehraje puk (pickup, obrání, tečování, crosscheck, nápřah, přikopnutí).
  get isDown() { return this._downT > 0 || this._upT > 0; }

  // ODSTUPŇOVANÝ KNOCKBACK (2026-11-12): I = síla zásahu (px/s po normále), (nx, ny) = směr od útočníka k oběti.
  // Vrací stupeň 0 = postrčení (fyzika jako dřív), 1 = zakolísání, 2 = rozplácnutí. Deterministické (bez kostky).
  takeHit(I, nx, ny) {
    if (this.isDown || !this.isPlayer || this.isGoalie) return 0;
    if (I >= PLAYER.kbHeavy && !(this._hitImm > 0)) {
      if (this.hasPuck) {   // puk vypadne z hole a jede dál s hráčem (volný puk)
        this.hasPuck = false; const pk = this._puckRef;
        if (pk) { const t = this.stickTip; pk.x = t.x; pk.y = t.y; pk.z = 0; pk.vz = 0; pk.vx = this.vx * 0.6 + nx * 50; pk.vy = this.vy * 0.6 + ny * 50; pk.trailColor = null; }
      }
      this.charge = 0; this._chargeDecaying = false; this.overcharged = false; this._oneTimer = false; this.crossCheck = false;
      this._downT = PLAYER.downT; this._upT = PLAYER.upT; this._stagT = 0; this._knockT = 0;
      this._shootCooldown = Math.max(this._shootCooldown || 0, PLAYER.downT + PLAYER.upT);
      this._hitImm = PLAYER.downT + PLAYER.upT + PLAYER.hitImmune;   // po zvednutí chvíli nejde znovu srazit (žádné řetězení)
      this._fallA = Math.atan2(ny, nx); this._fallN = (this._fallN || 0) + 1;
      this._fallB = this.bodyAngle;   // natočení v okamžiku zásahu: sražen zezadu/zboku vpřed = na břicho, zepředu = na záda (downBody.js)
      this.vx += nx * PLAYER.heavyPush; this.vy += ny * PLAYER.heavyPush;
      return 2;
    }
    if (I >= PLAYER.kbMid) {
      const c = Math.cos(this.bodyAngle) * ny - Math.sin(this.bodyAngle) * nx;   // náraz zleva/zprava → točí se po směru úderu
      this._stagDir = c >= 0 ? 1 : -1; this._stagT = PLAYER.stagT; this._knockT = Math.max(this._knockT, 0.25);
      return 1;
    }
    return 0;
  }

  // Souboj těl — dva hráči se přetlačí (clona, box-out, scramble před brankou)
  collideWith(other) {
    const minDist = 2 * PLAYER.bodyRadius;
    const dx = other.x - this.x, dy = other.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist || dist === 0) return;
    const nx = dx / dist, ny = dy / dist, pen = minDist - dist;
    this.x  -= nx * pen * 0.5; this.y  -= ny * pen * 0.5;
    other.x += nx * pen * 0.5; other.y += ny * pen * 0.5;
    // utlum přibližování
    const rel = (other.vx - this.vx) * nx + (other.vy - this.vy) * ny;
    const closing = Math.max(0, -rel);   // rychlost srážky (px/s) — měřítko odrazu
    // Kdo koho sejmul: útočník = ten, kdo do druhého víc jede (složka rychlosti po normále); jen soupeři
    const aThis = this.vx * nx + this.vy * ny, aOther = -(other.vx * nx + other.vy * ny);
    if (rel < 0) {
      const imp = rel * 0.5;
      this.vx  += nx * imp; this.vy  += ny * imp;
      other.vx -= nx * imp; other.vy -= ny * imp;
    }
    // Knockback úměrný síle srážky (dřív pevných 85 px/s i při lehkém doteku): lehký dotyk ≈ nic, plný náraz ≤ KB_MAX
    const KB = Math.min(PLAYER.kbMax, closing * PLAYER.kbFactor);
    this.vx  -= nx * KB; this.vy  -= ny * KB;
    other.vx += nx * KB; other.vy += ny * KB;
    this._knockT = other._knockT = 0.2; // dočasně zpomalí útlum, aby náraz dojel
    if (this.team !== other.team && closing >= PLAYER.kbMid) {
      const lv = aThis >= aOther ? other : this, s = lv === other ? 1 : -1;
      lv._lastHit = lv.takeHit(closing, nx * s, ny * s);
    }
  }

  // aimOverride: volitelný směr nahrávky (predikce do jízdy); jinak míří kam ukazuje hůl
  pass(puck, aimOverride, speedOverride) {
    this.hasPuck = false;
    this._passCooldown  = 0.15;
    this._shootCooldown = 0.18; // ať si hráč hned NEteční/nesebere vlastní přihrávku
    const tip = this.stickTip;
    puck.x = tip.x;
    puck.y = tip.y;
    puck.z = 0;
    // Normální přihrávka po ledě; rychlost přeměřená dle vzdálenosti (speedOverride)
    const ang = (aimOverride !== undefined && aimOverride !== null) ? aimOverride : this.carryAngle;
    const spd = (speedOverride !== undefined && speedOverride !== null) ? speedOverride : PUCK.passSpeed;
    puck.vx = Math.cos(ang) * spd;
    puck.vy = Math.sin(ang) * spd;
    puck.vz = 0;
    puck.trailColor = this.trail || null;   // stopa v barvě nahrávajícího
  }

  // Called each frame — check if this player's cross-check hits another
  tryCrossCheck(other) {
    if (!this.crossCheck || this._crossCheckCool > 0 || this.isDown) return;
    const dx   = other.x - this.x;
    const dy   = other.y - this.y;
    const dist = Math.hypot(dx, dy);
    const reach = this.radius + other.radius + 18;
    if (dist > reach || dist === 0) return;
    // Must be roughly in front (within ~70° of bodyAngle)
    if (Math.abs(angleDiff(Math.atan2(dy, dx), this.bodyAngle)) > Math.PI * 0.4) return;

    this._crossCheckCool = 0.55;

    // Strip puck — a nositel ho NESMÍ hned sebrat zpět (dřív bez pauzy → bot měl puk dál i po crosschecku)
    if (other.hasPuck) {
      other.hasPuck    = false;
      other.charge     = 0;
      other.overcharged = false;
      other._chargeDecaying = false; other._oneTimer = false;
      other._shootCooldown = 0.6;
      if (this._puckRef) {             // puk odletí ve směru úderu (nositel ho ztratí z hole)
        const pk = this._puckRef, ang = Math.atan2(dy, dx);
        pk.vx = Math.cos(ang) * 110 + (other.vx || 0) * 0.3; pk.vy = Math.sin(ang) * 110 + (other.vy || 0) * 0.3; pk.vz = 0;
      }
    }

    // Náraz — strčí soupeře (ne vystřelí): 120 < top speed 180, aby to nebylo „funny"; checker se lehce zbrzdí
    const nx = dx / dist;
    const ny = dy / dist;
    const ccI = Math.max(0, -((other.vx - this.vx) * nx + (other.vy - this.vy) * ny)) + PLAYER.ccBonus;   // síla: rozjetý crosscheck > stojící
    other.vx += nx * PLAYER.ccPush;
    other.vy += ny * PLAYER.ccPush;
    this.vx  -= nx * PLAYER.ccPush * 0.45;
    this.vy  -= ny * PLAYER.ccPush * 0.45;
    other._knockT = 0.18; this._knockT = 0.1;
    if (this.team !== other.team) other._lastHit = other.takeHit(ccI, nx, ny);
  }

  _move(input, dt) {
    // Knockback časovače (pevný krok simulace → deterministické). Ležící hráč ignoruje vlastní vstup.
    if (this._hitImm > 0) this._hitImm = Math.max(0, this._hitImm - dt);
    if (this._stagT > 0) this._stagT = Math.max(0, this._stagT - dt);
    if (this._downT > 0) this._downT = Math.max(0, this._downT - dt);
    else if (this._upT > 0) this._upT = Math.max(0, this._upT - dt);
    const down = this._downT > 0, rising = !down && this._upT > 0;
    if (down) input = _NO_INPUT;
    const braking       = !!(input.keys && input.keys['Space']); // tvrdá brzda (drž) — puk si necháš
    const charging      = !!(input.lmb && (this.hasPuck || this.charge > 0.01)); // i one-timer nápřah zpomaluje
    const crossChecking = this.crossCheck && !down;

    // TWIN-STICK: WASD bruslí ve SMĚRECH (world-space), myš míří hokejkou NEZÁVISLE
    // (turret) → skateuješ jedním směrem, střílíš/kličkuješ jiným. Pohyb má moment
    // (zrychlení + glide), tělo kouká kam bruslíš.
    let ix = input.dx, iy = input.dy;          // A/D = ±x, W/S = ±y
    const il = Math.hypot(ix, iy);
    if (il > 1) { ix /= il; iy /= il; }         // diagonála není rychlejší
    const hasInput = il > 0.01;

    let topSpeed = PLAYER.speed * (crossChecking ? PLAYER.ccSpeed : 1);   // crosscheck = hůl napřed, pomaleji než bruslení
    if (this.hasPuck) topSpeed *= 0.92;
    if (this.hasPuck && PLAYER.tuckF < 1) topSpeed *= PLAYER.tuckF + (1 - PLAYER.tuckF) * clamp(((this.aimDist ?? 60) - 10) / 20, 0, 1);   // stažený puk = krytý, ale pomalý
    if (charging) topSpeed *= clamp(1 - (this.charge || 0) * 0.85, 0.12, 1);
    // Kurzor blízko = hůl stažená = pohyb výrazně pomalejší (kratší krok)
    const _ad = this.aimDist ?? 60;
    topSpeed *= 0.45 + 0.55 * clamp(_ad / 65, 0, 1);  // blízko: ~45-55%, daleko: 100%
    // CRUISE (volitelný strop rychlosti): boti zpomalí při pozicování/krytí/rozehře (míň frantičnosti,
    // prostor na kličku); hráč může držet modifikátor pro kontrolovanou jízdu. null/1 = bez stropu.
    if (input.cruise != null && input.cruise < 1) topSpeed *= clamp(input.cruise, 0.3, 1);
    if (rising) topSpeed *= 0.4;                                  // zvedá se z ledu: první krok pomalý
    if (this._stagT > 0) topSpeed *= PLAYER.stagSlow;              // zakolísání: krátce pomalejší

    // Zpátečka (backskating): jízda dozadu je ~25% pomalejší
    // Détekce: pohyb opačný k facing direction (bodyAngle)
    if (hasInput && !crossChecking) {
      const movingDir = Math.atan2(iy, ix);
      const backAngle = Math.abs(angleDiff(movingDir, this.bodyAngle));
      if (backAngle > Math.PI * 0.6) topSpeed *= 0.75;   // více než 108° od facing = zpátečka
    }

    if (this._knockT > 0) this._knockT = Math.max(0, this._knockT - dt);
    const knocked = this._knockT > 0;            // po nárazu hráč skoro neřídí (náraz dojede)

    // CARVE + CUT MODEL: rychlost má moment (plynulý rozjezd/glide). Řízení je SVIŽNÉ
    // (jde uříznout směr), ale PRUDKÁ změna směru seškrtá rychlost (hrany do ledu):
    //  • mírný oblouk → drží rychlost (carve),
    //  • ostrý cut → změníš směr, ale ztratíš tempo (hokejové),
    //  • držet těsnou rotaci při rychlosti = rychlost odteče → žádný „kolotoč".
    let sp = Math.hypot(this.vx, this.vy);
    let heading = sp > 1 ? Math.atan2(this.vy, this.vx) : this.skateAngle;

    if (braking) {
      // tvrdá brzda podél směru jízdy (bez carve), puk zůstává
      sp = Math.max(0, sp - 620 * dt);
      this.vx = Math.cos(heading) * sp;
      this.vy = Math.sin(heading) * sp;
    } else if (hasInput && !knocked) {
      const targetDir = Math.atan2(iy, ix);
      const dA = angleDiff(targetDir, heading);          // kolik chceš zatočit (-π..π)
      const ratio = clamp(sp / PLAYER.speed, 0, 1);
      let turnRate = 6.5 - 3.5 * ratio;                  // ~6.5 rad/s pomalu → ~3.0 naplno (carve, ne pivot)
      if (crossChecking) turnRate *= 0.55;               // crosscheck = těžší zatočit, ale ne ochrnutý
      heading += clamp(dA, -turnRate * dt, turnRate * dt);
      // akcelerace k topSpeed
      const aUp = PLAYER.accel * (crossChecking ? 0.82 : 1) * (charging ? 0.5 : 1);
      sp += clamp(topSpeed - sp, -PLAYER.decel * 2 * dt, aUp * dt);
      // hrany do ledu: čím prudší změna směru, tím větší ztráta rychlosti
      sp *= 1 - Math.pow(clamp(Math.abs(dA) / Math.PI, 0, 1), 1.6) * (crossChecking ? 2.4 : 3.0) * dt;
      this.vx = Math.cos(heading) * sp;
      this.vy = Math.sin(heading) * sp;
    } else if (sp > 0) {
      // glide — led NESE: po puštění dlouhý skluz (cítit led); při nízké rychlosti doklouže a zastaví
      const dec = (down ? 1.4 : knocked ? 0.3 : (sp < 50 ? 1.6 : 0.55)) * PLAYER.decel * dt;   // ležící klouže po břiše a zastaví se
      sp = Math.max(0, sp - dec);
      this.vx = Math.cos(heading) * sp;
      this.vy = Math.sin(heading) * sp;
    }

    // Zakolísání: nad stagSlow × top speed hráč rychle ztrácí rychlost (otřes, ztráta hran) — i během knockT
    if (this._stagT > 0) { const v = Math.hypot(this.vx, this.vy), lim = PLAYER.speed * PLAYER.stagSlow;
      if (v > lim) { const nv = Math.max(lim, v - 220 * dt); this.vx *= nv / v; this.vy *= nv / v; } }

    // Tělo kouká TAM, KAM MÍŘÍŠ (kurzor) — plynule. Hůl tak vychází přirozeně zepředu a tělo
    // i hokejka jsou vždy zarovnané (žádné poskakování po 8 směrech kláves, žádné uvíznutí v boku).
    // Bruslení (WASD) je nezávislé (strafe s momentem) → twin-stick.
    // CROSSCHECK: tělo kouká směrem pohybu (WASD), angle je LOCKED když stojíš — ne kurzorem
    const sp2 = Math.hypot(this.vx, this.vy);
    // crosscheck: tělo jde za pohybem (WASD), ne za myší. Při stání = tělo se nezamrzne.
    const targetBodyAngle = down ? this.skateAngle : crossChecking
      ? (hasInput ? Math.atan2(iy, ix) : this.bodyAngle)
      : this.aimAngle;
    // NÁPŘAH (2026-11-13, Ondřej: „při chargování se jde až moc otáčet, mělo by jít méně"): tělo i hůl × chargeTurnK
    const bodyLerpRate = (this._stagT > 0 ? 2.5 : rising ? 6 : crossChecking ? 9 : 14) * (charging ? PLAYER.chargeTurnK : 1);   // otřesený hráč se srovnává pomalu
    const _prevSkateAngle = this.skateAngle;
    this.skateAngle = lerpAngle(this.skateAngle, targetBodyAngle, Math.min(1, bodyLerpRate * dt));
    // ŽÁDNÁ HELIKOPTÉRA (2026-11-13, Ondřej: „točit se dokola myší = nepřirozená rotace"): souvislé otáčení JEDNÍM směrem
    // se sčítá (_spin); prvních SPIN_FREE rad je volných (švih / obrat zůstane rychlý), pak strop SPIN_SLOW rad/s.
    // Změna směru otáčení počítadlo vynuluje, v klidu odtéká SPIN_REC rad/s. test/heli.test.mjs
    if (!down) {
      let dTh = angleDiff(this.skateAngle, _prevSkateAngle), sp0 = this._spin || 0;
      const dTg = this._prevTgt != null ? angleDiff(targetBodyAngle, this._prevTgt) : 0;   // kam se točí CÍL (myš), ne tělo
      const spF = PLAYER.spinFree * (charging ? PLAYER.chargeTurnK : 1), spS = PLAYER.spinSlow * (charging ? 0.6 : 1);
      if (Math.abs(sp0) >= spF) {
        // omezený: myš krouží dál stejným směrem → tělo pokračuje stropem tím směrem (i když je cíl „předběhnutý");
        // myš se otočila opačně → omezení pryč; myš stojí → tělo dojede k cíli stropovou rychlostí
        const lim = spS * dt;
        if (dTg * sp0 > 0) { dTh = Math.sign(sp0) * lim; this.skateAngle = _prevSkateAngle + dTh; }
        else if (dTg * sp0 < 0 && Math.abs(dTg) > 0.01) sp0 = 0;   // práh: chvění myši není změna směru
        else if (Math.abs(dTh) > lim) { dTh = Math.sign(dTh) * lim; this.skateAngle = _prevSkateAngle + dTh; }
      } else if (dTh * sp0 < 0) sp0 = 0;
      this._prevTgt = targetBodyAngle;
      sp0 += dTh;
      const rec = PLAYER.spinRec * dt; sp0 = Math.abs(sp0) <= rec ? 0 : sp0 - Math.sign(sp0) * rec;
      this._spin = clamp(sp0, -spF - 1.5, spF + 1.5);
    } else this._spin = 0;
    // Zakolísání: tělo se po zásahu stočí po směru úderu (oblouk stagSpin rad, plynule zpět)
    if (this._stagT > 0) this.skateAngle += this._stagDir * 2 * PLAYER.stagSpin / PLAYER.stagT * (this._stagT / PLAYER.stagT) * dt;   // lineárně doznívá, celkem stagSpin rad
    this.bodyAngle  = this.skateAngle;


    // Náklon do oblouku (vizuál). FYZIKA (2026-11-14, Ondřej: „pořád blbnou zatáčky"): dřív z úhlu kláves vůči bruslím → WASD má jen
    // 8 směrů, náklon v plynulém kruhu kmital −0,17 ↔ −0,67 při každé změně kláves. Nově z dostředivého zrychlení skutečné dráhy
    // (tg φ = v·ω / g): ω = změna směru rychlosti za čas, LEAN_G px/s² = plný náklon. scripts/turn_metrics.mjs
    this._lean = leanStep(this, this.vx, this.vy, dt);

    // Pohyb + WALL-SLIDE: u mantinelu zruš složku rychlosti DO zdi → sklouzneš podél,
    // nezasekneš se a netočíš se o band (heading se příští frame srovná podél zdi).
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Pivot drift: otáčení na místě dá přímý posun (obchází decel, jinak okamžitě utlumen)
    const _rotDelta = angleDiff(this.skateAngle, _prevSkateAngle);
    const _absRotV  = Math.abs(_rotDelta) / dt;
    if (sp2 < 45 && _absRotV > 2.5) {
      const _pivotDir  = this.bodyAngle - Math.sign(_rotDelta) * Math.PI / 2;
      const _driftSpd  = Math.min((_absRotV - 2.5) * 2.2, 26);  // max ~26 px/s
      this.x += Math.cos(_pivotDir) * _driftSpd * dt;
      this.y += Math.sin(_pivotDir) * _driftSpd * dt;
    }

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
    if (this.hasPuck) this._possT = (this._possT ?? 0) + dt;
    if (this._shieldT > 0) this._shieldT -= dt;
    if (this._shootCooldown > 0) this._shootCooldown -= dt;
    if (this._kickCd > 0) this._kickCd -= dt;
    if (this._kickQ > 0) { this._kickQ -= dt; const pk = world?.puck; if (pk && this.kickWindow(pk) === 1) this._doKick(pk); else if (this._kickQ <= 0) this._kickCd = KICK_CD; }
    if (this._kickFx > 0) this._kickFx -= dt;
    if (this._kickSw > 0) this._kickSw -= dt;
    if (this._deflQ > 0) { const pk = world?.puck; this._deflHeld = (this._deflHeld || 0) + dt; const w = pk ? this.deflectWindow(pk) : -1;
      if (w === 1) this._doDeflect(pk); else if ((this._deflQ -= dt) <= 0 || w < 0) { this._deflQ = 0; this._kickCd = KICK_CD; } }
    if (this._deflFx > 0) this._deflFx -= dt;
    if (this._passCooldown  > 0) this._passCooldown  -= dt;
    if (this._deflectCool   > 0) this._deflectCool   -= dt;
    // Hůl relativně k tělu (kužel) + forehand dle handedness
    this._updateStick(dt);
    if (this.passReq > 0) this.passReq = Math.max(0, this.passReq - dt);
    // RMB stisknuté ještě s pukem (pas / nadzvednutý pas) a puk ztracen → žádný crosscheck, dokud RMB nepustí (2026-11-13).
    if (!this.input.rmb) this._rmbFromCarry = false; else if (this.hasPuck) this._rmbFromCarry = true;
    this.crossCheck = !!this.input.rmb && !this.hasPuck && !this._rmbFromCarry && this._passCooldown <= 0 && !this.isDown;
    if (this._crossCheckCool > 0) this._crossCheckCool -= dt;

    this._move(this.input, dt);
    this._updateStickDisplay(dt);
  }
}

// ČITELNOST PUKU (jen ovládaný hráč): „magnet" = skutečná zóna převzetí u čepele (PLAYER.pickupTipRadius,
// stejný střed jako canPickup). Volný puk blízko → kroužek se rozsvítí; v dosahu → zelený (teď ho vezmeš).
// Převzetí → zelený puls na puku; ztráta (puk odešel pomalu = obrán / sklouzl, ne střela/pas) → červený záblesk.
const AID_SHOW = 60, AID_PULSE = 0.35;   // px od čepele, kdy se zóna ukáže; s délky pulzu
function _drawPickupAid(ctx, p, cam) {
  const puck = p._puckView || p._puckRef; if (!puck) return;
  const s = cam.scale, now = _rt(cam);
  const tip = p.stickTip;
  const bladeDir = (p.carryAngle ?? p.aimAngle) + (p.handed ?? 1) * Math.PI / 6.5;
  const cx = tip.x + Math.cos(bladeDir) * 3, cy = tip.y + Math.sin(bladeDir) * 3;   // střed lopatky (mezi tipem a koncem čepele)
  if (p._aidHad !== undefined && p._aidHad !== p.hasPuck) {   // hrana převzetí / ztráty
    const pv = Math.hypot(puck.vx || 0, puck.vy || 0);
    if (p.hasPuck) p._aidEv = { t: now, ok: true };
    else if (pv < 200) p._aidEv = { t: now, ok: false };
  }
  p._aidHad = p.hasPuck;
  ctx.save();
  const ev = p._aidEv;
  if (ev && now - ev.t < AID_PULSE) {
    const k = (now - ev.t) / AID_PULSE;
    ctx.beginPath(); ctx.arc(cam.ox + puck.x * s, cam.oy + puck.y * s, (6 + 16 * k) * s, 0, Math.PI * 2);
    ctx.strokeStyle = ev.ok ? `rgba(24,184,90,${0.9 * (1 - k)})` : `rgba(255,70,70,${0.95 * (1 - k)})`;
    ctx.lineWidth = 3 * s; ctx.stroke();
  }
  const held = puck.ownerId != null || (p._others || []).some(o => o.hasPuck);   // klient: ownerId nemusí být ze snapshotu
  const loose = !p.hasPuck && !held && !(puck.z > 0.5);
  const d = Math.hypot(puck.x - cx, puck.y - cy);
  const lossFlash = ev && !ev.ok && now - ev.t < AID_PULSE;   // po ztrátě puk chvíli nejde vzít (cooldown) → zónu neukazuj, ať si neprotiřečí
  if (loose && !lossFlash && d < AID_SHOW) {
    const inReach = d <= PLAYER.pickupTipRadius + PUCK.radius;
    const a = inReach ? 0.95 : 0.25 + 0.55 * (1 - d / AID_SHOW);
    ctx.beginPath(); ctx.arc(cam.ox + cx * s, cam.oy + cy * s, PLAYER.pickupTipRadius * s, 0, Math.PI * 2);
    ctx.fillStyle = inReach ? 'rgba(24,184,90,0.22)' : `rgba(31,79,216,${0.10 * a})`; ctx.fill();
    ctx.setLineDash(inReach ? [] : [3 * s, 2.5 * s]);
    ctx.strokeStyle = inReach ? 'rgba(24,184,90,0.95)' : `rgba(31,79,216,${a})`;   // tmavá modrá štítku TY = kontrast na bílém ledu
    ctx.lineWidth = (inReach ? 2.2 : 1.6) * s; ctx.stroke();
  }
  ctx.restore();
}

// Hodiny vykreslování z kamery (engine: cam.dt/cam.t); bez nich (testy, náhledy) pevně 1/60 s.
const _rdt = cam => (cam && cam.dt != null ? Math.min(0.05, cam.dt) : 1 / 60);
const _rt  = cam => (cam && cam.t != null ? cam.t : 0);
// Deterministická „náhoda“ pro efekty: hash (id, n, i) → 0..1
const _hrand = (id, n, i) => { let h = 2166136261 ^ n; const str = String(id); for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619); h = Math.imul(h ^ (i * 374761393), 668265263); h ^= h >>> 13; h = Math.imul(h, 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Hokejka — varianty kresby (vis.js): out = obrys dříku, sh = dřík, bl = čepel, blo = obrys čepele (× s), knob = koncovka, hi = odlesk, sh2 = stín na ledu
const SHOT_EAT_T = 0.25, SHOT_EAT_V = 300, SHOT_NOPICK = 0.1;
// TEČ NA Q: stáří rány (s), prostor od středu soupeřovy branky (px), min. rychlost (px/s), max. výška puku (px; břevno 21),
// dosah čepele (px), předstih okna (s), podržení stisku (s), „sladké" načasování (s), zachovaná rychlost a ztráta při
// pozdním/brzkém stisku, chyba úhlu z místa zásahu a z načasování (rad)
const DEFL_AGE = 1.2, DEFL_ZONE = 110, DEFL_VMIN = 80, DEFL_Z = 14, DEFL_R = 13, DEFL_SOON = 0.15, DEFL_BUF = 0.15, DEFL_SWEET = 0.05,
  DEFL_KEEP = 0.85, DEFL_LOSS = 0.15, DEFL_ERR_S = 0.06, DEFL_ERR_T = 0.14;
function _segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, u = clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1); return Math.hypot(px - ax - dx * u, py - ay - dy * u); }
// PŘIKOPNUTÍ (Q): okno px od středu těla (tělo 7 + puk 3 + 1), nápověda s před vjezdem, zámek po minutí (s), podržení stisku (s),
// délka animace přikopnutí a máchnutí naprázdno (s; jen kresba)
const KICK_R = PLAYER.radius + PUCK.radius + 1, KICK_HINT = 0.35, KICK_CD = 0.4, KICK_BUF = 0.1, KICK_FX = 0.3, KICK_SW = 0.22;
export const KICK = { R: KICK_R, HINT: KICK_HINT, CD: KICK_CD, BUF: KICK_BUF, FX: KICK_FX, SW: KICK_SW };
let _brakeSfxAt = -1e9;   // globální omezovač zvuku brzdy cizích hráčů (jen kresba/zvuk, ne simulace)
const STICK_V = [
  { out: 4.8, sh: 2.8, bl: 2.8, blo: 4.8 },
  { out: 3.4, sh: 1.8, bl: 3.8, blo: 5.4, knob: 1 },
  { out: 3.6, sh: 2.0, bl: 4.2, blo: 5.8, knob: 1, hi: 1, sh2: 1, paddle: 1 },   // paddle = čepel jako plochá lopatka (vyplněný tvar)
  { out: 4.1, sh: 2.4, bl: 2.5, blo: 4.3 },   // S3 = dnešní, lehce štíhlejší (~15 %) — výchozí od 2026-11-12
];
// CROSSCHECK: délka prolnutí póz hůl ↔ napříč (s, jen kresba) a poloha hole napříč před tělem ve SVĚTĚ (jako blok crosschecku v kresbě):
// konec hole (butt), pata čepele (heel), směr dříku, délka a ruce jako podíl délky od konce (uT horní, uB dolní)
const CC_BLEND = 0.15;
function _ccGeom(p, base = p._stickDisp) {
  const dir = base + (p.handed ?? 1) * Math.PI / 2, c = Math.cos(dir), sn = Math.sin(dir);
  const half = PLAYER.stickLen * 0.7 * PLAYER.stickDraw, hh = PLAYER.stickLen * 0.7;
  const cx = p.x + Math.cos(base) * (PLAYER.radius + 2), cy = p.y + Math.sin(base) * (PLAYER.radius + 2);
  return { dir, len: 2 * half, butt: { x: cx - c * half, y: cy - sn * half }, uT: (half - hh * 0.62) / (2 * half), uB: (half + hh * 0.42) / (2 * half) };
}
const SKATE_CYCLE = 95;   // K0–K2: px ujeté dráhy na celý cyklus kroku (2 odrazy) — 165 px/s ≈ 1,7 cyklu/s

// ══ ANIMACE BRUSLENÍ — čisté funkce (bez canvasu, bez hodin): volá je draw() i scripts/skate_anim_metrics.mjs ══
// K3 (výchozí od 2026-11-12): fáze kroku podle UJETÉ DRÁHY; délka cyklu roste s rychlostí (pomalu kratší krůčky).
// Odrazová noha je na ledě a ostří míří VŽDY po její dráze vůči ledu → brusle se po ledě nesmýká do boku (jen klouže po ostří),
// pak se zvedne (návrat vzduchem, brusle o chlup větší), přistane pod boky a klouže, dokud se neodrazí.
// Do strany se boky (a brusle) natočí ke směru jízdy (max SKATE_K3.hip rad), ramena s holí zůstanou na míření; couvání = C-cuty.
export const SKATE_K3 = { cyc0: 60, cycV: 0.26, push: 0.36, land: 0.80, hip: 1.25, accHz: 1.5, accLo: 40, accHi: 260,
  latW: 0.4, latW0: 0.65, ccW: 1.45, reachK: 1.2, reachM: 1.5, ampK: 1, y0: 1.05,          // šíře odrazu / C-cutu (×R), měkký dosah nohy od kyčle (×R)
  silF: 1.25, silS: 1.5, silB: 1.1,                       // obrys trupu+paží vpřed/do boku/vzad (×R)
  stopX: -0.45, stopW: 1.45, stopLead: 0.55, stopToe: 0.26, stopBack: 0.25, stopAe: 0.55 };   // stop: střed bruslí vpřed, rozkročení do boku, posun po jízdě (×R), špička ven k předku (rad), záklon (×R), ostří napříč do stopT
// PŘECHODY (2026-11-14, Ondřej z klipů F9: „nohy nebo tělo v nepřirozené pozici"): latA = zkrácení kroku při jízdě bokem vůči pohledu
// (dřív plná délka jako vpřed → zadní noha 2,2 R přímo za trupem = „ocas"); bwR = max. rychlost přechodu vpřed ↔ couvání (1/s).
// scripts/pose_transition_metrics.mjs
SKATE_K3.latA = 0.4; SKATE_K3.bwR = 3.5; SKATE_K3.bwA = 1.6; SKATE_K3.bwB = 2.5; SKATE_K3.psiM = 0.35;
// bwA–bwB = směr jízdy vůči tělu (rad), kde se krok vpřed mění v couvání (C-cuty); psiM = max. natočení kroku vůči bokům (rad; dřív bez limitu → za hranicí boků krok mířil dozadu)
// BOČNÍ KROK (shuffle, 2026-11-14, Ondřej: „jízda bokem furt jedna noha je hrozně vykloubená"): čelem vpřed + jízda do boku = obě brusle
// pod tělem na své straně (shX, shY0), ostří dopředu (špička lehce ven shA), odraz do strany o shY, návrat nad ledem (shL); váha podle
// směru jízdy vůči tělu lbA–lbB (rad). scripts/side_skate_metrics.mjs
SKATE_K3.cx = 0.3; SKATE_K3.cxW = 0.15;   // cxW = VIS.w (/dev): dráha kroku o 0,15 R vzad → odraz vidět za zády (duck_metrics Z1 −0,72 → −0,87 R)   // posun celé soustavy nohou vůči tělu (×R), 2026-11-15 „nohy pozadu" — scripts/feet_behind_metrics.mjs
SKATE_K3.lbA = 1.3; SKATE_K3.lbB = 1.55; SKATE_K3.shX = -0.2; SKATE_K3.shY0 = 1.3; SKATE_K3.shY = 0.6; SKATE_K3.shA = 0.15; SKATE_K3.shL = 0.3; SKATE_K3.shM = 0;
// HOKEJOVÝ STOP (2026-11-14): stopV 2 = předloha (Hockey Canada, MAHG, Riedell): boky otočené o 90°, obě ostří ROVNOBĚŽNĚ kolmo k jízdě,
// brusle za sebou PODÉL jízdy na šíři ramen (hsD ×R), střed o hsLead ×R před tělem (váha vzad), o hsN ×R ke špičkám. stopV 1 = dřívější
// (brusle vedle sebe po stranách těla, výchozí do 2026-11-14; teď stopV 3 níž) (stopV 2 schová brusle pod trup, viz stop_hockey_metrics H9).
// Otočka na stranu podle držení hole (o.hs). Časování: skateStopDrive (platí pro obě).
// stopV 3 = VÝCHOZÍ (2026-11-15, Ondřej: „brždění… vznikají divné nohy"): stopV 1 dával špičky obou bruslí VEN (ostří 165° od sebe =
// roznožka), při brzdě bokem nohu 1,8–2,0 R do strany a druhou brusli pod trupem, špičku dozadu. stopV 3: ostří rovnoběžně napříč jízdy
// (špičky na stranu skateStopSig, nikdy dozadu), kotník u své kyčle o st3W ×R ven a st3L ×R vpřed po jízdě (dozadu nikdy), úhel i poloha
// při DOJEZDU se úhel vrací spolu s polohou (dřív úhel napřed → špička vnitřní brusle přejela pod záda), při náběhu ostří napříč dřív
// (st3A0–st3A, čitelnost S1). scripts/brake_legs_metrics.mjs 9/9; mřížky st3W 0,3–1,2 × st3L × st3N × stopBack × st3A0/st3A, zvolena
// nejmenší šíře, která drží B5 i H10 / S1 (st3W 0,95 → B5 při dojezdu; 1,05 → H10 3,02 px); záklon stopBack 0,25 jako dosud.
SKATE_K3.st3W = 1.0; SKATE_K3.st3L = 0.3; SKATE_K3.st3N = 0; SKATE_K3.st3A0 = 0.1; SKATE_K3.st3A = 0.8;   /* st3A0–st3A = náběh úhlu ostří (podíl pózy); dojezd: úhel spolu s polohou */
SKATE_K3.stopV = 3; SKATE_K3.hsD = 1.4; SKATE_K3.hsLead = -0.1; SKATE_K3.hsN = 0.3;   // vybráno mřížkou: jediná kombinace 10/10
// UKOTVENÍ BRUSLÍ K LEDU (2026-11-14, Ondřej: „bruslení působí jako ragdoll, trup vede nohy, nohy nemají váhu"): brusle na ledě drží
// místo ve SVĚTĚ a klouže jen podél ostří (do strany max perpMax ×R odchylky od pózy), ve vzduchu dojíždí k póze (airK).
// Dřív se větev ukotvení ve skateFeetSmooth nikdy nespustila (draw ji volal bez x, y) → nohy v rámci trupu, otáčely se s ním.
// plant 0 = vypnuto. scripts/leg_weight_metrics.mjs
SKATE_K3.plBw = 0.5; SKATE_K3.relT = 0.03; SKATE_K3.relS = 0.08; SKATE_K3.skidK = 0; SKATE_K3.plLb = 0.5;
SKATE_K3.lbCyc = 1.2;   // boční krok: násobek délky cyklu (klidnější rytmus, 2026-11-15 „přešlapování do stran se seká“)
SKATE_K3.fwV = 30; SKATE_K3.fwT = 0.15; SKATE_K3.fwR = 4; SKATE_K3.fwS = 0.06; SKATE_K3.fwC = 0.025;   // fwR: vyhlazená rychlost otáčení těla (rad/s), nad ní brusle dojíždí k póze za ~fwS s (švih myší)
   // VIS.w: nad fwV j/s brusle po póze (přechod fwT s), pod ní ukotvení (otočka na místě, rozjezd z místa)
SKATE_K3.back = 1.0;   // VIS.w: délka odrazu dozadu (×R; hráči 0,6). 2026-11-16 Ondřej: „nohy do stran — měly by jít víc za tělo":
// nejzadnější brusle −0,31 → −0,72 R, odraz vzad/bok 1,4 → 2,4 (duck_metrics Z1/Z2); latW 0,3 schová brusle pod trup (viditelnost 6/9)
SKATE_K3.swK = 0.05; SKATE_K3.swK0 = 0.11;   // *0 = hodnoty pro VIS.w 0 (hráči; nové jen /dev)
   // K3: přenos váhy tělem do boku (×R amplituda; dřív 0,11)
// „KAČER" (2026-11-16, Ondřej: „nohy na dobré pozici, lehce za, ale nebruslí jak naprcanej kačer do stran"): odraz do boku latW
// 0,65 → 0,40 R (nejmenší, kde čitelnost kroku skate_anim R1 ≥ 40 %: 0,35 → 37 %), houpání těla swK 0,11 → 0,05; postoj y0 1,05 ponechán (užší = brusle pod trupem, skate_visibility vpřed 17 % < 50 %).
// scripts/duck_metrics.mjs: max do boku 1,75 → 1,48 R, tělo 0,22 → 0,10 R; varianta pod kyčlemi (y0 0,55, latW 0,55) v scripts/skate_gif.py
SKATE_K3.twK5 = 0.6; SKATE_K3.swK5 = 0.08;   // K5: podíl zkrutu trupu s boky, houpání trupu (×R)    // couvání nad tuto váhu = bez ukotvení (C-cut)
SKATE_K3.plant = 0; SKATE_K3.perpMax = 0.6; SKATE_K3.airK = 0.45;
// plant 2 = stavový automat: plRot max. dotáčení opěrné brusle (rad/s), krok když póza zvedá nohu (lift > stepL) nebo odchylka > stepD (×R,
// úhel váha stepA na rad), švih trvá swT s.
SKATE_K3.plRot = 1.5; SKATE_K3.stepD = 0.5; SKATE_K3.stepA = 0.5; SKATE_K3.swT = 0.14; SKATE_K3.stepL = 0.3; SKATE_K3.glC = 0.02; SKATE_K3.stepR = 0.5; SKATE_K3.reachS = 1.25; SKATE_K3.swT = 0.16; SKATE_K3.stepD = 0.35;   // vybráno mřížkou 48 kombinací (jen W4 bokem neprošlo)   // glC korekce podél ostří (×R/snímek), stepR nouzový krok (×R od pózy)
SKATE_K3.stopVmin = 25; SKATE_K3.stopDec = 450; SKATE_K3.stopUp = 9; SKATE_K3.stopHold = 0.6; SKATE_K3.stopDn = 4;
if (typeof process !== "undefined" && process.env && process.env.FH_K3) Object.assign(SKATE_K3, JSON.parse(process.env.FH_K3));   // jen měření / hledání (Node)
// K4 (2026-11-13, jen /dev k výběru): tělo jako celek + odraz. back = délka zaprutí dozadu (×R), hold = podíl rychlosti těla,
// kterým noha jede dozadu (≥ 0,6 → brusle ve světě skoro stojí), latK = šíře odrazu ven, hip = max natočení boků, twK = podíl zkrutu,
// který vezme trup (zbytek paže/hůl), sway = přenos váhy napříč (×R). Měření: scripts/body_unity_metrics.mjs --k=4
// VIDITELNÉ BOKY (2026-11-13, Ondřej: „hips jsou pozadu a vyčnívají"): kyčle a kalhoty se natočí s boky max o tolik vůči trupu
// (rad); víc = kalhoty vyjedou z trupu do boku (scripts/hip_pants_metrics.mjs V1). Brusle se dál řídí plným natočením boků h.
export const SKATE_HIPV = { k3: 0.7, k4: 0.5 };
export const SKATE_K4 = { back: 1.1, hold: 0.62, latW: 0.35, hip: 1.0, twK: 0.5, sway: 0.08, perpMax: 0.6, airK: 0.45, pMin: 0.12, pAcc: 0.08,
  cx: 0.0, glide: 0.3, land: 0.7, y0: 0.55, ampK: 1, sideA: 0.3, m0: 0.5 };   // 2026-11-14 scripts/k4_search.mjs: 24/25 (F1 rozkmit 13,4 px > 9 — konflikt s N2 zaprutím)   // NOHY VEZOU TĚLO (2026-11-13): odraz začíná pod středem těla (cx ×R, dřív −0,5), přistání glide R před ním, skluz od land (dřív 0,8)
if (typeof process !== "undefined" && process.env && process.env.FH_K4) Object.assign(SKATE_K4, JSON.parse(process.env.FH_K4));   // jen měření (scripts/k4_search.mjs)
export const skateCycle = (k, v) => k >= 3 ? SKATE_K3.cyc0 + SKATE_K3.cycV * Math.min(200, v) : SKATE_CYCLE;
const _ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _wrap1 = u => u - Math.floor(u);
// posun fáze po jednom snímku: st = { _skatePhase, _animPrev, _rotSf } (mutuje); poloha a úhel těla ve světě
export function skateAdvance(st, x, y, ba, spd, k, mLoc = 0, dt = 1 / 60) {
  const pv = st._animPrev, sf = Math.min(1, spd / 160);
  // PŘEMÍSTĚNÍ (buly, oprava polohy ze serveru, 2026-11-16 Ondřej: „při přemístění hráčů flekatý morph"): tělo poskočí víc,
  // než stihne ujet → zapomeň stav nohou (ukotvené brusle, natočení, vyhlazené boky), brusle naskočí rovnou do pózy, nedojíždějí
  // přes led (dřív buly při brzdě 170 px, 37 snímků). scripts/morph_event_game.mjs
  if (pv && Math.hypot(x - pv.x, y - pv.y) > 1.2 * PLAYER.radius + 1.5 * Math.min(400, Math.max(spd, pv.spd ?? 0)) * dt) {   // rychlost omezená: falešná rychlost z interpolace teleport neschová
    st._pl = null; st._faS = null; st._fpW = null; st._mLocS = null; st._mvW = null; st._bwS = null; st._lbS = null; st._thr = 0; }
  // K3: směr jízdy vůči tělu vyhlazený v čase (boky se natáčejí plynule i při švihu myší) → st._mLocS
  if (k === 4) {   // K4: směr boků vyhlazený VE SVĚTĚ → při švihu myší boky (a nohy) zůstanou, tělo se otočí nad nimi
    const mw = ba + mLoc; st._mvW = st._mvW == null ? mw : angleDiff(lerpAngle(st._mvW, mw, Math.min(1, 6 * dt)), 0);
    st._mLocS = angleDiff(st._mvW, ba);
    // přechod vpřed ↔ couvání omezenou rychlostí (≈ 0,25 s) — během něj přešlap (pivot), ne smyk bruslí
    const bwT = spd > 8 ? _ss(1.6, 2.5, Math.abs(st._mLocS)) : 0, b0 = st._bwS ?? bwT, nb = b0 + Math.max(-4 * dt, Math.min(4 * dt, bwT - b0));
    st._bwV = Math.abs(nb - b0) / Math.max(dt, 1e-4); st._bwS = nb;
  } else {
    st._mLocS = st._mLocS == null ? mLoc : angleDiff(lerpAngle(st._mLocS, mLoc, Math.min(1, 6 * dt)), 0);
    if (k === 3 || k === 5) { const bwT = spd > 8 ? _ss(SKATE_K3.bwA, SKATE_K3.bwB, Math.abs(st._mLocS)) : 0, b0 = st._bwS ?? bwT;   // K3: vpřed ↔ couvání max. bwR/s (dřív skok nohy 0,53 R za snímek)
      st._bwS = b0 + Math.max(-SKATE_K3.bwR * dt, Math.min(SKATE_K3.bwR * dt, bwT - b0));
      const lT = spd > 8 ? (1 - st._bwS) * _ss(SKATE_K3.lbA, SKATE_K3.lbB, Math.abs(st._mLocS)) : 0, l0 = st._lbS ?? lT;   // boční krok taky max. bwR/s (švih myší bez skoku)
      st._lbS = l0 + Math.max(-SKATE_K3.bwR * dt, Math.min(SKATE_K3.bwR * dt, lT - l0)); }
  }
  if (pv) {
    const dd = Math.min(30, Math.hypot(x - pv.x, y - pv.y));             // teleport (buly) nepočítej
    const dr = Math.abs(angleDiff(ba, pv.ba));
    const rotK = k >= 3 ? 1.6 * (1 - sf) : 1.6;                          // K3: otáčení přidá krok jen v pomalé jízdě (pivot)
    // K3 ROZJEZD (2026-11-13, Ondřej: „animace nesedí vůči pohybu"): fáze jen z dráhy → výbušný rozjezd vypadal jako klouzání
    // (1,6 kroku/s jako v plné jízdě). Zrychlení přidá rychlé krátké kroky: +SKATE_K3.accHz kroku/s při zrychlení ≥ accHi px/s².
    let acc = 0;
    if (k >= 3 && pv.spd != null && dd < 30) { const th = Math.max(0, (spd - pv.spd) / dt), t0 = st._thr ?? 0; st._thr = t0 + (th - t0) * Math.min(1, (th > t0 ? 10 : 2.5) * dt);   // nárůst rychle, odeznění pomalu (bez skoku délky kroku)
      acc = SKATE_K3.accHz * _ss(SKATE_K3.accLo, SKATE_K3.accHi, st._thr) * dt * Math.PI * 2; }
    st._skatePhase = ((st._skatePhase ?? 0) + dd / (skateCycle(k, spd) * (1 + (SKATE_K3.lbCyc - 1) * ((k === 3 || k === 5) ? (st._lbS ?? 0) : 0))) * Math.PI * 2 + acc + Math.min(0.6, dr) * rotK) % (Math.PI * 2);
    st._rotSf = Math.min(1, dr / 0.12) * (1 - sf);                        // otáčení na místě → pivot kroky
  }
  st._animPrev = { x, y, ba, spd };
}
// NÁKLON DO ZATÁČKY z dostředivého zrychlení (čistá funkce; sim i měření). st._lvD = minulý směr rychlosti, st._lean = náklon −1..1.
export const LEAN = { g: 600, rate: 2.5, vMin: 20, max: 2.5 };   // max = nejrychlejší změna náklonu (1/s), bez cuku v ostré zatáčce
export function leanStep(st, vx, vy, dt) {
  const sp = Math.hypot(vx, vy), dir = Math.atan2(vy, vx);
  const om = sp > LEAN.vMin && st._lvD != null ? angleDiff(dir, st._lvD) / Math.max(dt, 1e-4) : 0; st._lvD = sp > LEAN.vMin ? dir : null;
  const tgt = clamp(sp * om / LEAN.g, -1, 1), l0 = st._lean ?? 0;
  const d = (tgt - l0) * Math.min(1, LEAN.rate * dt); return l0 + Math.max(-LEAN.max * dt, Math.min(LEAN.max * dt, d));
}
// HOKEJOVÝ STOP K3 PODLE FYZIKY (2026-11-14, Ondřej: „chceme hockey stop"): dřív póza běžela pevně 0,55–0,9 s od stisku a náběh trval 0,29 s,
// fyzika ale zastaví z 140 px/s za ~0,25 s jen po dobu DRŽENÍ Space → plné brusle napříč až po zastavení, ťuknutí / zatáčka = brusle napříč v plné jízdě.
// Nově: póza je, jen když tělo opravdu brzdí (Space nad stopVmin nebo zpomalení > stopDec px/s²), náběh stopUp/s, dojezd stopDn/s.
// Čistá funkce (scripts/stop_hockey_metrics.mjs).
export function skateStopDrive(st, spd, space, dt) {
  const K = SKATE_K3, pv = st._sdV ?? spd; st._sdV = spd;
  const dec = (pv - spd) / Math.max(dt, 1e-4), d0 = st._sdD ?? 0; st._sdD = d0 + (dec - d0) * Math.min(1, 25 * dt);
  const brk = spd > K.stopVmin && (space || st._sdD > K.stopDec);
  // po zastavení hráč zůstane v postoji stopu (jako na ledě), dokud se nerozjede, nejdéle stopHold s (2026-11-15; dřív hned do klidu → brusle schované, skate_visibility V2)
  if (brk) st._sdH = K.stopHold; else if (spd > K.stopVmin) st._sdH = 0; else st._sdH = Math.max(0, (st._sdH ?? 0) - dt);
  const t = brk || (st._sdH ?? 0) > 0 ? 1 : 0, v0 = st._sdT ?? 0, r = t > v0 ? K.stopUp : K.stopDn;
  st._sdT = v0 + Math.sign(t - v0) * Math.min(Math.abs(t - v0), r * dt);
  st._sdDn = t < v0;   // póza právě dojíždí (stopV 3: úhel ostří se vrací spolu s polohou)
  return st._sdT < 0.02 ? 0 : st._sdT;
}
// STRANA ŠPIČEK VE STOPU (stopV 3): obě ostří rovnoběžně napříč jízdy, špičky na stranu σ (úhel ostří = směr stopu + σ·90°).
// Volí se jednou na začátku pózy tak, aby špičky mířily spíš dopředu vůči tělu (nikdy dozadu přes záda); kolem čisté jízdy vpřed/vzad
// (|sin| < 0,17) podle držení hole. Během pózy se nemění (otočka těla při brzdě = bez přeskoku bruslí). Čistá funkce (brake_legs_metrics).
export function skateStopSig(prev, stopT, stopLoc, hs) {
  if (!(stopT > 0)) return null;
  if (prev != null) return prev;
  const s = Math.sin(stopLoc ?? 0); return Math.abs(s) < 0.17 ? (hs ?? 1) : -Math.sign(s);
}
// vyhlazení přechodu do hokejového stopu (dřív přímo v draw)
export function skateStopBlend(prev, active, dt, up = 14, down = 5, lin = false) {   // K3: lin = rovnoměrně (up = 1/s trvání nájezdu)
  const t = active ? 1 : 0, rate = t > prev ? up : down;
  // lin: rovnoměrný nájezd (za 1/up s) místo exponenciály — exponenciála byla napoprvé rychlá a pak se dlouho dotahovala,
  // takže brusle byly ve stopu vidět pozdě (scripts/skate_visibility.py); póza na to dává smoothstep → plynulý start i konec
  const v = lin ? Math.min(1, Math.max(0, prev + Math.sign(t - prev) * Math.min(Math.abs(t - prev), rate * dt)))
    : Math.min(1, Math.max(0, prev + (t - prev) * Math.min(1, rate * dt)));
  return v < 0.03 ? 0 : v;
}
// K3: jedna noha v rámci boků (x vpřed, y VEN na stranu nohy); boky jedou vůči ledu směrem (cos psi, sin psi) (couvání: opačně).
// u = fáze nohy 0..1, A = amplituda, C = délka cyklu (px). Vrací x, y, úhel ostří a, lift 0..1 (noha ve vzduchu).
function _k3Leg(u, A, C, psi, back, k4) {
  // ROZKMIT (2026-11-14, Ondřej: „nohy hrozně vlajou"): brusle se vůči tělu rozkmitaly o 13–17 px při těle ~17 px → × ampK
  A *= k4 ? SKATE_K4.ampK : SKATE_K3.ampK;
  // K4: krátké silné zaprutí — noha vyjede dozadu ~rychlostí těla (drží led), délka odrazu z dráhy (B / 0,65 C)
  const R = PLAYER.radius, Bk = k4 ? SKATE_K4.back * R * A : (VIS.w ? SKATE_K3.back : 0.6) * R * A,   /* VIS.w (/dev): odraz víc za tělo */ P = k4 ? clamp(Bk / (SKATE_K4.hold * C), k4, SKATE_K3.push) : SKATE_K3.push, L = k4 ? SKATE_K4.land : SKATE_K3.land, Y0 = (k4 ? SKATE_K4.y0 : SKATE_K3.y0) * R;
  const Gf = k4 ? SKATE_K4.glide * R : 0;   // K4: přistání Gf před začátkem odrazu, skluzem se noha pod tělem vrací k němu (nohy vezou tělo)
  const mvx = back ? -Math.cos(psi) : Math.cos(psi), mvy = back ? -Math.sin(psi) : Math.sin(psi);
  let x, y, dx = 0, dy = 0, lift = 0, a = null;          // dx, dy = derivace podle u
  if (back) {          // C-cut: noha na ledě opíše C ven a zpět (pata ven → špička ven), pak klouže pod tělem
    const H = 0.5;
    if (u < H) { const s = u / H, q = Math.sin(Math.PI * s), d2 = Math.PI * Math.sin(2 * Math.PI * s) / H;
      // couvání = široký postoj (Yb) a delší oblouk ven (sin místo sin²) → brusle za obrysem většinu cyklu, ne jen v špičce
      const CW = SKATE_K3.ccW, Yb = 0.75 * R; x = 0.35 * R * A * q * q; y = Yb + (CW - 0.4) * R * A * q; dx = 0.35 * R * A * d2; dy = (CW - 0.4) * R * A * Math.PI * Math.cos(Math.PI * s) / H;
    } else { x = 0; y = 0.75 * R; }
  } else {
    const W = (k4 ? SKATE_K4.latW : VIS.w ? SKATE_K3.latW : SKATE_K3.latW0) * R * A, B = Bk;
    if (u < P) {       // odraz: noha jde ven (zrychluje) a dozadu, brusle se natáčí špičkou ven po své dráze
      const s = u / P; x = -B * s; y = Y0 + W * s * s; dx = -B / P; dy = 2 * W * s / P;
    } else if (u < L) {  // návrat vzduchem: Hermite z konce odrazu (dojezd ven) zpět pod boky
      const s = (u - P) / (L - P), D = L - P, m0x = -B / P * D * (k4 ? SKATE_K4.m0 : 0.5), m0y = 2 * W / P * D * (k4 ? SKATE_K4.m0 : 0.5);
      const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2;
      x = h00 * -B + h10 * m0x + h01 * Gf - (s3 - s2) * Gf / (1 - L) * D; y = h00 * (Y0 + W) + h10 * m0y + h01 * Y0;   // K4: dosedne na Gf rychlostí skluzu
      lift = Math.sin(Math.PI * s);
      const a0 = Math.atan2(mvy + 2 * W / P / C, mvx - B / P / C), e = _ss(0, 1, s);   // úhel při odlepení → úhel skluzu
      a = a0 * (1 - e) + Math.atan2(mvy, mvx) * e;
    } else { x = Gf * (1 - (u - L) / (1 - L)); y = Y0; dx = -Gf / (1 - L); }   // skluz pod boky (K4: z Gf zpět k 0)
  }
  if (a == null) {     // na ledě: ostří po dráze nohy vůči ledu (= nulový boční smyk)
    a = Math.atan2(mvy + dy / C, mvx + dx / C); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
  }
  return { x, y, a, lift, push: !back && u < P };
}
// K3: natočení brusle má omezenou rychlost (9 rad/s) → přechod couvání ↔ jízda vpřed = brusle se plynule otočí (pivot), ne skok.
// Mutuje feet[i].a a st._faS; v ustálené jízdě se úhly mění pomaleji, takže nic nemění.
// K4 (ba, x, y zadané): úhly hlídané VE SVĚTĚ a brusle na ledě smí jet jen po ostří (bez bočního smyku); odchylka od pózy
// kolmo na ostří max SKATE_K4.perpMax R, ve vzduchu se brusle dorovná do pózy (airK za snímek při 60 fps).
export function skateFeetSmooth(st, feet, dt, ba = 0, x = null, y = null, k4 = false) {
  st._k4L = k4;
  const lim = 9 * dt, S = st._faS || (st._faS = {});
  for (const f of feet) { const prev = S[f.side];
    if (prev != null) { const d = angleDiff(f.a + ba, prev); f.a = prev + Math.max(-lim, Math.min(lim, d)) - ba;
      if (st._k4L && !f.push && Math.abs(d) > 0.35) f.lift = Math.max(f.lift, Math.min(0.9, 0.3 + Math.abs(d)));   // K4: ostří se ještě dotáčí → brusle nad ledem
    }
    S[f.side] = angleDiff(f.a + ba, 0); }
  if (!k4 && x != null && (SKATE_K3.plant === 2 || st._plant5 || (VIS.n && !SKATE_K3.plant))) {   // st._plant5: K5 je ukotvené vždy   // K3 STAVOVÝ AUTOMAT (foot locking): opěrná brusle ve světě, krok jen jednou nohou
    const Q = st._pl || (st._pl = {}), c = Math.cos(ba), s = Math.sin(ba), R = PLAYER.radius, K = SKATE_K3;
    const T = feet.map(f => ({ f, x: x + f.x * c - f.y * s, y: y + f.x * s + f.y * c, a: f.a + ba }));
    const bdx = x - (Q._bx ?? x), bdy = y - (Q._by ?? y); Q._bx = x; Q._by = y;
    // bez ukotvení (hokejový stop: brusle kloužou napříč; couvání: C-cut po hraně) → brusle DOJEDOU k póze za ~relT s, ne skokem
    // (2026-11-15, Ondřej: „bruslení glitchuje": dřív teleport na pózu = skok 5–6 px/snímek, scripts/skate_glitch_game.mjs)
    // VIS.w (/dev, 2026-11-16 Ondřej: „bruslí po kouskách, zasekává se po pidi kouscích"): v rozjeté jízdě vpřed ukotvení dělalo 2× víc
    // kroků než póza (165 px/s: 3,3 kroku/s, scripts/anchor_steps_metrics.mjs) → krok rozsekaný. Póza tam neklouže (skating ratio 0 %),
    // takže nad fwV px/s jde brusle po póze = jeden ucelený krok. 2. kolo („furt škobrtá"): i zatáčky a myš jinam než jízda dělaly
    // s ukotvením 1,4–2× víc kroků (scripts/stumble_metrics.mjs) → ukotvení jen skoro na místě (otočka na místě, rozjezd z místa).
    // V jízdě se do ukotveného automatu nevrací (návrat při švihu = skok až 9,6 px): brzda a prudká otočka těla (švih myší) jen
    // zpomalí dojíždění k póze (relS / fwS s), brusle tak nepřeskočí do nové pózy (skate_glitch_game brzda + opačně, švih myší).
    const rr = Math.abs(angleDiff(ba, Q._ba ?? ba)) / Math.max(dt, 1e-4); Q._ba = ba; Q._rr = (Q._rr ?? 0) + (rr - (Q._rr ?? 0)) * Math.min(1, 12 * dt);
    const brk = (st._stopK3 ?? 0) > 0.05, bsp = Math.hypot(bdx, bdy) / Math.max(dt, 1e-4), fwd = VIS.w && bsp > SKATE_K3.fwV;
    const calm = fwd && !brk && Q._rr < SKATE_K3.fwR;   // klidná jízda: brusle přesně v póze
    if (fwd || brk || (st._bwS ?? 0) > SKATE_K3.plBw || (st._lbS ?? 0) > SKATE_K3.plLb) {   // + boční krok: ostří dopředu, pohyb do strany → ukotvená brusle se táhla za tělem (klipy F9)
      st._fwB = calm ? Math.min(1, (st._fwB ?? 0) + dt / SKATE_K3.fwT) : Math.max(0, (st._fwB ?? 0) - dt / SKATE_K3.fwT);   // plynulý náběh i odchod
      const fe = st._fwB * st._fwB * (3 - 2 * st._fwB), kr = 1 - Math.exp(-dt / (brk ? SKATE_K3.relS : fwd ? SKATE_K3.fwS : SKATE_K3.relT));
      const kf = Math.max(kr, fe * (1 - Math.exp(-dt / SKATE_K3.fwC)));   // stop pomaleji (plynulost), švih fwS, couvání rychleji; klidná jízda → póza se zpožděním fwC (rozmaže skok pózy, např. náraz do mantinelu)
      for (const t of T) { const q = Q[t.f.side]; if (!q) { Q[t.f.side] = { x: t.x, y: t.y, a: t.a, sw: 0 }; continue; }
        if (fwd) { q.x += bdx; q.y += bdy; }   // v jízdě brusle jede s tělem (posun), k natočené póze jen dojíždí → švih myší nenatočí nohy skokem
        q.x += (t.x - q.x) * kf; q.y += (t.y - q.y) * kf; q.a += angleDiff(t.a, q.a) * kf; q.sw = 0;
        const lx = q.x - x, ly = q.y - y; t.f.x = lx * c + ly * s; t.f.y = -lx * s + ly * c; t.f.a = q.a - ba; }
      return;
    }   // couvání (C-cut): brusle opisuje oblouk po hraně → bez ukotvení (jinak stály pod tělem, viditelnost 62 → 42 %)   // hokejový stop: brusle záměrně kloužou napříč → bez ukotvení
    const go = q => { q.sw = K.swT; q.wx = q.x - x; q.wy = q.y - y; };   // začátek kroku: odstup od těla v osách SVĚTA (posun s tělem, ne rotace s trupem)   // posun těla za snímek: opěrná brusle klouže podél ostří jen s tělem
    for (const t of T) { const q = Q[t.f.side];
      if (!q || Math.hypot(t.x - q.x, t.y - q.y) > 4 * R) { Q[t.f.side] = { x: t.x, y: t.y, a: t.a, sw: 0 }; continue; }   // první snímek / teleport (buly)
      if (q.sw > 0) {   // krok ve vzduchu: dráha v rámci TĚLA (kolem kyčle), ne napříč ledem — jinak se noha v oblouku přetáhla (W3)
        const k = Math.min(1, dt / q.sw);   // noha ve vzduchu letí s tělem (posun), ale netočí se s trupem → při švihu myší nepřeletí led (glitch 5,5 px)
        q.wx += ((t.x - x) - q.wx) * k; q.wy += ((t.y - y) - q.wy) * k; q.x = x + q.wx; q.y = y + q.wy;
        q.a += angleDiff(t.a, q.a) * k; q.sw = Math.max(0, q.sw - dt); }
      else { const ax = Math.cos(q.a), ay = Math.sin(q.a), al = (t.x - q.x) * ax + (t.y - q.y) * ay, gb = bdx * ax + bdy * ay;   // na ledě: klouže jen podél ostří,
        const g = gb + Math.max(-K.glC * R, Math.min(K.glC * R, al - gb)); q.x += ax * g; q.y += ay * g;   // o kolik ho nese tělo (+ malá korekce k póze)
        { const pe = -(t.x - q.x) * ay + (t.y - q.y) * ax; q.x += -ay * pe * K.skidK; q.y += ax * pe * K.skidK; }   // smyk po hraně napříč (skidK/snímek): brusle se netáhne za tělem (klipy F9 2026-11-15)
        const da = angleDiff(t.a, q.a); q.a += Math.max(-K.plRot * dt, Math.min(K.plRot * dt, da)); }
    }
    for (const t of T) { const q = Q[t.f.side]; if (q.sw > 0) continue;   // nouzový krok: brusle utekla od pózy, nebo by se noha utrhla (kotník daleko od kyčle)
      const lx = (q.x - x) * c + (q.y - y) * s - Math.cos(q.a - ba) * 0.32 * R, ly = -(q.x - x) * s + (q.y - y) * c - Math.sin(q.a - ba) * 0.32 * R, hp = skinHip(t.f.side, 0);
      if (Math.hypot(t.x - q.x, t.y - q.y) > K.stepR * R || Math.hypot(lx - hp.x, ly - hp.y) > K.reachS * R) go(q); }
    if (!T.some(t => Q[t.f.side].sw > 0)) {   // krok: póza chce nohu zvednout (návrat kroku) nebo brusle utekla od pózy; vždy jen jedna noha
      let best = null, bv = 0;
      for (const t of T) { const q = Q[t.f.side], e = Math.hypot(t.x - q.x, t.y - q.y) / R + Math.abs(angleDiff(t.a, q.a)) * K.stepA, want = (t.f.lift || 0) > K.stepL && !q.wl ? 1 : 0;   // krok jen při NÁSTUPU zvednutí v póze (ne znovu po dopadu)
        const v = want ? 10 + e : e; if ((want || e > K.stepD) && v > bv) { bv = v; best = t; } }
      if (best) go(Q[best.f.side]);
    }
    for (const t of T) Q[t.f.side].wl = (t.f.lift || 0) > K.stepL;
    for (const t of T) { const q = Q[t.f.side], lx = q.x - x, ly = q.y - y;
      t.f.x = lx * c + ly * s; t.f.y = -lx * s + ly * c; t.f.a = q.a - ba; t.f.lift = q.sw > 0 ? 0.8 * Math.sin(Math.PI * (1 - q.sw / K.swT)) + 0.05 : 0; }
    return;
  }
  if (x == null) return;
  const P = st._fpW || (st._fpW = {}), c = Math.cos(ba), s = Math.sin(ba), R = PLAYER.radius;
  for (const f of feet) {
    const tx = x + f.x * c - f.y * s, ty = y + f.x * s + f.y * c, q = P[f.side];
    let nx = tx, ny = ty;
    if (q && Math.hypot(tx - q.x, ty - q.y) < 4 * R) {
      if (f.lift < 0.05) {   // na ledě: posun jen podél ostří
        const ax = Math.cos(f.a + ba), ay = Math.sin(f.a + ba), dx = tx - q.x, dy = ty - q.y, al = dx * ax + dy * ay;
        nx = q.x + ax * al; ny = q.y + ay * al;
        const ex = tx - nx, ey = ty - ny, e = Math.hypot(ex, ey), M = (st._k4L ? SKATE_K4 : SKATE_K3).perpMax * R;
        if (e > M) { nx += ex * (1 - M / e); ny += ey * (1 - M / e); }
      } else { const kk = 1 - Math.pow(1 - (st._k4L ? SKATE_K4 : SKATE_K3).airK, dt * 60); nx = q.x + (tx - q.x) * Math.max(kk, f.lift); ny = q.y + (ty - q.y) * Math.max(kk, f.lift); }
    }
    P[f.side] = { x: nx, y: ny };
    const lx = nx - x, ly = ny - y; f.x = lx * c + ly * s; f.y = -lx * s + ly * c;
  }
}
// PÓZA bruslí a těla (lokál těla ve SVĚT. jednotkách: +x dopředu, +y doprava).
// o = { k, phase, spd, mLoc (směr pohybu vůči tělu), stopT, stopLoc (směr stopu vůči tělu), rotSf, lean }
// → { feet: [{ side, x, y, a, lift }], body: { x, y, tw } }  (body = posun těla / natočení ramen = přenos váhy)
export function skatePose(o) {
  const R = PLAYER.radius, k = o.k | 0, spd = o.spd, sf = Math.min(1, spd / 160), ph = o.phase ?? 0, mLoc = o.mLoc;
  const moving = spd > 8, back = moving && Math.abs(mLoc) > 2.2, lat = moving && !back && Math.abs(mLoc) > 0.6, latS = Math.sign(mLoc) || 1;
  const stopT = o.stopT ?? 0, rv = o.rotSf ?? 0, stopA = (o.stopLoc ?? 0) + Math.PI / 2;
  const feet = [], body = { x: 0, y: 0, tw: 0 };
  if (k >= 3) {
    const K4 = k === 4, K5 = k === 5;   // K5 (2026-11-15) = K3 + trup natočený s boky a klidnější trup z K4; ukotvení vždy (scripts/k5_compare.mjs)
    const C = skateCycle(3, spd), uA = _wrap1(ph / (Math.PI * 2));
    const w = _ss(4, 30, spd) * (1 - stopT);                          // váha kroku (klid ↔ jízda, plynule)
    const bw = o.bwS != null ? o.bwS : moving ? (K4 ? _ss(1.6, 2.5, Math.abs(mLoc)) : _ss(SKATE_K3.bwA, SKATE_K3.bwB, Math.abs(mLoc))) : 0;   // K3 i K4: časově omezený přechod ze skateAdvance (bez něj okamžitý)            // váha couvání (C-cut), široký přechod = plynulá otočka
    const hipM = K4 ? SKATE_K4.hip : SKATE_K3.hip, h = Math.max(-hipM, Math.min(hipM, mLoc)) * (1 - bw), psi0 = mLoc - h, psi = K4 ? psi0 : Math.max(-SKATE_K3.psiM, Math.min(SKATE_K3.psiM, psi0));
    // VIDITELNÉ BOKY (kyčle + kalhoty, skinBody B.hh): natočené max ±SKATE_HIPV vůči trupu (twT) → kalhoty nevyjedou z trupu; brusle dál v rámci h
    const twT0 = K4 ? h * SKATE_K4.twK : K5 ? h * SKATE_K3.twK5 : 0, hvM = K4 ? SKATE_HIPV.k4 : SKATE_HIPV.k3, hv = twT0 + Math.max(-hvM, Math.min(hvM, h - twT0));
    // K4 PŘEŠLAP: při přechodu vpřed ↔ vzad a ve stoje, když se boky dorovnávají za tělem, se nohy zvednou (brusle nesmýkají po ledě)
    const pivL = K4 ? Math.min(0.9, Math.max(0.9 * Math.min(1, (o.bwV ?? 0) / 3), 0.9 * (1 - _ss(4, 30, spd)) * Math.min(1, Math.abs(mLoc) / 0.25))) : 0;   // natočení boků k jízdě (při couvání rovně)
    const psiB = angleDiff(mLoc, Math.PI);                             // couvání: odchylka od přímo dozadu
    const latB = K4 ? 0 : o.lbS != null ? o.lbS : !moving ? 0 : (1 - bw) * _ss(SKATE_K3.lbA, SKATE_K3.lbB, Math.abs(mLoc));
    // ve stopu (stopV 2) se viditelné boky otočí s bruslemi (předloha: boky o 90°), max ±hvM jako jinde (kalhoty v trupu, V1)
    const eS = _ss(0, 1, stopT), hsT = K4 || SKATE_K3.stopV !== 2 ? 0 : Math.max(-hvM, Math.min(hvM, angleDiff((o.stopLoc ?? 0) + (o.hs ?? 1) * Math.PI / 2, 0)));
    const hvF = hv * (1 - latB) * (1 - eS) + hsT * eS;   // výsledné viditelné boky (kyčel pro dosah nohy = skin)   // K3: váha bočního kroku (časově omezená ze skateAdvance)
    // rozjezd: kroky rychlé A KRÁTKÉ (až −35 % délky při plném zrychlení) — jako hokejista z místa; o.thr = vyhlazené zrychlení
    const amp = Math.min(1, 0.45 + spd / 220) * (1 - 0.35 * _ss(SKATE_K3.accLo, SKATE_K3.accHi, o.thr ?? 0)), lean = Math.max(-1, Math.min(1, o.lean ?? 0));
    const pcx = (K4 ? -0.5 : VIS.w ? SKATE_K3.cxW : SKATE_K3.cx) * R,   /* VIS.w (/dev): dráha kroku víc vzad, klid beze změny */ ch = Math.cos(h), sh = Math.sin(h);
    for (const side of [-1, 1]) {
      const u = _wrap1(uA + (side === 1 ? 0 : 0.5));
      const latK = Math.min(1, Math.abs(mLoc) / 1.57) * (1 - bw) * w;   // jízda bokem: odráží hlavně zadní noha (dál od směru jízdy)
      const A = amp * (1 - 0.35 * lean * side) * (K4 ? 1 - SKATE_K4.sideA * latK : (1 - SKATE_K3.latA * latK) * (side === -Math.sign(mLoc || 1) ? 1 + 0.3 * latK : 1));   // K3: bokem kratší krok (bez „ocasu" za trupem)   // K4: bokem menší krok (bez vlání)   // zatáčka: vnější noha víc
      const F = _k3Leg(u, A, C, side * psi, false, K4 ? SKATE_K4.pMin + SKATE_K4.pAcc * _ss(SKATE_K3.accLo, SKATE_K3.accHi, o.thr ?? 0) : 0);   // K4: při rozjezdu delší odraz (bez skoků)                    // vpřed / bokem v rámci boků (zrcadleno pro stranu)
      const fy = side * F.y;
      let x = K4 ? (SKATE_K4.cx * R + F.x) * ch - fy * sh : pcx + F.x * ch - fy * sh, y = K4 ? (SKATE_K4.cx * R + F.x) * sh + fy * ch : F.x * sh + fy * ch,   /* K4: rám boků kolem středu těla (jako skinHip) */ a = side * F.a + h, lift = F.lift;
      if (bw > 0) {                                                    // couvání: C-cuty v rámci těla (boky rovně)
        const G = _k3Leg(u, amp, C, side * psiB, true);
        const gx = pcx - 0.2 * R + G.x, gy = side * G.y, ga = side * G.a;   // C-cut za rameny (trup se dozadu zužuje → brusle vidět; dřív +0,25 R = pod rameny)
        x += (gx - x) * bw; y += (gy - y) * bw; a = lerpAngle(a, ga, bw); lift *= 1 - bw;
      }
      if (latB > 0) {                                                  // K3 boční krok: brusle na své straně, odraz do strany, návrat nad ledem
        const q = Math.sin(2 * Math.PI * u), Ks = SKATE_K3;
        const bx = (Ks.shX + 0.08 * Math.cos(2 * Math.PI * u)) * R, by = side * (Ks.shY0 + Ks.shY * (0.5 - 0.5 * Math.cos(2 * Math.PI * u))) * R, ba2 = side * Ks.shA + Math.sign(mLoc || 1) * Ks.shM;   // shM: ostří šikmo do směru pohybu (opěrná brusle klouže)
        x += (bx - x) * latB; y += (by - y) * latB; a = lerpAngle(a, ba2, latB); lift += (Ks.shL * (0.5 + 0.5 * Math.sin(2 * Math.PI * u + Math.PI)) - lift) * latB;   // plynulá vlna místo max(0, …): noha nikdy půl cyklu nestojí (videa F9: „zamrzlé nohy")
      }
      const rx = (K4 ? -0.62 : SKATE_K3.cx - 0.12) * R, ry = side * 0.5 * R, ra = side * 0.2;     // klid: mírné V (špičky lehce ven)
      x = rx + (x - rx) * w; y = ry + (y - ry) * w; a = ra + angleDiff(a, ra) * w; lift *= w;
      if (rv > 0) { const q = ph + (side === 1 ? 0 : Math.PI); x += Math.cos(q) * R * 0.25 * rv; y += side * Math.max(0, Math.sin(q)) * R * 0.2 * rv; a += side * 0.3 * rv; }
      if (stopT > 0) {   // hokejový stop: široký postoj, každá brusle NA SVÉ straně (z kyčle), napříč k jízdě, mírně po směru jízdy
        // OBRAT (2026-11-13, Ondřej: „při prudké změně směru a brzdě jsou nohy úplně rozbité"): dřív obě brusle na stranu bez hole
        // 1,6–1,8 R před tělo → pod hokejkou/rukavicemi, noha 2,8 R od kyčle, pravá zkřížená vlevo (scripts/skate_stop_metrics.mjs)
        const m = o.stopLoc ?? 0, cm = Math.cos(m), sm = Math.sin(m), e = _ss(0, 1, stopT), K = SKATE_K3;
        if (K.stopV === 2) {   // předloha: ostří rovnoběžně kolmo k jízdě, brusle za sebou podél jízdy (přední = noha, jejíž kyčel se otočí dopředu)
          const sg = o.hs ?? 1, along = (-sg * side * K.hsD * 0.5 + K.hsLead) * R, acr = sg * K.hsN * R;
          const tx2 = along * cm - acr * sm, ty2 = along * sm + acr * cm, sa2 = angleDiff(m + sg * Math.PI / 2, 0);
          x += (tx2 - x) * e; y += (ty2 - y) * e; a = lerpAngle(a, sa2, _ss(0, K.stopAe, stopT)); lift *= 1 - e;
        } else if (K.stopV === 3) {   // obě ostří rovnoběžně napříč jízdy (špičky na stranu σ), každá noha u své kyčle, kotník kousek ven a po jízdě
          const sg = o.hsSig ?? skateStopSig(null, 1, m, o.hs ?? 1), sa3 = angleDiff(m + sg * Math.PI / 2, 0), hp = skinHip(side, 0);
          const ax = hp.x + (Math.max(0, cm) * K.st3L - cm * K.stopBack) * R, ay = hp.y + side * K.st3W * R + sm * (K.st3N * K.st3L - K.stopBack) * R;   // kotník: kyčel (posunutá záklonem) + ven + vpřed po jízdě (nikdy dozadu za záda)
          const tx3 = ax + Math.cos(sa3) * 0.32 * R, ty3 = ay + Math.sin(sa3) * 0.32 * R;   // střed brusle = kotník + 0,32 R po ostří (jako draw zpět)
          const eA = o.stopDn ? e : _ss(K.st3A0 ?? 0, K.st3A, stopT);   /* náběh: ostří napříč dřív (čitelné); dojezd: úhel s polohou (jinak špička vnitřní brusle přejede pod záda) */
          x += (tx3 - x) * e; y += (ty3 - y) * e; a = lerpAngle(a, sa3, eA); lift *= 1 - e;
        } else {
        const tx = K.stopX * R + cm * K.stopLead * R, ty = side * K.stopW * R + sm * K.stopLead * R;
        // ostří kolmo na jízdu, špička VEN a o stopToe k předku těla: kotník (u paty) zůstane blíž kyčli, takže noha nepřekryje
        // ostří a špička vyčnívá za obrys ramen (špička dovnitř = noha ležela přes botu, ve hře vidět 11 % snímků brzdy);
        // nezávisí na znaménku směru (m a m+π dají stejnou pózu) → obrat brzda → rozjezd opačně bez přeskoku bruslí
        let sa = m + Math.PI / 2; if (side * Math.sin(sa) < 0) sa += Math.PI;
        sa = angleDiff(sa, 0); sa -= Math.sign(sa) * K.stopToe;
        x += (tx - x) * e; y += (ty - y) * e; a = lerpAngle(a, sa, _ss(0, K.stopAe, stopT)); lift *= 1 - e;   // ostří se srovná napříč dřív než poloha (čitelné už v půlce nájezdu)
        }
      }
      // DOSAH NOHY (2026-11-13, Ondřej: „končetiny se odkryjí"): chodidlo šlo v zatáčce až 2,0 R od kyčle → noha trčela z postavy
      // jako odtržená. Měkký limit: do 1,0 R beze změny, nad tím plynule stlačeno k max. 1,25 R (rytmus kroku zůstává).
      // (2026-11-13 večer: 1,25 R schovalo brusle pod trup do boku a vzad — ve hře vidět jen vpřed; skripts/skate_visibility.py → 1,8 R; stop bez limitu)
      { const ex = 1 + 1.5 * _ss(0, 0.6, stopT);   // ve stopu se limit plynule uvolní (nohy vpředu za obrysem)
        const hp = skinHip(side, hvF), hx = hp.x, hy = hp.y, dx = x - hx, dy = y - hy, r = Math.hypot(dx, dy), k = SKATE_K3.reachK * R * ex, M = SKATE_K3.reachM * R * ex;   // kyčel natočená s boky (jako ji kreslí skin)
        if (r > k) { const r2 = k + (M - k) * (1 - Math.exp(-(r - k) / (M - k))); x = hx + dx * r2 / r; y = hy + dy * r2 / r; } }
      if (pivL > lift) lift = pivL;
      feet.push({ side, x, y, a, lift, push: K4 && !!F.push && bw < 0.5 });
    }
    // přenos váhy: odraz tlačí tělo od odrazové nohy (napříč boky), ramena se lehce protočí proti odrazové noze
    const swing = Math.sin(2 * Math.PI * uA) * amp * w * (1 - 0.6 * bw);
    const swK = K4 ? SKATE_K4.sway : K5 ? SKATE_K3.swK5 : VIS.w ? SKATE_K3.swK : SKATE_K3.swK0;
    body.x = swK * R * swing * sh * (1 - bw); body.y = -swK * R * swing * (ch * (1 - bw) + bw); body.tw = -0.08 * swing; body.sw = swing; body.h = h;
    body.twT = K4 ? h * SKATE_K4.twK : K5 ? h * SKATE_K3.twK5 : 0;   // K4: trup se natočí s boky (část zkrutu), hůl a hlava zůstanou na myši   // natočení boků → skinBody B.hh
    if (stopT > 0) { const m = o.stopLoc ?? 0, e = _ss(0, 1, stopT); body.x -= Math.cos(m) * SKATE_K3.stopBack * R * e; body.y -= Math.sin(m) * SKATE_K3.stopBack * R * e;
      body.h *= 1 - e; body.twT *= 1 - e; }
    body.hh = hvF;   // boční krok: boky rovně s trupem   // viditelné boky (skinBody B.hh) — stejný úhel jako kyčel v dosahu nohy výš   // záklon; ve stopu se boky srovnají s tělem (jinak se při obratu přetáčely o ±1,25 rad a kyčle utekly od bruslí)
    return { feet, body };
  }
  // ── K0–K2 (dřívější varianty beze změny; přepočteno z px na svět. jednotky)
  for (const side of [-1, 1]) {
    const q = ph + (side === 1 ? 0 : Math.PI);
    const push = Math.max(0, Math.sin(q)) * sf, rec = Math.max(0, -Math.sin(q)) * sf;
    let fx, fy, fa;
    if (back) { const cp2 = Math.max(0, Math.sin(q)) * Math.max(sf, 0.6);
      fx = -R * 0.95 + cp2 * R * 0.3; fy = side * (R * 0.45 + cp2 * R * 0.75); fa = -side * cp2 * 0.7;
    } else if (lat) { const lead = side === latS ? 1 : -1;
      fx = -R * 0.9 + (lead > 0 ? push : -rec) * R * 0.12; fy = side * R * 0.5 + latS * (push - rec) * R * 0.25;
      fa = latS * 0.78 * Math.min(1, Math.abs(mLoc) / 1.4);
    } else if (k) { const tilt = mLoc * 0.5; let pu = push;
      if (k === 2) { const u = _wrap1(q / (Math.PI * 2)); pu = (u < 0.18 ? u / 0.18 : u < 0.55 ? 1 : u < 0.75 ? 1 - (u - 0.55) / 0.2 : 0) * sf; }
      const am = k === 2 ? 1.45 : 1.05;
      fx = -R * 0.35 - pu * R * 0.55 + rec * R * 0.35; fy = side * (R * 0.42 + pu * R * am); fa = tilt + side * pu * 0.85;
    } else { const tilt = mLoc * 0.5;
      fx = -R * 0.9 - push * R * 0.55 + rec * R * 0.2; fy = side * (R * 0.38 + push * R * 0.45); fa = tilt + side * push * 0.75; }
    if (rv > 0) { fx += Math.cos(q) * R * 0.25 * rv; fy += side * Math.max(0, Math.sin(q)) * R * 0.2 * rv; fa += side * 0.3 * rv; }
    if (spd <= 8 && rv <= 0) { fx = -R * 0.9; fy = side * R * 0.45; fa = side * 0.18; }
    feet.push({ side, x: fx * (1 - stopT) + (-R * 0.85) * stopT, y: fy * (1 - stopT) + side * R * 0.55 * stopT, a: lerpAngle(fa, stopA, stopT), lift: 0 });
  }
  if (k) body.y = Math.sin(ph) * R * 0.07 * sf;   // K1/K2: tělo nad odrazovou nohu (dřív px: r·0.07)
  body.sw = Math.sin(ph) * sf * (spd > 8 ? 1 : 0);
  return { feet, body };
}

// ── ANIMACE PŘIKOPNUTÍ (Q, 2026-11-13) — jen kresba, časová osa ze simulace (_kickFx / _kickSw odpočítávají od KICK_FX / KICK_SW;
// online je nese snapshot `kk`). Brusle blíž k puku: 0–40 ms vyjede k puku a dupne na něj napříč (puk „pod nohou", brusle
// vyčnívá zpod těla → vidět v 1×), 40–160 ms ho stáhne směrem k čepeli (puk plynule, smoothstep), do 300 ms zpět do kroku.
// Máchnutí naprázdno (minutí): 220 ms tam a zpět, brusle vykopne dopředu do boku za obrys těla.
const _sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export function kickAnimW(e) { return e < 0.04 ? _sm(e / 0.04) : e < 0.16 ? 1 : _sm(1 - (e - 0.16) / 0.14); }   // váha nohy v čase e (s)
export function kickPuckU(e) { return _sm((e - 0.04) / 0.12); }   // 0 = puk u brusle, 1 = na čepeli
function _kickFoot(p, feet, ba) {
  const R = PLAYER.radius, c = Math.cos(ba), sn = Math.sin(ba), loc = (wx, wy) => ({ x: c * wx + sn * wy, y: -sn * wx + c * wy });
  let w = 0, tx = 0, ty = 0, ta = 0;
  if (p._kickFx > 0 && p._kickOx != null) {
    const e = KICK_FX - p._kickFx; w = kickAnimW(e);
    const C = loc(p._kickOx, p._kickOy), d = Math.hypot(C.x, C.y) || 1, k = (d + 1) / d;
    tx = C.x * k; ty = C.y * k; ta = Math.atan2(C.y, C.x) + Math.PI / 2;   // brusle napříč přes puk = zastavení „pod nohou"
    if (p._visPuck) { const B = loc(p._visPuck.x - p.x, p._visPuck.y - p.y), u = 0.45 * kickPuckU(e); tx += (B.x - tx) * u; ty += (B.y - ty) * u; }   // stáhne puk k čepeli
  } else if (p._kickSw > 0) {
    const e = KICK_SW - p._kickSw; w = Math.sin(Math.PI * clamp(e / KICK_SW, 0, 1));
    const sd = p._kickSide || 1; tx = R * 1.45; ty = sd * R * 1.2; ta = sd * 0.6;   // vykopnutí dopředu do boku
  }
  if (w <= 0) return;
  const f = feet.find(q => q.side === (p._kickSide || 1)); if (!f) return;
  f.x += (tx - f.x) * w; f.y += (ty - f.y) * w; f.a = lerpAngle(f.a, ta, w); f.lift = Math.max(f.lift || 0, w * (p._kickSw > 0 ? 0.6 : 0.3));
}
function _kickPuck(p, blade) {
  if (!(p._kickFx > 0) || p._kickOx == null) return blade;
  const u = kickPuckU(KICK_FX - p._kickFx); if (u >= 1) return blade;
  const sx = p.x + p._kickOx, sy = p.y + p._kickOy;
  return { x: sx + (blade.x - sx) * u, y: sy + (blade.y - sy) * u, _kick: true };
}
// ══ PŘÍJEM A PŘIHRÁVKA (VIS.r, 2026-11-15; scripts/pass_recv_metrics.mjs R1–R4) — jen KRESBA, simulace beze změny.
// Dřív: při převzetí puk skočil z místa, kde byl vidět, rovnou na čepel (5–12 px za snímek), při přihrávce z kreslené čepele na
// fyzikální špičku hole (2–4 px). Nově (rešerše: čepel jde puku naproti, v dotyku „povolí" po směru puku = cushioning, po pasu
// dojede za pukem):
//  • předstih: hůl se natočí k místu, kudy puk projede (max ±aimMax rad, váha podle času do průjezdu, tlumená pružina);
//  • chycení: puk pokračuje viditelnou rychlostí a dojede na klidové místo na čepeli po Hermitově křivce (doba z catchT s nejmenším
//    největším zrychlením). Kde by křivka přejela PŘES čepel (překmit po směru puku), puk čepel zatlačí: čepel ustoupí o tolik, o kolik
//    puk přejel (vyhlazeno trojúhelníkem ±cushK s, náběh cushW s), a s ním se vrátí = cushioning vzniká z pohybu puku, ne z nezávislé
//    animace; vyhlazení = čepel se dá do pohybu o chvilku dřív než dotyk (měkké ruce) → špička hole bez cuku;
//  • vypuštění: puk odejde z místa, kde byl vidět (Puck.draw), čepel dojede za pukem (follow, sin²).
// Čas = hodiny kresby (_rdt) → deterministické.
export const RECV = { aimMax: 0.45, aimT: 0.4, aimNear: 30, aimRate: 18, catchT: [0.1, 0.15], aMax: 3600, cushK: 0.04, cushW: 0.03,
  follow: 3, followT: 0.2, followV: 200, jump: 60 };
const _sin2 = (t, T) => { const s = Math.sin(Math.PI * clamp(t / T, 0, 1)); return s * s; };
// předstih: odchylka úhlu hole (rad) k průjezdu volného puku; base = úhel hole bez předstihu
export function recvAim(p, base, dt) {
  const pk = p._puckView || p._puckRef;
  let tgt = 0;
  if (pk && !p.hasPuck && !p.crossCheck && !p.isDown && (p._dispCharge ?? 0) < 0.05 && !(pk._carrier && pk._carrier.hasPuck) && (pk.z ?? 0) < 1.5) {
    const g = p.gripPoint, rx = pk.x - g.x, ry = pk.y - g.y, vx = (pk.vx || 0) - (p.vx || 0), vy = (pk.vy || 0) - (p.vy || 0), vv = vx * vx + vy * vy;
    if (vv > 900) {
      const tc = -(rx * vx + ry * vy) / vv, cx = rx + vx * tc, cy = ry + vy * tc;
      if (tc > 0 && tc < RECV.aimT && Math.hypot(cx, cy) < RECV.aimNear) {
        const w = _sm(1 - tc / RECV.aimT), a = Math.atan2(cy, cx);
        tgt = clamp(angleDiff(a, base), -RECV.aimMax, RECV.aimMax) * w;
      }
    }
  }
  // kriticky tlumená pružina (ne exponenciála): natočení i návrat po převzetí začnou plynule, bez skoku rychlosti hole
  const w = RECV.aimRate, A = p._rvA ?? 0, V = p._rvAv ?? 0, acc = w * w * (tgt - A) - 2 * w * V;
  p._rvAv = V + acc * dt; p._rvA = A + p._rvAv * dt;
  return p._rvA;
}
// Brzdění puku vůči čepeli s NEJMENŠÍM největším zrychlením (osa po směru příletu a napříč zvlášť, stejná doba T): v 1D je to
// „bang-bang" — stálé zrychlení −a do přepnutí s, pak +a do T; z podmínek x(T) = 0, v(T) = 0 vyjde kvadratická rovnice pro s
// (v0·s² + 2·x0·s − T·x0 − v0·T²/2 = 0) a a = v0 / (2s − T). Polohy jsou hladké (C¹), zrychlení po snímcích ≤ a·dt².
function _bb(x0, v0, T) {
  if (Math.abs(v0) < 1e-6) return Math.abs(x0) < 1e-9 ? { x0, v0, s: T / 2, a: 0 } : { x0, v0, s: T / 2, a: 4 * x0 / (T * T) };
  const D = x0 * x0 + v0 * T * x0 + v0 * v0 * T * T / 2; if (D < 0) return null;
  let best = null;
  for (const sg of [1, -1]) { const s = (-x0 + sg * Math.sqrt(D)) / v0;
    if (s < -1e-9 || s > T + 1e-9 || Math.abs(2 * s - T) < 1e-9) continue;
    const a = v0 / (2 * s - T); if (!best || Math.abs(a) < Math.abs(best.a)) best = { x0, v0, s: clamp(s, 0, T), a }; }
  return best;
}
function _bbAt(B, t) {
  if (t <= B.s) return B.x0 + B.v0 * t - B.a * t * t / 2;
  const xs = B.x0 + B.v0 * B.s - B.a * B.s * B.s / 2, vs = B.v0 - B.a * B.s, d = t - B.s;
  return xs + vs * d + B.a * d * d / 2;
}
// odchylka puku od klidového místa na čepeli v čase C.t (po směru příletu u, napříč n)
function _catchRel(C) {
  const t = Math.min(C.t, C.T), a = _bbAt(C.bu, t), b = _bbAt(C.bn, t);
  return { x: C.ux * a - C.uy * b, y: C.uy * a + C.ux * b, a };
}
// ustoupení čepele (svět) = hladký překmit puku přes čepel po směru jeho příletu; od počáteční hodnoty se odečte (začíná v 0, končí v 0)
function _catchCush(C) {
  const G = C.G, x = C.t / RECV_H, i = Math.floor(x);
  const a = i + 1 >= G.length ? 0 : G[i] + (G[i + 1] - G[i]) * (x - i);
  return { x: C.ux * a, y: C.uy * a };
}
// průběh ustoupení čepele (po 1/600 s): překmit max(0, odchylka po směru příletu) vyhlazený trojúhelníkem ±cushK, náběh smoothstep cushW
const RECV_H = 1 / 600;
function _cushPlan(bu, T) {
  const K = Math.round(RECV.cushK / RECV_H), n = Math.ceil(T / RECV_H) + K + 1, o = [], G = [];
  for (let i = 0; i <= n; i++) o.push(i * RECV_H <= T ? Math.max(0, _bbAt(bu, i * RECV_H)) : 0);
  for (let i = 0; i <= n; i++) { let sum = 0, wsum = 0;
    for (let j = -K; j <= K; j++) { const w = K + 1 - Math.abs(j), k = i + j; wsum += w; if (k >= 0 && k <= n) sum += o[k] * w; }
    G.push(sum / wsum * _sm(i * RECV_H / RECV.cushW)); }
  G.push(0);
  return G;
}
// posun špičky hole (svět): ustoupení při příjmu + dojezd za pukem po přihrávce
export function recvTipOffset(p, dt) {
  let x = 0, y = 0;
  if (p._rvC) { const c = _catchCush(p._rvC); x += c.x; y += c.y; }
  const f = p._rvF; if (f) { const a = f.A * _sin2(f.t, f.T); x += f.ux * a; y += f.uy * a; f.t += dt; if (f.t >= f.T) p._rvF = null; }
  return x || y ? { x, y } : null;
}
// doba T z intervalu catchT s nejmenším největším zrychlením (|a| po ose u i n); vrací brzdění pro obě osy
export function recvCatchPlan(ru, rn, vu, vn) {
  let best = null;
  for (let i = 0; RECV.catchT[0] + i * 0.005 <= RECV.catchT[1] + 1e-9; i++) {
    const T = RECV.catchT[0] + i * 0.005, bu = _bb(ru, vu, T), bn = _bb(rn, vn, T); if (!bu || !bn) continue;
    // překmit přes čepel (= o kolik puk čepel zatlačí): co nejmenší, dokud zrychlení nepřesáhne aMax; když to nejde, nejmenší zrychlení
    let ov = 0; for (let k = 0; k <= 24; k++) ov = Math.max(ov, _bbAt(bu, T * k / 24));
    const m = Math.hypot(bu.a, bn.a), ok = m <= RECV.aMax;
    if (!best || (ok && (!best.ok || ov < best.ov - 1e-9)) || (!ok && !best.ok && m < best.m - 1e-9)) best = { T, bu, bn, m, ov, ok };
  }
  return best;
}
// chycení: q = klidové místo puku na (už ustoupené) kreslené čepeli (bladePuck) → kreslená poloha puku
export function recvCatch(p, cp, q, dt) {
  let cush = p._rvC ? _catchCush(p._rvC) : null;
  if (!p._rvHad && cp._drawn && cp._dv && !(p._kickFx > 0)) {
    const rx = cp._drawn.x + cp._dv.x * dt - q.x, ry = cp._drawn.y + cp._dv.y * dt - q.y, vx = cp._dv.x - (p.vx || 0), vy = cp._dv.y - (p.vy || 0);
    if (Math.hypot(rx, ry) <= RECV.jump) {
      const v = Math.hypot(vx, vy), ux = v > 1e-6 ? vx / v : 1, uy = v > 1e-6 ? vy / v : 0;
      const ru = rx * ux + ry * uy, rn = -rx * uy + ry * ux, P = recvCatchPlan(ru, rn, v, 0);
      if (P) { p._rvC = { ux, uy, bu: P.bu, bn: P.bn, T: P.T, G: _cushPlan(P.bu, P.T), t: 0 }; cush = { x: 0, y: 0 }; }
    }
  }
  const C = p._rvC; if (!C) return q;
  // q0 = klidové místo bez ustoupení čepele; ke konci (posledních cushW s před T) se puk plynule „přilepí" na ustupující čepel
  const r = _catchRel(C), b = _sm((C.t - C.T + RECV.cushW) / RECV.cushW), q0x = q.x - cush.x * (1 - b), q0y = q.y - cush.y * (1 - b);
  C.t += dt; if (C.t >= C.T + RECV.cushK - 1e-9) p._rvC = null;   // ustoupení čepele doběhne o cushK později než puk
  return { x: q0x + r.x, y: q0y + r.y };
}
// vypuštění (pas): čepel dojede za pukem; rána má vlastní švih (p._sw), pomalé ztráty puku (obrání) bez dojezdu
export function recvRelease(p) {
  const pk = p._carriedPuck; p._rvC = null;
  if (!pk || p._sw) return;
  const v = Math.hypot(pk.vx || 0, pk.vy || 0);
  if (v >= RECV.followV) p._rvF = { ux: pk.vx / v, uy: pk.vy / v, A: RECV.follow, t: 0, T: RECV.followT };
}
// ══ TĚLO B1 (2026-11-13) — pohyb horní poloviny těla nad boky. Jen kresba: čistá funkce stavu simulace + dt snímku
// (žádná náhoda, žádné hodiny ze zdi), volá ji draw() i scripts/body_anim_metrics.mjs. B0 = dřívější (nic navíc).
//  • náklon do zrychlení: ramena+trup+helma se posunou ve směru zrychlení (rozjezd = předklon, brzda = záklon, zatáčka = dovnitř);
//    zrychlení přes dolní propust, měkké nasycení (tanh), pružina (lehký dojezd);
//  • náraz (skok rychlosti > jolt px/s²) / zakolísání = trhnutí horního těla po směru úderu + protočení ramen, pružina vrátí;
//  • protirotace ramen v rytmu kroku (k přenosu váhy K3), houpání horní ruky s holí napříč;
//  • nápřah: ramena se natočí dozadu na forhend a těžiště se „nabije“ dozadu; po ráně švih přes směr střely; přihrávka = krátké cuknutí ramen;
//  • hlava míří za kurzorem s malým zpožděním (vůči tělu, max ±head rad); v klidu jemné dýchání.
// st = stav kresby (mutuje _bp*); o = { b, x, y, vx, vy, ba, aim, dcv, sw (průběh švihu 0..1, < 0 = žádný), hasPuck, hnd, stagT, stagDir, swing }
// → { ux, uy (posun horního těla vůči bokům, lokál, svět. j.), tw (natočení ramen navíc, rad), hd (natočení hlavy vůči tělu), sway (horní ruka napříč, j.) }
// 2026-11-13: amplitudy × ~1,7 (Ondřej: „hráč je furt moc strohý" — v 1× byl rozdíl B0/B1 skoro neviditelný, 2–4 px)
export const BODY_B1 = { k: 0.024, umax: 0.7, aMax: 700, rate: 10, w: 14, z: 0.55, jolt: 3500, jk: 0.5, jMax: 60, stagV: 40, stagW: 7,
  twStride: 0.2, sway: 0.22, wind: 0.7, windU: 0.24, follow: 0.5, pass: 0.35, passT: 0.2, breath: 0.055, breathT: 2.8, head: 0.6, headRate: 12 };
export function bodyPose(st, o, dt = 1 / 60) {
  const out = { ux: 0, uy: 0, tw: 0, hd: 0, sway: 0 };
  if (!o.b) { st._bpPv = null; return out; }
  const B = BODY_B1, R = PLAYER.radius, c = Math.cos(o.ba), s = Math.sin(o.ba), hnd = o.hnd ?? 1;
  const spd = Math.hypot(o.vx, o.vy), mv = _ss(4, 30, spd);
  const A = st._bpA || (st._bpA = { x: 0, y: 0 }), U = st._bpU || (st._bpU = { x: 0, y: 0, vx: 0, vy: 0, t: 0, vt: 0 });
  // 1) zrychlení v lokálu těla (teleport / první snímek = nic)
  const pv = st._bpPv; let ax = 0, ay = 0;
  if (pv && dt > 0 && Math.hypot(o.x - pv.x, o.y - pv.y) < 30) {
    const dvx = o.vx - pv.vx, dvy = o.vy - pv.vy, lx = dvx * c + dvy * s, ly = -dvx * s + dvy * c, am = Math.hypot(lx, ly) / dt;
    if (am > B.jolt) { const k = Math.min(B.jMax, Math.hypot(lx, ly) * B.jk) / (Math.hypot(lx, ly) || 1); U.vx += lx * k; U.vy += ly * k; }   // náraz: trhnutí po směru úderu
    else { const k = am > B.aMax ? B.aMax / am : 1; ax = lx / dt * k; ay = ly / dt * k; }
  }
  st._bpPv = { x: o.x, y: o.y, vx: o.vx, vy: o.vy };
  const f = Math.min(1, B.rate * dt); A.x += (ax - A.x) * f; A.y += (ay - A.y) * f;
  // zakolísání (začátek): horní tělo hodí do strany úderu, ramena se protočí
  if ((o.stagT ?? 0) > 0 && !((st._bpSt ?? 0) > 0)) { U.vy += (o.stagDir ?? 1) * B.stagV; U.vt += (o.stagDir ?? 1) * B.stagW; }
  st._bpSt = o.stagT ?? 0;
  // cíl: náklon do zrychlení (měkké nasycení), nápřah = těžiště dozadu a na forhend, dýchání v klidu
  const am = Math.hypot(A.x, A.y) * B.k, um = B.umax * R, g = am > 1e-9 ? um * Math.tanh(am / um) / am * B.k : 0;
  const dcv = o.dcv ?? 0;
  st._bpT = ((st._bpT ?? 0) + dt) % (B.breathT * 1000);
  const br = Math.sin(2 * Math.PI * st._bpT / B.breathT) * B.breath * R * (1 - mv);
  let tx = A.x * g - B.windU * R * dcv + br, ty = A.y * g + B.windU * R * dcv * hnd;
  // přihrávka: puk odešel bez nabití → krátké cuknutí ramen a předklon
  if (st._bpHad && !o.hasPuck && (st._bpDc ?? 0) <= 0.15) st._bpPass = B.passT;
  st._bpHad = !!o.hasPuck; st._bpDc = dcv;
  let pu = 0; if ((st._bpPass ?? 0) > 0) { pu = Math.sin(Math.PI * (1 - st._bpPass / B.passT)); st._bpPass = Math.max(0, st._bpPass - dt); }
  tx += 0.1 * R * pu;
  // pružina (polo-implicitní Euler, podkroky ≤ 1/120 s → nezávislé na fps)
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, w2 = B.w * B.w, zw = 2 * B.z * B.w;
  for (let i = 0; i < n; i++) {
    U.vx += (w2 * (tx - U.x) - zw * U.vx) * h; U.vy += (w2 * (ty - U.y) - zw * U.vy) * h; U.vt += (w2 * (0 - U.t) - zw * U.vt) * h;
    U.x += U.vx * h; U.y += U.vy * h; U.t += U.vt * h;
  }
  // ramena: protirotace v kroku + nápřah dozadu na forhend + dokončení švihu + přihrávka + trhnutí
  // švih po ráně (u = 0..1): z natočení v okamžiku rány (W0) přes směr střely na druhou stranu (−follow), pak plynule zpět k nápřahu
  const sw = o.sw ?? -1, wind = hnd * B.wind * dcv;
  if (sw >= 0 && !((st._bpSw ?? -1) >= 0)) st._bpW0 = hnd * B.wind * (st._bpDcP ?? dcv);
  st._bpSw = sw; st._bpDcP = dcv;
  let twShot = wind;
  if (sw >= 0) { const e = _ss(0, 0.45, sw), e2 = _ss(0.45, 1, sw); twShot = (1 - e) * (st._bpW0 ?? 0) + e * (1 - e2) * -hnd * B.follow + e2 * wind; }
  out.tw = -B.twStride * (o.swing ?? 0) + twShot - hnd * B.pass * pu + U.t;
  out.ux = U.x; out.uy = U.y;
  out.sway = B.sway * R * (o.swing ?? 0) * (1 - dcv) * (o.hasPuck ? 0.6 : 1);
  // hlava za kurzorem (vůči tělu), malé zpoždění
  const ht = Math.max(-B.head, Math.min(B.head, angleDiff(o.aim ?? o.ba, o.ba)));
  st._bpHd = (st._bpHd ?? 0) + (ht - (st._bpHd ?? 0)) * Math.min(1, B.headRate * dt);
  out.hd = st._bpHd + 0.5 * U.t;
  return out;
}
// PUK NA ČEPELI (2026-11-14, scripts/puck_carry_metrics.mjs P1–P7). Jen kresba, simulace beze změny.
// Dřív: puk na středu TĚTIVY čepele + 1,05 r kolmo k přímce → u zahnuté čepele 0,8 px vedle (zanořený do obrysu), vždy jen na
// forhendu (při kličce na bekhend zůstal kreslený na forhendu) a bez rotace. Nově: bod na ZAHNUTÉ čepeli (bezier v parametru t,
// uprostřed), kolmo k její tečně o (poloviční tloušťku čepele s obrysem + poloměr puku) = puk se čepele právě dotýká; strana
// spojitě podle p._visSide (+1 forhend = prohnutá strana, −1 bekhend) → při kličce puk přejede pod čepelí na druhou stranu.
// B = p._visBlade (svět), t = poloha po čepeli (0 pata, 1 špička), hnd = ruka, side = p._visSide, r = poloměr puku → { x, y, t, tx, ty, sg }
export function bladePuck(B, t, hnd, side, r) {
  const u = 1 - t, x = u * u * B.sx + 2 * u * t * B.cx + t * t * B.ex, y = u * u * B.sy + 2 * u * t * B.cy + t * t * B.ey;
  let tx = 2 * u * (B.cx - B.sx) + 2 * t * (B.ex - B.cx), ty = 2 * u * (B.cy - B.sy) + 2 * t * (B.ey - B.cy);
  const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
  const sd = Math.max(-1, Math.min(1, side)), sg = -hnd * sd;   // + = vlevo od tečny (−ty, tx); forhend praváka = vlevo
  const off = (B.hw + r) * sg;
  return { x: x - ty * off, y: y + tx * off, t, tx, ty, sg };
}
// ROTACE PUKU (jen kresba): puk se o čepel neprokluzuje → otáčí se s čepelí (změna úhlu tečny) a kutálí se, když po ní popojede
// (ds po čepeli → −sg·ds/r). Jízda rovně se stálou holí = puk klouže s čepelí, netočí se. Volný puk rotaci podrží a ta dozní (Puck.draw).
// Stav na puku: _spin (rad), _spinW (rad/s), _spinPv (minulý dotyk). Deterministické: jen geometrie snímku a dt kamery.
export function puckSpinStep(puck, q, B, dt = 1 / 60) {
  const a = Math.atan2(q.ty, q.tx), L = Math.hypot(B.ex - B.sx, B.ey - B.sy), s = q.t * L, pv = puck._spinPv;
  let d = 0;
  if (pv) { d = Math.atan2(Math.sin(a - pv.a), Math.cos(a - pv.a)) - (q.sg || 0) * (s - pv.s) / PUCK.radius; if (Math.abs(d) > 1.2) d = 0; }   // teleport = bez skoku
  puck._spin = ((puck._spin ?? 0) + d) % (Math.PI * 2);
  puck._spinW = dt > 0 ? d / dt : 0;
  puck._spinPv = { a, s };
}
// horní a dolní ruka na holi (svět): sdílí draw i metrika. tipW = špička dříku, sway = posun horní ruky napříč (B1)
export function stickHands(x, y, ba, dcv, hnd, tipW, sway = 0) {
  const R0 = PLAYER.radius, fC = Math.cos(ba), fS = Math.sin(ba), sC = -fS, sS = fC;
  // DRŽENÍ (2026-11-13, scripts/stick_grip_metrics.mjs G1–G5): dřív horní ruka 0,55 R vpředu = PŘÍMO POD HELMOU (dřík „z krku").
  // HOKEJKA, NE MEČ (2026-11-13, Ondřej: „drží ji jak meč"; scripts/stick_hold_metrics.mjs H1–H6): horní ruka 1,1 R vpředu byla
  // před helmou a dolní ruka 0,6 R za ní → obě rukavice u sebe, dřík trčel dopředu. Nově horní ruka (konec hole) u břicha na
  // bekhendu (0,8 R vpředu, 0,75 R do strany), dolní ruka 1,2 R níž po dříku (≈ délka rukavice–šířka ramen), paže natažená;
  // dřík jde šikmo přes přední stranu těla. Nápřah končí jako dřív (0,2 R; +0,4 R). Špička (čepel) se nemění.
  const tF = R0 * (0.8 - 0.6 * dcv), tSd = R0 * (-0.75 + 1.15 * dcv) * hnd + sway;
  let f = tF / R0, sd = tSd / R0, bf = 0.35;
  { const dx = tipW.x - x, dy = tipW.y - y, lx = (dx * fC + dy * fS) / R0, ly = (dx * sC + dy * sS) / R0;   // špička v lokálu těla (R)
    // puk u těla (špička < 2,5 R): konec hole se stáhne k boku (až −0,35 R, +0,15 R do strany) → ruce zůstanou od sebe, dřík šikmo
    const near = Math.max(0, Math.min(1, (2.5 - Math.hypot(lx, ly)) / 0.9)) * (1 - dcv);
    f -= 0.35 * near; sd -= 0.15 * near * hnd;
    bf = Math.max(0.35, Math.min(0.65, 1.2 / Math.max(0.1, Math.hypot(lx - f, ly - sd))));
    ({ f, s: sd } = gripAdjust(f, sd, lx, ly, bf, hnd, 1 - dcv));   // do strany jen mimo nápřah (plynulý přechod)
    // dolní ruka v dosahu paže (≤ 1,85 R od forhendového ramene): spojitě (půlení) k horní ruce, rozestup nejméně 1,0 R
    const L = Math.max(0.1, Math.hypot(lx - f, ly - sd)), bmin = Math.min(bf, 1.0 / L);
    const far = b => Math.hypot(f + (lx - f) * b - 0.25, sd + (ly - sd) * b - 0.9 * hnd) > 1.85;
    if (far(bf)) { if (far(bmin)) bf = bmin; else { let lo = bmin, hi = bf; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (far(m)) hi = m; else lo = m; } bf = lo; } } }
  const topW = { x: x + (fC * f + sC * sd) * R0, y: y + (fS * f + sS * sd) * R0 };
  return { topW, botW: { x: topW.x + (tipW.x - topW.x) * bf, y: topW.y + (tipW.y - topW.y) * bf } };
}
// DŘÍK PŘED HLAVOU (2026-11-13, Ondřej: „hokejka stále občas prolejzá"): špička blízko u těla na forhendu → dřík by vedl přes obličej.
// Horní ruka se posune dopředu (krok 0,06 R, max +0,48 R), dokud dřík (horní ruka → špička) nevede mimo elipsu helmy (skin.js:
// střed 0,72 R, poloosy 0,616 × 0,56 R). Čistá funkce v jednotkách R — sdílí ji kresba i scripts/stick_grip_metrics.mjs.
// 2026-11-13 (meč): nejdřív ruku odsunout DO STRANY (od osy těla, krok 0,06 R, max 0,48 R) — dřík pak jde šikmo kolem helmy;
// až když to dosah nedovolí, dopředu jako dřív. Vrací { f, s } (horní ruka v R); bf = podíl dolní ruky po dříku.
// hnd: horní ruka patří vždy k bekhendovému rameni (skinRig) → strana −hnd; sideK = délka kroku do strany (0 = jen dopředu)
export function gripAdjust(fx, sy, tx, ty, bf = 0.35, hnd = 0, sideK = 1) {
  const e = (u, v) => ((u - 0.72) / 0.616) ** 2 + (v / 0.56) ** 2, sg = hnd ? -hnd : (sy > 0 ? 1 : -1);
  // dosah paží (ramena 0,25 R / ±0,9 R; horní ≤ 1,5 R, dolní ruka ≤ 1,9 R) — dál ruku nepřetahuj
  const reach = (f, s) => { const bx = f + (tx - f) * bf, by = s + (ty - s) * bf;
    return Math.hypot(f - 0.25, s - sg * 0.9) <= 1.5 && Math.hypot(bx - 0.25, by + sg * 0.9) <= 1.9; };
  const clear = (f, s) => { for (let i = 0; i <= 24; i++) { const t = i / 24; if (e(f + (tx - f) * t, s + (ty - s) * t) < 1) return false; } return true; };
  if (clear(fx, sy)) return { f: fx, s: sy };
  let s0 = sy;   // nejdál do strany, kam dosah pustí; odtud případně dopředu
  for (let k = 1; k <= 8 && sideK > 0; k++) { const s = sy + sg * 0.06 * sideK * k; if (!reach(fx, s)) break; s0 = s; if (clear(fx, s)) return { f: fx, s }; }
  for (let k = 1; k <= 8; k++) {
    const f = fx + 0.06 * k;
    if (!reach(f, s0)) return { f: f - 0.06, s: s0 };
    if (clear(f, s0)) return { f, s: s0 };
  }
  return { f: fx + 0.48, s: s0 };
}

// ROZPLÁCNUTÍ (2026-11-13): kloubová postava (downBody.js) — pád → doznění → ležení (klouže se simulací) → zvedání ve fázích
// (čtyři / sed → klek → stoj) → normální kresba. Póza = čistá funkce času od zásahu (stav _downT/_upT/_fallA/_fallB nese
// simulace / snapshot kd); kresba si čas jen vyhladí mezi snapshoty (online 30/s), takže animace neposkakuje.
function _downEl(p, cam) {
  const tot = PLAYER.downT + PLAYER.upT, e = p._downT > 0 ? PLAYER.downT - p._downT : tot - (p._upT || 0);
  if (p._kdN !== p._fallN || p._kdE == null || Math.abs(p._kdE - e) > 0.1) { p._kdN = p._fallN; p._kdE = e; }
  else { p._kdE = Math.min(tot, p._kdE + _rdt(cam)); p._kdE += (e - p._kdE) * 0.25; }
  return Math.max(0, Math.min(tot, p._kdE));
}
function _renderPlayer(ctx, p, cam) {
  if (p._downT > 0 || p._upT > 0) {
    const el = _downEl(p, cam), u = (el - PLAYER.downT) / PLAYER.upT, cut = !VIS.u ? 2 : globalThis.__fhRiseCut ?? RISE_CUT,   /* VIS.u 0 = dřívější zvedání (celé kloubovou postavou) */ rs = globalThis.__fhRiseS ?? RISE_S;   // __fh*: jen měření
    if (u < cut) {   // pád, ležení → čtyři / sed: kloubová postava; stav nohou zapomenout → po vstání brusle naskočí do pózy
      p._bpPv = null; p._pl = null; p._faS = null; p._fpW = null; p._animPrev = null; p._mLocS = null; p._bwS = null; p._lbS = null;
      _renderDown(ctx, p, cam, el); return; }   // B1: po pádu bez falešného zrychlení
    // OD ČTYŘ / SEDU DO STOJE (2026-11-16, Ondřej: „při zvedání … flekatý morph"): normální kresba, která se zvětší z RISE_S do 1
    // (shora: postava se zvedá ke kameře). Dřív kloubový stoj = shluk oválů a na konci skok 0,61 siluety. scripts/rise_morph_metrics.py
    const t = Math.min(1, (u - cut) / (1 - cut)), e = t * t * (3 - 2 * t), k = rs + (1 - rs) * e;
    const sx = cam.ox + p.x * cam.scale, sy = cam.oy + p.y * cam.scale;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(k, k); ctx.translate(-sx, -sy); _renderPlayerUp(ctx, p, cam); ctx.restore(); return;
  }
  p._kdE = null;
  _renderPlayerUp(ctx, p, cam);
}

function _renderDown(ctx, p, cam, el) {
  const s = cam.scale, R = PLAYER.radius, x = cam.ox + p.x * s, y = cam.oy + p.y * s;
  const K = skaterKit(p, PLAYER.colors[p.team]), fa = p._fallA ?? p.bodyAngle, n = p._fallN || 0;
  // ledová tříšť a záblesk nárazu (prvních 0,25 s)
  if (el < 0.25) {
    const k = el / 0.25;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, (R + 4 + 16 * k) * s, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(30,70,140,${(0.7 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 2.6 * s * (1 - k) + 0.4 * s; ctx.stroke();   // tmavší kruh: na světlém ledu čitelný
    for (let i = 0; i < 10; i++) {
      const a = fa + (_hrand(p.id, n, i * 2) - 0.5) * 2.2, d = (R + 2 + (10 + 14 * _hrand(p.id, n, i * 2 + 1)) * Math.sqrt(k)) * s;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.8, 1.6 * s * (1 - k)), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110,165,220,${(0.95 * (1 - k)).toFixed(3)})`; ctx.fill();   // ledová tříšť
    }
    ctx.restore();
  }
  const { psi, P } = downPose(el, { id: p.id, n, v: VIS.u, fb: p._fallB ?? p.bodyAngle, fa, ba: p.bodyAngle, ca: p.carryAngle ?? p.aimAngle, h: p.handed ?? 1 }, PLAYER);
  const lx = Math.cos(-psi) * -0.7 - Math.sin(-psi) * -0.7, ly = Math.sin(-psi) * -0.7 + Math.cos(-psi) * -0.7;   // světlo vlevo nahoře, pevné ve světě
  ctx.save(); ctx.translate(x, y); ctx.rotate(psi); ctx.scale(s, s);
  drawDownBody(ctx, P, K, R, { v: VIS.u, stickL: PLAYER.stickLen * PLAYER.stickDraw, bladeSide: p.handed ?? 1, lx, ly });
  ctx.restore();
}

function _renderPlayerUp(ctx, p, cam) {
  const s     = cam.scale;
  const { ox, oy } = cam;
  const sx    = ox + p.x * s;
  const sy    = oy + p.y * s;
  const r     = PLAYER.radius * s;
  const color = p.color || PLAYER.colors[p.team]; // vlastní barva dresu, jinak týmová
  const stickCol = p.stick || '#7a5015';          // barva hole (šaft)
  const tapeCol  = p.tape || '#111';
  const tapeSty  = p.tapeStyle || 'full';
  const K = skaterKit(p, PLAYER.colors[p.team]);   // kosmetika C-d2 (defaulty, když server pole nepošle)
  const bladeCol = K.blade;

  // RYCHLÁ HRA (2026-11-13): tým poznáš podle barvy jmenovky/štítku (níž); kruh pod hráčem zakrýval nohy (Ondřej) → žádný

  // ŠTÍT: soupeř se pokusil obrat puk krytý tělem → oblouk na straně soupeře (krytí tělem funguje)
  if (p._shieldT > 0 && p._shieldA != null) {
    const a = Math.min(1, p._shieldT / 0.2);
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(120,220,255,${0.9 * a})`; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.arc(sx, sy, (PLAYER.bodyRadius + 4) * s, p._shieldA - 0.9, p._shieldA + 0.9); ctx.stroke();
    ctx.restore();
  }
  const vmag  = Math.hypot(p.vx, p.vy);
  const vdir  = Math.atan2(p.vy, p.vx);

  // Ovládaný hráč: ledový kruh pod bruslařem (návrh UI: fokus #7FD4FF) — ať se v hloučku neztratíš
  if (p._isLocal) {
    ctx.save();
    ctx.beginPath(); ctx.arc(sx, sy, r + 9 * s, 0, Math.PI * 2);
    // rychlá hra: tým ukazuje kotouč pod hráčem → vlastní hráč jen bílý kroužek (modrý by vypadal jako modrý tým)
    // tenká linka bez výplně vně dosahu bruslí (výplň + 2,5 px přebarvovala nohy); rychlá hra: nic — označí tě štítek v barvě týmu
    if (!p.teamMark) { ctx.beginPath(); ctx.arc(sx, sy, r + 12 * s, 0, Math.PI * 2); ctx.lineWidth = 1.2 * s; ctx.strokeStyle = 'rgba(127,212,255,0.7)'; ctx.stroke(); }
    ctx.restore();
  }

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

  // ── Hockey stop: Space brake trigger + jednoduché bílé sprejové tečky ─────────
  {
    const _dtHS  = _rdt(cam);

    const _spd2 = Math.hypot(p.vx ?? 0, p.vy ?? 0);
    // uložit směr dokud jedeme; během stopu ZMRAZIT — stop v2 končí odrazem zpět a přepsal by směr (brusle pak skončily za zády)
    // … i během DOJEZDU pózy (_stopK3 > 0): po obratu by se směr otočil o 180° uprostřed pózy → záklon a brusle přeskočily (skate_stop_metrics S3/S4)
    if (_spd2 > 30 && !((p._stopFx ?? 0) > 0) && !((p._stopK3 ?? 0) > 0)) p._hsDir = Math.atan2(p.vy ?? 0, p.vx ?? 0);

    const _prevS = p._prevRSpd ?? _spd2;
    p._prevRSpd  = _spd2;
    if ((p._stopCd ?? 0) > 0) p._stopCd -= _dtHS;
    if ((p._stopFx ?? 0) > 0) p._stopFx -= _dtHS;

    const _spaceNow  = !!(p.input?.keys?.Space);
    const _spaceEdge = _spaceNow && !(p._prevSpace ?? false);
    p._prevSpace = _spaceNow;
    const _canFire = !((p._stopCd ?? 0) > 0);

    // brzda: Space (lokální hráč) NEBO prudké zpomalení (> 450 px/s² — vidí i ostatní hráči online / boti)
    // ZVUK BRZDY (2026-11-12, scripts/brake_sound_probe.mjs): vlastní hráč vždy; cizí/boti jen tvrdý stop (> 1500 px/s² z > 160 px/s),
    // globálně max 1× za 1,2 s a tišeji — dřív každé zpomalení > 450 px/s² u všech = 66 skřípnutí/min v zápase botů, teď 3,5/min
    const _decel = (_prevS - _spd2) / _dtHS, _mine = !!p._isLocal;
    const _hardOther = !_mine && _decel > 1500 && _prevS > 160;
    if ((_spaceEdge || (_mine ? _decel > 450 : _hardOther)) && _spd2 > 35 && _canFire) {
      p._stopN = (p._stopN || 0) + 1;
      const _dir = _spd2 > 30 ? Math.atan2(p.vy ?? 0, p.vx ?? 0) : (p._hsDir ?? 0);   // (_spd2 > 35 tady platí vždy)
      const _spd = _prevS;
      p._stopFx  = 0.55 + Math.min(1, (_spd - 35) / 145) * 0.35;  // 0.55–0.90s dle rychlosti
      p._hsDir = _dir;   // nový stop během dojezdu předchozího: směr podle současné jízdy (ne zmrazený starý)
      p._stopCd  = 1.0;
      // Spawn 20 bílých šupinek dopředu v úzkém fanu ±45°
      p._stopPts = [];
      for (let i = 0; i < 20; i++) {
        const _a = _dir + (_hrand(p.id, p._stopN, i * 3) - 0.5) * 1.57;
        const _v = 55 + _hrand(p.id, p._stopN, i * 3 + 1) * _spd * 0.6;
        p._stopPts.push({ x: p.x, y: p.y, vx: Math.cos(_a) * _v, vy: Math.sin(_a) * _v,
                          life: 0.15 + _hrand(p.id, p._stopN, i * 3 + 2) * 0.15, maxL: 0.30 });
      }
      const _now = (typeof performance !== 'undefined') ? performance.now() : 0;
      if (_mine) SFX.iceStop(_spd); else if (_now - _brakeSfxAt > 1200) { _brakeSfxAt = _now; SFX.iceStop(_spd, 0.45); }
    }

    if (p._stopPts?.length) {
      for (const pt of p._stopPts) {
        pt.x += pt.vx * _dtHS; pt.y += pt.vy * _dtHS;
        pt.vx *= 0.88; pt.vy *= 0.88;  // vzdušný odpor
        pt.life -= _dtHS;
        if (pt.life <= 0) continue;
        const _al = (pt.life / pt.maxL) * 0.85;
        ctx.beginPath();
        ctx.arc(ox + pt.x * s, oy + pt.y * s, Math.max(1, r * 0.30), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${_al.toFixed(2)})`;
        ctx.fill();
      }
      p._stopPts = p._stopPts.filter(pt => pt.life > 0);
    }

    // Smooth foot-blend přechod do stopu (sdílená čistá funkce skateStopBlend)
    p._stopTSmooth = skateStopBlend(p._stopTSmooth ?? 0, (p._stopFx ?? 0) > 0, _dtHS);
    p._stopK3 = skateStopDrive(p, _spd2, _spaceNow, _dtHS);   // K3: póza jen při skutečném brzdění (dřív pevný časovač 0,55–0,9 s, viz skateStopDrive)
    if (!p._stopTSmooth && !p._stopK3) p._hsDir = null;   // vyčisti uložený směr
    p._hsSig = skateStopSig(p._hsSig, p._stopK3, p._hsDir != null ? angleDiff(p._hsDir, p.bodyAngle) : 0, p.handed ?? 1);   // stopV 3: strana špiček zvolená na začátku pózy
  }

  // ── Hokejista (top-down) — orientovaný podle facingu (bodyAngle) ──
  const ba   = p.bodyAngle;
  const fcos = Math.cos(ba), fsin = Math.sin(ba);

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ba); // lokálně: +x dopředu (facing), +y doprava
  // Náklon těla do zatáčky — v lokálním Y (= bok hráče)
  ctx.translate(0, (p._lean ?? 0) * r * 0.15);

  // ── Brusle: póza ze sdílené čisté funkce skatePose (fáze podle UJETÉ DRÁHY → stejná dráha = stejná póza; viz SKATE_K3 výš)
  const _spd = Math.hypot(p.vx ?? 0, p.vy ?? 0);
  const _k = VIS.k | 0;
  const _mLoc = _spd > 8 ? angleDiff(Math.atan2(p.vy ?? 0, p.vx ?? 0), ba) : 0;   // směr pohybu vůči tělu
  skateAdvance(p, p.x, p.y, ba, _spd, _k, _mLoc, _rdt(cam));
  const _pose = skatePose({ k: _k, phase: p._skatePhase ?? 0, spd: _spd, mLoc: _k >= 3 ? p._mLocS : _mLoc, stopT: (_k >= 3 ? p._stopK3 : p._stopTSmooth) ?? 0,
    stopLoc: p._hsDir != null ? angleDiff(p._hsDir, ba) : 0, rotSf: p._rotSf ?? 0, lean: p._lean ?? 0, hs: p.handed ?? 1, thr: p._thr ?? 0, bwS: p._bwS, bwV: p._bwV, lbS: p._lbS, hsSig: p._hsSig, stopDn: _k >= 3 && !!p._sdDn });

  if (_k === 4) skateFeetSmooth(p, _pose.feet, _rdt(cam), ba, null, null, true); else if (_k === 3 || _k === 5) { p._plant5 = _k === 5; if (SKATE_K3.plant || VIS.n || _k === 5) skateFeetSmooth(p, _pose.feet, _rdt(cam), ba, p.x, p.y); else skateFeetSmooth(p, _pose.feet, _rdt(cam)); }   // K3: ukotvení k ledu (plant)
  if (globalThis.__fhSkateDbg) p._dbgPose = { feet: _pose.feet.map(f => ({ ...f })), stopT: (_k >= 3 ? p._stopK3 : p._stopTSmooth) ?? 0, stopLoc: p._hsDir != null ? angleDiff(p._hsDir, ba) : null };   // scripts/skate_visibility.py
  _kickFoot(p, _pose.feet, ba);   // Q: brusle zastaví puk / máchne naprázdno (časová osa ze simulace)
  // CROSSCHECK PLYNULE (2026-11-14, Ondřej: „crosscheck by neměl být sekavá animace"): přepnutí hůl ↔ crosscheck se prolne za CC_BLEND s
  // (hodiny kresby _rdt → deterministické; hladký náběh smoothstep). _ccE = 0 běžné držení, 1 crosscheck; hůl, ruce i tělo se míchají
  // mezi oběma pózami (scripts/crosscheck_anim_metrics.mjs C1–C6). Jen kresba — simulace crosschecku beze změny.
  const _ccT = globalThis.__fhCcT ?? CC_BLEND;
  p._ccB = _ccT > 0 ? clamp((p._ccB ?? 0) + (p.crossCheck ? 1 : -1) * _rdt(cam) / _ccT, 0, 1) : (p.crossCheck ? 1 : 0);
  const _ccE = p._ccB * p._ccB * (3 - 2 * p._ccB), _ccN = 1 - _ccE;
  // úhel hole při přechodu: sim _stickDisp se po přepnutí stáčí exponenciálně (26/s → první snímek ~35 % cesty = cuk) → kresba ho
  // od přepnutí převezme hladce (smoothstep za CC_BLEND s) z úhlu, který byl vidět; po dojetí přesně _stickDisp (cílová póza beze změny)
  if (p._ccOn === undefined) { p._ccOn = p.crossCheck; p._ccU = 1; }
  if (p._ccOn !== p.crossCheck) { p._ccOn = p.crossCheck; p._ccA0 = p._ccA ?? p._stickDisp; p._ccU = 0; }
  p._ccU = _ccT > 0 ? Math.min(1, (p._ccU ?? 1) + _rdt(cam) / _ccT) : 1;
  const _ccW = p._ccU * p._ccU * (3 - 2 * p._ccU);
  const _ccSd = _ccW >= 1 ? p._stickDisp : lerpAngle(p._ccA0, p._stickDisp, _ccW);
  p._ccA = _ccSd;
  const _ccFull = _ccE >= 1 && _ccW >= 1;
  // Tělo B1: pohyb horní poloviny těla (sdílená čistá funkce bodyPose; B0 = nic navíc); v crosschecku se plynule utlumí (× _ccN)
  const _bp = bodyPose(p, { b: VIS.b | 0, x: p.x, y: p.y, vx: p.vx ?? 0, vy: p.vy ?? 0, ba, aim: p.aimAngle, dcv: p._dispCharge ?? 0,
    sw: p._sw ? 1 - p._sw.t / p._sw.T : -1, hasPuck: !!p.hasPuck, hnd: p.handed ?? 1, stagT: p._stagT ?? 0, stagDir: p._stagDir ?? 1, swing: _pose.body.sw ?? 0 }, _rdt(cam));
  if (_ccE > 0) { _bp.ux *= _ccN; _bp.uy *= _ccN; _bp.tw *= _ccN; _bp.hd *= _ccN; _bp.sway *= _ccN; }
  ctx.lineCap = 'round';
  const feetW = [];   // polohy bruslí v lokálu (svět. jednotky) pro štulpny v skinBody
  for (const f of _pose.feet) {
    ctx.save();
    ctx.translate(f.x * s, f.y * s);
    ctx.rotate(f.a);
    const ls = 1 + 0.08 * (f.lift || 0);   // noha ve vzduchu: brusle o chlup větší (blíž kameře)
    ctx.scale(s * ls, s * ls); skinSkate(ctx, K);   // brusle C-d2 (skin.js), s obrysem
    ctx.restore();
    if (p._animDbg) p._animDbg.push({ side: f.side, fx: f.x * s, fy: f.y * s, fa: f.a });
    // kotník = nad botou u paty (brusle: pata −0,6 R, špička +0,55 R) → noha končí tam, ne uprostřed nože (2026-11-13, Ondřej)
    feetW.push({ x: f.x - Math.cos(f.a) * 0.32 * PLAYER.radius, y: f.y - Math.sin(f.a) * 0.32 * PLAYER.radius, side: f.side });
  }
  ctx.restore();   // konec rámce bruslí (hůl a tělo navrch: brusle → hůl/puk → tělo = pořadí y−z)

  // Cross-check: hůl držená napříč PŘED TĚLEM. Kreslí se přes vyhlazený úhel
  // _stickDisp (dojíždí k bodyAngle), takže přepnutí RMB hokejku neteleportuje.
  if (_ccFull) {
    ctx.lineCap = 'round';
    const baseDir   = p._stickDisp;            // dojíždí k bodyAngle (před tělem)
    const stickDir  = baseDir + (p.handed ?? 1) * Math.PI / 2;   // čepel na straně DOLNÍ ruky (pravák vpravo, levák vlevo)
    const sDirCos   = Math.cos(stickDir);
    const sDirSin   = Math.sin(stickDir);
    const halfLen   = PLAYER.stickLen * s * 0.7 * PLAYER.stickDraw; // kratší při crosschecku (+ vizuální zkrácení)
    // Offset center to front edge of player body, podél _stickDisp
    const fwdCos    = Math.cos(baseDir);
    const fwdSin    = Math.sin(baseDir);
    const cx        = sx + fwdCos * (r + 2 * s);
    const cy        = sy + fwdSin * (r + 2 * s);

    const gripX     = cx - sDirCos * halfLen;
    const gripY     = cy - sDirSin * halfLen;
    const bladeX    = cx + sDirCos * halfLen;
    const bladeY    = cy + sDirSin * halfLen;

    // obrys hole (C-d2): pod dříkem i čepelí
    ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 4.8 * s;
    ctx.beginPath(); ctx.moveTo(gripX, gripY); ctx.lineTo(bladeX, bladeY); ctx.stroke();
    // Grip (dark, ~35%)
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(cx - sDirCos * halfLen * 0.3, cy - sDirSin * halfLen * 0.3);
    ctx.strokeStyle = _shade(stickCol, -0.55);
    ctx.lineWidth   = 2.8 * s;
    ctx.stroke();

    // Main shaft
    ctx.beginPath();
    ctx.moveTo(cx - sDirCos * halfLen * 0.35, cy - sDirSin * halfLen * 0.35);
    ctx.lineTo(bladeX, bladeY);
    ctx.strokeStyle = stickCol;
    ctx.lineWidth   = 2.8 * s;
    ctx.stroke();

    // Blade bezier at blade end (same curve as normal stick)
    const bladeAngle = -(p.handed ?? 1) * Math.PI / 6.5;   // prohnutí dovnitř (jako normální hůl)
    const bladeL     = 12 * s * PLAYER.stickDraw;
    const bEndX  = bladeX + Math.cos(stickDir + bladeAngle) * bladeL;
    const bEndY  = bladeY + Math.sin(stickDir + bladeAngle) * bladeL;
    const bCtrlX = bladeX + Math.cos(stickDir) * bladeL * 0.55;
    const bCtrlY = bladeY + Math.sin(stickDir) * bladeL * 0.55;

    ctx.beginPath();
    ctx.moveTo(bladeX + sDirCos * 1.2 * s, bladeY + sDirSin * 1.2 * s);
    ctx.quadraticCurveTo(bCtrlX + sDirCos * 1.2 * s, bCtrlY + sDirSin * 1.2 * s,
                          bEndX  + sDirCos * 1.2 * s, bEndY  + sDirSin * 1.2 * s);
    ctx.beginPath(); ctx.moveTo(bladeX, bladeY); ctx.quadraticCurveTo(bCtrlX, bCtrlY, bEndX, bEndY);
    ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 4.8 * s; ctx.stroke();   // obrys čepele

    _drawBlade(ctx, bladeX, bladeY, bCtrlX, bCtrlY, bEndX, bEndY, tapeCol, tapeSty, 2.8 * s, bladeCol);
    if (globalThis.__fhCcDbg) p._ccSt = { butt: { x: (gripX - ox) / s, y: (gripY - oy) / s }, heel: { x: (bladeX - ox) / s, y: (bladeY - oy) / s }, end: { x: (bEndX - ox) / s, y: (bEndY - oy) / s } };
  }

  if (!_ccFull) {
  // ── Stick ──────────────────────────────────────────────────────────────
  // Vyhlazený úhel + charge → wind-up i zrušení charge jsou plynulé (bez skoku)
  // VIZUÁL STŘELY TAHEM: nápřah na FORHEND (strana rukou) a k tělu, po ráně švih + dokončení přes směr střely.
  // Jen kresba: sim úhel (_stickDisp) má nápřah 0,85 rad na druhou stranu → vrátíme ho a přidáme vizuální.
  const hnd = p.handed ?? 1, dcv = p._dispCharge ?? 0;
  let follow = 0;
  if (p._sw) { const u = 1 - p._sw.t / p._sw.T; follow = -hnd * PLAYER.followArc * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u); }
  const _rvA = VIS.r ? recvAim(p, _ccSd, _rdt(cam)) : 0;   // příjem: hůl se s předstihem natočí k průjezdu puku (RECV)
  const windAngle = p.crossCheck ? _ccSd : _ccSd + hnd * dcv * (0.85 + PLAYER.windBack) + follow + _rvA;
  p._visStick = windAngle;
  const windLen   = (p._dispReach ?? PLAYER.stickLen) * (1 - dcv * PLAYER.windPull) * PLAYER.stickDraw;
  const windCos   = Math.cos(windAngle);
  const windSin   = Math.sin(windAngle);

  // Dřík vychází z ÚCHOPU (ruce vedle těla), ne ze středu
  const grip = p.gripPoint;
  const gxw = grip.x, gyw = grip.y;
  const gx  = ox + gxw * s, gy = oy + gyw * s;

  // Display tip — clip dříku I ČEPELE proti všemu: klipuju délku dřík+čepel a pak
  // čepel odečtu zpět → ani zahnutá čepel nepřesahuje mantinel/roh/branku/hráče.
  const BLADE = 12 * PLAYER.stickDraw; // world délka čepele (vizuální zkrácení)
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
  // Cizí hokejky (vykreslený dřík): zkřížené hole se zastaví v bodě dotyku, neprolnou se
  if (p._others) for (const o of p._others) {
    if (o === p || o.crossCheck) continue;
    const q = o.gripPoint, qd = o._stickDisp, ql = (o._dispReach ?? PLAYER.stickLen) * (1 - (o._dispCharge ?? 0) * 0.30);
    wt = _clipRayStick(gxw, gyw, windCos, windSin, wt, q.x, q.y, Math.cos(qd), Math.sin(qd), ql);
  }
  wt = Math.max(0, wt - BLADE);   // stáhni zpět o čepel → čepel skončí přesně u překážky

  let tipX = ox + (gxw + windCos * wt) * s;
  let tipY = oy + (gyw + windSin * wt) * s;
  // STOPA TAHU: hráč právě vystřelil z nápřahu (puk pryč, nápřah byl nabitý) → oblouk po dráze čepele
  if (p._visHad && !p.hasPuck && (p._visDc ?? 0) > 0.15) p._sw = { a0: p._visSd, t: 0.22, T: 0.22 };
  p._visHad = p.hasPuck; p._visDc = p._dispCharge ?? 0; p._visSd = windAngle;
  if (p._sw) {
    p._sw.t -= _rdt(cam);
    if (p._sw.t <= 0) p._sw = null;
    else {
      const a = p._sw.t / p._sw.T, a0 = p._sw.a0, d = angleDiff(windAngle, a0), R = (wt + BLADE * 0.6) * s;
      ctx.save(); ctx.lineCap = 'round';
      for (const [lw, al] of [[7, 0.18], [3.5, 0.45]]) {
        ctx.beginPath(); ctx.arc(gx, gy, R, d >= 0 ? a0 : a0 + d, d >= 0 ? a0 + d : a0);
        ctx.strokeStyle = `rgba(255,255,255,${al * a})`; ctx.lineWidth = lw * s; ctx.stroke();
      }
      ctx.restore();
    }
  }
  const tipCos = windCos;
  const tipSin = windSin;

  // ── DRŽENÍ HOLE podle schématu (2026-11-09) ─────────────────────────────
  // Pravák (handed 1): hůl vpravo, HORNÍ ruka = levá u konce hole PŘED tělem, DOLNÍ ruka = pravá níž na dříku;
  // čepel prohnutá DOVNITŘ (forhend = prohnutá strana hledí dopředu k tělu), puk leží na prohnuté straně.
  // Levák zrcadlově. Jen kresba: špička/čepel = fyzikální poloha (dosah), mění se ruce, dřík, prohnutí, puk.
  // horní ruka: před tělem u středu, mírně k bekhendu; v nápřahu se stáhne k forhendovému boku; B1: houpe se v rytmu kroku (sway)
  // příjem: čepel povolí po směru puku; pas: dojede za pukem. Posune se celá čepel (ne natočí): ruce a směr dříku z neposunuté špičky
  const _rvO = VIS.r ? recvTipOffset(p, _rdt(cam)) : null;
  const tipW = { x: gxw + windCos * wt, y: gyw + windSin * wt };
  let { topW, botW } = stickHands(p.x, p.y, p.bodyAngle ?? windAngle, dcv, hnd, tipW, _bp.sway);
  let shDir = Math.atan2(tipW.y - topW.y, tipW.x - topW.x), buttW = topW;
  let gripF = 0.22, mainF = 0.18;   // podíl omotávky / začátek hlavního dříku (od konce hole)
  let SV = STICK_V[VIS.s] || STICK_V[0];
  if (_ccE > 0) {   // PŘECHOD do crosschecku: konec hole, směr a délka dříku, ruce (podíl po dříku) i tloušťky čar se míchají k póze napříč
    const G = _ccGeom(p, _ccSd), lN = Math.hypot(tipW.x - topW.x, tipW.y - topW.y), bfN = lN > 1e-6 ? Math.hypot(botW.x - topW.x, botW.y - topW.y) / lN : 0;
    const mx = (a, b) => a + (b - a) * _ccE;
    buttW = { x: mx(topW.x, G.butt.x), y: mx(topW.y, G.butt.y) };
    shDir = lerpAngle(shDir, G.dir, _ccE);
    const L = mx(lN, G.len), dc = Math.cos(shDir), ds = Math.sin(shDir), uT = mx(0, G.uT), uB = mx(bfN, G.uB);
    topW = { x: buttW.x + dc * L * uT, y: buttW.y + ds * L * uT }; botW = { x: buttW.x + dc * L * uB, y: buttW.y + ds * L * uB };
    tipX = ox + (buttW.x + dc * L) * s; tipY = oy + (buttW.y + ds * L) * s;
    gripF = mx(0.22, 0.35); mainF = mx(0.18, 0.325);
    const S0 = STICK_V[0]; SV = { ...SV, out: mx(SV.out, S0.out), sh: mx(SV.sh, S0.sh), bl: mx(SV.bl, S0.bl), blo: mx(SV.blo, S0.blo) };
  }
  if (_rvO) { tipX += _rvO.x * s; tipY += _rvO.y * s; }
  const shC = Math.cos(shDir), shS = Math.sin(shDir);
  p._visTopW = topW; p._visBotW = botW;
  const tx0 = ox + buttW.x * s, ty0 = oy + buttW.y * s;

  // ── Shaft ─────────────────────────────────────────────────────────────────
  ctx.lineCap = 'round';
  if (SV.sh2) {   // stín hole na ledu (světlo vlevo nahoře → stín vpravo dole)
    const o = 1.6 * s; ctx.strokeStyle = 'rgba(20,40,70,0.22)'; ctx.lineWidth = SV.sh * s;
    ctx.beginPath(); ctx.moveTo(tx0 + o, ty0 + o); ctx.lineTo(tipX + o, tipY + o); ctx.stroke();
  }
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = SV.out * s;   // obrys dříku (C-d2)
  ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.beginPath();   // konec hole + omotávka (od horní ruky)
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(tx0 + (tipX - tx0) * gripF, ty0 + (tipY - ty0) * gripF);
  ctx.strokeStyle = _shade(stickCol, -0.55);
  ctx.lineWidth   = SV.sh * s;
  ctx.stroke();
  ctx.beginPath();   // hlavní dřík
  ctx.moveTo(tx0 + (tipX - tx0) * mainF, ty0 + (tipY - ty0) * mainF);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = stickCol;
  ctx.lineWidth   = SV.sh * s;
  ctx.stroke();
  if (SV.hi) {   // odlesk podél dříku (na straně ke světlu)
    const nx = -(tipY - ty0), ny = tipX - tx0, nl = Math.hypot(nx, ny) || 1, k = (nx + ny < 0 ? 1 : -1) * 0.45 * s;
    ctx.beginPath(); ctx.moveTo(tx0 + (tipX - tx0) * 0.24 + nx / nl * k, ty0 + (tipY - ty0) * 0.24 + ny / nl * k);
    ctx.lineTo(tipX - (tipX - tx0) * 0.06 + nx / nl * k, tipY - (tipY - ty0) * 0.06 + ny / nl * k);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6 * s; ctx.stroke();
  }
  if (SV.knob) {   // koncovka hole u horní ruky
    ctx.beginPath(); ctx.arc(tx0, ty0, SV.out * 0.42 * s, 0, Math.PI * 2); ctx.fillStyle = _shade(stickCol, -0.6); ctx.fill();
    ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 0.9 * s; ctx.stroke();
  }

  // ── Blade ─────────────────────────────────────────────────────────────────
  const HOOK       = Math.PI / 6.5;
  const bladeDir   = shDir - hnd * HOOK;            // špička se stáčí DOVNITŘ (k forhendu)
  const bladeL     = 12 * s * PLAYER.stickDraw;

  let bStartX = tipX;
  let bStartY = tipY;
  let bEndX   = tipX + Math.cos(bladeDir) * bladeL;
  let bEndY   = tipY + Math.sin(bladeDir) * bladeL;
  let bCtrlX  = tipX + shC * bladeL * 0.55;
  let bCtrlY  = tipY + shS * bladeL * 0.55;

  // Oříznutí čepele na zadní stěnu branky (aby čepel nepronikala sítí zezadu)
  if (gyw > RINK.goalY && gyw < RINK.goalY + RINK.goalH) {
    const _bwRsc = ox + (RINK.goalLineRight + RINK.goalDepth) * s;
    const _bwLsc = ox + (RINK.goalLineLeft  - RINK.goalDepth) * s;
    if (gxw > RINK.goalLineRight + RINK.goalDepth) {
      if (bEndX  < _bwRsc) { bEndX  = _bwRsc; }
      if (bCtrlX < _bwRsc) { bCtrlX = _bwRsc; }
    } else if (gxw < RINK.goalLineLeft - RINK.goalDepth) {
      if (bEndX  > _bwLsc) { bEndX  = _bwLsc; }
      if (bCtrlX > _bwLsc) { bCtrlX = _bwLsc; }
    }
  }

  // kreslená čepel ve SVĚTĚ (bezier pata → špička, poloviční tloušťka s obrysem) — čte scripts/puck_carry_metrics.mjs
  p._visBlade = { sx: (bStartX - ox) / s, sy: (bStartY - oy) / s, cx: (bCtrlX - ox) / s, cy: (bCtrlY - oy) / s, ex: (bEndX - ox) / s, ey: (bEndY - oy) / s, hw: (SV.paddle ? 3.1 : SV.blo / 2) };
  // PUK NA ČEPELI (nese ho tento hráč): uprostřed zahnuté čepele, na straně podle _cradleSide, v nápřahu u paty (tah od paty ke špičce).
  // Kreslí se PŘED čepelí: usazený se jí jen dotýká, při přehozu forhend↔bekhend podjede POD zvednutou čepelí (bladePuck, puckSpinStep).
  const cp = p.hasPuck && p._carriedPuck && p._carriedPuck._carrier === p ? p._carriedPuck : null;
  if (cp) {
    // strana puku: forhend, dokud hůl nejde zřetelně přes tělo na bekhend (hystereze −0,25 / −0,05 rad vůči ose těla) — simulační
    // příznak forehand se překlápí už při ±0 (hůl rovně před tělem), kresba by pak puk házela přes čepel tam a zpět
    const rel = angleDiff(p.carryAngle ?? p.aimAngle, p.bodyAngle ?? 0) * hnd;
    const sT = rel < -0.25 ? -1 : rel > -0.05 ? 1 : (p._visSideT ?? 1); p._visSideT = sT;
    p._visSide = p._visSide == null ? sT : p._visSide + (sT - p._visSide) * Math.min(1, 9 * _rdt(cam));
    const q = bladePuck(p._visBlade, 0.5 - 0.3 * dcv, hnd, p._visSide, PUCK.radius);
    puckSpinStep(cp, q, p._visBlade, _rdt(cam));
    const Q = VIS.r ? recvCatch(p, cp, q, _rdt(cam)) : q;   // příjem: puk dojede z místa, kde byl vidět (RECV)
    p._visRest = q;
    p._visPuck = _kickPuck(p, { x: Q.x, y: Q.y });   // po přikopnutí puk z brusle plynule dojede na čepel
    p._kickTop = p._visPuck._kick === true;        // puk „pod nohama" je pod rukama/tělem → během dojezdu ho kreslíme navrch (čitelnost)
    if (!p._kickTop) cp.draw(ctx, cam, p._visPuck);
  } else { if (p._rvHad && VIS.r) recvRelease(p); p._visPuck = null; p._visRest = null; p._kickTop = false; }
  p._rvHad = !!cp;

  // Obrys čepele (C-d2, místo stínu)
  if (SV.sh2) { const o = 1.6 * s; ctx.beginPath(); ctx.moveTo(bStartX + o, bStartY + o); ctx.quadraticCurveTo(bCtrlX + o, bCtrlY + o, bEndX + o, bEndY + o);
    ctx.strokeStyle = 'rgba(20,40,70,0.22)'; ctx.lineWidth = SV.bl * s; ctx.lineCap = 'round'; ctx.stroke(); }
  if (!SV.paddle) {
  ctx.beginPath();
  ctx.moveTo(bStartX, bStartY);
  ctx.quadraticCurveTo(bCtrlX, bCtrlY, bEndX, bEndY);
  ctx.strokeStyle = SKIN_OUT;
  ctx.lineWidth   = SV.blo * s;
  ctx.lineCap     = 'round';
  ctx.stroke();
  }

  // Blade face (tape) — barva + styl tapování
  if (SV.paddle) {   // S2: lopatka — šířka od paty (5,2) ke špičce (3,6), zaoblená špička, jeden obrys
    const N = 10, L = [], Rr = [];
    for (let i = 0; i <= N; i++) { const t = i / N, [qx, qy] = _bezPt(bStartX, bStartY, bCtrlX, bCtrlY, bEndX, bEndY, t);
      const [ax, ay] = _bezPt(bStartX, bStartY, bCtrlX, bCtrlY, bEndX, bEndY, Math.min(1, t + 0.02)), [bx2, by2] = _bezPt(bStartX, bStartY, bCtrlX, bCtrlY, bEndX, bEndY, Math.max(0, t - 0.02));
      const tx = ax - bx2, ty = ay - by2, tl = Math.hypot(tx, ty) || 1, hw = (5.2 - 1.6 * t) * s / 2;
      L.push([qx - ty / tl * hw, qy + tx / tl * hw]); Rr.push([qx + ty / tl * hw, qy - tx / tl * hw]); }
    const blade = new Path2D(); blade.moveTo(L[0][0], L[0][1]); for (const q of L) blade.lineTo(q[0], q[1]);
    const e = L[N], f = Rr[N]; blade.quadraticCurveTo(bEndX + (bEndX - bCtrlX) * 0.25, bEndY + (bEndY - bCtrlY) * 0.25, f[0], f[1]);
    for (let i = N; i >= 0; i--) blade.lineTo(Rr[i][0], Rr[i][1]); blade.closePath();
    ctx.lineJoin = 'round'; ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 1.8 * s; ctx.stroke(blade);
    ctx.fillStyle = tapeSty === 'full' || !tapeSty ? tapeCol : bladeCol; ctx.fill(blade);
    if (tapeSty && tapeSty !== 'full') { ctx.save(); ctx.clip(blade); _drawBlade(ctx, bStartX, bStartY, bCtrlX, bCtrlY, bEndX, bEndY, tapeCol, tapeSty, 5.2 * s, bladeCol); ctx.restore(); }
  } else
  _drawBlade(ctx, bStartX, bStartY, bCtrlX, bCtrlY, bEndX, bEndY, tapeCol, tapeSty, SV.bl * s, bladeCol);
  if (globalThis.__fhCcDbg) p._ccSt = { butt: buttW, heel: { x: (tipX - ox) / s, y: (tipY - oy) / s }, end: { x: (bEndX - ox) / s, y: (bEndY - oy) / s } };
  } // end běžná hůl / přechod do crosschecku

  // ── TĚLO C-d2 (skin.js): jedna sjednocená cesta, obrys jednou, jedno stínování; ruce z držení hole ──
  {
    let topH, botH;
    if (_ccFull) {
      const baseDir = p._stickDisp, stickDir = baseDir + (p.handed ?? 1) * Math.PI / 2;
      const sc = Math.cos(stickDir), ss = Math.sin(stickDir), half = PLAYER.stickLen * 0.7;
      const cxW = p.x + Math.cos(baseDir) * (PLAYER.radius + 2), cyW = p.y + Math.sin(baseDir) * (PLAYER.radius + 2);
      topH = { x: cxW - sc * half * 0.62, y: cyW - ss * half * 0.62 };
      botH = { x: cxW + sc * half * 0.42, y: cyW + ss * half * 0.42 };
    } else if (p._visTopW && p._visBotW) { topH = p._visTopW; botH = p._visBotW; }
    else { const gp = p.gripPoint; topH = { x: p.x + fcos * PLAYER.radius * 0.5, y: p.y + fsin * PLAYER.radius * 0.5 }; botH = { x: gp.x, y: gp.y }; }
    const leanW = (p._lean ?? 0) * PLAYER.radius * 0.15;
    const bo = _ccFull ? { x: 0, y: 0, tw: 0 } : _ccE > 0 ? { x: (_pose.body.x ?? 0) * _ccN, y: (_pose.body.y ?? 0) * _ccN, tw: (_pose.body.tw ?? 0) * _ccN } : _pose.body;   // přenos váhy (K1–K3; v crosschecku plynule pryč); ruce zůstanou na holi → odečti posun
    const toL = h => { const dx = h.x - p.x, dy = h.y - p.y; return { x: dx * fcos + dy * fsin - bo.x, y: -dx * fsin + dy * fcos - leanW - bo.y }; };
    const llx = Math.cos(-ba) * -0.7 - Math.sin(-ba) * -0.7, lly = Math.sin(-ba) * -0.7 + Math.cos(-ba) * -0.7;   // světlo vlevo nahoře, pevné ve světě
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ba); ctx.translate(bo.x * s, (leanW + bo.y) * s); ctx.scale(s, s);
    K.headV = VIS.h;
    // DRES V RYCHLOSTI (2026-11-13): zadní lem se táhne proti jízdě a vlaje v rytmu kroku (fáze z ujeté dráhy → deterministické)
    const _jk = Math.max(0, Math.min(1, (_spd / PLAYER.speed - 0.35) / 0.65)), _jm = _k >= 3 ? (p._mLocS ?? _mLoc) : _mLoc;   // trup se v skinBody neotáčí o tw → směr vůči trupu = mLoc
    const _jd = _jk > 0 && VIS.b ? { mx: Math.cos(_jm), my: Math.sin(_jm), k: _jk, fl: _k === 4 ? 0 : Math.sin(2 * (p._skatePhase ?? 0)) } : null;   // K4: lem se jen táhne, nekmitá
    const _B = { kv: VIS.w, feet: feetW.map(f => ({ x: f.x - bo.x, y: f.y - bo.y, side: f.side })), top: toL(topH), bot: toL(botH), hnd: p.handed ?? 1, tw: bo.tw + _bp.tw + (_pose.body.twT || 0), twT: _pose.body.twT || 0, ux: _bp.ux, uy: _bp.uy, hd: _bp.hd, hh: _pose.body.hh ?? _pose.body.h ?? 0, lx: llx, ly: lly, jd: _jd };
    skinBody(ctx, _B, K);
    ctx.restore();
    if (globalThis.__fhCcDbg) p._ccDbg = { e: _ccE, b: p._ccB, ...p._ccSt, B: _B, bx: bo.x, by: leanW + bo.y };   // scripts/crosscheck_anim_metrics.mjs
  }


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

  if (p._isLocal) _drawPickupAid(ctx, p, cam);
  if (p._isLocal && p._puckView) {   // nápověda přikopnutí (Q): odznak u puku, zelený v okně
    const dw = p.deflectWindow(p._puckView), w = dw >= 0 ? dw : p.kickWindow(p._puckView);   // teč (rána spoluhráče u branky) má přednost
    if (w >= 0) { const s = cam.scale, P = p._puckView, x = cam.ox + P.x * s, y = cam.oy + (P.y - 9) * s, on = w === 1;
      ctx.save(); ctx.font = `800 ${6.5 * s}px 'Segoe UI', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.beginPath(); ctx.roundRect(x - 4.2 * s, y - 4.2 * s, 8.4 * s, 8.4 * s, 2 * s);
      ctx.fillStyle = on ? 'rgba(60,200,110,0.95)' : 'rgba(20,30,50,0.75)'; ctx.fill(); ctx.strokeStyle = on ? '#e9fff1' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.8 * s; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText('Q', x, y + 0.3 * s); ctx.restore(); }
  }
  if (p._kickTop && p._visPuck && p._carriedPuck) p._carriedPuck.draw(ctx, cam, p._visPuck);   // přikopnutý puk navrch (viz _kickPuck)
  if (p._kickFx > 0 && p._kickOx != null) {   // přikopnutí: ledová tříšť od brusle (deterministicky z pořadí kopu)
    const s = cam.scale, e = KICK_FX - p._kickFx, u = clamp(e / 0.22, 0, 1), cx = cam.ox + (p.x + p._kickOx) * s, cy = cam.oy + (p.y + p._kickOy) * s;
    const a0 = Math.atan2(-p._kickOy, -p._kickOx), n = p._kickN || 0;   // tříšť letí od těla (puk přijel zvenku)
    if (u < 1) { ctx.save(); ctx.fillStyle = `rgba(235,245,255,${0.9 * (1 - u)})`;
      for (let i = 0; i < 6; i++) { const h = ((n * 7 + i * 13) % 10) / 10, a = a0 + Math.PI + (i - 2.5) * 0.38 + (h - 0.5) * 0.2, L = (3 + 7 * u) * (0.7 + 0.5 * h);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * L * s, cy + Math.sin(a) * L * s, (1.3 - 0.6 * u) * s, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore(); }
  }
  if (p._kickFx > 0) {   // úspěšné přikopnutí: krátký záblesk u brusle
    const s = cam.scale, a = p._kickFx / KICK_FX; ctx.save(); ctx.beginPath(); ctx.arc(cam.ox + p.x * s, cam.oy + p.y * s, (PLAYER.radius + 4 + 6 * (1 - a)) * s, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(60,200,110,${a})`; ctx.lineWidth = 2 * s * a; ctx.stroke(); ctx.restore(); }

  if (p._deflFx > 0) {   // teč na Q: záblesk u čepele
    const s = cam.scale, a = p._deflFx / 0.3, t = p.stickTip; ctx.save(); ctx.beginPath(); ctx.arc(cam.ox + t.x * s, cam.oy + t.y * s, (5 + 7 * (1 - a)) * s, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,214,70,${a})`; ctx.lineWidth = 2 * s * a; ctx.stroke(); ctx.restore(); }

  // Charge arc — jen vlastní hráč (ostatní vidí nabíjení jako nápřah hole, ne ukazatel)
  if (p.charge > 0.05 && p._isLocal) {
    // Plné nabití (charge ≥ 0.99, i ze snapshotu) = okno PŘESNÉ rány → zelený pulzující kruh: TEĎ pusť
    const perfect = p.charge >= 0.99;
    const pulse = 0.65 + 0.35 * Math.sin(_rt(cam) * 1000 / 45);
    ctx.beginPath();
    ctx.arc(sx, sy, r + 5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
    ctx.strokeStyle = perfect
      ? `rgba(24, 200, 90, ${pulse})`
      : `rgba(255, ${220 - p.charge * 200}, 0, 0.85)`;
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Ovládaný hráč: štítek se jménem a šipkou dolů (návrh UI) místo prostého jména
  if (p._isLocal) {
    const label = (p.name || 'TY').toUpperCase();
    ctx.font = `italic 800 ${Math.round(10 * s)}px 'Barlow Condensed', 'Segoe UI', sans-serif`;
    const tw = ctx.measureText(label).width, ph = 16 * s, pw = tw + 10 * s;   // výška i s diakritikou (Á, Č)
    const by = sy - r - 9 * s - 6 * s - ph;          // nad kruhem
    ctx.fillStyle = p.teamMark || '#1F4FD8';   // rychlá hra: štítek v barvě týmu
    ctx.fillRect(sx - pw / 2, by, pw, ph);
    ctx.beginPath(); ctx.moveTo(sx - 4 * s, by + ph); ctx.lineTo(sx + 4 * s, by + ph); ctx.lineTo(sx, by + ph + 5 * s); ctx.closePath(); ctx.fill();
    drawTextCached(ctx, label, ctx.font, 'center', 'middle', sx, by + ph / 2 + 1.5 * s, '#fff', null, 0);   // text z keše (výkon)
    if (p.founder) _drawCrown(ctx, sx - pw / 2 - 9 * s, by + ph / 2, 7.5 * s);   // korunka vlevo od štítku
  } else
  // Jméno nad hráčem — v barvě týmu, jemný obrys pro čitelnost (tenké)
  if (p.name) {
    ctx.font = `${Math.round(9.5 * s)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const ny = sy - r - 7 * s;
    drawTextCached(ctx, p.name, ctx.font, 'center', 'alphabetic', sx, ny, p.teamMark || color, 'rgba(0,0,0,0.5)', 1.4 * s);   // rychlá hra: jméno v barvě týmu; text z keše (výkon)
    if (p.founder) _drawCrown(ctx, sx - ctx.measureText(p.name).width / 2 - 8 * s, ny - 3 * s, 7 * s);   // korunka vlevo od jména
    ctx.textAlign = 'left';
  }
}

// Malá vektorová korunka (titul Founder) — jantarová, 3 hroty. (x,y) = levý střed, w = šířka.
function _drawCrown(ctx, x, y, w) {
  const h = w * 0.78, topY = y - h / 2, baseY = y + h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, topY + h * 0.18);
  ctx.lineTo(x + w * 0.25, topY + h * 0.52);
  ctx.lineTo(x + w * 0.5, topY);
  ctx.lineTo(x + w * 0.75, topY + h * 0.52);
  ctx.lineTo(x + w, topY + h * 0.18);
  ctx.lineTo(x + w, baseY);
  ctx.closePath();
  ctx.fillStyle = '#FFB020';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.6, w * 0.08);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

// Zkrať paprsek hole tak, aby nevjel do kruhu (hráč/gólman) — vrátí nové tMax
const _env = k => (typeof process !== 'undefined' && process.env) ? process.env[k] : undefined;   // jen měření v Node
const _STK_BODY = _env('FH_STKBODY') !== '0', _STK_STICK = _env('FH_STKSTICK') !== '0', _STK_BODY_PAD = Number(_env('FH_STKPAD') || 0), _STK_MODE = _env('FH_STKMODE') || 'nopuck';   // nopuck: o těla se zastaví hokejka hráče BEZ puku (bránění, nastavené tělo). 'all' kope home_away mimo rubriku (1.93), změřeno test:balance
// Paprsek (hokejka) vs. DŘÍK cizí hokejky (úsečka z úchopu, bez posledních 5 px = čepel → čepele se smí potkat
// kvůli vypíchnutí puku). Vrací zkrácené tMax. Každý hráč se ořízne jen o SUROVÝ dřík druhého → pořadí nehraje roli.
function _clipRayStick(px, py, cos, sin, tMax, qx, qy, qc, qs, qLen) {
  const den = cos * qs - sin * qc;
  if (Math.abs(den) < 1e-9) return tMax;
  const dx = qx - px, dy = qy - py;
  const t = (dx * qs - dy * qc) / den, u = (dx * sin - dy * cos) / den;
  return (t > 2 && t < tMax && u > 0 && u < qLen - 5) ? t : tMax;
}

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

// Bod na kvadratické bézier křivce v parametru t
function _bezPt(x0, y0, cx, cy, x1, y1, t) {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}
// Čepel hokejky se stylem tapování: full (celá), toe (špička), heel (pata), candy (pruhy)
function _drawBlade(ctx, x0, y0, cx, cy, x1, y1, tape, style, lw, bare = '#15171c') {
  ctx.lineCap = 'round';
  if (!style || style === 'full') {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.strokeStyle = tape; ctx.lineWidth = lw; ctx.stroke();
    return;
  }
  const N = 9; ctx.lineWidth = lw;
  const col = t => style === 'toe'   ? (t > 0.5 ? tape : bare)
                 : style === 'heel'  ? (t < 0.5 ? tape : bare)
                 : style === 'candy' ? ((Math.floor(t * 6) % 2 === 0) ? tape : '#f4f7fb')
                 : tape;
  let [px, py] = _bezPt(x0, y0, cx, cy, x1, y1, 0);
  for (let i = 1; i <= N; i++) {
    const t = i / N, [qx, qy] = _bezPt(x0, y0, cx, cy, x1, y1, t);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy);
    ctx.strokeStyle = col((i - 0.5) / N); ctx.stroke();
    px = qx; py = qy;
  }
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


// ---------- Pohyb v2 (scripts/movement_feel.mjs --sweep, vítěz sw41: 16/19 rubriky, původní 12/19) ----------
// Výbušný 1. krok (320 px/s² ze stání → 180 u topu), hokejový stop (po tvrdé brzdě z rychlosti 0,45 s × 2 akcelerace
// + pod 30 px/s odraz rovnou do směru vstupu), crossover v mírném oblouku (top × 1,08 na 0,5 s), ostrý cut stojí tempo (k 4; s plynulými boty bez puku: 3v3 k4 4,7 gólu / k6 neprošlo / k8 4,37 — balance je šumivá).
// Obal kolem PlayerBase._move → server i klient (sdílený soubor) počítají stejně; deterministické (jen stav entity + dt).
const _mvEnv = (k, d) => (typeof process !== "undefined" && process.env?.[k] != null) ? +process.env[k] : d;
const MV = { acurve: [320, 180], stopgo: { k: 2, t: 0.45, pivot: 30 }, carve: { lo: 0.12, hi: 0.75, k: 1.08, hold: 0.5 }, cut: _mvEnv("FH_MVCUT", 4) };
const _baseMove = PlayerBase.prototype._move;
const MV_OFF = _mvEnv("FH_MV", 1) === 0;
PlayerBase.prototype._move = function (input, dt) {
  if (Math.max(0, (this._downT || 0) - dt) > 0) input = _NO_INPUT;   // rozplácnutý: stejný test jako v _baseMove (vstup nesmí projít ani sem)
  if (MV_OFF) return _baseMove.call(this, input, dt);
  const accel0 = PLAYER.accel, speed0 = PLAYER.speed;
  const sp = Math.hypot(this.vx, this.vy), top = speed0;
  let acc = MV.acurve[0] + (MV.acurve[1] - MV.acurve[0]) * clamp(sp / top, 0, 1), spd = speed0;
  const braking = !!(input.keys && input.keys.Space), il = Math.hypot(input.dx || 0, input.dy || 0);
  if (braking && sp > 0.5 * top) this._sgArm = true;
  if (!braking && this._sgArm) { this._sgArm = false; this._sgT = MV.stopgo.t; }
  if (this._sgT > 0) {
    acc *= MV.stopgo.k; this._sgT -= dt;
    if (il > 0.01 && sp < MV.stopgo.pivot) { const a = Math.atan2(input.dy, input.dx); this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp; }
  }
  if (il > 0.01 && sp > 0.7 * top) {
    const dA = Math.abs(angleDiff(Math.atan2(input.dy, input.dx), Math.atan2(this.vy, this.vx)));
    if (dA >= MV.carve.lo && dA <= MV.carve.hi) this._cvT = MV.carve.hold;
  }
  if (this._cvT > 0) { spd *= MV.carve.k; this._cvT -= dt; }
  let cutX = 0;
  if (!braking && il > 0.01 && sp > 20)
    cutX = clamp((Math.abs(angleDiff(Math.atan2(input.dy, input.dx), Math.atan2(this.vy, this.vx))) - 0.8) / (Math.PI - 0.8), 0, 1);
  PLAYER.accel = acc; PLAYER.speed = spd;
  try { _baseMove.call(this, input, dt); } finally { PLAYER.accel = accel0; PLAYER.speed = speed0; }
  if (cutX > 0) { const f = 1 - MV.cut * cutX * dt; this.vx *= f; this.vy *= f; }
};
