// DLOUHÉ ÚLOHY hlavního vlákna (CDP tracing devtools.timeline): úlohy > 30 ms a co v nich běží (časovač, funkce, GC…).
// node scripts/long_tasks_trace.mjs --port=P [--mode=play|train]
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
if ((A.mode || 'play') === 'play') await p.click('#go-play'); else { await p.click('#go-train'); await p.click('#go-solo'); }
await p.waitForTimeout(4000);
const ev = []; cdp.on('Tracing.dataCollected', d => ev.push(...d.value));
const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8', transferMode: 'ReportEvents' });
await p.waitForTimeout(4000); await cdp.send('Tracing.end'); await done;
const main = ev.filter(e => e.name === 'RunTask' && e.dur > 30000);
const tid = main.length ? main[0].tid : null;
console.log(`dlouhé úlohy > 30 ms: ${main.length}`);
const tally = {};
for (const t of main.slice(0, 40)) { const inside = ev.filter(e => e.tid === t.tid && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && e !== t && e.dur > 3000);
  const kids = inside.map(e => { const d = e.args?.data || {}; return `${e.name}${d.url ? ' ' + d.url.split('/').pop() + ':' + d.lineNumber : ''}${d.functionName ? ' ' + d.functionName : ''}${d.type ? ' ' + d.type : ''}`; });
  const key = [...new Set(kids)].slice(0, 5).join(' | ') || '(nic uvnitř > 3 ms)'; tally[key] = (tally[key] || 0) + 1; }
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`${n}×  ${k}`);
await b.close();
