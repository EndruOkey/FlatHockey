# VIDITELNOST BRUSLÍ ve skutečné hře (trénink, 1366×768, dpr 1): brusle se vykreslí fialově (globalThis.__fhSkateDbg)
# a počítá se, kolik fialových pixelů je VIDĚT (trup, paže, hokejka je zakrývají stejně jako ve hře).
# Server musí běžet:  PORT=4200 node server.js   →   python scripts/skate_visibility.py [port]
#
# RUBRIKA (stanovena PŘEDEM, 2026-11-13; Ondřej: „nohy nejsou tak, jak by měly, při brzdě, rozjezdu, do určitých směrů"):
#  V1 V každé jízdní situaci je brusle vidět (≥ 5 px v 1×) v ≥ 50 % snímků.
#  V2 Brzda (mezerník z plné rychlosti): brusle vidět v ≥ 70 % snímků prvních 0,6 s.
import sys, io, json
from playwright.sync_api import sync_playwright
from PIL import Image
PORT = sys.argv[1] if len(sys.argv) > 1 else '4200'
N, MINPX = 24, 5
# název, klávesy rozjezdu, klávesy během snímání, start (svět), cíl myši = tělo čelem doprava
SIT = [
    ('rozjezd vpřed', [], ['KeyD'], (250, 230)),
    ('vpřed plná', ['KeyD'], ['KeyD'], (150, 230)),
    ('brzda', ['KeyD'], ['Space'], (200, 230)),
    ('brzda', ['KeyD'], ['Space'], (200, 330)),   # brzda 3× (krátké okno 0,6 s = 12 snímků → sečíst, ať výsledek nekolísá)
    ('brzda', ['KeyD'], ['Space'], (200, 130)),
    ('obrat D→A', ['KeyD'], ['KeyA'], (300, 230)),
    ('bokem nahoru', ['KeyW'], ['KeyW'], (400, 400)),
    ('bokem dolů', ['KeyS'], ['KeyS'], (400, 60)),
    ('šikmo vpřed', ['KeyD', 'KeyW'], ['KeyD', 'KeyW'], (200, 400)),
    ('šikmo vzad', ['KeyA', 'KeyS'], ['KeyA', 'KeyS'], (700, 60)),
    ('pozpátku', ['KeyA'], ['KeyA'], (800, 230)),
]
def magenta(im):
    return sum(1 for r, g, b in im.getdata() if r > 190 and g < 90 and b > 190)
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 768})
    pg.goto('http://localhost:%s/?fhtest' % PORT); pg.evaluate("localStorage.setItem('hockey_tutorial_done','1')"); pg.reload(); pg.wait_for_timeout(1200)
    pg.click('#go-train'); pg.click('#go-solo'); pg.wait_for_timeout(1500)
    pg.evaluate("() => { globalThis.__fhSkateDbg = 1; const g = window.__fhGame; g.passer.active = false; if (g._defender) g._defender.active = false; }")
    cam = pg.evaluate("(() => { const c = window.__fhGame._cam; return { s: c.scale, ox: c.ox, oy: c.oy }; })()")
    for name, pre, keys, (sx, sy) in SIT:
        put = "([x,y]) => { const g = window.__fhGame, L = g.local; L.x = x; L.y = y; L.vx = L.vy = 0; g.puck.x = 980; g.puck.y = 40; g.puck.vx = g.puck.vy = 0; }"
        pg.evaluate(put, [sx, sy]); pg.mouse.move(cam['ox'] + 1300 * cam['s'], cam['oy'] + sy * cam['s']); pg.wait_for_timeout(300); pg.evaluate(put, [sx, sy])
        for k in pre: pg.keyboard.down(k)
        if pre: pg.wait_for_timeout(1300)
        for k in pre: pg.keyboard.up(k)
        for k in keys: pg.keyboard.down(k)
        px = []
        for i in range(N):
            L = pg.evaluate("[window.__fhGame.local.x, window.__fhGame.local.y]")
            pg.mouse.move(cam['ox'] + (L[0] + 500) * cam['s'], cam['oy'] + L[1] * cam['s'])
            cx, cy = cam['ox'] + L[0] * cam['s'], cam['oy'] + L[1] * cam['s']
            px.append(magenta(Image.open(io.BytesIO(pg.screenshot(clip={'x': cx - 30, 'y': cy - 30, 'width': 60, 'height': 60}))).convert('RGB')))
            pg.wait_for_timeout(25)
        for k in keys: pg.keyboard.up(k)
        use = (res.get(name, {}).get('_px', []) + px[:12]) if name == 'brzda' else px
        res[name] = {'vidět': round(sum(1 for v in use if v >= MINPX) / len(use), 2), 'medián_px': sorted(use)[len(use) // 2], '_px': use}
    b.close()
ok = 0
for name, r in res.items():
    lim = 0.7 if name == 'brzda' else 0.5
    good = r['vidět'] >= lim; ok += good
    print('%-4s %-15s vidět %3d %% snímků (limit %d %%), medián %d px' % ('OK' if good else 'NE', name, r['vidět'] * 100, lim * 100, r['medián_px']))
print('%d/%d' % (ok, len(res)))
