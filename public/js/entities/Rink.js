import { RINK, PUCK } from '../constants.js';

// Circle radius — slightly reduced so circles don't overlap goal mouth
const CIRCLE_R = 66;
// End-zone face-off spots: ~9ft inside goal line, 22ft from ice center each side
const FO_X = 248;   // midpoint between goalLine(90) and blueLine(405)
const FO_Y = 114;   // 22ft from ice center = ~110px from board

export class Rink {
  update() {}

  draw(ctx, cam) {
    const s = cam.scale;
    const { ox, oy } = cam;
    const r = RINK.cornerR * s;

    ctx.save();
    ctx.beginPath();
    _roundRect(ctx, ox, oy, RINK.w * s, RINK.h * s, r);
    ctx.fillStyle = '#ddeef8';
    ctx.fill();
    ctx.strokeStyle = '#c0d8ec';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    // Creases: D-shape, drawn first so lines appear on top
    _drawCrease(ctx, cam, RINK.goalLineLeft,   1);
    _drawCrease(ctx, cam, RINK.goalLineRight, -1);

    // Center circle (no hash marks, just circle + dot)
    {
      const cx = ox + RINK.centerX * s;
      const cy = oy + RINK.h / 2 * s;
      ctx.beginPath();
      ctx.arc(cx, cy, CIRCLE_R * s, 0, Math.PI * 2);
      ctx.strokeStyle = '#2255cc';   // středový kruh modrý (návrh UI)
      ctx.lineWidth = 2.5 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#2255cc';
      ctx.fill();
    }

    // Center red line
    ctx.beginPath();
    ctx.moveTo(ox + RINK.centerX * s, oy);
    ctx.lineTo(ox + RINK.centerX * s, oy + RINK.h * s);
    ctx.strokeStyle = '#cc2233';
    ctx.lineWidth = 3 * s;
    ctx.stroke();

    // Blue lines
    for (const bx of [RINK.blueLineLeft, RINK.blueLineRight]) {
      ctx.beginPath();
      ctx.moveTo(ox + bx * s, oy);
      ctx.lineTo(ox + bx * s, oy + RINK.h * s);
      ctx.strokeStyle = '#2255cc';
      ctx.lineWidth = 5 * s;
      ctx.stroke();
    }

    // End-zone face-off circles (4) — deep in zone, with hash marks
    for (const cx of [FO_X, RINK.w - FO_X]) {
      _drawFaceoffCircle(ctx, cam, cx, FO_Y);
      _drawFaceoffCircle(ctx, cam, cx, RINK.h - FO_Y);
    }

    // Neutral zone face-off dots (4) — u modrých čar, v obou řadách (sedí na buly body)
    ctx.fillStyle = '#cc2233';
    for (const bx of [RINK.blueLineLeft + 30, RINK.blueLineRight - 30]) {
      for (const fy of [FO_Y, RINK.h - FO_Y]) {
        ctx.beginPath();
        ctx.arc(ox + bx * s, oy + fy * s, 5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Goal lines (full board-to-board)
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = '#cc2233';
    for (const glx of [RINK.goalLineLeft, RINK.goalLineRight]) {
      ctx.beginPath();
      ctx.moveTo(ox + glx * s, oy);
      ctx.lineTo(ox + glx * s, oy + RINK.h * s);
      ctx.stroke();
    }

    // Trapézové čáry za oběma brankami (NHL Rule 1.7)
    _drawTrapezoid(ctx, cam, RINK.goalLineLeft,  -1);
    _drawTrapezoid(ctx, cam, RINK.goalLineRight, +1);

    ctx.restore();

    // Goals drawn outside clip — cage protrudes behind boards
    _drawGoal(ctx, cam, RINK.goalLineLeft,  -1, '#3a9fff');
    _drawGoal(ctx, cam, RINK.goalLineRight, +1, '#ff4455');
    _drawGlassAndBenches(ctx, cam);
  }
}

// PLEXISKLO + STŘÍDAČKY (2026-11-09): světlá linka skla kolem mantinelu; nahoře mezi modrými čarami sklo NENÍ
// (střídačky) → tam může vysoký puk vyletět ven (Puck._out). Střídačky = tmavé lavice v barvách týmů nad ledem.
function _drawGlassAndBenches(ctx, cam) {
  const s = cam.scale, { ox, oy } = cam, g = 4 * s;          // sklo kreslené 4 px vně mantinelu
  const bl = RINK.blueLineLeft, br = RINK.blueLineRight, cx = RINK.centerX;
  ctx.save();
  // střídačky
  const bh = 22 * s, by = oy - g - bh - 2 * s, gap = 14;
  for (const [x0, x1, col] of [[bl + 8, cx - gap, '#3a9fff'], [cx + gap, br - 8, '#ff4455']]) {
    ctx.fillStyle = 'rgba(20,28,44,0.92)'; ctx.fillRect(ox + x0 * s, by, (x1 - x0) * s, bh);
    ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fillRect(ox + x0 * s, by + bh - 3 * s, (x1 - x0) * s, 3 * s); ctx.globalAlpha = 1;
  }
  // sklo: obvod zaobleného obdélníku o g větší, s vynechanou mezerou u střídaček (horní strana mezi bl..br)
  ctx.strokeStyle = 'rgba(170,215,245,0.85)'; ctx.lineWidth = 2.5 * s; ctx.lineCap = 'round';
  const R = RINK.cornerR * s + g, X0 = ox - g, Y0 = oy - g, X1 = ox + RINK.w * s + g, Y1 = oy + RINK.h * s + g;
  ctx.beginPath();
  ctx.moveTo(ox + br * s, Y0); ctx.lineTo(X1 - R, Y0); ctx.arcTo(X1, Y0, X1, Y0 + R, R);
  ctx.lineTo(X1, Y1 - R); ctx.arcTo(X1, Y1, X1 - R, Y1, R); ctx.lineTo(X0 + R, Y1); ctx.arcTo(X0, Y1, X0, Y1 - R, R);
  ctx.lineTo(X0, Y0 + R); ctx.arcTo(X0, Y0, X0 + R, Y0, R); ctx.lineTo(ox + bl * s, Y0);
  ctx.stroke();
  ctx.restore();
}

// D-shaped crease: flat side on goal line, arc points into the ice
// dir=+1: extends right (left goal), dir=-1: extends left (right goal)
function _drawCrease(ctx, cam, glx, dir) {
  const s    = cam.scale;
  const { ox, oy } = cam;
  const sx   = ox + glx * s;
  const sy   = oy + (RINK.goalY + RINK.goalH / 2) * s;
  const half = RINK.goalH / 2 * s;

  ctx.beginPath();
  ctx.moveTo(sx, sy - half);
  // Arc: top → (through the ice side) → bottom
  // dir=1 → right side of circle (CCW=false sweeps through positive x)
  // dir=-1 → left side of circle (CCW=true sweeps through negative x)
  ctx.arc(sx, sy, half, -Math.PI / 2, Math.PI / 2, dir !== 1);
  ctx.closePath();  // straight line back along goal line

  ctx.fillStyle = 'rgba(100, 160, 255, 0.22)';
  ctx.fill();
  ctx.strokeStyle = '#2255cc';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
}

function _drawFaceoffCircle(ctx, cam, cx, cy) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const sx = ox + cx * s;
  const sy = oy + cy * s;
  const sr = CIRCLE_R * s;

  // Circle
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.strokeStyle = '#cc2233';
  ctx.lineWidth = 2 * s;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(sx, sy, 5 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#cc2233';
  ctx.fill();

  // Bez vnitřní mřížky „#“ (vypadala jako čtverec v kruhu) — jen kruh + tečka (návrh UI 2026-11-02)
}

// Trapézové čáry za brankou (dir=+1: vpravo k x=1080, dir=-1: vlevo k x=0)
function _drawTrapezoid(ctx, cam, glx, dir) {
  const s = cam.scale, { ox, oy } = cam;
  const endX = glx + dir * 90;
  ctx.strokeStyle = '#cc2233';
  ctx.lineWidth = 2 * s;
  ctx.setLineDash([5 * s, 4 * s]);
  ctx.beginPath();
  ctx.moveTo(ox + glx * s,  oy + RINK.trapTopLine  * s);
  ctx.lineTo(ox + endX * s, oy + RINK.trapTopBoard * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ox + glx * s,  oy + RINK.trapBotLine  * s);
  ctx.lineTo(ox + endX * s, oy + RINK.trapBotBoard * s);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Rectangular goal cage that protrudes outside the rink
// dir=+1: cage extends right (right goal), dir=-1: cage extends left (left goal)
function _drawGoal(ctx, cam, glx, dir, postColor) {
  // BRANKA S VÝŠKOU (2026-11-09): stejná projekce jako puk (obrazovka y = y − z) → břevno je
  // PUCK.crossbarHeight nad ledem, zadní horní hrana sítě níž (síť se k zadní stěně svažuje).
  const s = cam.scale, { ox, oy } = cam;
  const x = ox + glx * s, xB = x + dir * RINK.goalDepth * s;
  const y1 = oy + RINK.goalY * s, y2 = oy + (RINK.goalY + RINK.goalH) * s;
  const H = PUCK.crossbarHeight * s, HB = H * 0.55;
  const poly = (pts, fill, stroke, lw) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  const mesh = (A, B, C, D, n) => {   // příčky sítě mezi hranami A→B a D→C
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.7 * s;
    for (let i = 1; i < n; i++) { const t = i / n; ctx.beginPath();
      ctx.moveTo(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); ctx.lineTo(D[0] + (C[0] - D[0]) * t, D[1] + (C[1] - D[1]) * t); ctx.stroke(); }
  };
  // stín branky na ledu (půdorys)
  poly([[x, y1], [xB, y1], [xB, y2], [x, y2]], 'rgba(20,40,70,0.18)');
  // spodní rám na ledu (zadní + boky)
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(xB, y1); ctx.lineTo(xB, y2); ctx.lineTo(x, y2); ctx.stroke();
  // zadní stěna sítě (svislá) + horní střecha sítě
  const fT = [x, y1 - H], fB = [x, y2 - H], bT = [xB, y1 - HB], bB = [xB, y2 - HB];
  poly([[xB, y1], [xB, y2], bB, bT], 'rgba(200,215,230,0.35)');
  poly([fT, bT, bB, fB], 'rgba(205,220,235,0.55)');
  mesh(fT, bT, bB, fB, 4); mesh(fT, fB, bB, bT, 6);
  // horní boční stěna (u y1 je vidět „shora")
  poly([[x, y1], [xB, y1], bT, fT], 'rgba(200,215,230,0.45)'); mesh([x, y1], fT, bT, [xB, y1], 3);
  // horní rám sítě
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.moveTo(fT[0], fT[1]); ctx.lineTo(bT[0], bT[1]); ctx.lineTo(bB[0], bB[1]); ctx.lineTo(fB[0], fB[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(xB, y1); ctx.lineTo(bT[0], bT[1]); ctx.moveTo(xB, y2); ctx.lineTo(bB[0], bB[1]); ctx.stroke();
  // tyčky (svisle) + břevno v barvě týmu
  ctx.strokeStyle = postColor; ctx.lineWidth = 3.5 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(fT[0], fT[1]); ctx.lineTo(fB[0], fB[1]); ctx.lineTo(x, y2); ctx.stroke();
  // dolní tyčka přes ústí — slabší (je to čára u ledu, ne překážka)
  ctx.strokeStyle = _alphaHex(postColor, 0.45); ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
}
function _alphaHex(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}
