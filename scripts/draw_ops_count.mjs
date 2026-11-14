// POČET OPERACÍ CANVASU na jedno kreslení hráče / brankáře (proxy kontextu). node scripts/draw_ops_count.mjs --port=P
import { chromium } from 'playwright';
const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await p.goto(`http://localhost:${A.port || 4611}/?fhtest`); await p.evaluate(() => localStorage.setItem('hockey_tutorial_done', '1')); await p.reload(); await p.waitForTimeout(1200);
if (await p.isVisible('#splash-guest-btn')) { await p.click('#splash-guest-btn'); await p.waitForTimeout(800); }
await p.click('#go-train'); await p.click('#go-solo'); await p.waitForTimeout(2500);
const r = await p.evaluate(async () => { const g = window.__fhGame, ctx = g.canvas.getContext('2d'), cam = g._cam, cnt = {}, props = {};
  const proxy = new Proxy(ctx, { get(t, k) { const v = t[k]; if (typeof v === 'function') return (...a) => { cnt[k] = (cnt[k] || 0) + 1; return v.apply(t, a); }; return v; },
    set(t, k, v) { if (['filter', 'shadowBlur', 'globalCompositeOperation'].includes(k)) props[k + '=' + v] = (props[k + '=' + v] || 0) + 1; t[k] = v; return true; } });
  g.local.draw(proxy, cam); const pl = { ...cnt }; for (const k in cnt) delete cnt[k];
  const gl = g.goalie || [...(g.world?.goalies || [])][0]; if (gl) gl.draw(proxy, cam);
  return { hrac: pl, brankar: { ...cnt }, props }; });
const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log('hráč:', fmt(r.hrac)); console.log('brankář:', fmt(r.brankar)); console.log('vlastnosti:', JSON.stringify(r.props)); await b.close();
