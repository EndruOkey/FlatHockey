export const RINK = {
  w: 1800, h: 760,
  cornerR: 90,
  goalLineLeft: 130,
  goalLineRight: 1670,
  goalY: 280, goalH: 200,
  blueLineLeft: 530,
  blueLineRight: 1270,
  centerX: 900,
};

export const PLAYER = {
  radius: 22,
  speed: 300,
  accel: 1100,
  decel: 800,
  stickLen: 52,
  pickupRadius: 60,
  pickupHalfAngle: Math.PI * 0.65,
  pickupMaxRelSpeed: 420,
  colors: { home: '#3a9fff', away: '#ff4455' },
};

export const PUCK = {
  radius: 9,
  decel: 90,
  bounce: 0.62,
  maxShotSpeed: 850,
  minShotSpeed: 180,
  passSpeed: 480,
  maxPassSpeed: 540,
};
