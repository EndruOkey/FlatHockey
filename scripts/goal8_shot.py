"""Snímky pravé branky (G8/G9…) v tréninku: zmrazená simulace (engine.tempo = 0), brankář před brankou, puk v síti.
Deterministické: pevné pozice, pevné čekání na snímky, žádný vstup.
python scripts/goal8_shot.py <base_url> <out_dir> g8,g9   → <out_dir>/<g>_<W>x<H>@<dpr>_<scene>.png (výřez v plném rozlišení)
scene: 'gk' = brankář + puk v síti, 'empty' = jen branka (měření rubriky), *nf = totéž bez přední vrstvy branky
Výřez: svět x 950–1040, y 180–276 (pravá branka u x=990, ústí y 206–250).
"""
import sys, os, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
GS = [int(g[1:]) for g in (sys.argv[3] if len(sys.argv) > 3 else 'g8').split(',')]
os.makedirs(OUT, exist_ok=True)
CONFIGS = [(1366, 768, 1), (1920, 1080, 1), (1366, 768, 3)]
WX0, WX1, WY0, WY1 = 950, 1040, 180, 276
GK = "g.goalie.x = 982; g.goalie.y = 226; g.puck.x = 1006; g.puck.y = 236; g.puck.z = 0;"
EMPTY = "g.goalie.x = 880; g.goalie.y = 120; g.puck.x = 700; g.puck.y = 120; g.puck.z = 0;"
NOFRONT = "R.drawFront = function () {};"   # bez přední vrstvy branky (měření, kolik brankáře zakryje)
SCENES = {'gk': GK, 'empty': EMPTY, 'gknf': GK + NOFRONT, 'emptynf': EMPTY + NOFRONT}
errors = []
meta = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for (W, H, dpr) in CONFIGS:
        ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=dpr)
        ctx.add_init_script("window.FH_DEV = 1; localStorage.setItem('hockey_tutorial_done','1');")
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        # 401 z /auth/me = nepřihlášený host (očekávané), ostatní chyby konzole se počítají
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and not ('401' in m.text and 'Failed to load resource' in m.text) else None)
        page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not (r.status == 401 and r.url.endswith('/auth/me')) else None)
        page.goto(BASE + '/?fhtest&vis=g8', wait_until='networkidle')
        page.wait_for_timeout(400)
        if page.locator('#splash-guest-btn').is_visible():
            page.click('#splash-guest-btn'); page.wait_for_timeout(400)
        page.click('#go-solo'); page.wait_for_timeout(1500)
        page.mouse.move(5, 5)
        real = page.evaluate("async () => (await import('/js/entities/Rink.js')).GOAL_REAL")
        for g in GS:
            for sc, js in SCENES.items():
                page.evaluate("""async ([gv, js]) => { const { VIS } = await import('/js/vis.js'); VIS.g = gv;
                  const g = window.__fhGame; g.engine.tempo = 0;
                  g.local.x = 760; g.local.y = 60; g.passer.x = 760; g.passer.y = 400; if (g._defender) { g._defender.x = 700; g._defender.y = 420; }
                  g.puck.ownerId = null; g.puck.vx = g.puck.vy = g.puck.vz = 0; g.goalie._gvx = g.goalie._gvy = g.goalie._vy = 0;
                  const R = g.world.entities.find(e => e.constructor.name === 'Rink'); delete R.drawFront;
                  (new Function('g', 'R', js))(g, R); }""", [g, js])
                page.wait_for_timeout(250)
                cam = page.evaluate("""() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(); return { ox: r.left + k.ox, oy: r.top + k.oy, s: k.scale }; }""")
                x0 = round(cam['ox'] + WX0 * cam['s']); y0 = round(cam['oy'] + WY0 * cam['s'])
                w = round((WX1 - WX0) * cam['s']); h = round((WY1 - WY0) * cam['s'])
                name = f"g{g}_{W}x{H}@{dpr}_{sc}"
                page.screenshot(path=os.path.join(OUT, name + '.png'), clip={'x': x0, 'y': y0, 'width': w, 'height': h})
                meta[name] = {'scale': cam['s'], 'dpr': dpr, 'x0': x0, 'y0': y0, 'clipW': w, 'clipH': h}
        ctx.close()
    b.close()
json.dump({'meta': meta, 'world': [WX0, WX1, WY0, WY1], 'real': real}, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print('snímků:', len(meta), '| chyby konzole:', errors if errors else 0)
sys.exit(1 if errors else 0)
