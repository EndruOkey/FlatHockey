// Snímek postojů gólmana (stoj/motýlek/RVH/roztažení/cover, oba gólmani). Server: PORT=4931 node server.js
// node scripts/goalie_stance_shot.mjs [url] [out.png]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4931/', out = process.argv[3] || 'C:/Users/EndruOkey/Documents/hockey-game/_goalie_stances.png';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1250, height: 420 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url + 'privacy.html');
await p.setContent('<body style="margin:0;background:#dceef8"><canvas id=c width=1250 height=420></canvas></body>');
await p.addScriptTag({ type: 'module', content: `
  const { Goalie } = await import('${url}js/entities/Goalie.js');
  const c = document.getElementById('c'), ctx = c.getContext('2d'); ctx.fillStyle = '#dceef8'; ctx.fillRect(0, 0, 1250, 420);
  const S = 6, list = [['stand',1],['butterfly',1],['rvh',1],['stretch',1],['stretch',-1],['cover',1]];
  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#123';
  list.forEach(([st, side], i) => for2(st, side, i));
  function for2(st, side, i) { for (const [row, sd] of [[0,'right'],[1,'left']]) {
    const g = new Goalie(sd); g.stance = st === 'cover' ? 'stand' : st; g._side = side; g._stanceT = 1; g._tilt = 0;
    if (st === 'cover') { g._holdTimer = 1; }
    const cx = 105 + i * 205, cy = 110 + row * 200;
    // ústí branky pro měřítko (44 px) za gólmanem
    ctx.strokeStyle = '#c33'; ctx.lineWidth = 3; ctx.beginPath(); const gx = cx - g.inX * 8 * S; ctx.moveTo(gx, cy - 22 * S); ctx.lineTo(gx, cy + 22 * S); ctx.stroke();
    g.x = 0; g.y = 0; g.draw(ctx, { scale: S, ox: cx, oy: cy, t: 0 });
    if (row === 0) { ctx.fillStyle = '#123'; ctx.fillText(st + (st === 'stretch' ? (side > 0 ? ' ↓' : ' ↑') : ''), cx - 50, 18); }
  } }
  window.__done = true;` });
await p.waitForFunction(() => window.__done, null, { timeout: 5000 }).catch(() => {});
await p.screenshot({ path: out });
console.log('snímek:', out, '| chyby JS:', errs.length ? errs : 0); await b.close();
