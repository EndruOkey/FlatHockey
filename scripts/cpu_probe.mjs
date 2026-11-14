// ČAS PROCESORU v Rychlé hře vs tréninku (CDP Performance.getMetrics: TaskDuration/ScriptDuration/LayoutDuration za 5 s + rozpad
// kreslení hry po fázích přes engine). Nezávisí na omezení 60 FPS. node scripts/cpu_probe.mjs --port=P
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, b = await chromium.launch();
async function run(lab, start) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
  if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
  await start(p); await p.waitForTimeout(4000);
  await cdp.send('Performance.enable'); const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const a = await m(); await p.waitForTimeout(5000); const z = await m();
  const d = k => ((z[k] - a[k]) / 5 * 100).toFixed(1);
  console.log(`${lab}: procesor ${d('TaskDuration')} % (skripty ${d('ScriptDuration')} %, layout ${d('LayoutDuration')} %, styly ${d('RecalcStyleDuration')} %), DOM uzlů ${z.Nodes}, posluchačů ${z.JSEventListeners}`);
  await ctx.close();
}
await run('Rychlá hra', async p => { await p.click('#go-play'); });
await run('Trénink   ', async p => { await p.click('#go-train'); await p.click('#go-solo'); });
await run('Offline 3v3', async p => { await p.click('#go-offline'); });
await b.close();
