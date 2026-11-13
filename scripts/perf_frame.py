"""Měření snímků v zápase 3v3 s boty (offline, #go-offline): čas kreslení / fyziky na snímek a rozpad kreslení po entitách.
Deterministické nastavení (pevné okno, pevné čekání, stejné varianty v pevném pořadí); absolutní ms závisí na stroji
(headless bez GPU = pomalejší), porovnávají se POMĚRY mezi variantami.
python scripts/perf_frame.py <base_url> [varianty, např. "b1k3,b0k3,b1k0,b0k0"]
"""
import sys, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1].rstrip('/')
VARS = (sys.argv[2] if len(sys.argv) > 2 else 'b1k3,b0k3,b1k0,b0k0').split(',')
JS_HOOK = """() => { const g = window.__fhGame, w = g.engine._world, rw = g.renderWorld || g.world || w;
  const T = window.__perf = { draw: [], upd: [], ent: {}, raf: [] }; let lr = performance.now(); const rf = n => { T.raf.push(n - lr); lr = n; requestAnimationFrame(rf); }; requestAnimationFrame(rf);
  const od = w.draw.bind(w), ou = w.update.bind(w);
  w.draw = (c, k) => { const t = performance.now(); od(c, k); T.draw.push(performance.now() - t); };
  w.update = dt => { const t = performance.now(); ou(dt); T.upd.push(performance.now() - t); };
  for (const e of (rw.entities || [])) { const n = e.constructor.name, o = e.draw?.bind(e); if (!o) continue;
    e.draw = (...a) => { const t = performance.now(); const r = o(...a); T.ent[n] = (T.ent[n] || 0) + performance.now() - t; return r; }; } }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-gpu-vsync', '--disable-frame-rate-limit'])   # FPS bez stropu → zahrne i rasterizaci
    ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=1)
    ctx.add_init_script("window.FH_DEV = 1; localStorage.setItem('hockey_tutorial_done','1'); localStorage.setItem('hockey_name','Probe');")
    pg = ctx.new_page()
    pg.goto(BASE + '/?fhtest', wait_until='networkidle'); pg.wait_for_timeout(400)
    if pg.locator('#splash-guest-btn').is_visible(): pg.click('#splash-guest-btn'); pg.wait_for_timeout(400)
    pg.click('#go-offline'); pg.wait_for_timeout(4000); pg.mouse.move(683, 384)
    pg.evaluate(JS_HOOK)
    out = {}
    for v in VARS:
        bb, kk = int(v[1]), int(v[3]); gg = int(v.split('g')[1]) if 'g' in v else 5
        pg.evaluate(f"async () => {{ const {{ VIS }} = await import('/js/vis.js'); VIS.b = {bb}; VIS.k = {kk}; VIS.g = {gg}; const T = window.__perf; T.draw = []; T.upd = []; T.ent = {{}}; T.raf = []; }}")
        pg.wait_for_timeout(6000)
        r = pg.evaluate("""() => { const T = window.__perf, s = a => [...a].sort((x, y) => x - y), q = (a, f) => a.length ? s(a)[Math.floor(a.length * f)] : 0;
          const n = T.draw.length; const ent = {}; for (const k in T.ent) ent[k] = +(T.ent[k] / n).toFixed(3);
          return { frames: n, draw_med: +q(T.draw, .5).toFixed(2), draw_p95: +q(T.draw, .95).toFixed(2), upd_med: +q(T.upd, .5).toFixed(2), upd_p95: +q(T.upd, .95).toFixed(2), fps: +(1000 / q(T.raf, .5)).toFixed(0), raf_p95: +q(T.raf, .95).toFixed(1), raf_p99: +q(T.raf, .99).toFixed(1), over16: +(T.draw.filter((d, i) => d + (T.upd[i] || 0) > 16.7).length / n * 100).toFixed(1), ent }; }""")
        out[v] = r
        print(v, json.dumps(r, ensure_ascii=False))
    b.close()
