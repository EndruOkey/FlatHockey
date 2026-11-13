// ROZPLÁCNUTÍ — kloubová postava na ledě (2026-11-13). Čistá póza z času od zásahu (deterministicky, bez Math.random)
// + kresba ve stylu skinBody (jeden obrys SKIN_OUT, dres v barvě týmu, číslo, helma s hledím, rukavice, kalhoty, štulpny, brusle).
// Sekvence (el = s od zásahu): PÁD 0..FALL (tělo se natáčí a padá, zrychluje do dopadu) → DOZNĚNÍ (končetiny dojedou, lehký
// odraz) → LEŽENÍ (do downT; tělo klouže se simulací, pomalu se dotáčí) → ZVEDÁNÍ upT: na všechny čtyři / sed → klek → stoj.
// Stoj = stejné proporce jako skinBody (helma 0,72R vpředu, ramena 0,25R/±0,9R, kalhoty −0,62R) → návrat bez skoku.
// Rámec L: +x = směr hlavy ležícího (= směr úderu _fallA, dotočený o spin), +y = 90° po směru. Jednotky = R (PLAYER.radius).
import { SKIN_OUT, shade, luma, mix } from './skin.js';

export const DOWN_FALL = 0.2, DOWN_SETTLE = 0.16;   // s: pád (natočení + dopad), doznění po dopadu
const RISE_K = [0, 0.36, 0.68, 1];                       // zvedání: leží → čtyři/sed → klek → stoj (podíl upT)

export function downHash(id, n, i) { let h = 2166136261 ^ n; const s = String(id); for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (i * 374761393), 668265263); h ^= h >>> 13; h = Math.imul(h, 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// klíče pózy: body [x, y] (v R), úhly a skaláry. 'r*' = pravá strana těla, 'l*' = levá.
const PTS = ['hd', 'rs', 'ls', 're', 'le', 'rg', 'lg', 'rp', 'lp', 'rk', 'lk', 'rf', 'lf', 'st'];
const ANG = ['rfa', 'lfa', 'fa', 'sta'];
const SCL = ['hs', 'fv', 'num', 'fsh'];

// STOJ v rámci obličeje F (+x = bodyAngle, +y = pravá strana), převedený do L o d = bodyAngle − ψ
function standF(h, ca = 0) {   // ca = úhel hole vůči tělu (carryAngle − bodyAngle)
  const top = [0.5, 0], bot = [0.25, 0.5 * (h >= 0 ? 1 : -1)];
  const rg = h >= 0 ? bot : [top[0], top[1]], lg = h >= 0 ? [top[0], top[1]] : bot;
  const el = (s, g, o) => [(s[0] + g[0]) / 2 + 0.1, (s[1] + g[1]) / 2 + o * 0.25];
  const rs = [0.25, 0.9], ls = [0.25, -0.9];
  return { hd: [0.72, 0], rs, ls, re: el(rs, rg, 1), le: el(ls, lg, -1), rg, lg, rp: [-0.62, 0.55], lp: [-0.62, -0.55], rk: [-0.75, 0.52], lk: [-0.75, -0.52],
    rf: [-0.9, 0.45], lf: [-0.9, -0.45], st: [0.2 + Math.cos(ca) * 1.14, 0.5 * (h >= 0 ? 1 : -1) + Math.sin(ca) * 1.14], rfa: 0.18, lfa: -0.18, fa: 0, sta: ca, hs: 1, fv: 0, num: 1, fsh: 1 };
}
// KLEK v rámci F: přední noha (strana hole) pokrčená vpřed, zadní koleno na ledě, ruce u hole
function kneelF(h) {
  const q = h >= 0 ? 1 : -1, P = standF(h);
  const front = q > 0 ? 'r' : 'l', back = q > 0 ? 'l' : 'r', fs = q, bs = -q;
  return { ...P, hd: [0.55, 0], rs: [0.12, 0.88], ls: [0.12, -0.88], rp: [-0.6, 0.55], lp: [-0.6, -0.55],
    [front + 'k']: [0.35, fs * 0.62], [front + 'f']: [-0.2, fs * 0.66], [back + 'k']: [-0.8, bs * 0.58], [back + 'f']: [-1.6, bs * 0.52],
    [front + 'fa']: fs * 0.12, [back + 'fa']: Math.PI + bs * 0.15, st: [1.0, 0.9 * q], sta: 0.35 * q, hs: 1.04, fsh: 0.85 };
}
// LEŽENÍ v rámci L. sg = +1 na břiše (pravá strana = +y), −1 na zádech (pravá = −y). A = strana ruky vpřed (+1 pravá).
function lieL(sg, A, ht) {
  const y = (side, v) => side * sg * v;   // side: +1 pravá, −1 levá
  const fw = A > 0 ? 'r' : 'l', bk = A > 0 ? 'l' : 'r', fwS = A, bkS = -A;   // ruka vpřed / ruka podél těla
  const st = fwS, bt = bkS;                                                     // noha natažená na straně ruky podél těla (křížem)
  const o = { hd: [2.0, 0.12 * ht], rs: [1.3, y(1, 0.85)], ls: [1.3, y(-1, 0.85)], rp: [-0.45, y(1, 0.48)], lp: [-0.45, y(-1, 0.48)],
    fa: sg > 0 ? 0 : Math.PI, hs: 1, fv: sg > 0 ? -1 : 1, num: sg > 0 ? 1 : 0, fsh: 0.68, sta: (sg > 0 ? 0 : Math.PI) + 0.25 * fwS * sg, st: [0.35, y(fwS, 2.85)] };
  if (sg > 0) {   // na břiše: jedna ruka natažená vpřed, druhá pokrčená u boku; noha natažená + pokrčená do strany
    o[fw + 'e'] = [1.95, y(fwS, 1.45)]; o[fw + 'g'] = [2.7, y(fwS, 1.3)];
    o[bk + 'e'] = [0.7, y(bkS, 1.5)]; o[bk + 'g'] = [0.0, y(bkS, 1.45)];
    o[(bt > 0 ? 'r' : 'l') + 'k'] = [-1.6, y(bt, 0.6)]; o[(bt > 0 ? 'r' : 'l') + 'f'] = [-2.75, y(bt, 0.7)];
    o[(st > 0 ? 'r' : 'l') + 'k'] = [-1.3, y(st, 1.05)]; o[(st > 0 ? 'r' : 'l') + 'f'] = [-2.25, y(st, 1.6)];
  } else {        // na zádech: ruce rozhozené do stran, jedno koleno pokrčené nahoru
    o[fw + 'e'] = [1.5, y(fwS, 1.6)]; o[fw + 'g'] = [1.95, y(fwS, 2.2)];
    o[bk + 'e'] = [0.55, y(bkS, 1.55)]; o[bk + 'g'] = [0.1, y(bkS, 2.1)];
    o[(bt > 0 ? 'r' : 'l') + 'k'] = [-1.6, y(bt, 0.55)]; o[(bt > 0 ? 'r' : 'l') + 'f'] = [-2.75, y(bt, 0.62)];
    o[(st > 0 ? 'r' : 'l') + 'k'] = [-1.15, y(st, 0.85)]; o[(st > 0 ? 'r' : 'l') + 'f'] = [-1.95, y(st, 0.95)];
  }
  o.rfa = Math.PI + y(1, 0.2); o.lfa = Math.PI + y(-1, 0.2);
  if (sg < 0) for (const k of PTS) o[k] = [o[k][0] + 0.4, o[k][1]];   // na zádech: nohy vyjedou vpřed (pod střed), tělo padá dozadu → střed postavy se posune k hlavě
  return o;
}
// NA VŠECH ČTYŘECH (z břicha) / SED (ze zad) v rámci L
function midL(sg, A, h) {
  const y = (side, v) => side * sg * v;
  const o = sg > 0
    ? { hd: [1.4, 0], rs: [0.85, y(1, 0.8)], ls: [0.85, y(-1, 0.8)], re: [1.05, y(1, 1.08)], le: [1.05, y(-1, 1.08)], rg: [1.3, y(1, 0.95)], lg: [1.3, y(-1, 0.95)],
        rp: [-0.6, y(1, 0.5)], lp: [-0.6, y(-1, 0.5)], rk: [-0.55, y(1, 0.62)], lk: [-0.55, y(-1, 0.62)], rf: [-1.75, y(1, 0.62)], lf: [-1.75, y(-1, 0.62)],
        fa: 0, hs: 1.06, fv: 0, num: 1, fsh: 0.68 }
    : { hd: [0.45, 0], rs: [0.15, y(1, 0.85)], ls: [0.15, y(-1, 0.85)], re: [0.6, y(1, 1.25)], le: [0.6, y(-1, 1.25)], rg: [0.95, y(1, 1.15)], lg: [0.95, y(-1, 1.15)],
        rp: [-0.55, y(1, 0.5)], lp: [-0.55, y(-1, 0.5)], rk: [-1.0, y(1, 0.62)], lk: [-1.0, y(-1, 0.62)], rf: [-1.8, y(1, 0.6)], lf: [-1.8, y(-1, 0.6)],
        fa: Math.PI, hs: 1.08, fv: 0.15, num: 0.3, fsh: 0.8 };
  o.rfa = Math.PI + y(1, 0.1); o.lfa = Math.PI + y(-1, 0.1);
  if (sg < 0) { const b = h >= 0 ? 'l' : 'r', bs = h >= 0 ? -1 : 1; o[b + 'k'] = [-0.75, y(bs, 1.0)]; o[b + 'f'] = [-0.15, y(bs, 0.75)]; o[b + 'fa'] = y(bs, 0.6); }   // sed: noha zadní (pro klek) už podložená pod tělem
  o.st = [0.4, y(A, 2.6)]; o.sta = (sg > 0 ? 0 : Math.PI) + 0.2 * A * sg;
  return o;
}
const rotP = (P, d) => { const c = Math.cos(d), s = Math.sin(d), o = { ...P };
  for (const k of PTS) o[k] = [P[k][0] * c - P[k][1] * s, P[k][0] * s + P[k][1] * c]; for (const k of ANG) o[k] = P[k] + d; return o; };
const wrapTo = (a, ref) => a + Math.round((ref - a) / (2 * Math.PI)) * 2 * Math.PI;   // úhel nejblíž referenci (žádné obíhání při interpolaci)
function alignAng(P, ref) { const o = { ...P }; for (const k of ANG) o[k] = wrapTo(P[k], ref[k]); return o; }
function mixP(A, B, t) { const o = {};
  for (const k of PTS) o[k] = [A[k][0] + (B[k][0] - A[k][0]) * t, A[k][1] + (B[k][1] - A[k][1]) * t];
  for (const k of ANG.concat(SCL)) o[k] = A[k] + (B[k] - A[k]) * t; return o; }
// kubická Hermitova křivka přes klíčové pózy (Catmull-Rom tečny, nulové na koncích) → plynulá rychlost mezi fázemi
function hermite(K, T, u) {
  let i = 0; while (i < T.length - 2 && u > T[i + 1]) i++;
  const t0 = T[i], t1 = T[i + 1], D = t1 - t0, t = Math.min(1, Math.max(0, (u - t0) / D));
  const h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t;
  const tan = (j, f) => (j === 0 || j === K.length - 1) ? 0 : (f(K[j + 1]) - f(K[j - 1])) / (T[j + 1] - T[j - 1]);
  const v = f => h00 * f(K[i]) + h10 * D * tan(i, f) + h01 * f(K[i + 1]) + h11 * D * tan(i + 1, f);
  const o = {};
  for (const k of PTS) o[k] = [v(P => P[k][0]), v(P => P[k][1])];
  for (const k of ANG.concat(SCL)) o[k] = v(P => P[k]);
  return o;
}

// el = s od zásahu (0 … downT + upT), q = { id, n, sg (+1 břicho / −1 záda), fa (_fallA), ba (bodyAngle), h (handed) }
// Vrací { psi, P } — psi = natočení rámce L ve světě, P = póza v L (jednotky R). Čistá funkce: stejné vstupy = stejná póza.
export function downPose(el, q, PL) {
  const A = downHash(q.id, q.n, 7) < 0.5 ? 1 : -1, ht = downHash(q.id, q.n, 8) < 0.5 ? 1 : -1;
  const spin = (downHash(q.id, q.n, 9) - 0.5) * 0.7;   // ležící se při skluzu pomalu dotočí (±0,35 rad), plynule
  const psi = q.fa + spin * (1 - Math.exp(-el / 0.3));
  // fb = bodyAngle v okamžiku zásahu (konstanta pádu): podle ní se jednou sjednotí úhly → žádné přeskoky o 2π při dotáčení
  const fb = q.fb ?? q.ba, dRef = wrapTo(fb - q.fa, 0), sg = Math.cos(dRef) >= 0 ? 1 : -1;
  const LIE = alignAng(lieL(sg, A, ht), rotP(standF(q.h), dRef));
  const toL = F => rotP(F, wrapTo(q.ba - psi, dRef - (psi - q.fa)));
  const ST0 = toL(standF(q.h));
  const imp = { ...LIE };   // v okamžiku dopadu: končetiny ještě blíž tělu (dojedou při doznění)
  for (const k of ['re', 'le', 'rg', 'lg', 'rk', 'lk', 'rf', 'lf']) imp[k] = [LIE[k][0] * 0.85 + 0.15 * (k[1] === 'f' || k[1] === 'k' ? -0.6 : 1.1), LIE[k][1] * 0.82];
  imp.hs = 1.06; imp.st = [(ST0.st[0] + LIE.st[0]) / 2, (ST0.st[1] + LIE.st[1]) / 2]; imp.sta = (ST0.sta + LIE.sta) / 2 + 0.6 * A;
  let P;
  if (el < DOWN_FALL) {   // pád: zrychluje (gravitace), dopad rychlostí → 2t² − t³ (nulová počáteční, nenulová koncová rychlost)
    const t = el / DOWN_FALL, f = 2 * t * t - t * t * t;
    P = mixP(ST0, imp, f);
    const tl = Math.min(1, t * (sg > 0 ? 1.15 : 1)); P.rf = mixP(ST0, imp, 2 * tl * tl - tl ** 3).rf; P.lf = mixP(ST0, imp, 2 * tl * tl - tl ** 3).lf;   // nohy podjedou o chlup dřív
  } else if (el < PL.downT) {
    const t = Math.min(1, (el - DOWN_FALL) / DOWN_SETTLE), c = 1.6, f = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;   // easeOutBack = doznění s mírným přejetím
    P = mixP(imp, LIE, f);
    const ts = Math.min(1, (el - DOWN_FALL) / 0.3); P.st = mixP(imp, LIE, 1 - (1 - ts) ** 2).st; P.sta = mixP(imp, LIE, 1 - (1 - ts) ** 2).sta;   // hůl dojede po ledě
    const a = Math.max(0, (el - (PL.downT - 0.14)) / 0.14); P.hs += 0.03 * a * a; P.hd = [P.hd[0] - 0.08 * a * a, P.hd[1]];   // nádech před zvednutím: hlava se pozvedne
  } else {
    const u = Math.min(1, (el - PL.downT) / PL.upT);
    const L0 = { ...LIE, hs: LIE.hs + 0.03, hd: [LIE.hd[0] - 0.08, LIE.hd[1]] };
    const M = alignAng(midL(sg, A, q.h), LIE), KN = toL(kneelF(q.h)), ST = toL(standF(q.h, wrapTo((q.ca ?? q.ba) - q.ba, 0)));   // do stoje hůl tam, kam míří (jako normální kresba)
    P = hermite([L0, M, KN, ST], RISE_K, u);
    const ks = Math.min(1, Math.max(0, (u - 0.1) / 0.9)), fs = ks * ks * (3 - 2 * ks);   // hůl: sáhne po ní na čtyřech, do stoje ji zvedne (vlastní pomalejší oblouk)
    P.st = [LIE.st[0] + (ST.st[0] - LIE.st[0]) * fs, LIE.st[1] + (ST.st[1] - LIE.st[1]) * fs]; P.sta = LIE.sta + (ST.sta - LIE.sta) * fs;
  }
  return { psi, P };
}
// body pózy ve světových px relativně ke středu hráče (pro test plynulosti)
export function downPoints(el, q, PL) {
  const { psi, P } = downPose(el, q, PL), R = PL.radius, c = Math.cos(psi), s = Math.sin(psi), out = {};
  for (const k of PTS) out[k] = [(P[k][0] * c - P[k][1] * s) * R, (P[k][0] * s + P[k][1] * c) * R];
  const L = PL.stickLen * PL.stickDraw, a = P.sta + psi;   // konce hole
  out.s0 = [out.st[0] - Math.cos(a) * L / 2, out.st[1] - Math.sin(a) * L / 2]; out.s1 = [out.st[0] + Math.cos(a) * L / 2, out.st[1] + Math.sin(a) * L / 2];
  return out;
}

// ── kresba (ctx už v rámci L: translate(střed) · rotate(psi) · scale(s)); R = PLAYER.radius, K = skaterKit
function capsule(P, ax, ay, ra, bx, by, rb) {
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1e-6, ang = Math.atan2(dy, dx);
  if (d <= Math.abs(ra - rb) + 1e-3) { const r = Math.max(ra, rb), x = ra >= rb ? ax : bx, y = ra >= rb ? ay : by; P.moveTo(x + r, y); P.arc(x, y, r, 0, Math.PI * 2); P.closePath(); return; }
  const t = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / d)));
  P.moveTo(ax + Math.cos(ang + t) * ra, ay + Math.sin(ang + t) * ra);
  P.arc(ax, ay, ra, ang + t, ang + 2 * Math.PI - t, false); P.arc(bx, by, rb, ang - t, ang + t, false); P.closePath();
}
const ell = (P, x, y, rx, ry, a = 0) => { P.moveTo(x + Math.cos(a) * rx, y + Math.sin(a) * rx); P.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); P.closePath(); };

function skate(c, x, y, a, fsh, R, K) {   // brusle zkrácená perspektivou (ležící: botu vidíš z paty / ze špičky)
  c.save(); c.translate(x, y); c.rotate(a); c.scale(fsh, 1);
  c.beginPath(); c.roundRect(-R * 0.62, -R * 0.26, R * 1.14, R * 0.52, R * 0.22); c.strokeStyle = SKIN_OUT; c.lineWidth = 1.6; c.stroke();
  c.fillStyle = '#1c1f26'; c.fill();
  c.beginPath(); c.moveTo(-R * 0.66, 0); c.lineTo(R * 0.72, 0); c.strokeStyle = '#dfe5ee'; c.lineWidth = 0.9; c.lineCap = 'round'; c.stroke();   // nůž
  c.beginPath(); c.roundRect(R * 0.25, -R * 0.2, R * 0.3, R * 0.4, R * 0.15); c.fillStyle = '#e9edf3'; c.fill();   // jazyk
  c.beginPath(); for (const qq of [-0.3, -0.05]) { c.moveTo(R * qq, -R * 0.14); c.lineTo(R * qq, R * 0.14); } c.strokeStyle = K.laces; c.lineWidth = 0.45; c.stroke();
  c.restore();
}

export function drawDownBody(c, P, K, R, o = {}) {
  const X = k => P[k][0] * R, Y = k => P[k][1] * R;
  const lod = Math.hypot(c.getTransform().a, c.getTransform().b) < 2;
  // stín pod tělem (podél trupu)
  { const hx = X('hd'), px = (X('rp') + X('lp')) / 2, fx = (X('rf') + X('lf')) / 2, cx = (hx + fx) / 2, cy = (Y('hd') + (Y('rf') + Y('lf')) / 2) / 2;
    const len = Math.max(R * 1.1, Math.hypot(hx - fx, Y('hd') - (Y('rf') + Y('lf')) / 2) / 2 + R * 0.5);
    const a = Math.atan2(Y('hd') - (Y('rf') + Y('lf')) / 2, hx - fx);
    c.beginPath(); c.ellipse(cx + 1.5, cy + 2, len, R * 1.05, a, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill(); void px; }
  // hokejka na ledě (pod tělem) — 2026-11-13: jako hůl stojícího hráče (S3): dřík s koncovkou, čepel zahnutá křivkou s háčkem, páska
  { const L = o.stickL ?? R * 2.0, a = P.sta, mx = X('st'), my = Y('st'), ca = Math.cos(a), sa = Math.sin(a);
    const gx = mx - ca * L / 2, gy = my - sa * L / 2, bx = mx + ca * L / 2, by = my + sa * L / 2, bs = o.bladeSide ?? 1;
    const ba = a + bs * 0.55, BL = R * 1.15;                                                     // čepel: mírný úhel k dříku (lež hole)
    const ex = bx + Math.cos(ba) * BL, ey = by + Math.sin(ba) * BL;
    const qx = bx + ca * BL * 0.55, qy = by + sa * BL * 0.55;                                  // řídicí bod = háček čepele
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = SKIN_OUT; c.lineWidth = 4.1; c.beginPath(); c.moveTo(gx, gy); c.lineTo(bx, by); c.stroke();
    c.lineWidth = 4.3; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(qx, qy, ex, ey); c.stroke();
    c.strokeStyle = K.stick; c.lineWidth = 2.4; c.beginPath(); c.moveTo(gx + ca * R * 0.4, gy + sa * R * 0.4); c.lineTo(bx, by); c.stroke();
    c.strokeStyle = K.tape; c.lineWidth = 2.5; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(qx, qy, ex, ey); c.stroke();
    c.strokeStyle = K.tape; c.lineWidth = 2.4; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + ca * R * 0.4, gy + sa * R * 0.4); c.stroke();   // omotávka nahoře
    c.beginPath(); c.arc(gx, gy, 1.5, 0, Math.PI * 2); c.fillStyle = SKIN_OUT; c.fill(); }   // koncovka
  // brusle
  for (const sd of ['r', 'l']) skate(c, X(sd + 'f'), Y(sd + 'f'), P[sd + 'fa'], P.fsh, R, K);
  // sjednocená cesta těla: štulpny (koleno→brusle), stehna (kyčel→koleno), kalhoty, trup, ramena, paže, rukavice, helma
  const shin = new Path2D(), thigh = new Path2D(), up = new Path2D(), arms = new Path2D(), gloves = new Path2D(), helm = new Path2D();
  const fb = sd => { const kx = X(sd + 'k'), ky = Y(sd + 'k'), fx = X(sd + 'f'), fy = Y(sd + 'f'), d = Math.hypot(fx - kx, fy - ky) || 1;   // štulpna končí u kotníku (ne ve středu brusle)
    const back = Math.min(d * 0.6, R * 0.3 * P.fsh); return [fx - (fx - kx) / d * back, fy - (fy - ky) / d * back]; };
  for (const sd of ['r', 'l']) { const [ax, ay] = fb(sd); capsule(shin, X(sd + 'k'), Y(sd + 'k'), R * 0.3, ax, ay, R * 0.22); capsule(thigh, X(sd + 'p'), Y(sd + 'p'), R * 0.46, X(sd + 'k'), Y(sd + 'k'), R * 0.33); }
  const pcx = (X('rp') + X('lp')) / 2, pcy = (Y('rp') + Y('lp')) / 2, scx = (X('rs') + X('ls')) / 2, scy = (Y('rs') + Y('ls')) / 2;
  capsule(up, pcx, pcy, R * 0.78, scx, scy, R * 0.86);
  for (const sd of ['r', 'l']) ell(up, X(sd + 's'), Y(sd + 's'), R * 0.48, R * 0.44);
  for (const sd of ['r', 'l']) { capsule(arms, X(sd + 's'), Y(sd + 's'), R * 0.28, X(sd + 'e'), Y(sd + 'e'), R * 0.22); capsule(arms, X(sd + 'e'), Y(sd + 'e'), R * 0.22, X(sd + 'g'), Y(sd + 'g'), R * 0.19); }
  const gl = ['r', 'l'].map(sd => ({ x: X(sd + 'g'), y: Y(sd + 'g'), a: Math.atan2(Y(sd + 'g') - Y(sd + 'e'), X(sd + 'g') - X(sd + 'e')) }));
  for (const g of gl) { const m = new DOMMatrix().translate(g.x, g.y).rotate(g.a * 180 / Math.PI); const q = new Path2D(); q.roundRect(-2.4, -2.05, 4.6, 4.1, 1.5); gloves.addPath(q, m); }
  const hs = P.hs, hrx = R * 0.616 * hs, hry = R * 0.56 * hs, hx = X('hd'), hy = Y('hd');
  ell(helm, hx, hy, hrx, hry, P.fa);
  const body = new Path2D(); body.addPath(shin); body.addPath(thigh); body.addPath(up); body.addPath(arms); body.addPath(gloves); body.addPath(helm);
  c.lineJoin = 'round'; c.strokeStyle = SKIN_OUT; c.lineWidth = 2.0; c.stroke(body);   // jeden vnější obrys
  c.fillStyle = shade(K.jersey, -0.1); c.fill(shin);   // štulpny v barvě dresu
  if (!lod) { c.save(); c.clip(shin); c.strokeStyle = K.accent; c.lineWidth = R * 0.16; c.beginPath();   // pruh na štulpně
    for (const sd of ['r', 'l']) { const kx = X(sd + 'k'), ky = Y(sd + 'k'), [ax, ay] = fb(sd), mx = kx + (ax - kx) * 0.45, my = ky + (ay - ky) * 0.45, a = Math.atan2(ay - ky, ax - kx) + Math.PI / 2;
      c.moveTo(mx - Math.cos(a) * R * 0.4, my - Math.sin(a) * R * 0.4); c.lineTo(mx + Math.cos(a) * R * 0.4, my + Math.sin(a) * R * 0.4); } c.stroke(); c.restore(); }
  c.fillStyle = K.pants; c.fill(thigh);   // kalhoty
  c.fillStyle = K.jersey; c.fill(up);
  const lt = luma(K.jersey) > 0.55;
  c.fillStyle = shade(K.jersey, (lt ? -0.55 : 1) * (lod ? 0.22 : 0.13)); c.beginPath(); for (const sd of ['r', 'l']) { const sx = X(sd + 's'), sy = Y(sd + 's'); c.moveTo(sx + R * 0.48, sy); c.ellipse(sx, sy, R * 0.48, R * 0.44, 0, 0, Math.PI * 2); } c.fill();   // ramena (chrániče) světlejší
  c.fillStyle = shade(K.jersey, lod ? -0.22 : -0.14); c.fill(arms);   // rukávy tmavší
  // lem dresu u pasu (tvar trupu → kalhoty) a límec / číslo
  const ta = Math.atan2(scy - pcy, scx - pcx);
  { c.save(); c.clip(up); c.strokeStyle = shade(K.jersey, -0.3); c.lineWidth = R * 0.16; c.beginPath();
    const bx = pcx + Math.cos(ta) * R * 0.2, by = pcy + Math.sin(ta) * R * 0.2, nx = -Math.sin(ta), ny = Math.cos(ta);
    c.moveTo(bx - nx * R, by - ny * R); c.lineTo(bx + nx * R, by + ny * R); c.stroke(); c.restore(); }
  const tl = Math.hypot(scx - pcx, scy - pcy);
  if (P.num > 0.02) {   // číslo na zádech, vrchem k hlavě (ve stoji jako skinBody)
    const nx = pcx + (scx - pcx) * 0.42, ny = pcy + (scy - pcy) * 0.42, fs = R * (1.1 + 0.15 * Math.min(1, tl / R / 1.5));
    c.save(); c.globalAlpha *= Math.min(1, P.num); c.translate(tl > R * 0.3 ? nx : scx - Math.cos(P.fa) * R * 0.67, tl > R * 0.3 ? ny : scy - Math.sin(P.fa) * R * 0.67);
    c.rotate((tl > R * 0.3 ? ta : P.fa) + Math.PI / 2); c.font = `900 ${fs}px 'Segoe UI', sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lightJ = luma(K.jersey) > 0.4; c.lineJoin = 'round'; c.lineWidth = 1.1; c.strokeStyle = lightJ ? '#ffffff' : (K.accent === '#f4f7fb' || K.accent === '#ffffff') ? shade(K.jersey, -0.5) : K.accent;
    c.strokeText(String(K.num), 0, 0.3); c.fillStyle = lightJ ? '#1a1f29' : '#ffffff'; c.fillText(String(K.num), 0, 0.3); c.restore();
  }
  if (P.num < 0.98) {   // na zádech: hruď = límec do V a pruh přes prsa (přední strana dresu)
    c.save(); c.globalAlpha *= 1 - Math.max(0, P.num); c.translate(scx, scy); c.rotate(ta);
    c.strokeStyle = K.accent; c.lineWidth = R * 0.18; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-R * 0.05, -R * 0.42); c.lineTo(-R * 0.45, 0); c.lineTo(-R * 0.05, R * 0.42); c.stroke();
    c.save(); c.clip(up); c.globalAlpha *= 0.85; c.lineWidth = R * 0.26; c.beginPath(); c.moveTo(-tl * 0.55, -R * 1.2); c.lineTo(-tl * 0.55, R * 1.2); c.stroke(); c.restore();
    c.restore();
  }
  // rukavice + manžeta
  c.fillStyle = K.glove; c.fill(gloves);
  for (const g of gl) { c.save(); c.translate(g.x, g.y); c.rotate(g.a); c.fillStyle = mix(K.glove, K.cuff, 0.75); c.fillRect(-2.4 + 0.2, -2.05 + 0.3, 0.9, 4.1 - 0.6); c.restore(); }
  // helma (v barvě dresu o tón tmavší), hledí podle natočení obličeje: fv −1 = do ledu (skryté), 0 = vpřed (okraj), +1 = nahoru (střed)
  c.fillStyle = K.helmet === K.jersey ? shade(K.helmet, lt ? -0.18 : -0.24) : K.helmet; c.fill(helm);
  c.strokeStyle = shade(K.helmet, -0.38); c.lineWidth = 0.6; c.stroke(helm);
  const upF = Math.max(0, Math.min(1, P.fv)), dnF = Math.max(0, Math.min(1, -P.fv));
  if (dnF < 0.98) {
    const fa = P.fa, off = upF * hrx * 0.55, rr = hrx * (0.98 - 0.4 * upF), span = 0.85 + upF * 1.6;
    const vx = hx - Math.cos(fa) * off, vy = hy - Math.sin(fa) * off;
    c.save(); c.globalAlpha *= 1 - dnF; c.lineCap = 'round';
    if (K.helmetType === 'none') { c.beginPath(); c.ellipse(vx + Math.cos(fa) * rr * 0.8, vy + Math.sin(fa) * rr * 0.8, R * 0.18 * (1 + upF), R * 0.26 * (1 + upF), fa, 0, Math.PI * 2); c.fillStyle = '#e8b896'; c.fill(); }
    else { c.beginPath(); c.arc(vx, vy, rr, fa - span, fa + span); c.strokeStyle = K.helmetType === 'cage' ? '#2b2f36' : K.visor; c.lineWidth = K.helmetType === 'cage' ? 0.9 : 1.5; c.stroke();
      if (upF > 0.3) { c.beginPath(); c.ellipse(vx + Math.cos(fa) * rr * 0.25, vy + Math.sin(fa) * rr * 0.25, rr * 0.5, rr * 0.62, fa, 0, Math.PI * 2); c.fillStyle = '#e8b896'; c.globalAlpha *= (upF - 0.3) / 0.7; c.fill(); } }   // obličej za hledím
    c.restore();
  }
  if (!lod) { c.beginPath(); c.ellipse(hx - 0.35 * hrx, hy - 0.35 * hry, R * 0.16, R * 0.1, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill(); }   // lesk helmy
  // jedno stínování přes celé tělo (světlo vlevo nahoře ve světě, předané v lokálu)
  const lx = o.lx ?? -0.5, ly = o.ly ?? -0.5, gx = (pcx + scx) / 2, gy = (pcy + scy) / 2;
  const g = c.createRadialGradient(gx + lx * R * 0.9, gy + ly * R * 0.9, R * 0.2, gx, gy, R * 2.6);
  g.addColorStop(0, 'rgba(255,255,255,0.26)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(10,16,40,0.24)');
  c.save(); c.clip(body); c.fillStyle = g; c.fillRect(gx - R * 4, gy - R * 4, R * 8, R * 8); c.restore();
}
