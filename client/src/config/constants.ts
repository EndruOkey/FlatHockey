// Rink world coordinates — matches server DEFAULT_RINK_BOUNDS
export const RINK = {
  left:   -560,
  right:   560,
  top:    -320,
  bottom:  320,
  width:  1120,
  height:  640,
  cx: 0,
  cy: 0,
  cornerRadius: 80,
} as const;

// Key rink lines (world x coordinates)
export const LINES = {
  blueLeft:   -185,
  blueRight:   185,
  goalLeft:   -490,
  goalRight:   490,
  centerCircleRadius: 55,
  faceoffCircleRadius: 48,
  creaseRadius: 52,
} as const;

// Goal dimensions
export const GOAL = {
  width:  72,   // post-to-post
  depth:  28,   // net depth
  postR:   4,
} as const;

// Faceoff dot positions
export const FACEOFF_DOTS: [number, number][] = [
  [-320, -140], [-320, 140],   // left zone
  [ 320, -140], [ 320, 140],   // right zone
];

export const PLAYER = {
  radius:    22,
  deadzone:  28,   // world px — don't move if mouse is this close
} as const;

export const PUCK_R = 10;

export const NET = {
  PROTOCOL_VERSION: 7,
  WS_PROD:  'wss://flathockey.fun/ws2',
  WS_LOCAL: 'ws://localhost:8080/ws2',
  INPUT_HZ: 20,
} as const;

export const COLORS = {
  bg:         0x0a1929,
  ice:        0xcfe8f3,
  iceShade:   0xbbdaed,
  boards:     0x8aafc0,
  centerLine: 0xcc0020,
  blueLine:   0x1565c0,
  goalLine:   0xcc0020,
  crease:     0x5b9ed6,
  creaseAlpha: 0.18,
  dot:        0xcc0020,
  teamA:      0x3a8fe0,
  teamB:      0xd95c30,
  ownIndicator: 0xffffff,
  puck:       0x0f1318,
  puckRim:    0x5dc4f0,
  puckOwned:  0xffe080,
  nameplate:  0xffffff,
  hud:        0xe8f0f5,
} as const;
