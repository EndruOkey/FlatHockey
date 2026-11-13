"""Snímky ROZPLÁCNUTÍ v tréninku: zmrazená simulace (engine.tempo = 0), stav pádu nastavený přímo (_downT/_upT/_fallA/_fallB)
→ každý snímek = přesný čas sekvence (deterministické, bez čekání na náhodu). Pak živá kontrola: takeHit za běhu → leží → vstane.
python scripts/down_shot.py <base_url> <out.png> <out.gif>
List: řádky = (břicho 1×, záda 1×, břicho dpr3, záda dpr3); 1× zvětšeno 4× bez vyhlazení. Poslední sloupec = normální stoj.
GIF: dpr3, každý tik (1/60 s) celé sekvence, břicho i záda za sebou.
"""
import sys, os, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE, OUT_PNG, OUT_GIF = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
EL = [0, 0.05, 0.1, 0.15, 0.2, 0.26, 0.34, 0.5, 0.7, 0.76, 0.82, 0.86, 0.92, 0.98, 1.04, 1.12, -1]   # -1 = stoj (po sekvenci)
WX, WY, HALF = 600, 230, 30   # výřez světa kolem hráče
SET = """([el, fa, fb]) => { const g = window.__fhGame, p = g.local, D = 0.7, U = 0.42;
  p.x = 600; p.y = 230; p.vx = p.vy = 0; p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = fb; p.hasPuck = false;
  p._fallA = fa; p._fallB = fb; p._fallN = 3; p._kdE = null;
  if (el < 0) { p._downT = 0; p._upT = 0; } else if (el < D) { p._downT = D - el; p._upT = U; } else { p._downT = 0; p._upT = Math.max(1e-6, D + U - el); } }"""
VAR = [(-0.4, -0.4 + 0.25), (-0.4, -0.4 + 3.0)]   # (směr pádu, natočení při zásahu): zezadu → břicho, zepředu → záda
errors = []

def crop(page, cam, dpr):
    png = page.screenshot(clip={'x': cam['ox'] + (WX - HALF) * cam['s'], 'y': cam['oy'] + (WY - HALF) * cam['s'], 'width': 2 * HALF * cam['s'], 'height': 2 * HALF * cam['s']})
    return Image.open(io.BytesIO(png)).convert('RGB')

with sync_playwright() as pw:
    b = pw.chromium.launch()
    rows, gif = [], []
    for dpr in (1, 3):
        ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=dpr)
        ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and not ('401' in m.text and 'Failed to load resource' in m.text) else None)
        page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not (r.status == 401 and r.url.endswith('/auth/me')) else None)
        page.goto(BASE + '/?fhtest', wait_until='networkidle'); page.wait_for_timeout(400)
        if page.locator('#splash-guest-btn').is_visible(): page.click('#splash-guest-btn'); page.wait_for_timeout(400)
        page.click('#go-solo'); page.wait_for_timeout(1500); page.mouse.move(5, 5)
        page.evaluate("() => { const g = window.__fhGame; g.engine.tempo = 0; g.passer.x = 300; g.passer.y = 100; if (g._defender) { g._defender.x = 300; g._defender.y = 380; } g.puck.x = 800; g.puck.y = 380; g.puck.vx = g.puck.vy = 0; }")
        page.wait_for_timeout(200)
        cam = page.evaluate("() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(); return { ox: r.left + k.ox, oy: r.top + k.oy, s: k.scale }; }")
        for fa, fb in VAR:
            row = []
            for el in EL:
                page.evaluate(SET, [el, fa, fb]); page.wait_for_timeout(60)
                row.append(crop(page, cam, dpr))
            rows.append((dpr, row))
            if dpr == 3:
                for t in range(0, 68, 2):   # každý 2. tik po 33 ms = reálná rychlost
                    page.evaluate(SET, [min(1.12, t / 60), fa, fb]); page.wait_for_timeout(30)
                    gif.append(crop(page, cam, dpr).resize((180, 180), Image.LANCZOS))
                for _ in range(15): gif.append(gif[-1])
        if dpr == 1:   # živě: takeHit za běhu simulace → leží → vstane, bez chyb
            live = page.evaluate("""async () => { const g = window.__fhGame, p = g.local; g.engine.tempo = 1; p._downT = p._upT = 0; p._hitImm = 0;
              p.takeHit(260, 1, 0); const a = p.isDown; await new Promise(r => setTimeout(r, 1600)); return { a, b: p.isDown, down: p._downT, up: p._upT }; }""")
            print('živě:', live)
            if not (live['a'] and not live['b']): errors.append('živá sekvence: ' + str(live))
        ctx.close()
    b.close()
# list: 1× zvětšit 4× NEAREST na 240 px, dpr3 (180 px) na 240 px
cell = 240
sheet = Image.new('RGB', (cell * len(EL), cell * len(rows) + 22 * len(rows)), (20, 24, 32))
d = ImageDraw.Draw(sheet)
for ri, (dpr, row) in enumerate(rows):
    y = ri * (cell + 22)
    d.text((4, y + 4), f"{'1x (4x NEAREST)' if dpr == 1 else 'dpr3'} - {'bricho' if ri % 2 == 0 else 'zada'}", fill=(230, 230, 230))
    for ci, im in enumerate(row):
        im = im.resize((cell, cell), Image.NEAREST if dpr == 1 else Image.LANCZOS)
        sheet.paste(im, (ci * cell, y + 22))
        d.text((ci * cell + 4, y + 22 + 4), 'stoj' if EL[ci] < 0 else f'{EL[ci]:.2f}s', fill=(0, 0, 0))
os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
sheet.save(OUT_PNG)
gif[0].save(OUT_GIF, save_all=True, append_images=gif[1:], duration=33, loop=0)
print('list:', sheet.size, '| gif snímků:', len(gif), '| chyby konzole:', errors if errors else 0)
sys.exit(1 if errors else 0)
