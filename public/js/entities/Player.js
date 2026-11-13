import { RINK, PLAYER, PUCK } from '../constants.js';
import { clamp, lerpAngle, angleDiff } from '../utils.js';
import { SFX } from '../sound.js';
import { defaultRng } from '../rng.js';
import { skaterKit, skinSkate, skinBody, SKIN_OUT, shade, luma } from './skin.js';
import { VIS } from '../vis.js';
import { downPose, drawDownBody } from './downBody.js';

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

  // ── PŘIKOPNUTÍ (Q, 2026-11-12): volný puk na ledě do KICK_R px od těla, blížící se → zpracuješ bruslí a jedeš dál,
  // i když je rychlý (hokejkou čistě jen do 420 px/s). Mimo okno: KICK_CD s nic. Čerstvou ránu soupeře nejde (jako hokejkou).
  kickWindow(puck) {
    if (this.hasPuck || this.isDown || !puck || puck.isAirborne || puck.z > 1.5 || puck.faceoffTimer > 0) return -1;
    if (puck._carrier && puck._carrier.hasPuck) return -1;
    if (puck._shot && puck._shot.team !== this.team && (puck._shotAge ?? 9) < SHOT_EAT_T) return -1;
    const dx = puck.x - this.x, dy = puck.y - this.y, d = Math.hypot(dx, dy);
    const closing = -((puck.vx - this.vx) * dx + (puck.vy - this.vy) * dy) / (d || 1);   // rychlost přibližování (px/s)
    if (d <= KICK_R && (closing > -KICK_PASS || d < 12)) return 1;   // v okně (i puk, který tě právě minul — brusle za puk)
    if (d <= KICK_SOON && closing > 60) return 0;             // okno se blíží (nápověda)
    return -1;
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
    if ((this._kickCd || 0) > 0) return false;
    const w = this.kickWindow(puck);
    if (w === 0) { this._kickQ = KICK_BUF; return false; }   // o chvilku dřív: stisk podržíme, než puk do okna dojede
    if (w !== 1) { this._kickCd = KICK_CD; return false; }
    return this._doKick(puck);
  }
  _doKick(puck) {
    this._kickQ = 0;
    puck._passTo = null; this._grabPuck(); puck._carrier = this;
    this._kickFx = 0.35; this._kickN = (this._kickN || 0) + 1;
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
    const rate = baseRate * (1.4 - 0.4 * manoeuvrability) * dt;  // blízko = rychlejší rotace hole
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
    const bodyLerpRate = this._stagT > 0 ? 2.5 : rising ? 6 : crossChecking ? 9 : 14;   // otřesený hráč se srovnává pomalu
    const _prevSkateAngle = this.skateAngle;
    this.skateAngle = lerpAngle(this.skateAngle, targetBodyAngle, Math.min(1, bodyLerpRate * dt));
    // Zakolísání: tělo se po zásahu stočí po směru úderu (oblouk stagSpin rad, plynule zpět)
    if (this._stagT > 0) this.skateAngle += this._stagDir * 2 * PLAYER.stagSpin / PLAYER.stagT * (this._stagT / PLAYER.stagT) * dt;   // lineárně doznívá, celkem stagSpin rad
    this.bodyAngle  = this.skateAngle;


    // Náklon do oblouku (vizuál)
    const leanTarget = hasInput
      ? clamp(angleDiff(Math.atan2(iy, ix), this.skateAngle) * 1.3, -1, 1) * Math.min(1, sp2 / 130)
      : 0;
    this._lean += (leanTarget - this._lean) * Math.min(1, 8 * dt);

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
    if (this._deflQ > 0) { const pk = world?.puck; this._deflHeld = (this._deflHeld || 0) + dt; const w = pk ? this.deflectWindow(pk) : -1;
      if (w === 1) this._doDeflect(pk); else if ((this._deflQ -= dt) <= 0 || w < 0) { this._deflQ = 0; this._kickCd = KICK_CD; } }
    if (this._deflFx > 0) this._deflFx -= dt;
    if (this._passCooldown  > 0) this._passCooldown  -= dt;
    if (this._deflectCool   > 0) this._deflectCool   -= dt;
    // Hůl relativně k tělu (kužel) + forehand dle handedness
    this._updateStick(dt);
    if (this.passReq > 0) this.passReq = Math.max(0, this.passReq - dt);
    this.crossCheck = !!this.input.rmb && !this.hasPuck && this._passCooldown <= 0 && !this.isDown;
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
const KICK_R = 26, KICK_SOON = 70, KICK_CD = 0.4, KICK_BUF = 0.15, KICK_PASS = 260;   // + podržení stisku (s), puk po průjezdu (px/s od tebe)   // přikopnutí (Q): okno px od těla, nápověda od px, zámek po minutí (s)   // s, px/s — viz canPickup (čerstvá rána soupeře)
let _brakeSfxAt = -1e9;   // globální omezovač zvuku brzdy cizích hráčů (jen kresba/zvuk, ne simulace)
const STICK_V = [
  { out: 4.8, sh: 2.8, bl: 2.8, blo: 4.8 },
  { out: 3.4, sh: 1.8, bl: 3.8, blo: 5.4, knob: 1 },
  { out: 3.6, sh: 2.0, bl: 4.2, blo: 5.8, knob: 1, hi: 1, sh2: 1, paddle: 1 },   // paddle = čepel jako plochá lopatka (vyplněný tvar)
  { out: 4.1, sh: 2.4, bl: 2.5, blo: 4.3 },   // S3 = dnešní, lehce štíhlejší (~15 %) — výchozí od 2026-11-12
];
const SKATE_CYCLE = 95;   // K0–K2: px ujeté dráhy na celý cyklus kroku (2 odrazy) — 165 px/s ≈ 1,7 cyklu/s

// ══ ANIMACE BRUSLENÍ — čisté funkce (bez canvasu, bez hodin): volá je draw() i scripts/skate_anim_metrics.mjs ══
// K3 (výchozí od 2026-11-12): fáze kroku podle UJETÉ DRÁHY; délka cyklu roste s rychlostí (pomalu kratší krůčky).
// Odrazová noha je na ledě a ostří míří VŽDY po její dráze vůči ledu → brusle se po ledě nesmýká do boku (jen klouže po ostří),
// pak se zvedne (návrat vzduchem, brusle o chlup větší), přistane pod boky a klouže, dokud se neodrazí.
// Do strany se boky (a brusle) natočí ke směru jízdy (max SKATE_K3.hip rad), ramena s holí zůstanou na míření; couvání = C-cuty.
export const SKATE_K3 = { cyc0: 60, cycV: 0.26, push: 0.36, land: 0.80, hip: 1.25 };
export const skateCycle = (k, v) => k === 3 ? SKATE_K3.cyc0 + SKATE_K3.cycV * Math.min(200, v) : SKATE_CYCLE;
const _ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _wrap1 = u => u - Math.floor(u);
// posun fáze po jednom snímku: st = { _skatePhase, _animPrev, _rotSf } (mutuje); poloha a úhel těla ve světě
export function skateAdvance(st, x, y, ba, spd, k, mLoc = 0, dt = 1 / 60) {
  const pv = st._animPrev, sf = Math.min(1, spd / 160);
  // K3: směr jízdy vůči tělu vyhlazený v čase (boky se natáčejí plynule i při švihu myší) → st._mLocS
  st._mLocS = st._mLocS == null ? mLoc : angleDiff(lerpAngle(st._mLocS, mLoc, Math.min(1, 6 * dt)), 0);
  if (pv) {
    const dd = Math.min(30, Math.hypot(x - pv.x, y - pv.y));             // teleport (buly) nepočítej
    const dr = Math.abs(angleDiff(ba, pv.ba));
    const rotK = k === 3 ? 1.6 * (1 - sf) : 1.6;                          // K3: otáčení přidá krok jen v pomalé jízdě (pivot)
    st._skatePhase = ((st._skatePhase ?? 0) + dd / skateCycle(k, spd) * Math.PI * 2 + Math.min(0.6, dr) * rotK) % (Math.PI * 2);
    st._rotSf = Math.min(1, dr / 0.12) * (1 - sf);                        // otáčení na místě → pivot kroky
  }
  st._animPrev = { x, y, ba };
}
// vyhlazení přechodu do hokejového stopu (dřív přímo v draw)
export function skateStopBlend(prev, active, dt, up = 14, down = 5) {   // K3 volá pomaleji (7/4) → bez skoku nohou do stopu
  const t = active ? 1 : 0, rate = t > prev ? up : down;
  const v = Math.min(1, Math.max(0, prev + (t - prev) * Math.min(1, rate * dt)));
  return v < 0.03 ? 0 : v;
}
// K3: jedna noha v rámci boků (x vpřed, y VEN na stranu nohy); boky jedou vůči ledu směrem (cos psi, sin psi) (couvání: opačně).
// u = fáze nohy 0..1, A = amplituda, C = délka cyklu (px). Vrací x, y, úhel ostří a, lift 0..1 (noha ve vzduchu).
function _k3Leg(u, A, C, psi, back) {
  const R = PLAYER.radius, P = SKATE_K3.push, L = SKATE_K3.land, Y0 = 0.34 * R;
  const mvx = back ? -Math.cos(psi) : Math.cos(psi), mvy = back ? -Math.sin(psi) : Math.sin(psi);
  let x, y, dx = 0, dy = 0, lift = 0, a = null;          // dx, dy = derivace podle u
  if (back) {          // C-cut: noha na ledě opíše C ven a zpět (pata ven → špička ven), pak klouže pod tělem
    const H = 0.5;
    if (u < H) { const s = u / H, q = Math.sin(Math.PI * s), d2 = Math.PI * Math.sin(2 * Math.PI * s) / H;
      x = 0.35 * R * A * q * q; y = Y0 + 1.25 * R * A * q * q; dx = 0.35 * R * A * d2; dy = 1.25 * R * A * d2;
    } else { x = 0; y = Y0; }
  } else {
    const W = 1.3 * R * A, B = 0.6 * R * A;
    if (u < P) {       // odraz: noha jde ven (zrychluje) a dozadu, brusle se natáčí špičkou ven po své dráze
      const s = u / P; x = -B * s; y = Y0 + W * s * s; dx = -B / P; dy = 2 * W * s / P;
    } else if (u < L) {  // návrat vzduchem: Hermite z konce odrazu (dojezd ven) zpět pod boky
      const s = (u - P) / (L - P), D = L - P, m0x = -B / P * D * 0.5, m0y = 2 * W / P * D * 0.5;
      const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2;
      x = h00 * -B + h10 * m0x; y = h00 * (Y0 + W) + h10 * m0y + h01 * Y0;
      lift = Math.sin(Math.PI * s);
      const a0 = Math.atan2(mvy + 2 * W / P / C, mvx - B / P / C), e = _ss(0, 1, s);   // úhel při odlepení → úhel skluzu
      a = a0 * (1 - e) + Math.atan2(mvy, mvx) * e;
    } else { x = 0; y = Y0; }                            // skluz pod boky
  }
  if (a == null) {     // na ledě: ostří po dráze nohy vůči ledu (= nulový boční smyk)
    a = Math.atan2(mvy + dy / C, mvx + dx / C); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
  }
  return { x, y, a, lift };
}
// K3: natočení brusle má omezenou rychlost (9 rad/s) → přechod couvání ↔ jízda vpřed = brusle se plynule otočí (pivot), ne skok.
// Mutuje feet[i].a a st._faS; v ustálené jízdě se úhly mění pomaleji, takže nic nemění.
export function skateFeetSmooth(st, feet, dt) {
  const lim = 9 * dt, S = st._faS || (st._faS = {});
  for (const f of feet) { const prev = S[f.side];
    if (prev != null) { const d = angleDiff(f.a, prev); f.a = prev + Math.max(-lim, Math.min(lim, d)); }
    S[f.side] = angleDiff(f.a, 0); }
}
// PÓZA bruslí a těla (lokál těla ve SVĚT. jednotkách: +x dopředu, +y doprava).
// o = { k, phase, spd, mLoc (směr pohybu vůči tělu), stopT, stopLoc (směr stopu vůči tělu), rotSf, lean }
// → { feet: [{ side, x, y, a, lift }], body: { x, y, tw } }  (body = posun těla / natočení ramen = přenos váhy)
export function skatePose(o) {
  const R = PLAYER.radius, k = o.k | 0, spd = o.spd, sf = Math.min(1, spd / 160), ph = o.phase ?? 0, mLoc = o.mLoc;
  const moving = spd > 8, back = moving && Math.abs(mLoc) > 2.2, lat = moving && !back && Math.abs(mLoc) > 0.6, latS = Math.sign(mLoc) || 1;
  const stopT = o.stopT ?? 0, rv = o.rotSf ?? 0, stopA = (o.stopLoc ?? 0) + Math.PI / 2;
  const feet = [], body = { x: 0, y: 0, tw: 0 };
  if (k === 3) {
    const C = skateCycle(3, spd), uA = _wrap1(ph / (Math.PI * 2));
    const w = _ss(4, 30, spd) * (1 - stopT);                          // váha kroku (klid ↔ jízda, plynule)
    const bw = moving ? _ss(1.6, 2.5, Math.abs(mLoc)) : 0;            // váha couvání (C-cut), široký přechod = plynulá otočka
    const h = Math.max(-SKATE_K3.hip, Math.min(SKATE_K3.hip, mLoc)) * (1 - bw), psi = mLoc - h;   // natočení boků k jízdě (při couvání rovně)
    const psiB = angleDiff(mLoc, Math.PI);                             // couvání: odchylka od přímo dozadu
    const amp = Math.min(1, 0.45 + spd / 220), lean = Math.max(-1, Math.min(1, o.lean ?? 0));
    const pcx = -0.5 * R, ch = Math.cos(h), sh = Math.sin(h);
    for (const side of [-1, 1]) {
      const u = _wrap1(uA + (side === 1 ? 0 : 0.5));
      const A = amp * (1 - 0.35 * lean * side);                        // zatáčka: vnější noha se odráží víc
      const F = _k3Leg(u, A, C, side * psi, false);                    // vpřed / bokem v rámci boků (zrcadleno pro stranu)
      const fy = side * F.y;
      let x = pcx + F.x * ch - fy * sh, y = F.x * sh + fy * ch, a = side * F.a + h, lift = F.lift;
      if (bw > 0) {                                                    // couvání: C-cuty v rámci těla (boky rovně)
        const G = _k3Leg(u, amp, C, side * psiB, true);
        const gx = pcx + 0.25 * R + G.x, gy = side * G.y, ga = side * G.a;
        x += (gx - x) * bw; y += (gy - y) * bw; a = lerpAngle(a, ga, bw); lift *= 1 - bw;
      }
      const rx = -0.62 * R, ry = side * 0.5 * R, ra = side * 0.2;     // klid: mírné V (špičky lehce ven)
      x = rx + (x - rx) * w; y = ry + (y - ry) * w; a = ra + angleDiff(a, ra) * w; lift *= w;
      if (rv > 0) { const q = ph + (side === 1 ? 0 : Math.PI); x += Math.cos(q) * R * 0.25 * rv; y += side * Math.max(0, Math.sin(q)) * R * 0.2 * rv; a += side * 0.3 * rv; }
      if (stopT > 0) {   // hokejový stop: brusle napříč k jízdě, před tělem (tělo se zaklání), jedna za druhou po směru jízdy
        const m = o.stopLoc ?? 0, cm = Math.cos(m), sm = Math.sin(m), e = _ss(0, 1, stopT), d = 0.75 * R + side * 0.5 * R, q = 0.45 * R;
        const tx = -0.3 * R + cm * d - sm * q, ty = sm * d + cm * q;   // q: boky se stočí → brusle vykouknou do boku
        x += (tx - x) * e; y += (ty - y) * e; a = lerpAngle(a, stopA, e); lift *= 1 - e;
      }
      feet.push({ side, x, y, a, lift });
    }
    // přenos váhy: odraz tlačí tělo od odrazové nohy (napříč boky), ramena se lehce protočí proti odrazové noze
    const swing = Math.sin(2 * Math.PI * uA) * amp * w * (1 - 0.6 * bw);
    body.x = 0.11 * R * swing * sh * (1 - bw); body.y = -0.11 * R * swing * (ch * (1 - bw) + bw); body.tw = -0.08 * swing;
    if (stopT > 0) { const m = o.stopLoc ?? 0, e = _ss(0, 1, stopT); body.x -= Math.cos(m) * 0.32 * R * e; body.y -= Math.sin(m) * 0.32 * R * e; }   // záklon
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
  return { feet, body };
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
  if (p._downT > 0 || p._upT > 0) { _renderDown(ctx, p, cam, _downEl(p, cam)); return; }
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
  const { psi, P } = downPose(el, { id: p.id, n, fb: p._fallB ?? p.bodyAngle, fa, ba: p.bodyAngle, ca: p.carryAngle ?? p.aimAngle, h: p.handed ?? 1 }, PLAYER);
  const lx = Math.cos(-psi) * -0.7 - Math.sin(-psi) * -0.7, ly = Math.sin(-psi) * -0.7 + Math.cos(-psi) * -0.7;   // světlo vlevo nahoře, pevné ve světě
  ctx.save(); ctx.translate(x, y); ctx.rotate(psi); ctx.scale(s, s);
  drawDownBody(ctx, P, K, R, { stickL: PLAYER.stickLen * PLAYER.stickDraw, bladeSide: p.handed ?? 1, lx, ly });
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
    ctx.fillStyle = 'rgba(127,212,255,0.18)'; ctx.fill();
    ctx.lineWidth = 2.5 * s; ctx.strokeStyle = '#7FD4FF'; ctx.stroke();
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
    if (_spd2 > 30) p._hsDir = Math.atan2(p.vy ?? 0, p.vx ?? 0);  // uložit směr dokud jedeme

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
      const _dir = p._hsDir ?? Math.atan2(p.vy ?? 0, p.vx ?? 0);
      const _spd = _prevS;
      p._stopFx  = 0.55 + Math.min(1, (_spd - 35) / 145) * 0.35;  // 0.55–0.90s dle rychlosti
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
    p._stopK3 = skateStopBlend(p._stopK3 ?? 0, (p._stopFx ?? 0) > 0, _dtHS, 5, 4);
    if (!p._stopTSmooth && !p._stopK3) p._hsDir = null;   // vyčisti uložený směr
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
  const _pose = skatePose({ k: _k, phase: p._skatePhase ?? 0, spd: _spd, mLoc: _k === 3 ? p._mLocS : _mLoc, stopT: (_k === 3 ? p._stopK3 : p._stopTSmooth) ?? 0,
    stopLoc: p._hsDir != null ? angleDiff(p._hsDir, ba) : 0, rotSf: p._rotSf ?? 0, lean: p._lean ?? 0 });

  if (_k === 3) skateFeetSmooth(p, _pose.feet, _rdt(cam));
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
    feetW.push({ x: f.x, y: f.y, side: f.side });
  }
  ctx.restore();   // konec rámce bruslí (hůl a tělo navrch: brusle → hůl/puk → tělo = pořadí y−z)

  // Cross-check: hůl držená napříč PŘED TĚLEM. Kreslí se přes vyhlazený úhel
  // _stickDisp (dojíždí k bodyAngle), takže přepnutí RMB hokejku neteleportuje.
  if (p.crossCheck) {
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
  }

  if (!p.crossCheck) {
  // ── Stick ──────────────────────────────────────────────────────────────
  // Vyhlazený úhel + charge → wind-up i zrušení charge jsou plynulé (bez skoku)
  // VIZUÁL STŘELY TAHEM: nápřah na FORHEND (strana rukou) a k tělu, po ráně švih + dokončení přes směr střely.
  // Jen kresba: sim úhel (_stickDisp) má nápřah 0,85 rad na druhou stranu → vrátíme ho a přidáme vizuální.
  const hnd = p.handed ?? 1, dcv = p._dispCharge ?? 0;
  let follow = 0;
  if (p._sw) { const u = 1 - p._sw.t / p._sw.T; follow = -hnd * PLAYER.followArc * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u); }
  const windAngle = p.crossCheck ? p._stickDisp : p._stickDisp + hnd * dcv * (0.85 + PLAYER.windBack) + follow;
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

  const tipX = ox + (gxw + windCos * wt) * s;
  const tipY = oy + (gyw + windSin * wt) * s;
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
  const R0 = PLAYER.radius;
  const fA = p.bodyAngle ?? windAngle, fC = Math.cos(fA), fS = Math.sin(fA);
  const sC = Math.cos(fA + Math.PI / 2), sS = Math.sin(fA + Math.PI / 2);   // +strana = hnd 1 (pravá)
  // horní ruka: před tělem u středu, mírně k bekhendu; v nápřahu se stáhne k forhendovému boku
  const tF = R0 * (0.55 - 0.35 * dcv), tSd = R0 * (-0.15 + 0.55 * dcv) * hnd;
  const topW = { x: p.x + fC * tF + sC * tSd, y: p.y + fS * tF + sS * tSd };
  const tipW = { x: gxw + windCos * wt, y: gyw + windSin * wt };
  const shDir = Math.atan2(tipW.y - topW.y, tipW.x - topW.x), shC = Math.cos(shDir), shS = Math.sin(shDir);
  const botW = { x: topW.x + (tipW.x - topW.x) * 0.42, y: topW.y + (tipW.y - topW.y) * 0.42 };
  p._visTopW = topW; p._visBotW = botW;
  const tx0 = ox + topW.x * s, ty0 = oy + topW.y * s;

  // ── Shaft ─────────────────────────────────────────────────────────────────
  const SV = STICK_V[VIS.s] || STICK_V[0];
  ctx.lineCap = 'round';
  if (SV.sh2) {   // stín hole na ledu (světlo vlevo nahoře → stín vpravo dole)
    const o = 1.6 * s; ctx.strokeStyle = 'rgba(20,40,70,0.22)'; ctx.lineWidth = SV.sh * s;
    ctx.beginPath(); ctx.moveTo(tx0 + o, ty0 + o); ctx.lineTo(tipX + o, tipY + o); ctx.stroke();
  }
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = SV.out * s;   // obrys dříku (C-d2)
  ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.beginPath();   // konec hole + omotávka (od horní ruky)
  ctx.moveTo(tx0, ty0);
  ctx.lineTo(tx0 + (tipX - tx0) * 0.22, ty0 + (tipY - ty0) * 0.22);
  ctx.strokeStyle = _shade(stickCol, -0.55);
  ctx.lineWidth   = SV.sh * s;
  ctx.stroke();
  ctx.beginPath();   // hlavní dřík
  ctx.moveTo(tx0 + (tipX - tx0) * 0.18, ty0 + (tipY - ty0) * 0.18);
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
  // PUK NA ČEPELI (nese ho tento hráč): na prohnuté straně, v nápřahu u paty čepele (tah od paty ke špičce)
  const cp = p.hasPuck && p._carriedPuck && p._carriedPuck._carrier === p ? p._carriedPuck : null;
  if (cp) {
    const along = 0.5 - 0.3 * dcv;
    const mx = bStartX + (bEndX - bStartX) * along, my = bStartY + (bEndY - bStartY) * along;
    const nA = bladeDir - hnd * Math.PI / 2;        // normála k prohnuté straně
    const off = PUCK.radius * 1.05 * s;
    const vx = (mx + Math.cos(nA) * off - ox) / s, vy = (my + Math.sin(nA) * off - oy) / s;
    p._visPuck = { x: vx, y: vy };
    cp.draw(ctx, cam, p._visPuck);
  } else p._visPuck = null;
  } // end !crossCheck stick

  // ── TĚLO C-d2 (skin.js): jedna sjednocená cesta, obrys jednou, jedno stínování; ruce z držení hole ──
  {
    let topH, botH;
    if (p.crossCheck) {
      const baseDir = p._stickDisp, stickDir = baseDir + (p.handed ?? 1) * Math.PI / 2;
      const sc = Math.cos(stickDir), ss = Math.sin(stickDir), half = PLAYER.stickLen * 0.7;
      const cxW = p.x + Math.cos(baseDir) * (PLAYER.radius + 2), cyW = p.y + Math.sin(baseDir) * (PLAYER.radius + 2);
      topH = { x: cxW - sc * half * 0.62, y: cyW - ss * half * 0.62 };
      botH = { x: cxW + sc * half * 0.42, y: cyW + ss * half * 0.42 };
    } else if (p._visTopW && p._visBotW) { topH = p._visTopW; botH = p._visBotW; }
    else { const gp = p.gripPoint; topH = { x: p.x + fcos * PLAYER.radius * 0.5, y: p.y + fsin * PLAYER.radius * 0.5 }; botH = { x: gp.x, y: gp.y }; }
    const leanW = (p._lean ?? 0) * PLAYER.radius * 0.15;
    const bo = p.crossCheck ? { x: 0, y: 0, tw: 0 } : _pose.body;   // přenos váhy (K1–K3); ruce zůstanou na holi → odečti posun
    const toL = h => { const dx = h.x - p.x, dy = h.y - p.y; return { x: dx * fcos + dy * fsin - bo.x, y: -dx * fsin + dy * fcos - leanW - bo.y }; };
    const llx = Math.cos(-ba) * -0.7 - Math.sin(-ba) * -0.7, lly = Math.sin(-ba) * -0.7 + Math.cos(-ba) * -0.7;   // světlo vlevo nahoře, pevné ve světě
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ba); ctx.translate(bo.x * s, (leanW + bo.y) * s); ctx.scale(s, s);
    K.headV = VIS.h;
    skinBody(ctx, { feet: feetW.map(f => ({ x: f.x - bo.x, y: f.y - bo.y, side: f.side })), top: toL(topH), bot: toL(botH), hnd: p.handed ?? 1, tw: bo.tw, lx: llx, ly: lly }, K);
    ctx.restore();
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
  if (p._kickFx > 0) {   // úspěšné přikopnutí: krátký záblesk u brusle
    const s = cam.scale, a = p._kickFx / 0.35; ctx.save(); ctx.beginPath(); ctx.arc(cam.ox + p.x * s, cam.oy + p.y * s, (PLAYER.radius + 4 + 6 * (1 - a)) * s, 0, Math.PI * 2);
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
    ctx.fillStyle = '#1F4FD8';
    ctx.fillRect(sx - pw / 2, by, pw, ph);
    ctx.beginPath(); ctx.moveTo(sx - 4 * s, by + ph); ctx.lineTo(sx + 4 * s, by + ph); ctx.lineTo(sx, by + ph + 5 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, by + ph / 2 + 1.5 * s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (p.founder) _drawCrown(ctx, sx - pw / 2 - 9 * s, by + ph / 2, 7.5 * s);   // korunka vlevo od štítku
  } else
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
