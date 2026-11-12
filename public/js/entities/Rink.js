import { VIS, HGT } from '../vis.js';
import { RINK, PUCK } from '../constants.js';
import { SKIN_OUT } from './skin.js';
import { netRoofH } from './Puck.js';

// Circle radius — slightly reduced so circles don't overlap goal mouth
const CIRCLE_R = 66;
// End-zone face-off spots: ~9ft inside goal line, 22ft from ice center each side
const FO_X = 248;   // midpoint between goalLine(90) and blueLine(405)
const FO_Y = 114;   // 22ft from ice center = ~110px from board

export class Rink {
  update() {}

  // PŘEDNÍ VRSTVA BRANKY (2026-11-12): kreslí se AŽ po brankáři a puku → tyčky a břevno jsou nad brankářem, mřížka střechy
  // přes puk uvnitř sítě (pod střechou); puk výš než síť v daném místě se nakreslí ještě jednou navrch.
  drawFront(ctx, cam, puck, goalies = []) {
    if (VIS.g === 5) {
      _drawGoal(ctx, cam, RINK.goalLineLeft, -1, '#3a9fff', 'front');
      _drawGoal(ctx, cam, RINK.goalLineRight, +1, '#ff4455', 'front');
      if (puck && !puck.ownerId && puck.z > 0.5 && puckAboveGoal(puck)) puck.draw(ctx, cam, null, true);
    }
    this._hitFx(ctx, cam, puck, goalies);
  }

  // ZÁBLESK ZÁSAHU (2026-11-12): co puk trefil, přesně kde — tyčka/břevno kovově bíle (+ rozsvícená tyčka), výstroj brankáře žlutě.
  // Zdroj: puck._postHit / goalie._hit (offline ze simulace, online ze snapshotu). Čas jen pro kresbu (performance.now).
  _hitFx(ctx, cam, puck, goalies) {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0), L = this._fx || (this._fx = []), seen = this._fxSeen || (this._fxSeen = new Map());
    const add = (src, h, kind) => { const n = h ? h.n : 0; if (!seen.has(src)) { seen.set(src, n); return; }   // 1. kreslení: jen zapamatuj stav (žádný záblesk ze starého zásahu)
      if (seen.get(src) === n) return; seen.set(src, n); if (h) L.push({ x: h.x, y: h.y, kind, t0: now }); };
    if (puck) add(puck, puck._postHit, puck._postHit?.k === 2 ? 'bar' : puck._postHit?.k === 3 ? 'net' : 'post');
    for (const g of goalies) if (g) add(g, g._hit, 'goalie');
    const s = cam.scale, DUR = 420;
    for (let i = L.length - 1; i >= 0; i--) {
      const f = L[i], u = (now - f.t0) / DUR; if (u >= 1 || u < 0) { L.splice(i, 1); continue; }
      const x = cam.ox + f.x * s, y = cam.oy + f.y * s, a = 1 - u, metal = f.kind === 'post' || f.kind === 'bar';
      ctx.save();
      if (f.kind === 'post') { ctx.beginPath(); ctx.arc(x, y, (2.0 + 1.5 * a) * s, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`; ctx.fill(); }   // rozsvícená tyčka
      if (f.kind === 'bar') { ctx.beginPath(); ctx.moveTo(x, y - 6 * s); ctx.lineTo(x, y + 6 * s); ctx.strokeStyle = `rgba(255,255,255,${0.9 * a})`; ctx.lineWidth = 2.4 * s; ctx.lineCap = 'round'; ctx.stroke(); }
      const col = metal ? '235,242,255' : f.kind === 'net' ? '150,215,255' : '255,206,40';   // tyč/břevno bíle, síť modře, brankář žlutě
      if (u < 0.35) { ctx.beginPath(); ctx.arc(x, y, 3.2 * s * (1 - u), 0, Math.PI * 2); ctx.fillStyle = `rgba(${col},${0.95 * (1 - u / 0.35)})`; ctx.fill(); }   // záblesk v bodě dotyku
      ctx.beginPath(); ctx.arc(x, y, (3 + 8 * u) * s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(20,30,50,${0.5 * a})`; ctx.lineWidth = (3.2 - 1.6 * u) * s; ctx.stroke();   // tmavý lem = čitelné i na ledu
      ctx.strokeStyle = `rgba(${col},${a})`; ctx.lineWidth = (2.2 - 1.2 * u) * s; ctx.stroke();
      ctx.restore();
    }
  }

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
function _drawGoal(ctx, cam, glx, dir, postColor, part = 'base') {
  // BRANKA S VÝŠKOU (2026-11-09): stejná projekce jako puk (obrazovka y = y − z) → břevno je
  // PUCK.crossbarHeight nad ledem, zadní horní hrana sítě níž (síť se k zadní stěně svažuje).
  const s = cam.scale, { ox, oy } = cam;
  const x = ox + glx * s, xB = x + dir * RINK.goalDepth * s;
  const y1 = oy + RINK.goalY * s, y2 = oy + (RINK.goalY + RINK.goalH) * s;
  if (VIS.g === 1) return _drawGoalTop(ctx, s, x, xB, y1, y2, dir, postColor);
  if (VIS.g === 5) return _drawGoalExact(ctx, s, x, xB, y1, y2, dir, postColor, PUCK.crossbarHeight * s, part);
  if (part === 'front') return;
  if (VIS.g === 3 || VIS.g === 4) return _drawGoalPersp(ctx, s, x, xB, y1, y2, dir, postColor, VIS.g === 4 ? 1.45 : 1 + HGT.k, PUCK.crossbarHeight * s);
  const H = PUCK.crossbarHeight * s * (VIS.g === 2 ? 0.35 : 1), HB = H * 0.55;
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
// G1 „čistý půdorys": branka shora stejně jako hráči a gólman (bez výšky). Síť = mřížka v půdorysu, tyčky = body v barvě týmu,
// břevno = čára přes ústí; obrys SKIN_OUT jako u hráčů, ať branka mluví stejným jazykem.
function _drawGoalTop(ctx, s, x, xB, y1, y2, dir, postColor) {
  const lo = Math.min(x, xB), w = Math.abs(xB - x), h = y2 - y1, rr = 4 * s;
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  // stín pod brankou (stejný směr světla jako hráči: vlevo nahoře → stín vpravo dole)
  ctx.fillStyle = 'rgba(20,40,70,0.16)'; ctx.beginPath(); ctx.roundRect(lo + 1.5 * s, y1 + 1.5 * s, w, h, rr); ctx.fill();
  // tělo sítě: zaoblený obdélník za brankovou čarou (otevřený k ledu)
  const net = new Path2D(); net.moveTo(x, y1); net.lineTo(xB - dir * rr, y1); net.quadraticCurveTo(xB, y1, xB, y1 + rr);
  net.lineTo(xB, y2 - rr); net.quadraticCurveTo(xB, y2, xB - dir * rr, y2); net.lineTo(x, y2);
  ctx.fillStyle = 'rgba(232,240,248,0.92)'; ctx.fill(net);
  // mřížka sítě
  ctx.save(); ctx.clip(net); ctx.strokeStyle = 'rgba(120,140,165,0.45)'; ctx.lineWidth = 0.6 * s; ctx.beginPath();
  for (let gx = 0; gx <= w; gx += 3.2 * s) { const xx = x + dir * gx; ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); }
  for (let gy = y1; gy <= y2; gy += 3.2 * s) { ctx.moveTo(lo, gy); ctx.lineTo(lo + w, gy); }
  ctx.stroke(); ctx.restore();
  // rám sítě: obrys jako hráči + bílá trubka
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 3.4 * s; ctx.stroke(net);
  ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = 1.8 * s; ctx.stroke(net);
  // břevno přes ústí + tyčky v barvě týmu
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 3.6 * s; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.strokeStyle = postColor; ctx.lineWidth = 2.2 * s; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  for (const yy of [y1, y2]) { ctx.beginPath(); ctx.arc(x, yy, 2.4 * s, 0, Math.PI * 2); ctx.fillStyle = postColor; ctx.fill(); ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 1.2 * s; ctx.stroke(); }
  ctx.restore();
}
// G3/G4 „top-down s hloubkou" (2026-11-12): kamera kolmo NAD brankou → vyšší body se zobrazí dál od středu branky
// (perspektiva, žádný posun nahoru jako u šikmé projekce). kH = zvětšení v úrovni břevna; zadní horní hrana sítě je níž (× 0.55 výšky).
function _drawGoalPersp(ctx, s, x, xB, y1, y2, dir, postColor, kH, Hs) {
  const cx = (x + xB) / 2, cy = (y1 + y2) / 2;
  const P = (px, py, zr) => { const k = 1 + (kH - 1) * zr; return [cx + (px - cx) * k, cy + (py - cy) * k]; };   // zr = výška / břevno
  const F1 = [x, y1], F2 = [x, y2], B1 = [xB, y1], B2 = [xB, y2];
  const T1 = P(x, y1, 1), T2 = P(x, y2, 1), U1 = P(xB, y1, 0.55), U2 = P(xB, y2, 0.55);
  const path = pts => { const q = new Path2D(); q.moveTo(pts[0][0], pts[0][1]); for (const v of pts.slice(1)) q.lineTo(v[0], v[1]); q.closePath(); return q; };
  const mesh = (A, B, C, D, n, m) => {   // mřížka v lichoběžníku A-B-C-D (A→B a D→C rovnoběžné strany)
    ctx.beginPath();
    for (let i = 1; i < n; i++) { const t = i / n; ctx.moveTo(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); ctx.lineTo(D[0] + (C[0] - D[0]) * t, D[1] + (C[1] - D[1]) * t); }
    for (let j = 1; j < m; j++) { const t = j / m; ctx.moveTo(A[0] + (D[0] - A[0]) * t, A[1] + (D[1] - A[1]) * t); ctx.lineTo(B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t); }
    ctx.stroke();
  };
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  // stín na ledu: půdorys ∪ horní rám posunutý o výšku × směr světla (HGT, stejně jako stín puku) — jedna cesta = bez dvojité tmy
  const sh = new Path2D(), off = (q, h) => [q[0] + h * HGT.lx, q[1] + h * HGT.ly], Hb = Hs * 0.55;
  const ring = pts => { sh.moveTo(pts[0][0], pts[0][1]); for (const v of pts.slice(1)) sh.lineTo(v[0], v[1]); sh.closePath(); };
  ring([F1, B1, B2, F2]); ring([off(F1, Hs), off(B1, Hb), off(B2, Hb), off(F2, Hs)]);
  ring([F1, off(F1, Hs), off(F2, Hs), F2]); ring([B1, off(B1, Hb), off(B2, Hb), B2]); ring([F1, off(F1, Hs), off(B1, Hb), B1]); ring([F2, off(F2, Hs), off(B2, Hb), B2]);
  ctx.fillStyle = 'rgba(20,40,70,0.16)'; ctx.fill(sh, 'nonzero');
  // podlaha sítě (led uvnitř) o tón tmavší = hloubka
  ctx.fillStyle = 'rgba(150,175,200,0.35)'; ctx.fill(path([F1, B1, B2, F2]));
  // stěny sítě: zadní, boční (lichoběžníky mezi ledem a horním rámem)
  const walls = [[B1, B2, U2, U1], [F1, B1, U1, T1], [F2, B2, U2, T2]];
  for (const w of walls) { ctx.fillStyle = 'rgba(225,235,245,0.55)'; ctx.fill(path(w)); }
  ctx.strokeStyle = 'rgba(110,130,155,0.45)'; ctx.lineWidth = 0.6 * s;
  mesh(B1, U1, U2, B2, 3, 6); mesh(F1, B1, U1, T1, 5, 3); mesh(F2, B2, U2, T2, 5, 3);
  // střecha sítě (nejvýš) — průsvitná mřížka, ať je vidět dovnitř
  ctx.fillStyle = 'rgba(240,246,252,0.45)'; ctx.fill(path([T1, U1, U2, T2]));
  ctx.strokeStyle = 'rgba(110,130,155,0.5)'; mesh(T1, U1, U2, T2, 5, 8);
  // spodní rám na ledu
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(F1[0], F1[1]); ctx.lineTo(B1[0], B1[1]); ctx.lineTo(B2[0], B2[1]); ctx.lineTo(F2[0], F2[1]); ctx.stroke();
  // horní rám + zadní svislé hrany: obrys jako hráči + bílá trubka
  const top = () => { ctx.beginPath(); ctx.moveTo(T1[0], T1[1]); ctx.lineTo(U1[0], U1[1]); ctx.lineTo(U2[0], U2[1]); ctx.lineTo(T2[0], T2[1]);
    ctx.moveTo(B1[0], B1[1]); ctx.lineTo(U1[0], U1[1]); ctx.moveTo(B2[0], B2[1]); ctx.lineTo(U2[0], U2[1]); ctx.stroke(); };
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 3.2 * s; top(); ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = 1.7 * s; top();
  // tyčky (z ledu k břevnu) + břevno v barvě týmu, s obrysem
  const posts = () => { ctx.beginPath(); ctx.moveTo(F1[0], F1[1]); ctx.lineTo(T1[0], T1[1]); ctx.lineTo(T2[0], T2[1]); ctx.lineTo(F2[0], F2[1]); ctx.stroke(); };
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 4.2 * s; posts(); ctx.strokeStyle = postColor; ctx.lineWidth = 2.6 * s; posts();
  // brankové ústí na ledu (slabá čára, není překážka)
  ctx.strokeStyle = _alphaHex(postColor, 0.45); ctx.lineWidth = 1.2 * s; ctx.beginPath(); ctx.moveTo(F1[0], F1[1]); ctx.lineTo(F2[0], F2[1]); ctx.stroke();
  ctx.restore();
}
// G5 „shora, hloubka stínem" (2026-11-12): rám, tyčky a břevno PŘESNĚ na kolizních čarách (Puck.js: boky y1/y2, záda goalDepth,
// tyčky POST_R 2 px) → co vidíš, to platí. Výška = jen stín podle HGT (stejné pravidlo jako puk), hloubka = tmavnutí sítě k zádům.
// Dvě vrstvy: 'base' (stín + vnitřek sítě, pod vším) a 'front' (mřížka střechy, rám, tyčky, břevno — po brankáři a puku, Rink.drawFront).
function _drawGoalExact(ctx, s, x, xB, y1, y2, dir, postColor, Hs, part = 'base') {
  const lo = Math.min(x, xB), w = Math.abs(xB - x), Hb = Hs * 0.55;
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  if (part === 'base') {
    const off = (q, h) => [q[0] + h * HGT.lx, q[1] + h * HGT.ly];
    const F1 = [x, y1], F2 = [x, y2], B1 = [xB, y1], B2 = [xB, y2];
    // vržený stín: půdorys ∪ rám ve výšce posunutý od světla (vpředu břevno H, vzadu Hb) — jedna cesta, bez dvojité tmy
    const sh = new Path2D(), ring = pts => { sh.moveTo(pts[0][0], pts[0][1]); for (const v of pts.slice(1)) sh.lineTo(v[0], v[1]); sh.closePath(); };
    const fo1 = off(F1, Hs), fo2 = off(F2, Hs), bo1 = off(B1, Hb), bo2 = off(B2, Hb);
    ring([F1, B1, B2, F2]); ring([fo1, bo1, bo2, fo2]); ring([F1, fo1, fo2, F2]); ring([B1, bo1, bo2, B2]); ring([F1, fo1, bo1, B1]); ring([F2, fo2, bo2, B2]);
    ctx.fillStyle = 'rgba(20,40,70,0.17)'; ctx.fill(sh, 'nonzero');
    // vnitřek sítě: od ústí (světlé) k zádům (tmavší) = hloubka
    const g = ctx.createLinearGradient(x, 0, xB, 0); g.addColorStop(0, 'rgba(235,242,250,0.9)'); g.addColorStop(1, 'rgba(150,170,195,0.95)');
    ctx.fillStyle = g; ctx.fillRect(lo, y1, w, y2 - y1);
    ctx.restore(); return;
  }
  // závoj sítě: co je pod střechou (puk v brance, záda brankáře), je vidět „za sítí" (2026-11-12)
  ctx.fillStyle = 'rgba(225,236,248,0.42)'; ctx.fillRect(lo, y1, w, y2 - y1);
  // mřížka střechy (přes puk/brankáře uvnitř sítě)
  ctx.save(); ctx.beginPath(); ctx.rect(lo, y1, w, y2 - y1); ctx.clip();
  ctx.strokeStyle = 'rgba(90,110,135,0.55)'; ctx.lineWidth = 0.6 * s; ctx.beginPath();
  for (let gx = 3.3 * s; gx < w; gx += 3.3 * s) { const xx = x + dir * gx; ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); }
  for (let gy = y1 + 3.3 * s; gy < y2; gy += 3.3 * s) { ctx.moveTo(lo, gy); ctx.lineTo(lo + w, gy); }
  ctx.stroke(); ctx.restore();
  // rám sítě přesně na kolizních stěnách (boky + záda): obrys + bílá trubka
  const frame = () => { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(xB, y1); ctx.lineTo(xB, y2); ctx.lineTo(x, y2); ctx.stroke(); };
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 2.6 * s; frame(); ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = 1.3 * s; frame();
  // břevno přes ústí + tyčky (kruh = kolizní tyčka) — nad brankářem
  ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 2.8 * s; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.strokeStyle = postColor; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  for (const yy of [y1, y2]) { ctx.beginPath(); ctx.arc(x, yy, 2.0 * s, 0, Math.PI * 2); ctx.fillStyle = postColor; ctx.fill(); ctx.strokeStyle = SKIN_OUT; ctx.lineWidth = 0.9 * s; ctx.stroke(); }
  ctx.restore();
}
// Je puk výš než branka v místě, kde je? (nad střechou sítě, nebo nad břevnem v ústí) → kreslí se nad přední vrstvou branky
export function puckAboveGoal(p) {
  const gy1 = RINK.goalY - PUCK.radius, gy2 = RINK.goalY + RINK.goalH + PUCK.radius;
  if (p.y < gy1 || p.y > gy2) return false;
  for (const [lineX, dir] of [[RINK.goalLineRight, 1], [RINK.goalLineLeft, -1]]) {
    const u = dir * (p.x - lineX);
    if (u >= -PUCK.radius && u <= RINK.goalDepth + PUCK.radius) return p.z >= netRoofH(Math.max(0, Math.min(RINK.goalDepth, u)));
  }
  return false;
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
