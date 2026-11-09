// AUDIT BRUSLENÍ — deterministická simulace (match-core, pevný krok 1/60 s) + filmový pás každého scénáře.
// Kontroly: (1) anatomie: brusle míří max 90° od těla (mimo hokejový stop), (2) determinismus: 2 běhy = stejné pixely,
// (3) krok sleduje dráhu: fáze kroku na 100 px dráhy je stejná při různé rychlosti (brusle neklouzají).
// Server: PORT=4931 node server.js. node scripts/skate_audit.mjs → _skate_audit.png
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1260, height: 1330 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4931/', { waitUntil: 'networkidle' });
const out = await p.evaluate(async () => {
  const { createMatch, makeInput, rebuildEntities, stepMatch } = await import('/js/match-core.js');
  const { Player } = await import('/js/entities/Player.js');
  const { RINK } = await import('/js/constants.js');
  const SC = [
    ['vpřed', { dx: 1, dy: 0, aim: 0 }],
    ['zatáčka', t => ({ dx: 1, dy: t > 40 ? 1 : 0, aim: t > 40 ? 0.8 : 0 })],
    ['bokem (kouká nahoru, jede vpravo)', { dx: 1, dy: 0, aim: -Math.PI / 2 }],
    ['couvání (kouká vpravo, jede vlevo)', { dx: -1, dy: 0, aim: 0 }],
    ['otočka na místě', t => ({ dx: 0, dy: 0, aim: t * 0.09 })],
    ['stop (Space)', t => ({ dx: t < 50 ? 1 : 0, dy: 0, aim: 0, space: t >= 50 })],
    ['klid', { dx: 0, dy: 0, aim: 0 }],
  ];
  const W = 1260, H = 1330, ROWH = 185, S = 5.2, FR = 6;
  const run = (canvas) => {
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#dfe9f2'; ctx.fillRect(0, 0, W, H);
    const viol = [];
    SC.forEach(([name, inpF], row) => {
      const m = createMatch(7); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
      const pl = new Player('me', 'home', makeInput()); m.players.set('me', pl); m.inputs.set('me', pl.input); rebuildEntities(m);
      m.goalieL.x = m.goalieR.x = -999; m.puck.x = -500; m.puck.y = -500;
      pl.x = RINK.w * 0.3; pl.y = RINK.h / 2; pl.aimAngle = pl.bodyAngle = pl.skateAngle = pl.carryAngle = 0;
      const startX = pl.x;
      for (let t = 0; t < 60 + FR * 8; t++) {
        const inp = typeof inpF === 'function' ? inpF(t) : inpF;
        pl.input.dx = inp.dx; pl.input.dy = inp.dy; pl.input.aim = inp.aim; pl.input.aimDist = 60; pl.input.keys = { Space: !!inp.space };
        stepMatch(m);
        // vykresli KAŽDÝ tick (animace má stav), do strip ulož jen každý 8.
        { const sc = document.createElement('canvas'); sc.width = sc.height = 10; pl._animDbg = []; pl.draw(sc.getContext('2d'), { scale: S, ox: 0, oy: 0, dt: 1 / 60 }); }
        if (t >= 60 && (t - 60) % 8 === 0) {
          const col = (t - 60) / 8, cx = 170 + col * 185, cy = 95 + row * ROWH;
          const cam = { scale: S, ox: cx - pl.x * S, oy: cy - pl.y * S, dt: 0 };
          pl._animDbg = [];
          ctx.save(); ctx.beginPath(); ctx.rect(cx - 92, cy - 80, 185, 160); ctx.clip(); pl.draw(ctx, cam); ctx.restore();
          for (const f of pl._animDbg) if ((pl._stopTSmooth ?? 0) < 0.05 && Math.abs(f.fa) > Math.PI / 2 + 0.01) viol.push(`${name} f${col} noha ${f.side} ${(f.fa * 57.3).toFixed(0)}°`);
          // šipka pohybu
          const sp = Math.hypot(pl.vx, pl.vy); if (sp > 8) { ctx.strokeStyle = '#e33'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy + 70); ctx.lineTo(cx + pl.vx / sp * 22, cy + 70 + pl.vy / sp * 22); ctx.stroke(); }
        }
      }
      ctx.fillStyle = '#123'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(name, 6, 18 + row * ROWH);
    });
    return viol;
  };
  const c1 = document.createElement('canvas'); c1.width = W; c1.height = H; document.body.innerHTML = ''; document.body.appendChild(c1);
  const viol = run(c1);
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; run(c2);
  const det = c1.toDataURL() === c2.toDataURL();
  // krok sleduje dráhu: fáze po 100 px při rychlosti A vs B
  const phaseAt = (spdK) => { const q = new Player('q', 'home', makeInput()); q.x = 0; q.y = 0; q.bodyAngle = 0; q.vx = 160 * spdK; q.vy = 0; q._skatePhase = 0;
    const cv = document.createElement('canvas').getContext('2d'); const cam = { scale: 1, ox: 0, oy: 0 }; q._others = [];
    const steps = Math.round(100 / (160 * spdK / 60)); for (let i = 0; i <= steps; i++) { q.x = i * 160 * spdK / 60; q.draw(cv, cam); } return q._skatePhase; };
  const pA = phaseAt(1), pB = phaseAt(0.5);
  return { viol, det, pA, pB };
});
await p.screenshot({ path: '_skate_audit.png' });
console.log(`anatomie: ${out.viol.length ? out.viol.length + ' porušení: ' + out.viol.slice(0, 6).join('; ') : 'OK'} | determinismus (2 běhy stejné pixely): ${out.det ? 'OK' : 'NE'} | fáze po 100 px: rychle ${out.pA.toFixed(2)} vs pomalu ${out.pB.toFixed(2)} ${Math.abs(out.pA - out.pB) < 0.15 ? 'OK' : 'NE'} | chyby JS:`, errs.length ? errs : 0);
await b.close();
