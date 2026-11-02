// Měřítko ≈ NHL: 1080×456 px = 200×85 ft → 5.3 px/ft. Velikosti sedí na realitu.
// TEMPO hry: jednotné zpomalení CELÉ simulace (bruslení, puk, gólman, časování botů) — hra vypadá stejně, jen klidněji.
// Časomíra a herní prodlevy (buly, píšťalka) běží v reálném čase. Pro měření lze přepsat env FH_TEMPO (jen Node).
const _envTempo = (typeof process !== 'undefined' && process.env && Number(process.env.FH_TEMPO)) || 0;
export const TEMPO = _envTempo > 0 ? _envTempo : 1;

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
  radius: 7,       // tělo (mírně nad realitou kvůli čitelnosti)
  speed: 180,      // ~34 ft/s top speed (realistický sprint) — DRŽ v souladu s bot.js PLAYER_V
  accel: 140,      // rozjezd — pomalejší, hráč rychlost BUDUJE (víc setrvačnosti, míň frantického svištění
                   // při plném hřišti); top speed zůstává, takže bot pořád obere nosiče (stall guardrail OK)
  decel: 70,       // skluz při puštění (glide), ale kontrolovatelný
  turnRate: 3.8,   // rotace — střed: ovladatelná, ne těžkopádná ani twitchy
  stickLen: 16,    // úměrně k tělu
  pickupTipRadius: 10,
  // Ochrana po převzetí puku (s): tak dlouho ho soupeř holí nevyrazí → méně chaosu. Env FH_GRACE pro měření.
  stealGrace: ((typeof process !== 'undefined' && process.env && process.env.FH_GRACE != null) ? Number(process.env.FH_GRACE) : 1.2),   // 1.2 = změřeno scripts/tempo_sweep.mjs (2026-11-02)     // dosah čepele na puk (velkorysejší úchop)
  pickupMaxRelSpeed: 420,  // ať jde chytit i rychlá přihrávka
  colors: { home: '#3a9fff', away: '#ff4455', passer: '#22cc88' },
};

export const PUCK = {
  radius: 3,        // reálně 3″ — zvětšeno kvůli viditelnosti/hratelnosti
  decel: 100,       // tření — vyšší, aby puk neujížděl přes celé hřiště (vybalancováno na 1080px)
  bounce: 0.62,
  maxShotSpeed: 470,   // „prdel" — plný slap (plné nabití)
  minShotSpeed: 150,   // „žabička" — malá měkká rána (lehký tap), umístěná, ne silová
  passSpeed: 320,
  maxPassSpeed: 370,
  maxShotVz: 160,   // max vertical speed — plný slap na břevno (~22px): horní roh dosažitelný. Pozn.: nižší (≤146) zavře top shelf skokem a zakončení je moc těžké (bot nestihne skórovat) — viz analýza.
  gravity: 580,     // px/s² downward
  gloveHeight: 4,   // z above which glove/blocker applies
  crossbarHeight: 21,  // břevno ~4 ft
};
