// SKIN „C-d2 Týmová grafika" — kresba hokejisty a gólmana shora (2026-11-11).
// Sdílí ji hra (Player.js, Goalie.js) i náhled scripts/visual_variants.html (vkládá se skriptem scripts/visual_build.mjs).
// Vše kreslí ve SVĚTOVÝCH jednotkách: volající nastaví ctx.translate/rotate/scale(s). Bez importů, bez DOM kromě Path2D.
// Zásady (měřeno v náhledu, sekce C-d2): tělo = JEDNA sjednocená cesta (trup + ramena + paže + kalhoty + štulpny + helma),
// obrys se kreslí jednou pod výplněmi → zůstane jen na vnější hraně; stínování jedním překryvem přes celé tělo;
// vnitřní linky jen tam, kde nesou informaci (číslo, vzor dresu, manžeta, mřížka/plexi, hřebínek helmy).

export const SKIN_OUT = '#121a2c';
export const SKIN_ICE = '#ddeef8';
export const JERSEY_PATTERNS = ['solid', 'shoulder', 'stripes', 'sleeves', 'diagonal', 'checker', 'gradient', 'retro'];
export const MASK_STYLES = ['team', 'stripe', 'flame', 'split'];
const R = 7;                      // PLAYER.radius
const GS = 1.12;                  // přehnané rysy (helma, rukavice)

// ── barvy (s cache — volá se každý snímek)
const _hx = new Map();
function rgb(h) { let v = _hx.get(h); if (!v) { const n = parseInt(String(h).slice(1, 7), 16) || 0; v = [n >> 16, (n >> 8) & 255, n & 255]; _hx.set(h, v); } return v; }
const _sh = new Map();
export function shade(h, a) {
  const key = h + a; let v = _sh.get(key); if (v) return v;
  const [r, g, b] = rgb(h), f = x => Math.max(0, Math.min(255, Math.round(a < 0 ? x * (1 + a) : x + (255 - x) * a)));
  v = '#' + [f(r), f(g), f(b)].map(x => x.toString(16).padStart(2, '0')).join(''); _sh.set(key, v); return v;
}
export function luma(h) { const [r, g, b] = rgb(h).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const rgba = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
export function mix(a, b, t) { const p = rgb(a), q = rgb(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : d;

// ── KITY: z polí entity (hra posílá col, js, hc, sh, gc, tc, sk, ty, hy, vc; nové: st = akcent/pruh, bl = čepel). Vše má default.
export function skaterKit(p, teamColor) {
  const jersey = hex(p.color, teamColor || '#3a9fff');
  const pat = JERSEY_PATTERNS.includes(p.jersey) ? p.jersey : 'solid';
  return {
    jersey, pattern: pat, accent: hex(p.stripe, luma(jersey) > 0.55 ? '#1a1f29' : '#f4f7fb'),
    pants: hex(p.shorts, shade(jersey, -0.62)), glove: hex(p.gloves, shade(jersey, -0.25)), cuff: '#f4f7fb',
    helmet: hex(p.helmet, jersey), helmetType: ['visor', 'cage', 'shield', 'none'].includes(p.helmetType) ? p.helmetType : 'visor',
    visor: hex(p.visor, '#bfe0ff'), tape: hex(p.tape, '#111318'), tapeStyle: p.tapeStyle || 'full', blade: hex(p.blade, '#15171c'),
    stick: hex(p.stick, '#1b1f27'), laces: hex(p.laces, '#e9edf3'), num: p.num ?? autoNum(p.id),
  };
}
export function goalieKit(g, teamColor) {
  const gk = hex(g.color, teamColor || '#2f6db0');
  return { gk, accent: '#f4f7fb', pad: hex(g.padColor, '#f6f8fb'), padAccent: hex(g.padAccent, gk), glove: hex(g.gloveColor, '#f6f8fb'),
    gloveAccent: hex(g.gloveAccent, gk), mask: MASK_STYLES.includes(g.maskStyle) ? g.maskStyle : 'team', num: g.num ?? 1 };
}

// číslo, když ho server/profil nepošle (boti, offline): deterministicky z id (FNV-1a) → 2..98; bez čísla je hráč v 1× beztvarý
function autoNum(id) { if (id == null) return ''; let h = 2166136261; for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return 2 + h % 97; }

// ── geometrie
function capsule(P, ax, ay, ra, bx, by, rb) {   // zúžená kapsle a→b jako jedna cesta (konvexní obal dvou kruhů) — kladná orientace
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1e-6, ang = Math.atan2(dy, dx);
  const t = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / d)));      // úhel tečny
  P.moveTo(ax + Math.cos(ang + t) * ra, ay + Math.sin(ang + t) * ra);
  P.arc(ax, ay, ra, ang + t, ang + 2 * Math.PI - t, false);
  P.arc(bx, by, rb, ang - t, ang + t, false);
  P.closePath();
}
// D = deformace dresu v rychlosti (2026-11-13): { mx, my } = směr jízdy v lokálu trupu (jednotkový), k = 0–1 rychlost, fl = vlání −1…1.
// Body na ZADNÍ straně (proti jízdě) se táhnou dozadu (váha t² → přední strana i ramena drží tvar) a lehce vlají do boku.
function torso(P, D) {
  const r = R * 1.04;
  const f = !D || D.k <= 0 ? (x, y) => [x, y] : (x, y) => {
    const t = Math.max(0, -(x * D.mx + y * D.my)) / r, w = t * t, b = D.k * w * R * 0.28, sw = D.fl * D.k * w * R * 0.14;
    return [x - D.mx * b - D.my * sw, y - D.my * b + D.mx * sw]; };
  const M = (x, y) => P.moveTo(...f(x, y)), Q = (cx, cy, x, y) => P.quadraticCurveTo(...f(cx, cy), ...f(x, y));
  M(r * 0.35, -r * 1.2); Q(r * 0.75, -r * 0.6, r * 0.55, 0); Q(r * 0.75, r * 0.6, r * 0.35, r * 1.2);
  Q(-r * 0.15, r * 1.42, -r * 0.75, r * 0.85); Q(-r * 1.05, 0, -r * 0.75, -r * 0.85); Q(-r * 0.15, -r * 1.42, r * 0.35, -r * 1.2); P.closePath();
}
const ellP = (P, x, y, rx, ry) => { P.moveTo(x + rx, y); P.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2, false); P.closePath(); };
const rot = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

// ── úroveň detailu podle skutečného měřítka (px zařízení na světovou jednotku); deterministické, bez času
export function lodSmall(c) { const t = c.getTransform(); return Math.hypot(t.a, t.b) < 2; }

// ── BRUSLE (lokální rámec brusle: +x = špička), s obrysem
export function skinSkate(c, K) {
  c.beginPath(); c.roundRect(-R * 0.62, -R * 0.24, R * 1.14, R * 0.48, R * 0.22); c.strokeStyle = SKIN_OUT; c.lineWidth = 1.6; c.stroke();
  c.beginPath(); c.moveTo(-R * 0.66, 0); c.lineTo(R * 0.72, 0); c.strokeStyle = '#dfe5ee'; c.lineWidth = 1.05; c.lineCap = 'round'; c.stroke();
  c.beginPath(); c.roundRect(-R * 0.6, -R * 0.22, R * 1.1, R * 0.44, R * 0.2); c.fillStyle = '#1c1f26'; c.fill();
  c.beginPath(); c.roundRect(R * 0.25, -R * 0.2, R * 0.3, R * 0.4, R * 0.15); c.fillStyle = '#e9edf3'; c.fill();
  c.beginPath(); for (const q of [-0.3, -0.05, 0.2]) { c.moveTo(R * q, -R * 0.13); c.lineTo(R * q, R * 0.13); } c.strokeStyle = K.laces; c.lineWidth = 0.45; c.stroke();
}

// ── VZOR DRESU (klip = trup ∪ ramena). Cíl: ΔE76 mezi vzory na ploše trupu ≥ 15 v 1×.
function pattern(c, K) {
  const a = K.accent; c.fillStyle = a;
  switch (K.pattern) {
    case 'shoulder': c.fillRect(-R * 0.05, -R * 1.6, R * 1.3, R * 3.2); break;                                                   // sedlo přes ramena a hruď
    case 'stripes':  c.fillRect(-R * 1.4, -R * 0.74, R * 2.8, R * 0.36); c.fillRect(-R * 1.4, R * 0.38, R * 2.8, R * 0.36); break;  // dva podélné pruhy
    case 'sleeves':  c.fillRect(-R * 1.4, -R * 1.6, R * 2.8, R * 0.85); c.fillRect(-R * 1.4, R * 0.75, R * 2.8, R * 0.85); break;  // boky + rukávy
    case 'diagonal': c.save(); c.rotate(-0.75); c.fillRect(-R * 2, -R * 0.42, R * 4, R * 0.84); c.restore(); break;               // šerpa
    case 'checker':  for (let i = -3; i < 3; i++) for (let j = -4; j < 4; j++) if ((i + j) & 1) c.fillRect(i * R * 0.55, j * R * 0.55, R * 0.55, R * 0.55); break;
    case 'gradient': { const g = c.createLinearGradient(0, -R * 1.2, 0, R * 1.2); g.addColorStop(0, rgba(a, 0)); g.addColorStop(1, a); c.fillStyle = g; c.fillRect(-R * 1.4, -R * 1.6, R * 2.8, R * 3.2); break; }  // přechod do boku
    case 'retro':    c.fillRect(-R * 1.2, -R * 1.6, R * 0.62, R * 3.2); c.fillStyle = shade(a, 0.55); c.fillRect(-R * 0.48, -R * 1.6, R * 0.14, R * 3.2); break;   // široký pás na zádech + linka
  }
}

// ── KOSTRA TĚLA (čistá geometrie, bez canvasu): sdílí skinBody i scripts/body_anim_metrics.mjs.
// B.ux, B.uy = posun horního těla (trup, ramena, helma) vůči bokům; B.hd = natočení hlavy kolem krku (Tělo B1, Player.js bodyPose)
export function skinRig(B) {
  const tw = B.tw || 0, hnd = B.hnd || 1, ux = B.ux || 0, uy = B.uy || 0, hd = B.hd || 0;
  const S = [{ x: R * 0.25, y: -R * 0.9 }, { x: R * 0.25, y: R * 0.9 }].map(p => { const q = rot(p, tw); return { x: q.x + ux, y: q.y + uy }; });
  const H = hnd > 0 ? [B.top, B.bot] : [B.bot, B.top];
  const E = [0, 1].map(i => ({ x: (S[i].x + H[i].x) / 2 + R * 0.1, y: (S[i].y + H[i].y) / 2 + (i ? 1 : -1) * R * 0.25 }));
  const hp = rot({ x: R * 0.72 - R * 0.25, y: 0 }, hd);
  return { S, H, E, ux, uy, tw, hd, head: { x: R * 0.25 + ux + hp.x, y: uy + hp.y } };
}
// ── TĚLO HRÁČE (lokál: +x = dopředu/obličej, +y = doprava). B = { feet:[{x,y,side}], top, bot (ruce), hnd, tw (natočení ramen), ux, uy, hd, lx, ly (světlo v lokálu) }
export function skinBody(c, B, K) {
  const lod = lodSmall(c);   // lod: malé měřítko → silnější tóny tvarů, méně drobných linek
  const Rg = skinRig(B), { S, H, E, ux, uy, tw, hd } = Rg;
  const hx = R * 0.72, hrx = R * 0.55 * GS, hry = R * 0.5 * GS;
  const HM = new DOMMatrix().translate(Rg.head.x, Rg.head.y).rotate(hd * 180 / Math.PI).translate(-hx, 0);   // rámec helmy (hlava kolem krku)
  const shY = s => (s.y - uy) * 0.98 + uy;   // ramenní chrániče (B0: s.y·0,98)
  // rukavice: natočené podél předloktí (sdílená tečna paže → rukavice)
  const gl = [0, 1].map(i => ({ x: H[i].x, y: H[i].y, a: Math.atan2(H[i].y - E[i].y, H[i].x - E[i].x) }));
  // 1) sjednocená cesta těla
  const body = new Path2D();
  // NOHY (2026-11-13, Ondřej: „nohy vypadají jen jako tyčky"): dřív jedna kapsle 1,4 → 1,15 px. Nově stehno (kalhoty, široké, z kalhot
  // ke koleni) + lýtko se štulpnou zúžené ke kotníku; koleno lehce vybočené ven (do strany nohy) → noha má tvar, ne čáru.
  const legs = B.feet.map(f => { const hx = -R * 0.6, hy = f.side * R * 0.58, ax = f.x, ay = f.y;   // f = kotník (Player posílá bod nad botou u paty)
    const kx = (hx + ax) / 2, ky = (hy + ay) / 2 + f.side * R * 0.12;
    const th = new Path2D(); capsule(th, hx, hy, R * 0.4, kx, ky, R * 0.3);
    const sh = new Path2D(); capsule(sh, kx, ky, R * 0.27, ax, ay, R * 0.2);
    return { th, sh }; });
  for (const L of legs) { body.addPath(L.sh); body.addPath(L.th); }
  ellP(body, -R * 0.62, -R * 0.62, R * 0.5, R * 0.46); ellP(body, -R * 0.62, R * 0.62, R * 0.5, R * 0.46);  // kalhoty
  const up = new Path2D(); { const q = new Path2D(); torso(q, B.jd); up.addPath(q, new DOMMatrix().translate(ux, uy)); } for (const s of S) ellP(up, s.x - R * 0.12, shY(s), R * 0.48, R * 0.42);   // trup + ramena
  for (let i = 0; i < 2; i++) { capsule(up, S[i].x, S[i].y, 1.9, E[i].x, E[i].y, 1.5); capsule(up, E[i].x, E[i].y, 1.5, H[i].x, H[i].y, 1.25); }   // paže: plynulé zúžení
  const gloves = new Path2D(); for (const g of gl) { const m = new DOMMatrix().translate(g.x, g.y).rotate(g.a * 180 / Math.PI); const q = new Path2D(); q.roundRect(-2.6 * GS + 0.6, -1.9 * GS, 4.6 * GS, 3.8 * GS, 1.5); gloves.addPath(q, m); }
  const helm = new Path2D(); { const q = new Path2D(); ellP(q, hx, 0, hrx, hry); helm.addPath(q, HM); }
  const hv = K.headV || 0;   // H0 helma v jedné cestě s tělem; H1/H2 samostatný tvar s vlastním obrysem (dev playground)
  body.addPath(up); body.addPath(gloves); if (!hv) body.addPath(helm);
  // 2) obrys jednou (pod výplněmi) → zůstane jen vnější hrana
  c.lineJoin = 'round'; c.strokeStyle = SKIN_OUT; c.lineWidth = 2.0; c.stroke(body);
  // 3) výplně v pořadí zdola (y−z): štulpny, kalhoty, trup+paže (jedna barva = bez švu), vzor, číslo, rukavice, helma
  c.fillStyle = shade(K.jersey, -0.1); for (const L of legs) c.fill(L.sh);   // lýtko = štulpna v barvě dresu (tmavší)
  c.fillStyle = shade(K.pants, -0.06); for (const L of legs) c.fill(L.th);   // stehno = kalhoty
  c.fillStyle = K.pants; c.beginPath(); c.ellipse(-R * 0.62, -R * 0.62, R * 0.5, R * 0.46, 0, 0, Math.PI * 2); c.ellipse(-R * 0.62, R * 0.62, R * 0.5, R * 0.46, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = K.jersey; c.fill(up);
  // čitelné tvary v 1× tónem (ne linkou → obrys zůstává jeden): ramena světlejší, rukávy tmavší; vzor dresu jde přes ně
  const lt = luma(K.jersey) > 0.55;
  c.fillStyle = shade(K.jersey, (lt ? -0.55 : 1) * (lod ? 0.22 : 0.13)); c.beginPath(); for (const s of S) { c.moveTo(s.x - R * 0.12 + R * 0.48, shY(s)); c.ellipse(s.x - R * 0.12, shY(s), R * 0.48, R * 0.42, 0, 0, Math.PI * 2); } c.fill();
  const arms = new Path2D(); for (let i = 0; i < 2; i++) { capsule(arms, S[i].x, S[i].y, 1.9, E[i].x, E[i].y, 1.5); capsule(arms, E[i].x, E[i].y, 1.5, H[i].x, H[i].y, 1.25); }
  c.fillStyle = shade(K.jersey, lod ? -0.22 : -0.14); c.fill(arms);
  c.save(); c.clip(up); c.translate(ux, uy); c.rotate(tw); pattern(c, K); c.restore();
  // rukávový pruh (sleeves/stripes) — páska na předloktí
  if (K.pattern === 'sleeves' || K.pattern === 'stripes') for (let i = 0; i < 2; i++) { const mx = (E[i].x + H[i].x) / 2, my = (E[i].y + H[i].y) / 2, a = Math.atan2(H[i].y - E[i].y, H[i].x - E[i].x);
    c.save(); c.translate(mx, my); c.rotate(a); c.fillStyle = K.accent; c.fillRect(-0.5, -1.45, 1.0, 2.9); c.restore(); }
  // číslo na zádech (vrchem k hlavě)
  c.save(); c.translate(ux, uy); c.rotate(tw); c.translate(-R * 0.42, 0); c.rotate(Math.PI / 2); c.font = `900 ${R * 1.25}px 'Segoe UI', sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const lightJ = luma(K.jersey) > 0.4; c.lineJoin = 'round'; c.lineWidth = 1.1; c.strokeStyle = lightJ ? '#ffffff' : (K.accent === '#f4f7fb' || K.accent === '#ffffff') ? shade(K.jersey, -0.5) : K.accent;
  c.strokeText(String(K.num), 0, 0.3); c.fillStyle = lightJ ? '#1a1f29' : '#ffffff'; c.fillText(String(K.num), 0, 0.3); c.restore();
  // rukavice + manžeta (záměrná linka výstroje)
  c.fillStyle = K.glove; c.fill(gloves);   // ruce čte manžeta (záměrná linka), ne šev
  for (const g of gl) { c.save(); c.translate(g.x, g.y); c.rotate(g.a); c.fillStyle = mix(K.glove, K.cuff, 0.75); c.fillRect(-2.6 * GS + 0.6, -1.9 * GS + 0.3, 0.9, 3.8 * GS - 0.6); c.restore(); }
  // helma
  if (!hv) { c.fillStyle = K.helmet === K.jersey ? shade(K.helmet, lt ? -0.18 : -0.24) : K.helmet; c.fill(helm); }   // helma v barvě dresu o tón tmavší = hlava se oddělí od ramen c.strokeStyle = shade(K.helmet, -0.38); c.lineWidth = 0.6; c.stroke(helm);   // okraj helmy = hlava a směr pohledu (informační linka)
  // 4) jedno stínování přes celé tělo (světlo pevné ve světě, předané v lokálu)
  const lx = B.lx ?? -0.5, ly = B.ly ?? -0.5;
  const g = c.createRadialGradient(ux + lx * R * 0.7, uy + ly * R * 0.7, R * 0.2, ux, uy, R * 1.9);
  g.addColorStop(0, 'rgba(255,255,255,0.30)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(10,16,40,0.24)');
  c.save(); c.clip(body); c.fillStyle = g; c.fillRect(-R * 2.5, -R * 2.5, R * 5, R * 5); c.restore();
  c.save(); c.setTransform(c.getTransform().multiply(HM));   // helma a linky obličeje v rámci hlavy
  const hlx = lx * Math.cos(hd) + ly * Math.sin(hd), hly = -lx * Math.sin(hd) + ly * Math.cos(hd);   // světlo v rámci hlavy
  const helmL = new Path2D(); ellP(helmL, hx, 0, hrx, hry);
  if (hv) {   // H1: tón odlišený od dresu; H2: světlá helma jako dřív (pokud hráč nemá vlastní barvu helmy)
    const own = K.helmet !== K.jersey;
    const hc = hv === 2 ? (own ? K.helmet : '#eef2f8') : (own ? K.helmet : shade(K.jersey, lt ? -0.45 : 0.42));
    c.lineJoin = 'round'; c.strokeStyle = SKIN_OUT; c.lineWidth = 2.0; c.stroke(helmL);
    c.fillStyle = hc; c.fill(helmL);
    const hg = c.createRadialGradient(hx + hlx * R * 0.25, hly * R * 0.25, R * 0.05, hx, 0, hrx * 1.2);
    hg.addColorStop(0, 'rgba(255,255,255,0.35)'); hg.addColorStop(1, 'rgba(10,16,40,0.18)'); c.fillStyle = hg; c.fill(helmL);
    K = { ...K, helmet: hc };   // hřebínek a lesk níž počítají s barvou helmy
  }
  // 5) informační linky navrch: hřebínek helmy, lesk, ochrana obličeje
  c.lineCap = 'round';
  // v 1× (lod) bez hřebínku a lesku helmy (splývají ve skvrnu), směr hlavy nese hledí
  if (!lod) { c.beginPath(); c.moveTo(hx - hrx * 0.85, 0); c.lineTo(hx + hrx * 0.15, 0); c.strokeStyle = mix(K.helmet, K.helmet === K.jersey ? K.accent : K.jersey, 0.6); c.lineWidth = 0.9; c.stroke(); }   // hřebínek: tón, ne tvrdá linka
  if (!lod) { c.beginPath(); c.ellipse(hx + hlx * R * 0.22, hly * R * 0.22, R * 0.16, R * 0.1, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill(); }
  const ht = K.helmetType;
  if (ht === 'cage') { c.beginPath(); c.arc(hx, 0, hrx * 1.12, -0.9, 0.9); for (const yy of [-0.22, 0, 0.22]) { c.moveTo(hx + R * 0.34, R * yy); c.lineTo(hx + hrx * 1.12 * Math.cos(Math.asin(R * yy / (hrx * 1.12))), R * yy); } c.strokeStyle = '#2b2f36'; c.lineWidth = 0.5; c.stroke(); }
  else if (ht === 'visor') { c.beginPath(); c.arc(hx, 0, hrx * 0.98, -0.85, 0.85); c.strokeStyle = K.visor; c.lineWidth = 1.5; c.stroke(); }
  else if (ht === 'shield') { c.beginPath(); c.arc(hx, 0, hrx * 1.04, -1.1, 1.1); c.closePath(); c.fillStyle = rgba(K.visor, 0.45); c.fill(); c.strokeStyle = shade(K.visor, -0.3); c.lineWidth = 0.6; c.stroke(); }
  else { c.beginPath(); c.ellipse(hx + hrx * 0.78, 0, R * 0.16, R * 0.26, 0, 0, Math.PI * 2); c.fillStyle = '#e8b896'; c.fill(); }
  c.restore();
}

// ── GÓLMAN (lokál gólmana: −X = k puku, +Y = dolů; po ctx.scale(−inX·s, s)). G = goalieGeom(...) ze simulace (beze změny).
// o = { stance, tilt, recoil, holding, padFlash, blockFlash, inX }
export function skinGoalie(c, G, K, o) {
  const st = o.stance, r = 8, rb = r * G.bodyScale * 1.04, lx = 0.7 * (o.inX || 1), ly = -0.7, cover = st === 'cover' || o.holding;
  const lod = lodSmall(c);   // malé měřítko (< 2 px na jednotku): bez drobných linek výstroje — v 1× by splynuly ve šum
  // hokejka (vizuální; sim ji nemá): čepel na ledě před pady, paddle, dřík k vyrážečce
  // úchop hole = vyrážečka VE STEJNÉM rámci jako ruka (posun těla, odskok, náklon) → hůl se od ruky neodtrhne (2026-11-12)
  const bmS = new DOMMatrix().translate(G.bodyX + (o.recoil || 0), G.bodyY).rotate((o.tilt || 0) * 180 / Math.PI);
  let stk = null;
  if (cover) { const h = bmS.transformPoint({ x: G.handX + 2, y: G.blockY + 1 }); stk = { hx: h.x, hy: h.y, b0: { x: -1, y: 18 }, b1: { x: -6.5, y: 19.5 } }; }
  else { const h = bmS.transformPoint({ x: G.handX, y: G.blockY }), hx = h.x, hy = h.y, bx = Math.min(hx - 5, -9); stk = { hx, hy, b0: { x: bx, y: hy * 0.55 }, b1: { x: bx - 0.6, y: hy * 0.55 - 7.5 * Math.sign(hy || 1) } }; }
  // pady (rámec padu jako Goalie.js _gPad)
  const padPaths = G.pads.map(pd => { const P = new Path2D(), m = new DOMMatrix().translate(pd.kx, pd.ky).rotate(pd.angle * pd.dir * 180 / Math.PI), q = new Path2D(); q.roundRect(-pd.pw / 2, pd.dir > 0 ? 0 : -pd.ph, pd.pw, pd.ph, 2.4); P.addPath(q, m); return P; });
  // tělo v rámci těla (translate bodyX/Y, rotate tilt) — sestavíme cesty v lokálu gólmana přes matici
  const bm = new DOMMatrix().translate(G.bodyX + (o.recoil || 0), G.bodyY).rotate((o.tilt || 0) * 180 / Math.PI);
  const B = new Path2D(); { const q = new Path2D(); ellP(q, 0, 0, rb * 0.88, rb * 1.12); for (const sd of [-1, 1]) ellP(q, rb * 0.05, sd * rb * 0.68, rb * 0.5, rb * 0.44);
    for (const hy of [G.gloveY, G.blockY]) capsule(q, -rb * 0.1, Math.sign(hy) * rb * 0.75, 1.9, G.handX, hy, 1.4);
    // stehna: tělo → kolena (napojení padů na tělo)
    for (const pd of G.pads) capsule(q, rb * 0.15, Math.sign(pd.ky || pd.dir) * rb * 0.35, 2.2, pd.kx - G.bodyX, pd.ky - G.bodyY, 2.0);
    B.addPath(q, bm); }
  const mx = -rb * 0.5, mrx = 3.9 * G.bodyScale * 1.12, mry = 3.5 * G.bodyScale * 1.12;
  const M = new Path2D(); { const q = new Path2D(); ellP(q, mx, 0, mrx, mry); M.addPath(q, bm); }
  const glove = new Path2D(); { const q = new Path2D(); ellP(q, G.handX, G.gloveY, 3.5 * 1.1, 3.8 * 1.1); const cuffQ = new Path2D(); cuffQ.roundRect(G.handX + 1.3 * 1.1, G.gloveY - 2.4 * 1.1, 3.2 * 1.1, 4.8 * 1.1, 1.2); q.addPath(cuffQ); glove.addPath(q, bm); }
  const block = new Path2D(); { const q = new Path2D(); q.roundRect(G.handX - 1.6 * 1.1, G.blockY - 3.5 * 1.1, 2.8 * 1.1, 7 * 1.1, 0.9); q.roundRect(G.handX + 0.8, G.blockY - 1.6, 2.6, 3.2, 0.9); block.addPath(q, bm); }
  const all = new Path2D(); for (const p of padPaths) all.addPath(p); all.addPath(B); all.addPath(M); all.addPath(glove); all.addPath(block);
  // 1) obrys jednou: hokejka + celé tělo s pady
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = SKIN_OUT;
  c.lineWidth = 4.6; c.beginPath(); c.moveTo(stk.b0.x, stk.b0.y); c.lineTo(stk.b1.x, stk.b1.y); c.stroke();
  c.lineWidth = 3.4; c.beginPath(); c.moveTo(stk.b0.x, stk.b0.y); c.lineTo(stk.hx, stk.hy); c.stroke();
  if (!lod) { const q = t => ({ x: stk.b0.x + (stk.hx - stk.b0.x) * t, y: stk.b0.y + (stk.hy - stk.b0.y) * t }), a = q(0.2), z = q(0.6);   // zesílený úsek dříku u paže = žádná díra hůl–paže (v 1× nevzniká)
    c.lineWidth = 6.0; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(z.x, z.y); c.stroke(); }
  c.lineWidth = 2.0; c.stroke(all);
  // 2) hokejka
  const dx = stk.b1.x - stk.b0.x, dy = stk.b1.y - stk.b0.y;
  c.strokeStyle = '#1b1f27'; c.lineWidth = 3.0; c.beginPath(); c.moveTo(stk.b0.x, stk.b0.y); c.lineTo(stk.b1.x, stk.b1.y); c.stroke();
  if (!lod) { c.strokeStyle = 'rgba(244,246,250,0.9)'; c.lineWidth = 1.0; c.beginPath(); c.moveTo(stk.b0.x + dx * 0.55, stk.b0.y + dy * 0.55); c.lineTo(stk.b1.x, stk.b1.y); c.stroke(); }
  const px = stk.b0.x + (stk.hx - stk.b0.x) * 0.45, py = stk.b0.y + (stk.hy - stk.b0.y) * 0.45;
  c.strokeStyle = K.padAccent; c.lineWidth = 2.6; c.beginPath(); c.moveTo(stk.b0.x, stk.b0.y); c.lineTo(px, py); c.stroke();
  c.strokeStyle = '#1b1f27'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, py); c.lineTo(stk.hx, stk.hy); c.stroke();
  // 3) betony: výplň + válce/bloky (záměrné linky výstroje)
  G.pads.forEach((pd, i) => {
    c.fillStyle = o.padFlash > 0 ? 'rgba(200,220,255,0.98)' : K.pad; c.fill(padPaths[i]);
    c.save(); c.translate(pd.kx, pd.ky); c.rotate(pd.angle * pd.dir); const y0 = pd.dir > 0 ? 0 : -pd.ph, w = pd.pw, h = pd.ph, kneeTop = pd.dir > 0;
    c.fillStyle = lod ? mix(K.pad, K.padAccent, 0.3) : shade(K.pad, -0.12); c.fillRect(w / 2 - 1.3, y0 + 1, 1.0, h - 2);   // v 1× nese barvu padu jen boční pruh
    if (!lod) { c.beginPath(); const n = Math.max(2, Math.round(h / 3.2)); for (let k = 1; k < n; k++) { const yy = y0 + h * k / n; c.moveTo(-w / 2 + 0.7, yy); c.lineTo(w / 2 - 1.3, yy); } c.strokeStyle = 'rgba(14,22,38,0.18)'; c.lineWidth = 0.45; c.stroke(); }
    if (!lod) { c.fillStyle = mix(K.pad, K.padAccent, 0.22); c.beginPath(); c.roundRect(-w / 2 + 0.3, kneeTop ? y0 : y0 + h - 2.6, w - 0.6, 2.6, 1.2); c.fill();   // kolenní válec (tón, mezistupeň pad → tělo)
    c.fillStyle = mix(K.pad, K.padAccent, 0.22); c.fillRect(-w / 2 + 0.6, y0 + h * (kneeTop ? 0.55 : 0.3), w - 1.9, h * 0.13); }   // blok jen tónem
    c.restore();
  });
  if (cover && o.drawPuck) { c.beginPath(); c.arc(G.handX + G.bodyX - 1.2, G.bodyY, 3, 0, Math.PI * 2); c.fillStyle = '#0b0d12'; c.fill(); }   // hra kreslí puk sama
  // 4) tělo (vesta + ramena + paže + stehna jednou barvou = bez švů), lem ramen, číslo
  c.fillStyle = K.gk; c.fill(B);
  c.save(); c.setTransform(c.getTransform().multiply(bm));
  const tone = shade(K.gk, 0.2);   // lem ramen a páska na paži tónem dresu (ne bílou) → čte se tvar, ne šev
  if (!lod) for (const sd of [-1, 1]) { c.beginPath(); c.arc(rb * 0.05, sd * rb * 0.68, rb * 0.42, Math.PI * 0.6, Math.PI * 1.4); c.strokeStyle = tone; c.lineWidth = 0.9; c.stroke(); }
  for (const hy of [G.gloveY, G.blockY]) { const mxx = (-rb * 0.1 + G.handX) / 2, myy = (Math.sign(hy) * rb * 0.75 + hy) / 2; c.save(); c.translate(mxx, myy); c.rotate(Math.atan2(hy - Math.sign(hy) * rb * 0.75, G.handX + rb * 0.1)); if (!lod) { c.fillStyle = tone; c.fillRect(-0.45, -1.7, 0.9, 3.4); } c.restore(); }
  c.save(); c.translate(rb * 0.45, 0); c.rotate(Math.PI / 2 * (o.inX || 1)); c.scale(-(o.inX || 1), 1); c.font = `900 ${rb * 0.7}px 'Segoe UI', sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = luma(K.gk) > 0.4 ? '#1a1f29' : '#ffffff'; c.fillText(String(K.num), 0, 0.3); c.restore();
  c.restore();
  // 5) vyrážečka, lapačka, maska
  c.fillStyle = lod ? K.glove : shade(K.glove, -0.15); c.fill(block);
  c.save(); c.setTransform(c.getTransform().multiply(bm));
  const gw = 1.1;
  c.fillStyle = o.blockFlash > 0 ? 'rgba(220,170,70,0.95)' : K.glove; c.beginPath(); c.roundRect(G.handX - 1.6 * gw, G.blockY - 3.5 * gw, 2.8 * gw, 7 * gw, 0.9); c.fill();
  if (!lod) { c.fillStyle = mix(K.glove, K.gloveAccent, 0.2); c.fillRect(G.handX - 1.0 * gw, G.blockY - 2.6 * gw, 1.6 * gw, 5.2 * gw); }
  c.translate(G.handX, G.gloveY); const inw = -Math.sign(G.gloveY || -1);
  c.fillStyle = lod ? mix(K.glove, K.gloveAccent, 0.2) : K.gloveAccent; c.beginPath(); c.roundRect(1.3 * gw, -2.4 * gw, 3.2 * gw, 4.8 * gw, 1.2); c.fill();                                     // manžeta
  c.fillStyle = K.glove; c.beginPath(); c.ellipse(0, 0, 3.5 * gw, 3.8 * gw, 0, 0, Math.PI * 2); c.fill();                                                  // dlaň/hřbet
  if (!lod) { c.beginPath(); c.arc(0.2 * gw, 0, 3.0 * gw, Math.PI * 0.5 * (1 - inw) - inw * Math.PI * 0.15, Math.PI * 0.5 * (1 - inw) - inw * Math.PI * 0.15 - inw * Math.PI * 0.95, inw > 0); c.strokeStyle = mix(K.glove, K.gloveAccent, 0.6); c.lineWidth = 1.0; c.stroke(); }   // prsty
  c.beginPath(); c.ellipse(-0.6 * gw, inw * 3.0 * gw, 1.9 * gw, 1.15 * gw, -inw * 0.45, 0, Math.PI * 2); c.fillStyle = shade(K.glove, -0.06); c.fill(); c.strokeStyle = SKIN_OUT; c.lineWidth = 0.6; c.stroke();   // palec
  if (!lod || cover || o.gloveFlash > 0) { c.beginPath(); c.ellipse(-1.5 * gw, inw * 1.1 * gw, 1.8 * gw, 1.7 * gw, 0, 0, Math.PI * 2); c.fillStyle = (cover || o.gloveFlash > 0) ? '#e8a020' : shade(K.glove, -0.14); c.fill(); }   // kapsa
  if (!lod) { c.beginPath(); c.moveTo(-3.3 * gw, inw * -0.5 * gw); c.lineTo(-3.3 * gw, inw * 2.6 * gw); c.moveTo(-3.3 * gw, inw * 1.05 * gw); c.lineTo(-1.0 * gw, inw * 1.05 * gw); c.strokeStyle = SKIN_OUT; c.lineWidth = 0.75; c.stroke();   // T-web
  c.fillStyle = '#f4f6fa'; for (const t of [-0.2, 0.6, 1.4, 2.2]) { c.beginPath(); c.arc(-3.3 * gw, inw * t * gw, 0.3, 0, Math.PI * 2); c.fill(); } }
  c.restore();
  // maska: zadní plát, kopule s malbou, klec „kočičí oči"
  c.save(); c.setTransform(c.getTransform().multiply(bm));
  if (!lod) { c.fillStyle = mix(K.gk, '#f4f6fa', 0.55); c.beginPath(); c.roundRect(mx + mrx * 0.55, -mry * 0.55, mrx * 0.6, mry * 1.1, 0.8); c.fill(); }   // zadní plát masky (v 1× splývá)
  c.fillStyle = K.gk; c.beginPath(); c.ellipse(mx, 0, mrx, mry, 0, 0, Math.PI * 2); c.fill();
  c.save(); c.clip(); const pc = mix(K.gk, K.padAccent === K.gk ? K.accent : K.padAccent, lod ? 0.3 : 0.7); c.fillStyle = pc;
  if (K.mask === 'team') c.fillRect(mx - mrx, -mry * 0.18, mrx * 2, mry * 0.36);
  else if (K.mask === 'stripe') { c.fillRect(mx - mrx, -mry * 0.62, mrx * 2, mry * 0.24); c.fillRect(mx - mrx, mry * 0.38, mrx * 2, mry * 0.24); }
  else if (K.mask === 'flame') { c.beginPath(); c.moveTo(mx + mrx, -mry); for (let i = 0; i <= 4; i++) { const yy = -mry + i * mry * 0.5; c.quadraticCurveTo(mx - mrx * 0.2, yy + mry * 0.12, mx - mrx * 0.75 + (i & 1) * mrx * 0.45, yy + mry * 0.25); } c.lineTo(mx + mrx, mry); c.closePath(); c.fill(); }
  else c.fillRect(mx - mrx, -mry, mrx * 2, mry);
  c.restore();
  c.restore();
  // 6) jedno stínování přes celé tělo gólmana (bez padů — ty leží na ledě)
  const body = new Path2D(); body.addPath(B); body.addPath(M); body.addPath(glove); body.addPath(block);
  const gx = G.bodyX + lx * rb * 0.6, gy = G.bodyY + ly * rb * 0.6, gr = c.createRadialGradient(gx, gy, rb * 0.2, G.bodyX, G.bodyY, rb * 1.9);
  gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(10,16,40,0.22)');   // slabší lesk: přechod lesk → pad nesmí působit jako tmavá linka (spoj pad–tělo < 30)
  c.save(); c.clip(body); c.fillStyle = gr; c.fillRect(-30, -30, 60, 60); c.restore();
  // 7) klec masky + lesk navrch
  c.save(); c.setTransform(c.getTransform().multiply(bm));
  c.beginPath(); c.ellipse(mx + lx * 1.2, ly * 1.2, 0.9, 0.55, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
  c.beginPath(); const cx0 = mx - mrx * 0.45;
  c.moveTo(cx0, -mry * 0.85); c.quadraticCurveTo(mx - mrx * 1.35, 0, cx0, mry * 0.85);
  c.moveTo(cx0 + 0.2, -mry * 0.55); c.quadraticCurveTo(mx - mrx * 1.18, -mry * 0.32, mx - mrx * 1.02, 0);
  c.moveTo(cx0 + 0.2, mry * 0.55); c.quadraticCurveTo(mx - mrx * 1.18, mry * 0.32, mx - mrx * 1.02, 0);
  c.moveTo(mx - mrx * 0.7, 0); c.lineTo(mx - mrx * 1.15, 0);
  c.strokeStyle = lod ? shade(K.gk, luma(K.gk) < 0.25 ? 0.25 : -0.25) : luma(K.gk) < 0.25 ? '#f4f6fa' : '#20242c'; c.lineWidth = 0.65; c.stroke();   // v 1× klec tónem
  c.restore();
}
