// Měří SEKÁNÍ na obrazovce: per-frame posun botů vs. jejich vyhlazená rychlost.
// node scripts/stutter_probe.mjs <url> <#tlačítko> [sekund=15]
// hitch = snímek, kde bot jedoucí >80 px/s urazí <40 % nebo >180 % očekávané dráhy; dlouhý snímek = dt > 25 ms.
import { chromium } from 'playwright';
const [url = 'http://localhost:4900/', sel = '#go-offline', secs = '15'] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
// Na produkci (bez háčku) ho vlož do main.js jen v tomto testovacím prohlížeči
// LOCAL_CLIENT=1: na produkci podstrč místní public/js/game.js (test nového klienta proti živému serveru)
if (process.env.LOCAL_CLIENT) { const fs = await import('node:fs'); const src = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
  await p.route(/\/js\/game\.js(\?|$)/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: src })); }
await p.route(/\/js\/main\.js(\?|$)/, async route => { const r = await route.fetch(); let body = await r.text();
  if (!body.includes('__fhGame')) body = body.replace('inGame = true; currentGame = game;', 'inGame = true; currentGame = game; window.__fhGame = game;');
  route.fulfill({ response: r, body }); }); p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', localStorage.getItem('hockey_name') || 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click(sel); await p.waitForTimeout(4000);
const drive = (async () => { const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA']; for (let i = 0; i < +secs; i++) { const k = keys[i % 4]; await p.keyboard.down(k); await p.waitForTimeout(1000); await p.keyboard.up(k); } })();
const r = await p.evaluate(secs => new Promise(res => {
  const g = window.__fhGame; if (!g) return res({ err: 'no game' });
  const prev = new Map(), vavg = new Map(); const H = {}, S = {}, PV = {}, PJ = { n: 0, max: 0 }; let last = performance.now(), frames = 0, longF = 0, hitch = 0, samples = 0;
  const end = last + secs * 1000;
  const f = now => {
    const dt = (now - last) / 1000; last = now; frames++; if (dt > 0.025) longF++;
    const list = [...[...g.players].map(([id, e]) => [e.isMe ? 'JA' : 'bot', e.ent]), ['puk', g.puck]];
    for (const [id, ent] of list) { const x = ent.x, y = ent.y, q = prev.get(ent);
      if (q && dt > 0) { const v = Math.hypot(x - q.x, y - q.y) / dt, a = vavg.get(ent) ?? v;
        if (a > 80 && dt < 0.025 && !g.locked) { samples++; S[id] = (S[id] || 0) + 1; const ratio = v / a; if (ratio < 0.4 || ratio > 1.8) { hitch++; const k = (ratio > 1.8 ? 'skok+' : 'stop-') + ':' + id; H[k] = (H[k] || 0) + 1; } }
        vavg.set(ent, a * 0.8 + v * 0.2); }
      if (id === 'puk' && q && !g.locked) { const pv = PV.v; const dx = x - q.x, dy = y - q.y;
        if (pv && (dx * pv.x + dy * pv.y) < 0 && Math.hypot(dx, dy) > 6 && Math.hypot(pv.x, pv.y) > 3) { PJ.n++; PJ.max = Math.max(PJ.max, Math.round(Math.hypot(dx, dy))); }
        PV.v = { x: dx, y: dy }; }
      prev.set(ent, { x, y }); }
    if (now < end) requestAnimationFrame(f);
    else res({ frames, fps: +(frames / secs).toFixed(1), longFramePct: +(100 * longF / frames).toFixed(1), hitchPct: +(100 * hitch / Math.max(1, samples)).toFixed(2), samples, snapAvg: g._snapAvg && +g._snapAvg.toFixed(1), snapMax: g._snapMax && +g._snapMax.toFixed(1), underruns: g._underruns || 0, offline: !!g.offline, pukZpet: PJ, pct: Object.fromEntries(Object.keys(S).map(k => [k, +(100 * ((H['skok+:' + k] || 0) + (H['stop-:' + k] || 0)) / S[k]).toFixed(2)])), H });
  }; requestAnimationFrame(f);
}), +secs);
await drive.catch(() => {});
console.log(sel, JSON.stringify(r), 'chyby JS:', errs.length ? errs : 0);
await b.close();
