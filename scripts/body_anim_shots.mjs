// SNÍMKY TĚLA ze živé hry (trénink): jízda vpřed, zatáčka, brzda, nápřah + rána, klid — PŘED (VIS.b = 0) i PO (VIS.b = 1)
// v 1× (dpr 1) a v detailu (dpr 3). Snímá se z herního canvasu po každém vykreslení (hook engine.onDraw), každý k-tý snímek.
// Server musí běžet: PORT=46xx node server.js.   node scripts/body_anim_shots.mjs --port=4611 --out=DIR [--n=12]
// List a GIF: python scripts/body_anim_sheet.py DIR OUT.png OUT.gif
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, OUT = A.out || '_body_shots', N = +(A.n || 12);
// --key=k --pred=3 --po=4: porovnat jinou volbu VIS (výchozí tělo b 0 → 1)
const VKEY = A.key || 'b', VPRED = +(A.pred ?? 0), VPO = +(A.po ?? 1);
mkdirSync(OUT, { recursive: true });
// id, krok snímání (každý k-tý snímek), příprava (s jízdy), klávesy, akce během snímání
const SIT = [
  { id: 'vpred', k: 2, keys: ['KeyD'], pre: 1.4 },
  { id: 'zatacka', k: 3, keys: ['KeyD'], pre: 1.4, turn: true },
  { id: 'brzda', k: 2, keys: ['KeyD'], pre: 1.4, brake: true },
  { id: 'napr', k: 4, keys: [], pre: 0.6, shot: true },
  { id: 'klid', k: 12, keys: [], pre: 1.0 },
  { id: 'bokem', k: 2, keys: ['KeyS'], pre: 1.4 },                  // jízda bokem dolů, tělo čelem doprava (myš)
  { id: 'svih', k: 2, keys: ['KeyD'], pre: 1.4, flick: true },      // jízda vpřed, po 6 snímcích švih myší dozadu
  { id: 'obrat', k: 3, keys: ['KeyD'], pre: 1.4, rev: true },       // jízda doprava, po 3 snímcích prudce doleva (brzda + rozjezd), myš vpravo
];
const ONLY = A.only ? String(A.only).split(',') : null;
const errs = [];
const b = await chromium.launch();
for (const dpr of [1, 3]) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr, reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(`http://localhost:${PORT}/?fhtest`, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1'));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(1500);
  for (const lab of ['pred', 'po']) {
    await p.evaluate(async ([key, v]) => { (await import('/js/vis.js')).VIS[key] = v; }, [VKEY, lab === 'po' ? VPO : VPRED]);
    for (const S of SIT) { if (ONLY && !ONLY.includes(S.id)) continue;
      await p.evaluate(() => { const g = window.__fhGame, L = g.local; L.x = 160; L.y = 330; L.vx = 0; L.vy = 0; L.bodyAngle = L.skateAngle = L.aimAngle = 0;
        if (g.puck) { g.puck.x = 900; g.puck.y = 60; g.puck.vx = 0; g.puck.vy = 0; } });
      const cam = await p.evaluate(() => { const c = window.__fhGame._cam; return { s: c.scale, ox: c.ox, oy: c.oy }; });
      const aimAt = async () => { const L = await p.evaluate(() => { const L = window.__fhGame.local; return [L.x, L.y]; });
        await p.mouse.move(cam.ox + (L[0] + 220) * cam.s, cam.oy + L[1] * cam.s); };
      await aimAt(); await p.waitForTimeout(300);
      if (S.shot) await p.evaluate(() => { const g = window.__fhGame, L = g.local, t = L.stickTip; if (g.puck) { g.puck.x = t.x; g.puck.y = t.y; g.puck.vx = 0; g.puck.vy = 0; g.puck.z = 0; } });
      for (const k of S.keys) await p.keyboard.down(k);
      for (let t = 0; t < S.pre / 0.17; t++) { await p.waitForTimeout(170); await aimAt(); }
      if (S.shot) await p.mouse.down();
      if (S.brake) await p.keyboard.down('Space');
      const frames = await p.evaluate(async ({ n, k, turn, shot, flick, rev, cw }) => {
        const g = window.__fhGame, eng = g.engine, cv = eng.canvas || document.querySelector('canvas'), inp = g.input;
        const sc = cv.width / cv.clientWidth, W = cw, out = [], prev = eng.onDraw; let f = 0;
        await new Promise(res => {
          eng.onDraw = (c) => { prev(c); const cam = g._cam, L = g.local; f++;
            if (turn) {   // zatáčka: vstup se po 12 snímcích stáčí doprava dolů (D → D+S → S), myš míří po směru jízdy
              const st = Math.floor(f / 12); inp.keys.KeyD = st < 2; inp.keys.KeyS = st >= 1;
              const a = Math.atan2(L.vy, L.vx); inp.mouseX = cam.ox + (L.x + Math.cos(a) * 200) * cam.scale; inp.mouseY = cam.oy + (L.y + Math.sin(a) * 200) * cam.scale; }
            if (rev && f === 3) { inp.keys.KeyD = false; inp.keys.KeyA = true; }
            if (flick && f >= 6) { inp.mouseX = cam.ox + (L.x - 200) * cam.scale; inp.mouseY = cam.oy + L.y * cam.scale; }   // švih dozadu
            if (shot && f === 44) window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));   // rána po ~0,7 s nápřahu
            if (f % k) return;
            const cx = (cam.ox + L.x * cam.scale) * sc, cy = (cam.oy + L.y * cam.scale) * sc, w = W * sc;
            const o = document.createElement('canvas'); o.width = w; o.height = w;
            o.getContext('2d').drawImage(cv, cx - w / 2, cy - w / 2, w, w, 0, 0, w, w);
            out.push({ img: o.toDataURL('image/png'), v: Math.hypot(L.vx, L.vy), dc: L._dispCharge ?? 0 });
            if (out.length >= n) { eng.onDraw = prev; inp.keys.KeyS = false; res(); } };
        });
        return out;
      }, { n: N, k: S.k, turn: !!S.turn, shot: !!S.shot, flick: !!S.flick, rev: !!S.rev, cw: +(A.w || 52) });   // --w = výřez (css px)
      for (const k of S.keys) await p.keyboard.up(k);
      await p.keyboard.up('KeyS'); await p.evaluate(() => { window.__fhGame.input.keys.KeyA = false; }); if (S.brake) await p.keyboard.up('Space'); if (S.shot) await p.mouse.up();
      frames.forEach((f, i) => writeFileSync(join(OUT, `${lab}_${S.id}_d${dpr}_${String(i).padStart(2, '0')}.png`), Buffer.from(f.img.split(',')[1], 'base64')));
      console.log(`${lab} dpr${dpr} ${S.id}: ${frames.length} snímků, rychlost ${frames[0].v.toFixed(0)}–${frames.at(-1).v.toFixed(0)} px/s, nabití max ${Math.max(...frames.map(f => f.dc)).toFixed(2)}`);
      await p.waitForTimeout(500);
    }
  }
  await ctx.close();
}
await b.close();
console.log('chyby v konzoli:', errs.length ? errs : 0);
process.exit(errs.length ? 1 : 0);
