export const RINK = {
  w: 1080, h: 456,
  cornerR: 80,
  goalLineLeft: 90,
  goalLineRight: 990,
  goalY: 192, goalH: 72,
  goalDepth: 24,
  blueLineLeft: 405,
  blueLineRight: 675,
  centerX: 540,
};

export const PLAYER = {
  radius: 11,
  speed: 180,
  accel: 300,      // svižný rozjezd i reakce v zatáčce (ne těžkopádné)
  decel: 70,       // skluz při puštění (glide), ale kontrolovatelný
  turnRate: 3.3,
  stickLen: 26,
  pickupTipRadius: 13,     // puck must be within 13px of blade tip
  pickupMaxRelSpeed: 252,
  colors: { home: '#3a9fff', away: '#ff4455', passer: '#22cc88' },
};

export const PUCK = {
  radius: 4,
  decel: 54,
  bounce: 0.62,
  maxShotSpeed: 510,
  minShotSpeed: 108,
  passSpeed: 288,
  maxPassSpeed: 324,
  maxShotVz: 150,   // max vertical speed on full-charge shot
  gravity: 580,     // px/s² downward
  gloveHeight: 7,   // z above which glove/blocker applies
  crossbarHeight: 18,
};
