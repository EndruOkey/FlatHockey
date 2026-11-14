// PROFIL procesoru (CDP Profiler, vzorkování 200 µs, 4 s) — top funkce podle vlastního času. node scripts/cpu_profile.mjs --port=P [--mode=play|train]
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const PORT = A.port || 4611, MODE = A.mode || 'play', b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } }), p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await p.goto(`http://localhost:${PORT}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
if (MODE === 'play') await p.click('#go-play'); else { await p.click('#go-train'); await p.click('#go-solo'); }
await p.waitForTimeout(4000);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await p.waitForTimeout(4000); const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])); const dt = profile.timeDeltas; const cnt = new Map();
profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
for (const [id, us] of cnt) { const n = byId.get(id), cf = n.callFrame, k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + us); }
const tot = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`${MODE}: celkem ${(tot / 1000).toFixed(0)} ms za 4 s`);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, us]) => console.log(`${(us / tot * 100).toFixed(1).padStart(5)} %  ${(us / 4000).toFixed(2).padStart(6)} ms/s  ${k}`));
await b.close();
