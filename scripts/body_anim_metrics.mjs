// ANIMACE TĚLA — deterministické měření (bez canvasu). Póza těla = TÁŽ čistá funkce jako draw(): skatePose + bodyPose
// (public/js/entities/Player.js) → skinRig (public/js/entities/skin.js; kostra, ze které kreslí skinBody). Ruce = stickHands (jako draw).
// Simulace se nepouští — kinematika je předepsaná (60 fps). node scripts/body_anim_metrics.mjs [--b=0,1] [--detail] [--json]
//
// RUBRIKA (stanovena PŘEDEM, 2026-11-13; 1× = trénink 1366×768 dpr 1 → 1,198 px na svět. jednotku; „vůči bokům" = posun horního těla
// ux, uy oproti kalhotám/bruslím, které se nehýbou):
//  B1 Krok: při jízdě vpřed 165 px/s se rameno pohne (vůči středu hráče) ≥ 3 px špička–špička v rytmu kroku (|korelace s fází| ≥ 0,7).
//  B2 Rozjezd = předklon: horní tělo se vůči bokům posune vpřed ≥ 1,5 px (rozjezd z klidu 140 px/s²).
//  B3 Brzda = záklon: při stopu (−620 px/s², jako Space) horní tělo vůči bokům dozadu ≥ 1,5 px.
//  B4 Zatáčka: boční posun horního těla do zatáčky úměrný úhlové rychlosti (korelace ≥ 0,8) a ≥ 2 px špička–špička.
//  B5 Nápřah a švih (stojící hráč, ať se neplete krok): plný nápřah natočí ramena ≥ 0,35 rad (na forhend); po ráně švih přes směr střely ≥ 0,2 rad na druhou stranu.
//  B6 Přihrávka (stojící hráč): krátké cuknutí ramen ≥ 0,15 rad do 0,25 s, za 0,5 s zpět (< 0,03 rad).
//  B7 Zásah: po nárazu (skok rychlosti) horní tělo do 0,15 s odskočí ≥ 2 px, za 0,8 s je zpět (< 0,5 px).
//  B8 Hlava: švih míření o 1 rad → hlava se vůči tělu natočí ≥ 0,25 rad napřed, za 0,6 s srovná (< 0,05 rad).
//  B9 Klid: stojící hráč dýchá — ramena/helma se hýbou 0,3–1 px špička–špička (ne mrtvý, ne neklid).
//  B10 Plynulost: žádný bod těla (ramena, lokty, helma) neskočí > 3 px mezi snímky v žádném scénáři.
//  B11 Ruce na holi: rukavice (z kostry) leží na dříku ≤ 1 px ve všech scénářích.
//  B12 Deterministické: dva běhy = stejný hash všech póz.
import { createHash } from 'crypto';
const { PLAYER } = await import('../public/js/constants.js');
const { skateAdvance, skateStopBlend, skatePose, skateFeetSmooth, bodyPose, stickHands } = await import('../public/js/entities/Player.js');
const { skinRig } = await import('../public/js/entities/skin.js');
const { angleDiff, lerpAngle } = await import('../public/js/utils.js');
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BS = String(ARG.b ?? '0,1').split(',').map(Number);
const R = PLAYER.radius, SC = 1.198, DT = 1 / 60, HND = 1;

// scénář: step(p, t) nastaví vx, vy, bodyAngle, aimAngle, _dispCharge, hasPuck, _sw, _stagT…; vrací snímky s kostrou ve SVĚTĚ i lokálu
function scenario(sc, b) {
  const p = { x: 0, y: 0, vx: 0, vy: 0, bodyAngle: 0, aimAngle: 0, _lean: 0, _dispCharge: 0, hasPuck: false, handed: HND, _stagT: 0, _stagDir: 1 }, F = [];
  for (let n = 0; n < (sc.T || 4) * 60; n++) {
    const t = n * DT; sc.step(p, t);
    p.x += p.vx * DT; p.y += p.vy * DT;
    // == draw(): stop + póza bruslí (stejné pořadí jako _renderPlayerUp, K3)
    const spd = Math.hypot(p.vx, p.vy), ba = p.bodyAngle;
    if (spd > 30) p._hsDir = Math.atan2(p.vy, p.vx);
    if ((p._stopFx ?? 0) > 0) p._stopFx -= DT;
    p._stopK3 = skateStopBlend(p._stopK3 ?? 0, (p._stopFx ?? 0) > 0, DT, 5, 4); if (!p._stopK3) p._hsDir = null;
    const mLoc = spd > 8 ? angleDiff(Math.atan2(p.vy, p.vx), ba) : 0;
    skateAdvance(p, p.x, p.y, ba, spd, 3, mLoc, DT);
    const pose = skatePose({ k: 3, phase: p._skatePhase ?? 0, spd, mLoc: p._mLocS, stopT: p._stopK3 ?? 0, stopLoc: p._hsDir != null ? angleDiff(p._hsDir, ba) : 0, rotSf: p._rotSf ?? 0, lean: p._lean });
    skateFeetSmooth(p, pose.feet, DT);
    const bp = bodyPose(p, { b, x: p.x, y: p.y, vx: p.vx, vy: p.vy, ba, aim: p.aimAngle, dcv: p._dispCharge, sw: p._sw ? 1 - p._sw.t / p._sw.T : -1,
      hasPuck: p.hasPuck, hnd: HND, stagT: p._stagT, stagDir: p._stagDir, swing: pose.body.sw ?? 0 }, DT);
    // hůl: špička dříku před tělem na forhendu (v nápřahu stažená k tělu), ruce jako draw (stickHands)
    const c = Math.cos(ba), s = Math.sin(ba), dc = p._dispCharge, tl = { x: 24 * (1 - 0.5 * dc), y: HND * (6 + 10 * dc) };
    const tipW = { x: p.x + tl.x * c - tl.y * s, y: p.y + tl.x * s + tl.y * c };
    const { topW, botW } = stickHands(p.x, p.y, ba, dc, HND, tipW, bp.sway);
    const bo = pose.body, leanW = p._lean * R * 0.15;
    const toL = h => { const dx = h.x - p.x, dy = h.y - p.y; return { x: dx * c + dy * s - bo.x, y: -dx * s + dy * c - leanW - bo.y }; };
    const rig = skinRig({ top: toL(topW), bot: toL(botW), hnd: HND, tw: bo.tw + bp.tw, ux: bp.ux, uy: bp.uy, hd: bp.hd });
    // body kostry v lokálu hráče (s posunem přenosu váhy) a ve světě (pro ruce na holi)
    const L = q => ({ x: q.x + bo.x, y: q.y + bo.y + leanW }), W = q => { const l = L(q); return { x: p.x + l.x * c - l.y * s, y: p.y + l.x * s + l.y * c }; };
    F.push({ t, spd, ba, phase: p._skatePhase ?? 0, bp, rig, S: rig.S.map(L), E: rig.E.map(L), head: L(rig.head), Hw: rig.H.map(W), topW, tipW,
      shA: Math.atan2(rig.S[1].y - rig.S[0].y, rig.S[1].x - rig.S[0].x) - Math.PI / 2 });
    if (p._sw) { p._sw.t -= DT; if (p._sw.t <= 0) p._sw = null; }
    if (p._stagT > 0) p._stagT = Math.max(0, p._stagT - DT);
  }
  return F;
}
const SCN = {
  vpred165: { step: p => { p.vx = 165; p.vy = 0; } },
  rozjezd: { T: 2.5, step: (p, t) => { p.vx = Math.min(165, Math.max(0, (t - 0.3) * 140)); p.vy = 0; } },
  stop: { T: 3, step: (p, t) => { if (t >= 1.2 && !p._st) { p._st = 1; p._stopFx = 0.9; } p.vx = t < 1.2 ? 165 : Math.max(0, 165 - (t - 1.2) * 620); p.vy = 0; } },
  zatacka: { T: 6, step: (p, t) => { const w = 1.4 * Math.sin(2 * Math.PI * t / 3); p._h = (p._h ?? 0) + w * DT; p._w = w;
    p.vx = 150 * Math.cos(p._h); p.vy = 150 * Math.sin(p._h); p.bodyAngle = p.aimAngle = p._h; } },
  napr: { T: 2.5, step: (p, t) => { p.vx = 0; p.vy = 0; const charging = t >= 0.5 && t < 1.3; p.hasPuck = t < 1.3;
    p._dispCharge += ((charging ? 1 : 0) - p._dispCharge) * Math.min(1, (charging ? 18 : 9) * DT);
    if (t >= 1.3 && !p._rel) { p._rel = 1; p._sw = { t: 0.22, T: 0.22 }; } } },
  prihr: { T: 2, step: (p, t) => { p.vx = 0; p.vy = 0; p.hasPuck = t < 1; } },
  zasah: { T: 2.5, step: (p, t) => { p.vx = 120; if (t >= 1 && !p._hit) { p._hit = 1; p.vy = 90; p._stagT = PLAYER.stagT; p._stagDir = 1; }
    else if (p._hit) p.vy = Math.max(0, p.vy - 220 * DT); } },
  hlava: { T: 2, step: (p, t) => { p.vx = 0; p.vy = 0; p.aimAngle = t >= 1 ? 1 : 0; p.bodyAngle = lerpAngle(p.bodyAngle, p.aimAngle, Math.min(1, 14 * DT)); } },
  klid: { T: 6, step: p => { p.vx = 0; p.vy = 0; } },
};

const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let sab = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa && sb ? sab / Math.sqrt(sa * sb) : 0; };
const pp = pts => { let m = 0; for (let i = 0; i < pts.length; i += 3) for (let j = i + 3; j < pts.length; j += 3) m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)); return m * SC; };
const segD = (q, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(q.x - a.x - u * dx, q.y - a.y - u * dy); };
const at = (F, t) => F[Math.min(F.length - 1, Math.round(t * 60))];
const win = (F, t0, t1) => F.filter(f => f.t >= t0 - 1e-9 && f.t <= t1 + 1e-9);

function analyze(b) {
  const hash = createHash('sha256'), S = {}; let jump = 0, jumpAt = '', hand = 0;
  for (const [id, sc] of Object.entries(SCN)) {
    const F = scenario(sc, b); S[id] = F;
    for (let n = 0; n < F.length; n++) { const f = F[n];
      for (const q of [...f.S, ...f.E, f.head]) hash.update(q.x.toFixed(4) + q.y.toFixed(4));
      for (const h of f.Hw) hand = Math.max(hand, segD(h, f.topW, f.tipW) * SC);
      if (n > 0) { const g = F[n - 1], A = [...f.S, ...f.E, f.head], Bp = [...g.S, ...g.E, g.head];
        for (let i = 0; i < A.length; i++) { const d = Math.hypot(A[i].x - Bp[i].x, A[i].y - Bp[i].y) * SC; if (d > jump) { jump = d; jumpAt = id; } } }
    }
  }
  const r = {};
  { const F = S.vpred165.slice(60); r.stepPP = Math.max(pp(F.map(f => f.S[0])), pp(F.map(f => f.S[1])));
    r.stepCorr = Math.max(Math.abs(corr(F.map(f => f.S[1].x), F.map(f => Math.sin(f.phase)))), Math.abs(corr(F.map(f => f.S[1].y), F.map(f => Math.sin(f.phase))))); }
  r.fwd = Math.max(...S.rozjezd.map(f => f.rig.ux)) * SC;
  r.back = -Math.min(...win(S.stop, 1.2, 3).map(f => f.rig.ux)) * SC;
  { const F = S.zatacka.slice(60), w = F.map((f, i) => 1.4 * Math.sin(2 * Math.PI * (i + 60) * DT / 3)); r.turnCorr = corr(F.map(f => f.rig.uy), w);
    r.turnPP = (Math.max(...F.map(f => f.rig.uy)) - Math.min(...F.map(f => f.rig.uy))) * SC; }
  { const F = S.napr, base = at(F, 0.45).shA; r.wind = Math.max(...win(F, 0.5, 1.3).map(f => HND * (f.shA - base))); r.follow = -Math.min(...win(F, 1.3, 1.8).map(f => HND * (f.shA - base))); }
  { const F = S.prihr, base = mean(win(F, 0.5, 1).map(f => f.shA)); r.pass = Math.max(...win(F, 1, 1.25).map(f => Math.abs(f.shA - base))); r.passBack = Math.max(...win(F, 1.5, 2).map(f => Math.abs(f.shA - base)) ); }
  { const F = S.zasah, ux0 = at(F, 0.98).rig, d = f => Math.hypot(f.rig.ux - ux0.ux, f.rig.uy - ux0.uy) * SC;
    r.hit = Math.max(...win(F, 1, 1.15).map(d)); r.hitBack = Math.max(...win(F, 1.8, 2.5).map(d)); }
  { const F = S.hlava; r.head = Math.max(...win(F, 1, 1.6).map(f => f.rig.hd)); r.headBack = Math.max(...win(F, 1.6, 2).map(f => Math.abs(f.rig.hd))); }
  { const F = S.klid.slice(60); r.idle = Math.max(pp(F.map(f => f.S[0])), pp(F.map(f => f.S[1])), pp(F.map(f => f.head))); }
  return { r, jump, jumpAt, hand, hash: hash.digest('hex').slice(0, 16) };
}

const f2 = v => (+v).toFixed(2), out = {};
for (const b of BS) {
  const A = analyze(b), B2 = analyze(b), r = A.r;
  const rub = [
    ['B1 krok: rameno ≥3 px, |r|≥0,7', r.stepPP >= 3 && r.stepCorr >= 0.7, `${f2(r.stepPP)} px, r = ${f2(r.stepCorr)}`],
    ['B2 rozjezd: předklon ≥1,5 px', r.fwd >= 1.5, `${f2(r.fwd)} px`],
    ['B3 brzda: záklon ≥1,5 px', r.back >= 1.5, `${f2(r.back)} px`],
    ['B4 zatáčka: r≥0,8, ≥2 px', r.turnCorr >= 0.8 && r.turnPP >= 2, `r = ${f2(r.turnCorr)}, ${f2(r.turnPP)} px`],
    ['B5 nápřah ≥0,35 rad, švih ≥0,2', r.wind >= 0.35 && r.follow >= 0.2, `${f2(r.wind)} / ${f2(r.follow)} rad`],
    ['B6 přihrávka ≥0,15 rad, zpět', r.pass >= 0.15 && r.passBack < 0.03, `${f2(r.pass)} rad, po 0,5 s ${f2(r.passBack)}`],
    ['B7 zásah ≥2 px do 0,15 s, zpět', r.hit >= 2 && r.hitBack < 0.5, `${f2(r.hit)} px, po 0,8 s ${f2(r.hitBack)} px`],
    ['B8 hlava ≥0,25 rad, srovná', r.head >= 0.25 && r.headBack < 0.05, `${f2(r.head)} rad, po 0,6 s ${f2(r.headBack)}`],
    ['B9 klid 0,3–1 px', r.idle >= 0.3 && r.idle <= 1, `${f2(r.idle)} px`],
    ['B10 skok ≤3 px/snímek', A.jump <= 3, `max ${f2(A.jump)} px (${A.jumpAt})`],
    ['B11 ruce na holi ≤1 px', A.hand <= 1, `max ${A.hand.toExponential(1)} px`],
    ['B12 deterministické', A.hash === B2.hash, A.hash],
  ];
  out[b] = { rub: rub.map(([n, ok, v]) => ({ n, ok, v })), r };
  console.log(`\n== B${b} ${b === 1 ? '(živé tělo, nové)' : '(dřívější)'} — ${rub.filter(x => x[1]).length}/${rub.length}`);
  for (const [n, ok, v] of rub) console.log(`  ${ok ? 'OK  ' : 'NE  '} ${n.padEnd(34)} ${v}`);
  if (ARG.detail) console.log(r);
}
if (ARG.json) console.log(JSON.stringify(out));
