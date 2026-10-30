// Živý mini-kluziště náhled v šatně — hráč shora v nastavených barvách, jemné "idle" bruslení.
// Reuses the real in-game top-down renderer (entities/Player.js _renderPlayer via p.draw),
// so the preview matches the actual match look (jersey color, helmet, gloves, stick, tape, number).
import { Player } from './entities/Player.js';
import { PLAYER, RINK } from './constants.js';

// Jemný idle-skate: hráč krouží po malé kružnici kolem středu plátna.
// getKit() → aktuální výbava; isActive() → zda je šatna viditelná.
export function initLockerPreview(canvasId, getKit) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.getContext) return { start() {}, stop() {}, redraw() {} };
  const ctx = canvas.getContext('2d');

  const p = new Player('lk-preview', 'home', null);
  // Stabilní poza (mirror existujícího profilového náhledu)
  p._dispReach = PLAYER.stickLen;
  p._dispCharge = 0; p.charge = 0; p.passReq = 0; p.crossCheck = false;

  const CX = RINK.w / 2, CY = RINK.h / 2;   // střed kružnice (svět)
  const R  = 11;                            // poloměr idle-okruhu (svět)
  const S  = Math.min(canvas.width / 90, canvas.height / 70);  // měřítko pro ~260×190
  const cam = { scale: S, ox: canvas.width / 2 - CX * S, oy: canvas.height / 2 - CY * S };

  let angle = 0;         // fáze okruhu
  let raf = null;
  let last = 0;

  function drawIce() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // led
    const pad = 6, rr = 14;
    ctx.beginPath();
    _round(ctx, pad, pad, w - pad * 2, h - pad * 2, rr);
    ctx.fillStyle = '#d6e6f2';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,200,0.6)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.save();
    ctx.beginPath(); _round(ctx, pad, pad, w - pad * 2, h - pad * 2, rr); ctx.clip();
    // středový kruh + čára
    ctx.strokeStyle = 'rgba(204,34,51,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, pad); ctx.lineTo(w / 2, h - pad); ctx.stroke();
    ctx.fillStyle = 'rgba(204,34,51,0.7)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    angle = (angle + 0.55 * dt) % (Math.PI * 2);

    const k = getKit();
    p.handed = k.hand === -1 ? -1 : 1;
    p.color = k.jersey; p.helmet = k.helmet; p.gloves = k.gloves; p.tape = k.tape;
    p.stick = k.stick; p.tapeStyle = k.tapeStyle; p.helmetType = k.helmetType; p.visor = k.visor;
    const n = parseInt(k.num, 10);
    p.num = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null;
    p.name = '';

    // poloha na malém okruhu → vypadá to jako klidné bruslení
    p.x = CX + Math.cos(angle) * R;
    p.y = CY + Math.sin(angle) * R;
    const heading = angle + Math.PI / 2;            // tečna okruhu
    p.bodyAngle = p.skateAngle = heading;
    // zdánlivá rychlost pohání animaci kroku (stride) v rendereru
    p.vx = Math.cos(heading) * 95; p.vy = Math.sin(heading) * 95;
    p.aimAngle = p.carryAngle = p._stickDisp = heading + p.handed * 0.55;  // hůl mírně do strany ruky

    drawIce();
    try { p.draw(ctx, cam); } catch {}
  }

  function start() { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop()  { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  return { start, stop, redraw() { drawIce(); } };
}

function _round(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
