import { RINK, TEMPO } from './constants.js';
// Časování botů je v ticích → při jiném tempu natáhnout stejným dílem (herní sekunda = TICK_HZ/TEMPO ticků)
const _envE0 = (k, d) => (typeof process !== 'undefined' && process.env[k] != null && process.env[k] !== '') ? Number(process.env[k]) : d;
const TT = v => Math.max(1, Math.round(v / TEMPO));

// Bot = obyčejný Player, jen vstupy (směr, míření, střela) mu generuje server místo klávesnice.
// Stejná fyzika i pravidla jako člověk. Náhoda je seedovaná → stejný zápas = stejné chování.

const THINK_EVERY = TT(6);            // rozhoduje 10× za s (reakce ~100 ms jako člověk)
const AIM_ERR     = 0.02;         // max chyba míření při střele (rad) — střela podél tyčky snese jen pár px
// Gólman kryje celou bránu proti pomalé střele → bot střílí silně (~0.7 s nápřah) těsně podél horní tyčky
// Nápřah podle výšky rány (dřív jeden rozsah [18, 46] ticků = náhodný mix)
const HOLD_LOW    = [TT(_envE0('FH_HLLO', 24)), TT(_envE0('FH_HLHI', 29))];     // přízemní rána (charge 0,48–0,58; změřeno: slabší 0,3–0,5 jen ~7 % gólů) — spodní roh proti stoji
const HOLD_HIGH   = [TT(32), TT(46)];     // zvednutá rána (charge ≥ 0,64) — horní roh proti motýlku
const SNAP = (typeof process !== 'undefined' && process.env.FH_SNAP) ? Number(process.env.FH_SNAP) : 0;   // změřeno: rychlá přízemní rána ~6 % → vypnuto
const SNAP_HOLD   = TT(14);               // rychlá rána, když by dlouhý nápřah dráhu nestihl
const LANE_LEAD   = (typeof process !== 'undefined' && process.env.FH_LLEAD) ? Number(process.env.FH_LLEAD) : 0.7;   // podíl nápřahu, o který se předvídá pohyb obránce do dráhy
const HIGH_STAND  = (typeof process !== 'undefined' && process.env.FH_HIGHST) ? Number(process.env.FH_HIGHST) : 0.6;    // podíl zvednutých proti stoji — změřeno 2026-11-11 (24 seedů): proti stoji zvednutá ~25 %, přízemní (0,48–0,58) ~19 %
const SHOT_RANGE  = [130, 170];   // px od branky, odkud bot vystřelí
const QUICK_RANGE = 40;           // úplně zblízka rychlá střela (gólman je do ~28 px vypíchne)
const QUICK_HOLD  = TT(6);
const LANE        = 8;            // px nad středem — bot najíždí skoro středem, gólman tam stojí nejblíž ose
const SLOT_Y      = 48;           // střílí jen z úzkého slotu kolem osy (|y od středu| < SLOT_Y)
const COAST       = 0.35;         // s — kam bot dojede setrvačností za nápřahu (do slotu se počítá s tím)
const BRAKE_V     = 25;           // px/s — nad tuhle rychlostí bot za nápřahu brzdí
const CORNER_IN   = 2;            // px od horní tyčky, kam míří
const CREASE_OUT  = 140;          // px před brankou — kam se stáhne, když gólman drží puk
const PUCK_LEAD   = 0.25;         // s — jede tam, kam puk dojede, ne kde je
const LEAD_MAX     = 0.7;          // s — strop předstihu při pronásledování
const PLAYER_V     = (typeof process !== 'undefined' && process.env.FH_PSPEED != null && process.env.FH_PSPEED !== '') ? Number(process.env.FH_PSPEED) : 165;          // px/s — rychlost bruslaře (= PLAYER.speed, čte stejný FH_PSPEED)
const AVOID_R     = 26;           // px — puk blíž než tohle k soupeři → najeď z druhé strany
const REACH       = 13;           // px — dosah čepele před tělem při aimDist 40
const PICK_NEAR   = 45;           // px — od téhle vzdálenosti k puku bot zastaví tělo tak, aby čepel dosáhla
const NET_CLEAR   = 50;           // px — za brankou: dokud je |y od středu| menší, jede se bokem ze sítě
const STANDOFF    = 12;           // px za puk (směrem od soupeře)
const LOOK        = 120;          // px — jak daleko dopředu hledá soupeře v cestě
const CLEAR       = 26;           // px — boční odstup od soupeře na dráze (poloměry 7+7 + rezerva)
const PRESS_R     = (typeof process !== 'undefined' && Number(process.env.FH_PRESS)) || 20;           // px — soupeř takhle blízko = nátlak → pas
const _envE = (k, d) => (typeof process !== 'undefined' && process.env[k] != null && process.env[k] !== '') ? Number(process.env[k]) : d;
const PASS_MIN    = 50, PASS_MAX = 260, PASS_CD = TT(_envE('FH_PCD', 60));   // px / ticky pauzy mezi pasy
const PASS_FAR    = _envE('FH_PFAR', 150);   // px od branky: dál než to se vyplatí přihrát lepšímu
const PASS_SCORE  = _envE('FH_PSCORE', 70);  // skóre příjemce (posun + volnost), od kterého se přihraje i blízko branky
const PASS_ADV    = _envE('FH_PADV', 20);    // px — o kolik musí být příjemce blíž k brance
// TRASY ÚTOKU (2026-11-09): nosič si na začátku držení (seedovaně) vybere cestu — přímo / po kraji / přejezd
// na druhou stranu — a teprve od bodu obratu stáčí do slotu. Dřív vždy přímka do středu (bot_style: křivost 1,11).
const ROUTES      = _envE('FH_ROUTES', 1);
const ROUTE_X     = _envE('FH_RTX', 185);    // px před brankou — bod obratu
const ROUTE_W     = _envE('FH_RTW', 90);     // px od osy — šířka kraje
const ROUTE_MIN   = 260;                     // px od branky — kratší nájezd jede rovnou
const SUP_AHEAD   = 80, SUP_BACK = 55, SUP_WIDE = 100;  // rozestavení podpory
const _env = (k, d) => (typeof process !== 'undefined' && process.env[k] != null && process.env[k] !== '') ? Number(process.env[k]) : d;
// Obrana s odstupem (gap control): napadající bot drží GAP px před nosičem na obranné straně a napadne ho,
// až je nosič blíž než ENGAGE px k naší brance. 0 = staré chování (napadá hned). Měřeno scripts/attack_test.mjs
// + rubrika (2026-11-02): k ráně 0 % → 58 %, změny týmu u puku 17,7 → 14,6/min.
const ENGAGE      = _env('FH_ENGAGE', 200);
const PASS_LEAD   = _env('FH_PLEAD', 1);   // dráhu pasu kontroluj k místu setkání, ne k příjemci teď
const GAP         = _env('FH_GAP', 120);
const ATTACK_V    = _env('FH_ATTV', 60);   // px/s — rychlost nosiče směrem k naší brance, od které jde o nájezd
const SECOND_COVER = _env('FH_COVER', 1);   // 1 = druhý bot kryje prostor před brankou místo druhého tlaku na puk
const CARRY_TURN  = _env('FH_CTURN', 0.4);   // rad za think (10×/s) — max otočení míření s pukem; 0 = vypnuto
const DIAG        = 0.38;        // práh pro diagonálu (8 směrů jako WASD)

// Malý seedovaný PRNG (mulberry32) — deterministický, bez Math.random
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const between = (rng, [lo, hi]) => lo + (hi - lo) * rng();

export function makeBotBrain(seed) {
  const rng = mulberry32(seed);
  const b = { rng, hold: 0, shotAim: 0, shotRange: between(rng, SHOT_RANGE) };
  // POVAHA (2026-11-11): střelec / nahrávač — seedovaně, mění váhy plánů v útočném pásmu (ne fyziku)
  b.style = rng() < 0.5 ? 'shooter' : 'playmaker';
  b.ph = rng() * Math.PI * 2;                       // fáze kličkování (plynulá vlna, ne zuby)
  b.stats = { shot: 0, pass: 0, dangle: 0, reset: 0, cycle: 0, wide: 0, drive: 0, held: 0 };
  return b;
}

// ── PLÁN NOSIČE V ÚTOČNÉM PÁSMU (2026-11-11) ─────────────────────────────────────────────
// Dřív: jeď do slotu a střílej, jakmile dist < shotRange — i přes soupeře ve střelecké dráze (bot_decisions:
// 21 % střel do těla obránce, křivost dráhy 1,13). Teď si nosič po vjezdu do pásma (seedovaně podle povahy
// a situace) vybere plán a střílí jen s volnou dráhou; zablokovaná dráha → pas / klička od hole obránce / reset.
const ZONE_D     = _envE('FH_ZONED', 330);     // px od branky — útočné pásmo (≈ modrá čára)
const SCREEN_PX  = _envE('FH_SCRPX', 50);       // px před cílem rány — soupeř blíž k brance je clona, ne blok (3v3 góly 3,77 → 4,9; balance FH_TEAM=2/3 zelená)
const BLK_R      = _envE('FH_BLKR', 17);       // px — soupeřovo tělo blíž k dráze střely = zablokováno
const WEAVE_W    = _envE('FH_WEAVE', 0.55);    // rad — amplituda kličkování (odklon směru jízdy)
const WEAVE_T    = TT(_envE('FH_WVT', 96));                     // ticky — perioda vlny kličky (~1,6 s)
const PLAN_MAX   = TT(150);                    // ticky — strop jednoho plánu (pak nový výběr)
const ZONE_PATIENCE = TT(_envE('FH_ZPAT', 300)); // ticky v pásmu, po nichž už jen „drive" (proti zdržování)
const PLAN_W = {   // váhy [drive, wide, cycle, reset] podle povahy × situace (volno / obránce mezi mnou a slotem)
  shooter:   { open: [0.78, 0.12, 0.05, 0.05], blocked: [0.25, 0.35, 0.20, 0.20] },
  playmaker: { open: [0.58, 0.20, 0.11, 0.11], blocked: [0.10, 0.30, 0.30, 0.30] },
};
const STICK_SIDE = _envE('FH_STSIDE', 1);      // 1 = nosič objíždí obránce od jeho hole
const STICK_LAT  = _envE('FH_STLAT', 4);       // px — od hole se rozhoduje, jen když obránce stojí skoro přímo v cestě (jinak by nosič přejel před ním)
const WEAVE_FREE = _envE('FH_WVFREE', 110);     // px — kličkuje jen, když je nejbližší soupeř dál
const EVADE_D    = _envE('FH_EVD', 280);       // px — jak daleko dopředu nosič plánuje oblouk kolem soupeře
const EVADE_LAT  = _envE('FH_EVLAT', 100);      // px — boční pás, ve kterém soupeř „stojí v cestě"
const EVADE_W    = _envE('FH_EVW', 1.2);       // rad — max odklon oblouku
// Soupeř, který se na nosiče řítí zblízka (přibližuje se rychleji než EVC_V px/s, blíž než EVC_D px), se obloukem neobjede
// (stejná rychlost = jen by ujížděl do strany a nedal se dojet; crosscheck 72 nájezdů: oblouk 21, tohle 29, starý bot 30 zásahů). Pak jen uhne ramenem (EVC_W rad).
const EVC_V = _envE('FH_EVCV', 60), EVC_D = _envE('FH_EVCD', 200), EVC_W = _envE('FH_EVCW', 0.2);
const ANALOG     = _envE('FH_ANALOG', 1);       // 1 = nosič řídí plynulým směrem (ne 8 směrů)
const WIDE_X = _envE('FH_WIDEX', 165), WIDE_Y = _envE('FH_WIDEY', 100);   // px — bod na kraji pro plán „wide"
const PRESS_ZONE = _envE('FH_PRZ', 40);        // px — soupeř takhle blízko v pásmu = nečekej (reset nezpomaluje)
const WEAVE_CHASE = _envE('FH_WVCH', 0);       // px — soupeř ZA nosičem blíž než tohle = žádné vlnění (ztratil by náskok)
const SUP_MOVE   = _envE('FH_SUPM', 1);        // 1 = podpora v pásmu nabízí pas z volného místa
const SUP_SPOTS  = [[85, 60], [140, 40], [125, 100], [175, 15]];   // [px před brankou, px od osy na straně OPAČNÉ k nosiči]: zadní tyč, slot, kruh, vysoký slot
const WEAVE_MIN  = _envE('FH_WVMIN', 200);     // px od branky — blíž už jede do slotu rovně (střela z čisté jízdy)
const DRIVE_K = _envE('FH_DRVK', 2), RESET_K = _envE('FH_RSTK', 0.5);   // diagnostika: násobky vah
const PLAN_K = ['drive', 'wide', 'cycle', 'reset'];
const _PW = (typeof process !== 'undefined' && process.env.FH_PW) ? process.env.FH_PW.split(',').map(Number) : null;   // diagnostika: přepis vah
const oppsOf = (p, match) => { const a = []; for (const o of match.players.values()) if (o.team !== p.team) a.push(o); return a; };
// Soupeř (bruslař, ne gólman) blíž než r k úsečce (x0,y0)→(x1,y1)? Vrací ho, jinak null.
// lead (s) = kontroluj i místo, kam soupeř za tu dobu dojede (nápřah trvá ~0,3–0,8 s)
function laneBlocker(opps, x0, y0, x1, y1, r, lead = 0) {
  const sx = x1 - x0, sy = y1 - y0, L2 = sx * sx + sy * sy || 1;
  let best = null, bu = 2;
  for (const o of opps) {
    for (const k of lead ? [0, 1] : [0]) {
      const ox = o.x + (o.vx || 0) * lead * k, oy = o.y + (o.vy || 0) * lead * k;
      const u = ((ox - x0) * sx + (oy - y0) * sy) / L2;
      if (u <= 0.02 || u >= 1) continue;
      if ((1 - u) * Math.sqrt(L2) < SCREEN_PX) continue;   // obránce těsně před brankou = clona (gólmanovi škodí, _screen), ne blok
      if (Math.hypot(x0 + sx * u - ox, y0 + sy * u - oy) < r && u < bu) { bu = u; best = o; }
    }
  }
  return best;
}
// Strana od hole soupeře (−1/+1 v Y): jeho čepel je na jedné straně těla → objeď ho z druhé
const awayFromStick = (o) => { const t = o.stickTip; const s = t ? t.y - o.y : 0; return Math.abs(s) > 1 ? -Math.sign(s) : 0; };
function pickPlan(p, b, match, dir, goalX, goalY, mates) {
  const opps = oppsOf(p, match);
  const blocked = !!laneBlocker(opps, p.x, p.y, goalX - dir * 110, goalY, 40);   // obránce mezi mnou a slotem
  const w = _PW ? [..._PW] : [...PLAN_W[b.style][blocked ? 'blocked' : 'open']];
  if (!mates) { w[3] *= 0.25; w[2] *= 0.6; }                 // bez spoluhráče nemá reset/cyklus na koho čekat
  w[0] *= DRIVE_K; w[3] *= RESET_K;
  if ((b.zonePlans || 0) >= 2 || (b.zoneT || 0) > ZONE_PATIENCE * 0.6) { w[2] = 0; w[3] = 0; if (!w[0] && !w[1]) w[0] = 1; }     // třetí plán už bez dalšího zdržení
  const sum = w.reduce((a, c) => a + c, 0); let r = b.rng() * sum, k = 0;
  while (k < 3 && r >= w[k]) { r -= w[k]; k++; }
  const side = Math.abs(p.y - goalY) > 12 ? Math.sign(p.y - goalY) : (b.rng() < 0.5 ? -1 : 1);
  b.plan = { kind: PLAN_K[k], t: 0, side, stage: 0 };
  b.zonePlans = (b.zonePlans || 0) + 1;
  b.stats[PLAN_K[k]]++;
}

// Stabilní honič s hysterezí: tým má jednoho určeného honiče k puku a drží ho,
// dokud není jiný spoluhráč o CHASE_HYST px blíž. Bez toho se dva skoro stejně vzdálení
// hráči v roli střídali každý think (10×/s) → vizuální cukání ("nedrží pozici").
const CHASE_HYST = _env('FH_CHYST', 50);   // px — náskok, který musí mít vyzyvatel, aby převzal honiče (50 = bezpečné max, 80 už sráží konverzi pod rubriku)
function nearestToPuck(match, team) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o.team !== team) continue;
    const d = Math.hypot(o.x - match.puck.x, o.y - match.puck.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { p: best, d: bd } : null;
}
function pickChaser(match, team, prevId) {
  const near = nearestToPuck(match, team); if (!near) return null;
  const prev = prevId != null ? match.players.get(prevId) : null;
  if (prev && prev.team === team) {
    const pd = Math.hypot(prev.x - match.puck.x, prev.y - match.puck.y);
    if (pd <= near.d + CHASE_HYST) return prevId;   // stávající honič si roli udrží
  }
  return near.p.id;
}
// Přepočítá se jednou za tick a nacachuje na match, aby všichni hráči obou týmů viděli shodné přidělení.
function chaserId(match, team) {
  if (match._chaseTick !== match.tick) {
    match._chaseTick = match.tick;
    match._chaseHome = pickChaser(match, 'home', match._chaseHome);
    match._chaseAway = pickChaser(match, 'away', match._chaseAway);
  }
  return team === 'home' ? match._chaseHome : match._chaseAway;
}
function isChaser(p, match) { return p.id === chaserId(match, p.team); }

// Soupeř drží puk staženě u těla (kurzor < TUCK px) → čepelí se k němu dostaneš jen z blízka; boti sami drží puk s aimDist ≥ 40
const TUCK = 40;
const tucked = (o) => o.hasPuck && (o.aimDist ?? 99) < TUCK;

const clampX = (x, goalX, dir) => (dir > 0 ? Math.min(x, goalX - 90) : Math.max(x, goalX + 90));

// Vyber NEJLEPŠÍHO spoluhráče na přihrávku (ne jen nejbližšího): volný, s čistou dráhou,
// posunutý dopředu k brance. Vrací hráče, nebo null. Simuluje souhru — rozehrávku na volného.
const PASS_LANE   = _env('FH_LANE', 30);   // px — poloviční šířka koridoru přihrávky (soupeř uvnitř = zablokováno)
const RECV_OPEN   = _env('FH_OPEN', 40);   // px — soupeř blíž než tohle k příjemci = není volný
const OPEN_CAP    = 90;   // px — nad tolik už „volnost" příjemce dál neodměňujeme
function pickPass(p, match, dir, goalX, goalY, dist, force = false) {
  let pressed = false;
  for (const o of match.players.values())
    if (o.team !== p.team && Math.hypot(o.x - p.x, o.y - p.y) < PRESS_R) { pressed = true; break; }

  // VYŽÁDÁNÍ: spoluhráč (člověk) si řekl o puk (passReq) → dej mu ho, pokud je dráha čistá. Priorita.
  let req = null, reqD = Infinity;
  for (const t of match.players.values()) {
    if (t === p || t.team !== p.team || !((t.passReq || 0) > 0)) continue;
    const td = Math.hypot(t.x - p.x, t.y - p.y);
    if (td < 20 || td > PASS_MAX * 1.3) continue;
    const ux = (t.x - p.x) / td, uy = (t.y - p.y) / td;
    let blocked = false;
    for (const o of match.players.values()) {
      if (o.team === p.team) continue;
      const rx = o.x - p.x, ry = o.y - p.y, al = rx * ux + ry * uy, lat = rx * -uy + ry * ux;
      if (al > 0 && al < td && Math.abs(lat) < PASS_LANE) { blocked = true; break; }
    }
    if (!blocked && td < reqD) { reqD = td; req = t; }
  }
  if (req) return req;

  let best = null, bestScore = -Infinity, bestDist = 0;
  for (const t of match.players.values()) {
    if (t === p || t.team !== p.team) continue;
    const td0 = Math.hypot(t.x - p.x, t.y - p.y);
    if (td0 < PASS_MIN || td0 > PASS_MAX) continue;
    // Místo setkání (kam pas poletí — viz server leadAim): příjemce + 70 % jeho pohybu za dobu letu
    const tf = PASS_LEAD ? td0 / 250 : 0;
    const lx = t.x + (t.vx || 0) * tf * 0.7, ly = t.y + (t.vy || 0) * tf * 0.7;
    const td = Math.hypot(lx - p.x, ly - p.y) || 1;
    const ux = (lx - p.x) / td, uy = (ly - p.y) / td;
    // Dráha přihrávky nesmí vést přes soupeře; zároveň změř, jak je příjemce volný
    let blocked = false, openR = Infinity;
    for (const o of match.players.values()) {
      if (o.team === p.team) continue;
      const rx = o.x - p.x, ry = o.y - p.y;
      const al = rx * ux + ry * uy, lat = rx * -uy + ry * ux;
      if (al > 0 && al < td && Math.abs(lat) < PASS_LANE) { blocked = true; break; }
      const dor = Math.hypot(o.x - t.x, o.y - t.y);
      if (dor < openR) openR = dor;
    }
    if (blocked || openR < RECV_OPEN) continue;         // dráha blokovaná / příjemce pokrytý
    const tDist = Math.hypot(goalX - t.x, goalY - t.y);
    const advance = dist - tDist;                        // o kolik je příjemce blíž k brance
    const score = advance + Math.min(openR, OPEN_CAP) * 0.5;
    if (score > bestScore) { bestScore = score; best = t; bestDist = tDist; }
  }
  if (!best) return null;
  if (force) return best;                                // střela zablokovaná → přihraj volnému, i když neposune hru
  const better = bestDist < dist - PASS_ADV;             // příjemce je blíž k brance
  // Pod tlakem odehraj na kohokoli rozumného; jinak jen když to posune hru dopředu
  if (pressed) return (better || bestScore > 0) ? best : null;
  return (better && (dist > PASS_FAR || bestScore > PASS_SCORE)) ? best : null;
}

function nearestOpp(p, match, x, y) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o.team === p.team) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function botThink(p, inp, match) {
  const b = p.brain;
  // Zrcadlová ruka: domácí bot pravák, hostující levák → obě strany útočí se stejnou geometrií forehandu vůči brance.
  // Dřív server dal všem handed = 1 → strukturální výhoda domácích (120 zápasů 2v2: góly 5,02 vs 2,52).
  if (!b.handSet) { p.handed = p.team === 'away' ? -1 : 1; b.handSet = true; }
  inp.rmb = false;                        // RMB = jen jednotikový impuls (pas); jinak by bez puku dělal crossCheck
  // Nápřah běží → drž LMB, puštěním (hrana) server vystřelí
  if (b.hold > 0) {
    b.hold--;
    // Za nápřahu brzdí (protisměr k rychlosti), ať nedojede do brankoviště / mimo slot
    inp.dx = Math.abs(p.vx) > BRAKE_V ? -Math.sign(p.vx) : 0;
    inp.dy = Math.abs(p.vy) > BRAKE_V ? -Math.sign(p.vy) : 0;
    inp.lmb = b.hold > 0 && p.hasPuck;
    // Míření dopočítávám každý tick z aktuální polohy (bot za nápřahu dojíždí) + pevná chyba střelce
    const tip = p.stickTip;               // puk vyletí z čepele, ne ze středu hráče → míří se z ní
    inp.aim = Math.atan2(b.shotY - tip.y, b.shotX - tip.x) + b.aimErr;
    // Obránce za nápřahu vjel do dráhy → ránu zruš (RMB za nápřahu = zrušení, ne pas) a obejdi ho. Člověk do těla nepálí.
    if (inp.lmb && (p.charge || 0) > 0.08) {
      const opps = oppsOf(p, match);
      let blk = laneBlocker(opps, tip.x, tip.y, b.shotX, b.shotY, BLK_R);
      if (blk) {   // druhý roh volný → přemiř tam (nápřah pokračuje)
        const gy = RINK.goalY + RINK.goalH / 2, oy = 2 * gy - b.shotY;
        if (!laneBlocker(opps, tip.x, tip.y, b.shotX, oy, BLK_R)) { b.shotY = oy; blk = null; b.stats.reaim = (b.stats.reaim || 0) + 1; }
      }
      if (blk) {
        inp.lmb = false; inp.rmb = true; b.hold = 0; b.stats.cancel = (b.stats.cancel || 0) + 1;
        b.plan = { kind: 'dangle', t: 0, side: awayFromStick(blk) || (blk.y > p.y ? -1 : 1), stage: 0 }; b.stats.dangle++;
        return;
      }
    }
    if (!inp.lmb) b.hold = 0;
    return;
  }
  if (match.tick % THINK_EVERY) return;   // mezi rozhodnutími drží poslední vstup

  const puck = match.puck;
  const dir   = p.team === 'home' ? 1 : -1;               // home útočí vpravo
  const goalX = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft;
  const ownX  = dir > 0 ? RINK.goalLineLeft : RINK.goalLineRight;
  const goalY = RINK.goalY + RINK.goalH / 2;
  let tx, ty, ax, ay;

  const g = puck.x < RINK.centerX ? match.goalieL : match.goalieR;   // gólman u puku

  if (p.hasPuck && !b.hadPuck) {   // nové držení → vyber stranu a trasu
    b.lane = -1; b.route = 0; b.plan = null; b.zoneT = 0; b.zonePlans = 0; b.blockN = 0;
    if (ROUTES) {
      const gx0 = dir > 0 ? RINK.goalLineRight : RINK.goalLineLeft, gy0 = RINK.goalY + RINK.goalH / 2;
      if (Math.hypot(gx0 - p.x, gy0 - p.y) > ROUTE_MIN) {
        const r = b.rng(), mySide = p.y < gy0 - 10 ? -1 : p.y > gy0 + 10 ? 1 : (b.rng() < 0.5 ? -1 : 1);
        b.route = r < 0.35 ? 0 : r < 0.7 ? mySide : -mySide;   // 0 = přímo, ±1 = kraj (strana)
      }
    }
  }
  b.hadPuck = p.hasPuck;

  if (p.hasPuck) {
    p._botMode = 'carry';
    const behind = (p.x - goalX) * dir > -4;               // za brankovou čarou → vyjeď do slotu
    tx = goalX - dir * (behind ? 90 : 110); ty = goalY + (behind ? 0 : b.lane * LANE);
    ax = goalX; ay = goalY;
    if (b.route) {
      const wx = goalX - dir * ROUTE_X, wy = goalY + b.route * ROUTE_W;
      if ((p.x - wx) * dir > -30) b.route = 0;               // bod obratu minut → stoč do slotu
      else { tx = wx; ty = wy; ax = wx + dir * 60; ay = wy; } // hůl míří po směru jízdy (plynule, CARRY_TURN)
    }
    const dist = Math.hypot(goalX - p.x, goalY - p.y);
    let mates = 0; for (const o of match.players.values()) if (o.team === p.team && o !== p) mates++;
    // ── plán v útočném pásmu ──
    let canShoot = true;
    if (dist < ZONE_D && !behind) {
      b.zoneT += THINK_EVERY; b.route = 0;
      let pressed = false; for (const o of match.players.values()) if (o.team !== p.team && Math.hypot(o.x - p.x, o.y - p.y) < PRESS_ZONE) pressed = true;
      if (!b.plan || b.plan.t > PLAN_MAX) pickPlan(p, b, match, dir, goalX, goalY, mates);
      if (b.zoneT > ZONE_PATIENCE && b.plan.kind !== 'drive' && b.plan.kind !== 'dangle') b.plan = { kind: 'drive', t: 0, side: b.plan.side, stage: 0 };
      const P = b.plan; P.t += THINK_EVERY;
      const near = (x, y, r) => Math.hypot(x - p.x, y - p.y) < r;
      const clampY = y => Math.max(30, Math.min(RINK.h - 30, y));
      if (P.kind === 'wide') {          // po kraji k mantinelu, pak oblouk do slotu
        if (P.stage === 0) { tx = goalX - dir * WIDE_X; ty = clampY(goalY + P.side * WIDE_Y); if (near(tx, ty, 40)) P.stage = 1; canShoot = false; }
        else { tx = goalX - dir * 115; ty = goalY + P.side * 20; if (near(tx, ty, 30)) b.plan = { kind: 'drive', t: 0, side: P.side, stage: 0 }; }
        ax = tx + dir * 40; ay = ty;
      } else if (P.kind === 'cycle') {  // do rohu vedle branky, ven k mantinelu nahoru, pak do slotu
        if (P.stage === 0) { tx = goalX - dir * 30; ty = clampY(goalY + P.side * 135); if (near(tx, ty, 45)) P.stage = 1; canShoot = false; }
        else { tx = goalX - dir * 215; ty = clampY(goalY + P.side * 95); if (near(tx, ty, 45)) b.plan = { kind: 'drive', t: 0, side: P.side, stage: 0 }; canShoot = P.stage > 1; }
        ax = tx; ay = ty;
      } else if (P.kind === 'reset') {  // zpátky k modré, počkej na podporu, pak nový plán
        canShoot = false;
        if (P.stage === 0) { tx = goalX - dir * (ZONE_D - 45); ty = clampY(goalY + P.side * 85); if (near(tx, ty, 40)) { P.stage = 1; P.t0 = P.t; } }
        else {
          tx = p.x - dir * 10; ty = clampY(goalY - P.side * 60);   // na modré pomalu přejíždí na druhou stranu (ne stání)
          b.slow = !pressed;
          let sup = false;
          for (const o of match.players.values()) if (o.team === p.team && o !== p && Math.hypot(goalX - o.x, goalY - o.y) < dist - 30) sup = true;
          if (sup || P.t - P.t0 > TT(48)) b.plan = null;      // podpora je v pásmu (nebo dost čekání) → nový plán
        }
        ax = goalX; ay = goalY;
      } else if (P.kind === 'dangle') { // boční oblouk od hole obránce, pak zase do slotu
        tx = p.x + dir * 25; ty = clampY(p.y + P.side * 70);
        if (P.t > TT(36)) b.plan = { kind: 'drive', t: 0, side: P.side, stage: 0 };
        ax = goalX; ay = goalY;
      }
    }
    // OBLOUK OD OBRÁNCE + KLIČKOVÁNÍ: dřív nosič jel po přímce do slotu a uhnul až těsně před soupeřem (CLEAR 26 px).
    // Teď soupeře před sebou (do EVADE_D px, v pásu ±EVADE_LAT) objíždí plynulým obloukem včas — na stranu, kde není,
    // a stojí-li přímo v ose, na stranu od jeho hole. Na volném ledě (nikdo do WEAVE_FREE px) se vlní (seedovaná fáze).
    {
      b.ph += 2 * Math.PI * THINK_EVERY / WEAVE_T;
      const hx = tx - p.x, hy = ty - p.y, hd = Math.hypot(hx, hy);
      const drive = !b.plan || b.plan.kind === 'drive';
      if (hd > 45 && drive) {
        const ux = hx / hd, uy = hy / hd;
        let off = 0, free = Infinity, ba = Infinity;
        for (const o of match.players.values()) {
          if (o.team === p.team) continue;
          const rx = o.x - p.x, ry = o.y - p.y, al = rx * ux + ry * uy, lat = -rx * uy + ry * ux;
          const od = Math.hypot(rx, ry);
          free = Math.min(free, od);
          if (al < 0 && od < WEAVE_CHASE) free = 0;                         // honič za zády → nevlnit, ujeď mu
          if (al > 10 && al < Math.min(EVADE_D, hd + 20) && Math.abs(lat) < EVADE_LAT && al < ba) {
            ba = al;
            const away = awayFromStick(o) * Math.sign(ux || 1e-9);          // strana od hole v souřadnici „lat" (Y → lat přes ux)
            const side = lat > STICK_LAT ? -1 : lat < -STICK_LAT ? 1 : (STICK_SIDE && away ? away : (p.y < goalY ? -1 : 1) * Math.sign(ux || 1e-9));
            const closing = -((o.vx - p.vx) * rx + (o.vy - p.vy) * ry) / (od || 1);   // px/s, kladné = soupeř se blíží
            const wMax = (closing > EVC_V && od < EVC_D) ? EVC_W : EVADE_W;
            off = side * wMax * Math.min(1, (EVADE_D - al) / (EVADE_D * 0.6));
          }
        }
        if (!off && dist > WEAVE_MIN && free > WEAVE_FREE) off = WEAVE_W * Math.sin(b.ph);
        if (off) { const h = Math.atan2(hy, hx) + off; tx = p.x + Math.cos(h) * 90; ty = p.y + Math.sin(h) * 90; }
      }
    }
    if (b.passCd > 0) b.passCd -= THINK_EVERY;
    const passTo = (mate) => {
      inp.rmb = true; b.passCd = PASS_CD; p._passTarget = mate.id;   // server přihraje právě tomuto spoluhráči
      inp.aim = Math.atan2(mate.y - p.y, mate.x - p.x); b.stats.pass++;
    };
    const mate = (b.passCd > 0) ? null : pickPass(p, match, dir, goalX, goalY, dist);
    if (mate) { passTo(mate); return; }
    if (canShoot && !behind && dist < b.shotRange && Math.abs(p.y + p.vy * COAST - goalY) < SLOT_Y) {
      // Střela do rohu dál od gólmana (při shodě rozhodne rng) — ale JEN s volnou dráhou čepel→roh
      const tip = p.stickTip, opps = oppsOf(p, match);
      const off = g.y - goalY;
      let side = Math.abs(off) < 2 ? (b.rng() < 0.5 ? -1 : 1) : (off > 0 ? -1 : 1);
      const cyOf = s => goalY + s * (RINK.goalH / 2 - CORNER_IN);
      const st = g.stance || 'stand'; b.lastStance = st;
      const pHigh = st === 'butterfly' ? 0.85 : st === 'stretch' ? 0.75 : st === 'rvh' ? 0.7 : HIGH_STAND;
      const high = b.rng() < pHigh;
      let hold = dist < QUICK_RANGE ? QUICK_HOLD : Math.round(between(b.rng, high ? HOLD_HIGH : HOLD_LOW));
      const tryLane = (h) => {   // volný roh pro nápřah h ticků (obránce se mezitím posune) → strana, jinak 0
        const lead = h / 60 * TEMPO * LANE_LEAD;
        if (!laneBlocker(opps, tip.x, tip.y, goalX, cyOf(side), BLK_R, lead)) return side;
        if (!laneBlocker(opps, tip.x, tip.y, goalX, cyOf(-side), BLK_R, lead)) return -side;
        return 0;
      };
      let ok = tryLane(hold);
      if (!ok && SNAP && hold > SNAP_HOLD) { ok = tryLane(SNAP_HOLD); if (ok) { hold = SNAP_HOLD; b.stats.snap = (b.stats.snap || 0) + 1; } }   // dlouhý nápřah by obránce zavřel → rychlá rána
      let blk = null;
      if (ok) side = ok; else blk = laneBlocker(opps, tip.x, tip.y, goalX, cyOf(side), BLK_R, hold / 60 * TEMPO * LANE_LEAD) || nearestOpp(p, match, p.x, p.y);
      if (blk && dist > QUICK_RANGE) {
        // Dráha zavřená → NESTŘÍLEJ: pas (i bez posunu dopředu), jinak klička od hole obránce, po 2 pokusech reset
        b.stats.held++; b.blockN++;
        const m2 = b.passCd > 0 ? null : pickPass(p, match, dir, goalX, goalY, dist, true);
        if (m2) { passTo(m2); return; }
        if (b.blockN > 2 && mates && b.zoneT < ZONE_PATIENCE) { b.plan = { kind: 'reset', t: 0, side: Math.sign(p.y - goalY) || 1, stage: 0 }; b.stats.reset++; b.blockN = 0; }
        else {
          const s = awayFromStick(blk) || (blk.y > p.y ? -1 : 1);
          b.plan = { kind: 'dangle', t: 0, side: s, stage: 0 }; b.stats.dangle++;
        }
      } else {
        // Výška podle postoje gólmana (výše): motýlek → zvednutá rána (dlouhý nápřah = horní roh), stoj → spíš přízemní
        const cy = cyOf(side);
        b.shotX = goalX; b.shotY = cy;
        b.aimErr = (b.rng() * 2 - 1) * AIM_ERR;
        b.shotAim = Math.atan2(cy - p.y, goalX - p.x) + b.aimErr;
        b.hold = hold;
        b.shotRange = between(b.rng, SHOT_RANGE);
        b.stats.shot++; b.plan = null;
        inp.lmb = true;
        inp.aim = b.shotAim;
        inp.aimDist = 300;
        return;
      }
    }
  } else if (g.isHolding) {
    p._botMode = 'wait';
    // Gólman drží puk → neblokuj brankoviště, počkej před ním
    tx = g.netX + g.inX * CREASE_OUT; ty = goalY;
    ax = puck.x; ay = puck.y;
  } else if (ENGAGE > 0 && isChaser(p, match) && (() => { const oc = [...match.players.values()].find(o => o.team !== p.team && o.hasPuck); if (!oc) return false; const dx = ownX - oc.x, dy = goalY - oc.y, dd = Math.hypot(dx, dy) || 1;
      // odstup jen proti nájezdu: nosič jede k naší brance rychleji než ATTACK_V (stojící/couvající se napadá hned)
      return dd > ENGAGE && (oc.vx * dx + oc.vy * dy) / dd > ATTACK_V; })()) {
    p._botMode = 'gap';
    // Nosič soupeře je ještě daleko od naší branky → nenapadej, drž odstup na obranné straně (zrcadli ho)
    const oc = [...match.players.values()].find(o => o.team !== p.team && o.hasPuck);
    const gx = ownX - oc.x, gy = goalY - oc.y, gd = Math.hypot(gx, gy) || 1;
    tx = oc.x + gx / gd * GAP; ty = oc.y + gy / gd * GAP;
    ax = oc.x; ay = oc.y;
  } else if (isChaser(p, match)) {
    p._botMode = 'chase';
    // Předstih = doba, za kterou bot k puku dojede (max LEAD_MAX), ne pevných 0.25 s — jinak jen ocasí nosiče
    // po kružnici (naměřeno: 65 px za ním, puk držel 98.8 % času) místo aby mu přeťal dráhu
    const lead = Math.min(LEAD_MAX, Math.max(PUCK_LEAD, Math.hypot(puck.x - p.x, puck.y - p.y) / PLAYER_V));
    tx = puck.x + puck.vx * lead; ty = puck.y + puck.vy * lead;
    ax = puck.x; ay = puck.y;
    // Puk těsně u soupeře (buly, scrum): najeď na něj z opačné strany, ne skrz soupeřovo tělo
    // (každý kontakt = knockback 85 px/s → stojícího člověka to odhodí o stovky px)
    const o = nearestOpp(p, match, tx, ty);
    if (o && !tucked(o)) {          // nosiče se staženým pukem (kurzor u těla) NEobjíždí — jde se o puk bojovat, jinak ho jen ocasí
      const ox = tx - o.x, oy = ty - o.y, od = Math.hypot(ox, oy) || 1;
      if (od < AVOID_R) { tx += ox / od * STANDOFF; ty += oy / od * STANDOFF; }
    }
    // Blízko puku se zastav tam, kde čepel (~REACH před tělem) dosáhne na puk; střed těla na puk by čepel
    // posunul za něj a bot by puk donekonečna obíhal (puk ležel 100+ s, bot kolem něj kroužil)
    const pdx = tx - p.x, pdy = ty - p.y, pd = Math.hypot(pdx, pdy);
    if (pd > REACH && pd < PICK_NEAR) { const k = (pd - REACH) / pd; tx = p.x + pdx * k; ty = p.y + pdy * k; }
  } else {
    ax = puck.x; ay = puck.y;
    p._botMode = 'support';                    // upřesněno níž (support/defend) podle držení
    const mates = [];                          // spoluhráči bez puku, seřazení podle vzdálenosti k puku (shoda → id)
    let carrier = null;
    for (const o of match.players.values()) {
      if (o.team !== p.team) continue;
      if (o.hasPuck) carrier = o; else mates.push(o);
    }
    mates.sort((a, c) => (Math.hypot(a.x - puck.x, a.y - puck.y) - Math.hypot(c.x - puck.x, c.y - puck.y)) || (a.id < c.id ? -1 : 1));
    const rank = mates.indexOf(p);
    const side = puck.y < RINK.h / 2 ? 1 : -1;  // strana ledu OPAČNÁ k puku
    // Support/defend podle TÝMOVÉHO držení, ne okamžitého carriera: volný puk (scrum) po NAŠEM doteku =
    // dál support (forecheck) → míň frantického přepínání support↔defend (role_churn). Obrana zůstává OKAMŽITÁ:
    // jakmile soupeř puk JASNĚ drží (oppHas), hned defend (bez prodlevy → stall/konverze beze změny).
    const oppHas = [...match.players.values()].some(o => o.team !== p.team && o.hasPuck);
    const teamHas = carrier || (!oppHas && match.lastTouch === p.team);
    if (teamHas) {
      // Náš hráč drží puk: nejbližší jde do útoku na opačné straně (volný pro pas), ostatní se drží za pukem
      const cd = carrier ? Math.hypot(goalX - carrier.x, goalY - carrier.y) : Infinity;
      if (rank === 0 && SUP_MOVE && carrier && cd < ZONE_D + 60) {
        // NABÍDKA PASU v útočném pásmu (2026-11-11): dřív stál na pevném místě vůči puku. Teď ~2× za s vybere
        // z pevných míst (zadní tyč, vysoký slot, kraj, modrá) to s volnou dráhou od nosiče a dál od soupeřů.
        if (!b.sup || match.tick >= b.supT) {
          const opps = oppsOf(p, match), cs = carrier.y < goalY ? 1 : -1;   // strana opačná k nosiči
          const spots = SUP_SPOTS.map(([fx, fy]) => [fx, cs * fy]);
          let best = null, bs = -Infinity;
          spots.forEach(([fx, fy], i) => {
            const sx = goalX - dir * fx, sy = goalY + fy;
            let open = 90; for (const o of opps) open = Math.min(open, Math.hypot(o.x - sx, o.y - sy));
            const lane = laneBlocker(opps, carrier.x, carrier.y, sx, sy, PASS_LANE) ? 0 : 60;
            const sc = lane + open - Math.hypot(sx - p.x, sy - p.y) * 0.15 + (b.sup === i + 1 ? 20 : 0);
            if (sc > bs) { bs = sc; best = i; }
          });
          b.sup = best + 1; b.supT = match.tick + TT(30);
        }
        const [fx, fy] = SUP_SPOTS[b.sup - 1];
        const cs = carrier.y < goalY ? 1 : -1;
        tx = goalX - dir * fx; ty = goalY + cs * fy;
        ax = carrier.x; ay = carrier.y;                // čelem k nosiči (hůl připravená na pas)
      } else if (rank === 0) {
        b.sup = 0;
        tx = clampX(puck.x + dir * SUP_AHEAD, goalX, dir); ty = RINK.h / 2 + side * SUP_WIDE;
      } else {
        tx = puck.x - dir * SUP_BACK * rank; ty = RINK.h / 2 - side * SUP_WIDE * 0.5;
      }
    } else {
      // ── OBRANA: puk drží soupeř / je volný. Rank 0 (nejblíž puku) tlačí na puk, ostatní
      //    si rozeberou soupeře OSOBNĚ (goal-side marking), ať to vypadá jako hra s lidmi. ──
      p._botMode = 'defend';
      const oppCarrier = [...match.players.values()].find(o => o.team !== p.team && o.hasPuck) || null;
      if (rank === 0 && SECOND_COVER && oppCarrier) {
        // Druhý obránce nejde na puk (to by byli dva na jednoho) — kryje prostor mezi nosičem a brankou
        tx = oppCarrier.x + (ownX - oppCarrier.x) * 0.55; ty = oppCarrier.y + (goalY - oppCarrier.y) * 0.55;
        ax = oppCarrier.x; ay = oppCarrier.y;
      } else if (rank === 0) {
        // Druhý na puku: tlač na nosiče/puk z vlastní strany (goal-side), ať ho zatlačí od branky
        const lead = Math.min(LEAD_MAX, Math.max(PUCK_LEAD, Math.hypot(puck.x - p.x, puck.y - p.y) / PLAYER_V));
        tx = puck.x + puck.vx * lead + dir * -6; ty = puck.y + puck.vy * lead;
      } else {
        // Nejnebezpečnější soupeři (bez nosiče — toho řeší chaser) = nejblíž naší brance; rozeber je
        const threats = [...match.players.values()]
          .filter(o => o.team !== p.team && o !== oppCarrier)
          .sort((a, c) => (Math.hypot(a.x - ownX, a.y - goalY) - Math.hypot(c.x - ownX, c.y - goalY)) || (a.id < c.id ? -1 : 1));
        const mark = threats[rank - 1] || threats[threats.length - 1] || null;
        if (mark) {
          // Postav se mezi soupeře a vlastní branku (goal-side), blíž k soupeři → bere pas i nájezd
          tx = mark.x + (ownX - mark.x) * 0.25; ty = mark.y + (goalY - mark.y) * 0.25;
          ax = mark.x; ay = mark.y;                 // čelem k bráněnému hráči
        } else {
          // Nikoho k bránění → stáhni se před vlastní branku (slot)
          tx = ownX + dir * CREASE_OUT; ty = goalY + side * 24;
        }
      }
    }
  }

  // Za kteroukoli brankovou čarou, v šířce sítě: nejdřív vyjeď bokem ze sítě (rovně by narazil do sítě/brankáře
  // a zůstal na místě navždy — naměřeno: bot s pukem i bez něj tam stál 100+ s)
  if ((p.x < RINK.goalLineLeft + 4 || p.x > RINK.goalLineRight - 4) && Math.abs(p.y - goalY) < NET_CLEAR) {
    tx = p.x; ty = goalY + (p.y >= goalY ? 1 : -1) * (NET_CLEAR + 25);
  }
  // Obejdi soupeře ležícího na cestě (kontakt = knockback 85 px/s). Dívá se dopředu po přímce k cíli,
  // uhne na tu stranu, kde soupeř NENÍ; bez soupeře na dráze se cíl nemění.
  {
    const ux0 = tx - p.x, uy0 = ty - p.y, m0 = Math.hypot(ux0, uy0);
    if (m0 > 1) {
      const ux = ux0 / m0, uy = uy0 / m0, nx = -uy, ny = ux;
      let bestAlong = Infinity, bestLat = 0, bestO = null;
      for (const o of match.players.values()) {
        if (o.team === p.team) continue;
        const rx = o.x - p.x, ry = o.y - p.y;
        const along = rx * ux + ry * uy, lat = rx * nx + ry * ny;
        if (!p.hasPuck && tucked(o)) continue;   // nosič se staženým pukem není překážka, ale cíl
        if (along > 0 && along < Math.min(m0 - 4, LOOK) && Math.abs(lat) < CLEAR && along < bestAlong) { bestAlong = along; bestLat = lat; bestO = o; }
      }
      if (bestAlong < Infinity) {
        // Nosič objíždí obránce na stranu OD jeho hole (čepel = dosah na puk); jinak tam, kde soupeř není
        const so = STICK_SIDE && p.hasPuck && bestO && Math.abs(bestLat) < STICK_LAT ? awayFromStick(bestO) * Math.sign(ny || 1e-9) * (Math.abs(ny) > 0.3 ? 1 : 0) : 0;
        const side = so || (bestLat > 0.5 ? -1 : bestLat < -0.5 ? 1 : (p.y < RINK.h / 2 ? 1 : -1));
        tx = p.x + ux * bestAlong + nx * side * CLEAR * 1.6; ty = p.y + uy * bestAlong + ny * side * CLEAR * 1.6;
      }
    }
  }
  const mx = tx - p.x, my = ty - p.y, m = Math.hypot(mx, my);
  inp.dx = m > 6 && Math.abs(mx) / m > DIAG ? Math.sign(mx) : 0;
  inp.dy = m > 6 && Math.abs(my) / m > DIAG ? Math.sign(my) : 0;
  // Nosič řídí plynule (jednotkový směr, stejná max. rychlost jako diagonála WASD): oblouk místo zubů 8 směrů,
  // které při kličce dělaly ostré „cuty" (carve model za ně bere rychlost → obránce nosiče dojel)
  if (ANALOG && p.hasPuck && m > 6) { inp.dx = mx / m; inp.dy = my / m; }
  inp.lmb = false;
  inp.aim = Math.atan2(ay - p.y, ax - p.x);
  // S pukem otáčej holí plynule: skok míření (honič→nosič míří najednou jinam) roztočil hůl nad práh
  // „anti-helikoptéry" a puk bot sám ztratil (chaos_meter: 16 % konců držení = sklouznutí). Člověk myší točí plynule.
  if (p.hasPuck && CARRY_TURN > 0 && b.lastAim != null) {
    let d = inp.aim - b.lastAim; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > CARRY_TURN) inp.aim = b.lastAim + Math.sign(d) * CARRY_TURN;
  }
  b.lastAim = inp.aim;
  inp.aimDist = Math.max(40, Math.hypot(ax - p.x, ay - p.y));
  // CRUISE podle režimu: útočná podpora, rozehra s pukem a čekání = pod kontrolou (klid, prostor).
  // OBRANA (chase/gap/defend) zůstává PLNÁ rychlost — zasahovat do ní rozbíjí stall/steal guardrail
  // (změřeno: zpomalení/zrychlení obránce kope stall mimo rubriku). Měřeno motion_probe + balance.
  const CRUISE = { support: 0.66, wait: 0.6 };
  inp.cruise = b.slow ? 0.6 : (CRUISE[p._botMode] ?? 1);
  b.slow = false;
}
