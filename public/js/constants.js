// Měřítko ≈ NHL: 1080×456 px = 200×85 ft → 5.3 px/ft. Velikosti sedí na realitu.
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
  speed: 180,      // ~34 ft/s top speed (realistický sprint)
  accel: 190,      // rozjezd — těžší push-off (cítit „led", ne pírko); cuty řeší seškrtnutí rychlosti
  decel: 70,       // skluz při puštění (glide), ale kontrolovatelný
  turnRate: 3.8,   // rotace — střed: ovladatelná, ne těžkopádná ani twitchy
  stickLen: 16,    // úměrně k tělu
  pickupTipRadius: 10,     // dosah čepele na puk (velkorysejší úchop)
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
  maxShotVz: 158,   // max vertical speed on full-charge shot
  gravity: 580,     // px/s² downward
  gloveHeight: 4,   // z above which glove/blocker applies
  crossbarHeight: 21,  // břevno ~4 ft
};
