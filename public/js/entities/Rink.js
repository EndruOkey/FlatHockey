import { RINK } from '../constants.js';

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
      ctx.strokeStyle = '#cc2233';
      ctx.lineWidth = 2.5 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#cc2233';
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

    ctx.restore();

    // Goals drawn outside clip — cage protrudes behind boards
    _drawGoal(ctx, cam, RINK.goalLineLeft,  -1, '#3a9fff');
    _drawGoal(ctx, cam, RINK.goalLineRight, +1, '#ff4455');
  }
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

  // Hash marks: crosshair inside the circle
  const hShort = 16 * s;  // short arm (toward center)
  const hLong  = 28 * s;  // long arm (away from center)
  const hOff   = 22 * s;  // distance from center to mark
  ctx.strokeStyle = '#cc2233';
  ctx.lineWidth = 2.5 * s;
  // Left and right marks (vertical lines at ±hOff)
  for (const dx of [-hOff, hOff]) {
    ctx.beginPath();
    ctx.moveTo(sx + dx, sy - hLong);
    ctx.lineTo(sx + dx, sy + hLong);
    ctx.stroke();
  }
  // Top and bottom marks (horizontal lines at ±hOff)
  for (const dy of [-hOff, hOff]) {
    ctx.beginPath();
    ctx.moveTo(sx - hLong, sy + dy);
    ctx.lineTo(sx + hLong, sy + dy);
    ctx.stroke();
  }
}

// Rectangular goal cage that protrudes outside the rink
// dir=+1: cage extends right (right goal), dir=-1: cage extends left (left goal)
function _drawGoal(ctx, cam, glx, dir, postColor) {
  const s     = cam.scale;
  const { ox, oy } = cam;
  const depth = RINK.goalDepth * s;
  const x     = ox + glx * s;
  const y1    = oy + RINK.goalY * s;
  const y2    = oy + (RINK.goalY + RINK.goalH) * s;
  const xBack = x + dir * depth;

  // Net fill
  ctx.fillStyle = 'rgba(200, 215, 230, 0.45)';
  ctx.beginPath();
  ctx.rect(Math.min(x, xBack), y1, depth, y2 - y1);
  ctx.fill();

  // Net lines — horizontal
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 0.8 * s;
  for (let i = 1; i < 6; i++) {
    const ny = y1 + (y2 - y1) * (i / 6);
    ctx.beginPath();
    ctx.moveTo(x, ny);
    ctx.lineTo(xBack, ny);
    ctx.stroke();
  }
  // Net lines — vertical
  for (let i = 1; i < 4; i++) {
    const nx = x + dir * depth * (i / 4);
    ctx.beginPath();
    ctx.moveTo(nx, y1);
    ctx.lineTo(nx, y2);
    ctx.stroke();
  }

  // White cage frame (top, back, bottom)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5 * s;
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(xBack, y1);
  ctx.lineTo(xBack, y2);
  ctx.lineTo(x, y2);
  ctx.stroke();

  // Colored goal post on goal line
  ctx.strokeStyle = postColor;
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();
}

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
