import { RINK, PLAYER, PUCK } from './constants.js';

export function computeCamera(canvas) {
  const pad = 48;
  const scale = Math.min(
    (canvas.width  - pad * 2) / RINK.w,
    (canvas.height - pad * 2) / RINK.h
  );
  return {
    scale,
    ox: (canvas.width  - RINK.w * scale) / 2,
    oy: (canvas.height - RINK.h * scale) / 2,
  };
}

export function toScreen(wx, wy, cam) {
  return { x: cam.ox + wx * cam.scale, y: cam.oy + wy * cam.scale };
}

export function fromScreen(sx, sy, cam) {
  return { x: (sx - cam.ox) / cam.scale, y: (sy - cam.oy) / cam.scale };
}

export function renderFrame(ctx, state, cam, score) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#07090f';
  ctx.fillRect(0, 0, width, height);

  renderRink(ctx, cam);
  renderPuck(ctx, state.puck, cam);
  for (const p of state.players) renderPlayer(ctx, p, cam);
  renderHUD(ctx, score, width);
}

function renderRink(ctx, cam) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const r = RINK.cornerR * s;

  // Ice surface
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, ox, oy, RINK.w * s, RINK.h * s, r);
  ctx.fillStyle = '#ddeef8';
  ctx.fill();
  ctx.strokeStyle = '#c0d8ec';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  // Goal creases
  drawCrease(ctx, cam, RINK.goalLineLeft, RINK.h / 2, 1);
  drawCrease(ctx, cam, RINK.goalLineRight, RINK.h / 2, -1);

  // Center circle
  ctx.beginPath();
  ctx.arc(ox + RINK.centerX * s, oy + RINK.h / 2 * s, 90 * s, 0, Math.PI * 2);
  ctx.strokeStyle = '#cc2233';
  ctx.lineWidth = 2.5 * s;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(ox + RINK.centerX * s, oy + RINK.h / 2 * s, 5 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#cc2233';
  ctx.fill();

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

  // Face-off dots
  const dotPositions = [
    [RINK.blueLineLeft - 110, RINK.goalY - 20],
    [RINK.blueLineLeft - 110, RINK.goalY + RINK.goalH + 20],
    [RINK.blueLineRight + 110, RINK.goalY - 20],
    [RINK.blueLineRight + 110, RINK.goalY + RINK.goalH + 20],
    [RINK.blueLineLeft + 100, RINK.h / 2],
    [RINK.blueLineRight - 100, RINK.h / 2],
  ];
  ctx.fillStyle = '#cc2233';
  for (const [dx, dy] of dotPositions) {
    ctx.beginPath();
    ctx.arc(ox + dx * s, oy + dy * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Goal lines (red)
  ctx.lineWidth = 2.5 * s;
  ctx.strokeStyle = '#cc2233';
  for (const glx of [RINK.goalLineLeft, RINK.goalLineRight]) {
    ctx.beginPath();
    ctx.moveTo(ox + glx * s, oy);
    ctx.lineTo(ox + glx * s, oy + RINK.h * s);
    ctx.stroke();
  }

  ctx.restore();

  // Goals (nets — outside clip so they protrude)
  drawGoal(ctx, cam, RINK.goalLineLeft,  RINK.goalY, RINK.goalH, 1,  '#3a9fff');
  drawGoal(ctx, cam, RINK.goalLineRight, RINK.goalY, RINK.goalH, -1, '#ff4455');
}

function drawCrease(ctx, cam, glx, cy, dir) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const cr = 80 * s;
  const x = ox + glx * s;
  const top = oy + (RINK.goalY + 20) * s;
  const bot = oy + (RINK.goalY + RINK.goalH - 20) * s;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.arcTo(x + dir * cr, top, x + dir * cr, bot, cr * 0.8);
  ctx.lineTo(x + dir * cr, bot);
  ctx.lineTo(x, bot);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 160, 255, 0.18)';
  ctx.fill();
  ctx.strokeStyle = '#2255cc';
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
}

function drawGoal(ctx, cam, glx, goalY, goalH, dir, color) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const depth = 55 * s;
  const x = ox + glx * s;
  const y1 = oy + goalY * s;
  const y2 = oy + (goalY + goalH) * s;
  const gw = goalH * s;

  // Net background
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x + dir * depth, y1 + depth * 0.25);
  ctx.lineTo(x + dir * depth, y2 - depth * 0.25);
  ctx.lineTo(x, y2);
  ctx.closePath();
  ctx.fill();

  // Net lines
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 0.8 * s;
  const steps = 5;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ny1 = y1 + (y2 - y1) * t;
    const offset = depth * 0.25 + (depth * 0.5 - depth * 0.25) * (Math.sin(t * Math.PI) * 0.5 + 0.5);
    ctx.beginPath();
    ctx.moveTo(x, ny1);
    ctx.lineTo(x + dir * depth, ny1);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(x, y1 + (y2 - y1) * t);
    ctx.lineTo(x + dir * depth * 0.95, y1 + (y2 - y1) * t);
    ctx.stroke();
  }

  // Posts and crossbar
  ctx.strokeStyle = color;
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5 * s;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x + dir * depth * 0.9, y1 + depth * 0.22);
  ctx.lineTo(x + dir * depth * 0.9, y2 - depth * 0.22);
  ctx.lineTo(x, y2);
  ctx.stroke();
}

function renderPlayer(ctx, p, cam) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const sx = ox + p.x * s;
  const sy = oy + p.y * s;
  const r = PLAYER.radius * s;
  const color = PLAYER.colors[p.team];

  // Shadow
  ctx.beginPath();
  ctx.ellipse(sx + 2, sy + 3, r * 0.9, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // Stick (behind body)
  const tipX = ox + (p.x + Math.cos(p.aimAngle) * PLAYER.stickLen) * s;
  const tipY = oy + (p.y + Math.sin(p.aimAngle) * PLAYER.stickLen) * s;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = 4 * s;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Blade
  const bladeLen = 14 * s;
  const bladeAngle = p.aimAngle + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(tipX - Math.cos(bladeAngle) * bladeLen * 0.4, tipY - Math.sin(bladeAngle) * bladeLen * 0.4);
  ctx.lineTo(tipX + Math.cos(bladeAngle) * bladeLen * 0.6, tipY + Math.sin(bladeAngle) * bladeLen * 0.6);
  ctx.strokeStyle = '#ccaa44';
  ctx.lineWidth = 3 * s;
  ctx.stroke();

  // Body
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();

  // Direction indicator (small dot on body front)
  const indX = sx + Math.cos(p.bodyAngle) * r * 0.55;
  const indY = sy + Math.sin(p.bodyAngle) * r * 0.55;
  ctx.beginPath();
  ctx.arc(indX, indY, 4 * s, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();

  // Charge indicator
  if (p.charge > 0.05) {
    ctx.beginPath();
    ctx.arc(sx, sy, r + 5 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge);
    ctx.strokeStyle = `rgba(255, ${220 - p.charge * 200}, 0, 0.85)`;
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function renderPuck(ctx, puck, cam) {
  const s = cam.scale;
  const { ox, oy } = cam;
  const sx = ox + puck.x * s;
  const sy = oy + puck.y * s;
  const r = PUCK.radius * s;

  // Shadow
  ctx.beginPath();
  ctx.ellipse(sx + 1.5, sy + 2, r * 0.9, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Puck
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1 * s;
  ctx.stroke();
}

function renderHUD(ctx, score, width) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(width / 2 - 90, 12, 180, 42);

  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = PLAYER.colors.home;
  ctx.fillText(score.home, width / 2 - 36, 44);

  ctx.fillStyle = '#888';
  ctx.fillText('–', width / 2, 44);

  ctx.fillStyle = PLAYER.colors.away;
  ctx.fillText(score.away, width / 2 + 36, 44);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
