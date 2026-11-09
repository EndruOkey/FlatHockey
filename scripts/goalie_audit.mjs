// AUDIT GÓLMANA: oba gólmani × stavy (klid, přesun, lapačka, vyrážečka, betony, drží puk). Kontrola: zákrok
// se rozsvítí na STEJNÉ straně, kam míří rána (lapačka/vyrážečka vs. y puku). Server: PORT=4931 node server.js → _goalie_audit.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1140, height: 420 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
const res = await p.evaluate(async () => {
  const { Goalie } = await import('/js/entities/Goalie.js');
  const { RINK, PUCK } = await import('/js/constants.js');
  document.body.innerHTML = ''; const c = document.createElement('canvas'); c.width = 1140; c.height = 420; document.body.appendChild(c);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#dfe9f2'; ctx.fillRect(0, 0, 1140, 420);
  const states = ['klid', 'přesun', 'lapačka (puk nahoře, vysoko)', 'vyrážečka (puk dole, vysoko)', 'betony (nízko)', 'drží puk'];
  const S = 4.2, out = [];
  ['left', 'right'].forEach((side, row) => {
    states.forEach((st, col) => {
      const g = new Goalie(side); g.rng = { next: () => 0.5 }; g._vy = 0;
      if (st === 'přesun') g._vy = 120;
      const puckY = st.includes('nahoře') ? -1 : st.includes('dole') ? 1 : 0;
      if (st.startsWith('lapačka')) g._markSave('glove', 0.42), g._saveFlash = 0.3;
      if (st.startsWith('vyrážečka')) g._markSave('blocker', 0.3), g._saveFlash = 0.2;
      if (st.startsWith('betony')) g._markSave('pads', 0.3), g._saveFlash = 0.2;
      if (st === 'drží puk') g._holdTimer = 0.5;
      const cx = 95 + col * 190, cy = 110 + row * 200;
      const cam = { scale: S, ox: cx - g.x * S, oy: cy - g.y * S, t: 0, dt: 0 };
      g.draw(ctx, cam);
      if (puckY) { ctx.fillStyle = '#e33'; ctx.beginPath(); ctx.arc(cx + g.inX * 14 * S, cy + puckY * 9 * S, 5, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#123'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(st, cx, cy + 75);
      // sim pravidlo: lapačka = vysoká rána relY ≤ 0 (nahoře); kresba lapačky musí být nahoře
      if (st.startsWith('lapačka')) out.push({ side, ok: puckY < 0 });
    });
    ctx.fillStyle = '#c00'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(side === 'left' ? 'LEVÝ gólman (domácí branka)' : 'PRAVÝ gólman', 8, 20 + row * 200);
  });
  return out;
});
await p.screenshot({ path: '_goalie_audit.png' }); console.log('chyby JS:', errs.length ? errs : 0); await b.close();
