// Kontakt hokejek: jak často hokejka projde tělem soupeře nebo jiné hokejce (offline zápas, deterministická metrika
// nad herní geometrií: úchop → stickTip). Volitelně uloží výřezy kontaktů.
// node scripts/stick_contact.mjs <url> [sekund=30] [složka na snímky]
import { chromium } from 'playwright';
const [url = 'http://localhost:4900/', secs = '30', outDir] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.setItem('hockey_tutorial_done', '1'); localStorage.setItem('hockey_name', 'Probe'); });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
await p.click('#go-offline'); await p.waitForTimeout(3000);
let nShot = 0;
if (outDir) await p.exposeFunction('fhSnap', async (x, y, kind) => { if (nShot >= 8) return; const k = nShot++;
  await p.screenshot({ path: `${outDir}/kontakt_${k}_${kind}.png`, clip: { x: Math.max(0, x - 70), y: Math.max(0, y - 70), width: 140, height: 140 } }); });
const r = await p.evaluate(secs => new Promise(res => {
  const g = window.__fhGame;
  // průsečík úseček (a1→a2, b1→b2)
  const segX = (a1, a2, b1, b2) => { const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x); if (!d) return false;
    const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d, u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
    return t > 0 && t < 1 && u > 0 && u < 1; };
  const process_close = (A, B) => Math.hypot(A.x - B.x, A.y - B.y) < 22;
  const sh = (g0, t0) => { const L = Math.hypot(t0.x - g0.x, t0.y - g0.y) || 1, k = Math.max(0, L - 5) / L; return { x: g0.x + (t0.x - g0.x) * k, y: g0.y + (t0.y - g0.y) * k }; };
  // úsečka protíná kruh
  const segC = (a, c, o, r) => { const dx = c.x - a.x, dy = c.y - a.y, L = dx * dx + dy * dy || 1; let t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / L; t = Math.max(0, Math.min(1, t));
    return Math.hypot(a.x + dx * t - o.x, a.y + dy * t - o.y) < r; };
  let frames = 0, close = 0, thruBody = 0, crossed = 0; const marks = []; const end = performance.now() + secs * 1000;
  const f = now => {
    frames++;
    if (!g.locked) {
      const ps = [...g.players.values()].map(e => e.ent);
      for (let i = 0; i < ps.length; i++) for (let j = 0; j < ps.length; j++) {
        if (i === j) continue; const A = ps[i], B = ps[j];
        if (Math.hypot(A.x - B.x, A.y - B.y) > 34) continue;
        if (i < j) close++;
        const ga = A.gripPoint, ta = A.stickTip, gb = B.gripPoint, tb = B.stickTip;
        const body = segC(ga, ta, B, B.radius - 1), cr = i < j && segX(ga, sh(ga, ta), gb, sh(gb, tb));   // jen dřík × dřík (čepele se smí potkat)
        if (body) thruBody++; if (cr) crossed++;
        if ((body || cr || process_close(A, B)) && marks.length < 8 && (!marks.length || frames - marks[marks.length - 1].f > 40)) {
          { const c = g._cam; if (c && window.fhSnap) window.fhSnap(c.ox + (A.x + B.x) / 2 * c.scale, c.oy + (A.y + B.y) / 2 * c.scale, body ? 'telo' : 'hokejky'); }
          marks.push({ f: frames, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, kind: body ? 'telo' : 'hokejky', cam: g._cam && { ox: g._cam.ox, oy: g._cam.oy, s: g._cam.scale } }); }
      }
    }
    if (now < end) requestAnimationFrame(f); else res({ frames, closePairFrames: close, stickThroughBody: thruBody, sticksCrossed: crossed,
      thruBodyPct: +(100 * thruBody / Math.max(1, close)).toFixed(1), crossedPct: +(100 * crossed / Math.max(1, close)).toFixed(1), marks });
  }; requestAnimationFrame(f);
}), +secs);
const { marks, ...stats } = r;
console.log(JSON.stringify(stats), 'chyby JS:', errs.length ? errs : 0);
await b.close();
