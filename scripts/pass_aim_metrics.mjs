// UKAZATEL PŘIHRÁVKY (NetGame._drawPassAim) — měření + porovnávací snímky. Deterministické: pevné pozice, pevné cam.t, cam.dt=0.
// RUBRIKA (stanovena PŘEDEM, 2026-11-15; platí pro každou situaci):
//   R1 inkoust ukazatele (součet alfa/255 jeho pixelů na prázdném plátně) ≤ 30 % původního (baseline z --label=pred)
//   R2 ukazatel nepřekrývá cílového hráče: 0 px uvnitř kruhu těla cíle (poloměr PLAYER.radius)
//   R3 šipka začíná u vlastní postavy: nejbližší pixel ukazatele u mé postavy je ≤ R+6 od jejího středu
//      a žádný pixel ukazatele není dál než 3,5 R od mé postavy, pokud neleží u cíle (≤ R+12 od cíle) = bez čáry přes led
//   R4 deterministické: dva vykreslení se stejným vstupem dají stejný hash masky (i ve dvou situacích s pulsem cam.t)
// Situace: blizko (cíl 90 j.), daleko (cíl 480 j.), za_zady (jediný spoluhráč za zády), vzduch (podržené RMB → nadzvednutý pas).
// Spuštění: PORT=P node server.js; node scripts/pass_aim_metrics.mjs --port=P --label=pred|po --out=<složka>
//   → <out>/pass_aim_<label>.json + <out>/pass_aim_<label>_<situace>.png (2× zvětšený výřez kolem hráčů, celá scéna)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4873, LABEL = A.label || 'po', OUT = A.out || '.';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.waitForTimeout(300); await p.click('#go-offline'); await p.waitForTimeout(3000);

const SCEN = ['blizko', 'daleko', 'za_zady', 'vzduch'];
const res = await p.evaluate((SCEN) => {
  const g = window.__fhGame, R = 7;
  const ents = [...g.players.values()], meE = ents.find(e => e.isMe), me = meE.ent;
  const mates = ents.filter(e => !e.isMe && e.ent.team === me.team).map(e => e.ent);
  const opps = ents.filter(e => e.ent.team !== me.team).map(e => e.ent);
  const W = 1400, H = 700, scale = 1.25;
  const cam = { scale, ox: 0, oy: 0, t: 0.4, dt: 0 };
  const setup = (sc) => {
    const MX = 420, MY = 230;
    Object.assign(me, { x: MX, y: MY, hasPuck: true, aimAngle: 0, bodyAngle: 0, carryAngle: 0 });
    g.puck.x = MX + 11; g.puck.y = MY + 4;
    opps.forEach((o, i) => Object.assign(o, { x: 980, y: 60 + i * 40, hasPuck: false, passReq: 0 }));
    mates.forEach(o => Object.assign(o, { x: 1000, y: 420, hasPuck: false, passReq: 0 }));
    const m0 = mates[0], m1 = mates[1];
    if (sc === 'blizko' || sc === 'vzduch') { Object.assign(m0, { x: MX + 90, y: MY - 20 }); if (m1) Object.assign(m1, { x: MX - 200, y: MY + 150 }); }
    if (sc === 'daleko') { Object.assign(m0, { x: MX + 480, y: MY + 60 }); if (m1) Object.assign(m1, { x: MX - 220, y: MY - 160 }); }
    if (sc === 'za_zady') { Object.assign(m0, { x: MX - 150, y: MY + 30 }); if (m1) Object.assign(m1, { x: MX - 170, y: MY - 60 }); }
    g.input = g.input || {}; g.input.rmb = sc === 'vzduch';
    g._rmbAt = sc === 'vzduch' ? performance.now() / 1000 - 1 : null;
    // cíl = stejné skóre jako v _drawPassAim (jen pro měření R2)
    let best = null, bs = -Infinity;
    for (const o of mates) { const dx = o.x - me.x, dy = o.y - me.y, d = Math.hypot(dx, dy);
      const diff = Math.abs(((Math.atan2(dy, dx) - me.aimAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const s = -diff * 2 - d / 400; if (s > bs) { bs = s; best = o; } }
    return best;
  };
  const mask = (sc) => {
    const tgt = setup(sc);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    g._drawPassAim(x, cam);
    const d = x.getImageData(0, 0, W, H).data;
    let ink = 0, n = 0, h = 2166136261, inTgt = 0, nearMe = Infinity, stray = 0;
    const mx = me.x * scale, my = me.y * scale, tx = tgt.x * scale, ty = tgt.y * scale;
    for (let i = 0; i < W * H; i++) {
      const a = d[i * 4 + 3]; h = Math.imul(h ^ a ^ (d[i * 4] << 8), 16777619) >>> 0; if (!a) continue;
      n++; ink += a / 255;
      const px = i % W, py = (i / W) | 0;
      const dm = Math.hypot(px - mx, py - my) / scale, dt = Math.hypot(px - tx, py - ty) / scale;
      if (dt < R) inTgt++;
      if (dm < nearMe && dt > R + 12) nearMe = dm;
      if (dm > 3.5 * R && dt > R + 12) stray++;
    }
    return { tgtDist: +Math.hypot(tgt.x - me.x, tgt.y - me.y).toFixed(1), px: n, ink: +ink.toFixed(1), inTgt, nearMe: +nearMe.toFixed(1), stray, hash: h.toString(16) };
  };
  const out = {};
  for (const sc of SCEN) {
    const m1 = mask(sc), m2 = mask(sc);
    const c2 = { ...cam, t: 1.1 }; const save = cam.t; cam.t = 1.1; const m3 = mask(sc); cam.t = save; void c2;
    out[sc] = { ...m1, det: m1.hash === m2.hash, hashPuls: m3.hash };
  }
  return out;
}, SCEN);

// Snímky: celá scéna (_draw) přes skutečný render, výřez kolem hráčů, 2× zvětšený
for (const sc of SCEN) {
  const url = await p.evaluate((sc) => {
    const g = window.__fhGame, ents = [...g.players.values()], me = ents.find(e => e.isMe).ent;
    const mates = ents.filter(e => !e.isMe && e.ent.team === me.team).map(e => e.ent);
    const opps = ents.filter(e => e.ent.team !== me.team).map(e => e.ent);
    const MX = 420, MY = 230;
    Object.assign(me, { x: MX, y: MY, hasPuck: true, aimAngle: 0, bodyAngle: 0, carryAngle: 0 });
    g.puck.x = MX + 11; g.puck.y = MY + 4;
    opps.forEach((o, i) => Object.assign(o, { x: 980, y: 60 + i * 40, hasPuck: false, passReq: 0 }));
    mates.forEach(o => Object.assign(o, { x: 1000, y: 420, hasPuck: false, passReq: 0 }));
    const m0 = mates[0], m1 = mates[1];
    if (sc === 'blizko' || sc === 'vzduch') { Object.assign(m0, { x: MX + 90, y: MY - 20 }); if (m1) Object.assign(m1, { x: MX - 200, y: MY + 150 }); }
    if (sc === 'daleko') { Object.assign(m0, { x: MX + 480, y: MY + 60 }); if (m1) Object.assign(m1, { x: MX - 220, y: MY - 160 }); }
    if (sc === 'za_zady') { Object.assign(m0, { x: MX - 150, y: MY + 30 }); if (m1) Object.assign(m1, { x: MX - 170, y: MY - 60 }); }
    g.input.rmb = sc === 'vzduch'; g._rmbAt = sc === 'vzduch' ? performance.now() / 1000 - 1 : null;
    const S = 2.6, x0 = 140, y0 = 40, W = 860, H = 380;   // výřez ve světě
    const c = document.createElement('canvas'); c.width = Math.round(W * S); c.height = Math.round(H * S);
    const ctx = c.getContext('2d');
    ents.forEach(e => { e.ent._aidEv = null; e.ent._aidHad = e.ent.hasPuck; });
    ents.forEach(e => { e.ent.vx = 0; e.ent.vy = 0; });
    for (let f = 0; f < 90; f++) g._draw(ctx, { scale: S, ox: -x0 * S, oy: -y0 * S, t: 100000.4 - (90 - f) / 60, dt: 1 / 60 });   // nohy dojedou na nové pozice
    ents.forEach(e => { e.ent._aidEv = null; });
    g._draw(ctx, { scale: S, ox: -x0 * S, oy: -y0 * S, t: 100000.4, dt: 0 });
    return c.toDataURL('image/png');
  }, sc);
  fs.writeFileSync(path.join(OUT, `pass_aim_${LABEL}_${sc}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

let base = null; const bf = path.join(OUT, 'pass_aim_pred.json');
if (LABEL !== 'pred' && fs.existsSync(bf)) base = JSON.parse(fs.readFileSync(bf, 'utf8')).res;
const verdict = {};
for (const sc of SCEN) {
  const r = res[sc], R1 = base ? r.ink <= 0.3 * base[sc].ink : null;
  verdict[sc] = { R1_ink_pomer: base ? +(r.ink / base[sc].ink).toFixed(3) : null, R1, R2: r.inTgt === 0, R3: r.nearMe <= 13 && r.stray === 0, R4: r.det };
}
fs.writeFileSync(path.join(OUT, `pass_aim_${LABEL}.json`), JSON.stringify({ res, verdict }, null, 1));
for (const sc of SCEN) console.log(sc.padEnd(8), JSON.stringify(res[sc]), '|', JSON.stringify(verdict[sc]));
console.log('chyby JS:', errs.length ? errs : 0);
await b.close();
