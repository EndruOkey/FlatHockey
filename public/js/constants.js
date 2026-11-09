// Měřítko ≈ NHL: 1080×456 px = 200×85 ft → 5.3 px/ft. Velikosti sedí na realitu.
// TEMPO hry: jednotné zpomalení CELÉ simulace (bruslení, puk, gólman, časování botů) — hra vypadá stejně, jen klidněji.
// Časomíra a herní prodlevy (buly, píšťalka) běží v reálném čase. Pro měření lze přepsat env FH_TEMPO (jen Node).
const _envTempo = (typeof process !== 'undefined' && process.env && Number(process.env.FH_TEMPO)) || 0;
export const TEMPO = _envTempo > 0 ? _envTempo : 1;

const _penv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k] != null && process.env[k] !== '') ? Number(process.env[k]) : d;

export const RINK = {
  w: 1080, h: 456,
  cornerR: 80,
  goalLineLeft: 90,
  goalLineRight: 990,
  goalY: 206, goalH: 44,   // ústí branky — mírně nad realitou kvůli hratelnosti
  goalDepth: 20,
  blueLineLeft: 405,
  blueLineRight: 675,
  centerX: 540,
  // Trapézová zóna (NHL Rule 1.7): golman smí hrát puk za brankou jen v trapézu
  // 6ft od každé tyčky na brankové čáře → 32px; 14ft od středu u zadního mantinelu → 74px
  trapTopLine:  174,   // y horní hranice u brankové čáry  (206 − 32)
  trapBotLine:  282,   // y dolní hranice u brankové čáry  (250 + 32)
  trapTopBoard: 154,   // y horní hranice u zadního mantinelu (228 − 74)
  trapBotBoard: 302,   // y dolní hranice u zadního mantinelu (228 + 74)
};

export const PLAYER = {
  radius: _penv('FH_RADIUS', 7),       // tělo (mírně nad realitou kvůli čitelnosti). 2026-11-09: zpět 6→7 — místo menších panáků je režim HRÁT/Sólo 2v2 (chaos_meter: skrumáž 8,9→5,0 %)
  // Srážka hráč–hráč a zastavení hokejky o tělo: podle NAKRESLENÝCH ramen (trup 1.25×radius), jinak se těla
  // na obrazovce překrývala (scripts/body_overlap.mjs: 18 % blízkých dvojic). Braní puku/gólman dál přes radius.
  bodyRadius: _penv('FH_BODYR', 8),    // ≈ ramena (1.25 × radius = 8.75); 8 = nejvíc, co drží stall rubriku (8.75 → stall 93.7 % MIMO, 8 → 73.6 %; scripts/stall_only.mjs)
  speed: _penv('FH_PSPEED', 165),      // 180→165 (−8 %): pomalejší relativní tempo = víc času číst hru (náhrada „bigger rink" pocitu). 165 = změřené bezpečné dno (150 už rozbije stall). DRŽ v souladu s bot.js PLAYER_V (čte stejný FH_PSPEED)
  accel: 140,      // rozjezd — pomalejší, hráč rychlost BUDUJE (víc setrvačnosti, míň frantického svištění
                   // při plném hřišti); top speed zůstává, takže bot pořád obere nosiče (stall guardrail OK)
  decel: 70,       // skluz při puštění (glide), ale kontrolovatelný
  turnRate: 3.8,   // rotace — střed: ovladatelná, ne těžkopádná ani twitchy
  stickLen: _penv('FH_STICK', 16),    // dosah hole na puk (= balanc, NEzkracovat: 14 rozbilo bot_1v1 a stall). Vizuální délka se krátí zvlášť přes stickDraw.
  stickDraw: _penv('FH_STICKDRAW', 0.86),   // jen VIZUÁLNÍ zkrácení kreslené hole (dřík+čepel), nemění dosah/pickup → hůl nepůsobí dlouhá u menšího těla
  pickupTipRadius: 10,
  shield: _penv('FH_SHIELD', 0.4),   // krytí tělem: cos úhlu (nosič→puk vs nosič→soupeř) pod tímto = kryto; −2 = vypnuto
  stealR: _penv('FH_STEALR', 10),
  // VIZUÁL STŘELY TAHEM (2026-11-09): nápřah stáhne hůl dozadu na forhend (windBack rad) a puk k tělu (windPull = podíl
  // zkrácení dosahu); po ráně švih dopředu s dokončením přes směr střely (followArc rad, followT s).
  windBack: _penv('FH_WINDBACK', 1.75), windPull: _penv('FH_WINDPULL', 0.5), followArc: _penv('FH_FOLLOW', 0.6), followT: 0.2,
  // MĚKKÉ DRŽENÍ (2026-11-09): puk jezdí za čepelí; obvodová rychlost čepele nad gripV px/s → puk zaostává (lag px),
  // lag > loseLag → ztráta. Deterministické (žádná kostka). 0 = staré náhodné „anti-helikoptéra“.
  softCarry: _penv('FH_SOFT', 1), gripV: _penv('FH_GRIPV', 150), loseLag: _penv('FH_LOSELAG', 6), lagRecover: _penv('FH_LAGREC', 40),
  shContact: _penv('FH_SHCONTACT', 0.8),   // tělo na tělo (vzdálenost středů < 2×bodyRadius + 6) → práh krytí nižší o tolik (útočník se opře a natáhne hůl kolem)
  tuckF: _penv('FH_TUCKF', 0.75),   // puk stažený u těla (kurzor < 30 px) → max. rychlost × tuckF (kurzor 10 px = plný postih); 1 = vypnuto
  softRel: _penv('FH_SOFTREL', 1),   // 1 = do měkkého držení počítej jen pohyb hole VŮČI TĚLU (ruce), ne otáčení těla při jízdě
  // SOUBOJ HOLÍ: čepel soupeře na puku sbírá tlak = relativní rychlost čepel×puk (px) + základ fightBase px/s;
  // tlak > kontrola nosiče → puk vyskočí ve směru tahu. 0 = staré pasivní obrání.
  // 2026-11-09: FCTRL 30 už shodí stall rubriku (95 %), 25 = hrana s rezervou. scripts/carry_lab.mjs + rubrika.
  fight: _penv('FH_FIGHT', 1), fightCtrl: _penv('FH_FCTRL', 25), fightBase: _penv('FH_FBASE', 15), fightDecay: _penv('FH_FDECAY', 30),   // obrání = stejná zóna jako převzetí (zelený kroužek). Dřív 9,2 → "najedu do hole a nic" (scripts/steal_match.mjs)
  // Ochrana po převzetí puku (s): tak dlouho ho soupeř holí nevyrazí → méně chaosu. Env FH_GRACE pro měření.
  // Kontakt a crosscheck (2026-11-02; env FH_* jen pro měření v Node)
  kbMax:    _penv('FH_KBMAX', 45),     // px/s — strop odrazu při srážce (dřív pevných 85)
  kbFactor: _penv('FH_KBF', 0.35),     // odraz = rychlost srážky × faktor
  ccSpeed:  _penv('FH_CCSPD', 0.9),    // rychlost při crosschecku × top speed (dřív 1.12)
  ccPush:   _penv('FH_CCPUSH', 80),    // px/s — strčení soupeře crosscheckem (dřív 120)
  receiveFirst: _penv('FH_RECV', 1) > 0,   // pas, který jde zpracovat, hráč převezme (dřív se od hole náhodně odrazil)
  stealGrace: ((typeof process !== 'undefined' && process.env && process.env.FH_GRACE != null) ? Number(process.env.FH_GRACE) : 0.8),   // 2026-11-09 1.5→0.8: neviditelná ochrana blokovala 29 % kontaktů (steal_match). Dřív 1.2→1.5: nosič udrží čerstvý puk o kus déle → míň pranic/turnoverů (fel klidnější, víc stavění akcí). Měřeno rubrikou.
  pickupMaxRelSpeed: 420,
  // Adresát přihrávky má větší zónu převzetí (pas míří na tělo, čepel je 16 px před ním). Soupeř zachytává normálně.
  passRecvRadius: _penv('FH_RECVR', 18),
  passRecvMaxRel: _penv('FH_RECVREL', 560),  // ať jde chytit i rychlá přihrávka
  colors: { home: '#3a9fff', away: '#ff4455', passer: '#22cc88' },
};

export const PUCK = {
  radius: 3,        // reálně 3″ — zvětšeno kvůli viditelnosti/hratelnosti
  decel: 100,       // tření — vyšší, aby puk neujížděl přes celé hřiště (vybalancováno na 1080px)
  bounce: 0.62,
  maxShotSpeed: 470,   // „prdel" — plný slap (plné nabití)
  minShotSpeed: 150,   // „žabička" — malá měkká rána (lehký tap), umístěná, ne silová
  passSpeed: 320,
  maxPassSpeed: 450,   // 370→450 + passBase 110→250: pas letí 2× rychleji (0,73→0,36 s), převzetí 96→100 % (scripts/pass_stride.mjs), rubrika zelená
  passBase: 250,    // rychlostní rezerva nad „doklouzání“ k cíli (px/s) — viz passSpeedFor
  maxShotVz: 160,   // max vertical speed — plný slap na břevno (~22px): horní roh dosažitelný. Pozn.: nižší (≤146) zavře top shelf skokem a zakončení je moc těžké (bot nestihne skórovat) — viz analýza.
  gravity: 580,     // px/s² downward
  gloveHeight: 4,   // z above which glove/blocker applies
  crossbarHeight: 21,  // břevno ~4 ft
  boardHeight: 16,     // hrana mantinelu (~3 ft, mírně pod realitou 3,5 ft, ať je sklo ve hře); výš = plexisklo / u střídaček ven
};

// Rychlost přihrávky podle vzdálenosti: doklouzání k cíli + rezerva, ať dorazí ostře. JEDINÉ místo
// (server.js i match-core.js). Env FH_PASSBASE / FH_PASSMAX jen pro měření v Node (scripts/pass_stride.mjs).
// Spodní mez 400 px/s: i krátký pas je pro soupeře v dráze nad limitem čistého převzetí (420 × 0,9) → odrazí se mu od hole,
// adresát ho převezme (limit 560). Audit K9 (dřív 210 → pas na 80 px 376 px/s šel soupeři čistě sebrat).
const PASS_FLOOR = _penv('FH_PASSFLOOR', 400);
export function passSpeedFor(dist) {
  const base = _penv('FH_PASSBASE', PUCK.passBase), max = _penv('FH_PASSMAX', PUCK.maxPassSpeed);
  return Math.max(PASS_FLOOR, Math.min(max, Math.sqrt(2 * PUCK.decel * dist) + base));
}
