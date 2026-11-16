"""Porovnání zvedání z pádu ve videu (GIF, reálná rychlost 30 fps), varianty vedle sebe. Zmrazená simulace → deterministické.
python scripts/rise_gif.py <out.gif> "<url>|<popisek>|<cut>|<s>" ...   (cut/s prázdné = výchozí kód serveru)
Řádky: pád na břicho, pád na záda. Od 0,55 s (ležení) do konce zvedání + 0,4 s stoje.
"""
import sys, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT, VARS = sys.argv[1], [v.split('|') for v in sys.argv[2:]]
D, U = 0.7, 0.42
ELS = [round(0.55 + i / 30, 4) for i in range(int((D + U - 0.55) * 30) + 1)] + [-1] * 12
WX, WY, HALF = 600, 230, 26
SET = """([el, fa, fb]) => { const g = window.__fhGame, p = g.local; p._isLocal = false;
  p.x = 600; p.y = 230; p.vx = p.vy = 0; p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = p._stickDisp = fb; p.hasPuck = false;
  p._fallA = fa; p._fallB = fb; p._fallN = 3; p._kdE = null;
  if (el < 0) { p._downT = 0; p._upT = 0; } else if (el < 0.7) { p._downT = 0.7 - el; p._upT = 0.42; } else { p._downT = 0; p._upT = Math.max(1e-6, 1.12 - el); } }"""
POSE = [(-0.4, -0.4 + 0.25), (-0.4, -0.4 + 3.0)]
cols = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for url, label, cut, sc in VARS:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=2)
        ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
        page = ctx.new_page(); page.goto(url.rstrip('/') + '/?fhtest', wait_until='networkidle'); page.wait_for_timeout(400)
        if page.locator('#splash-guest-btn').is_visible(): page.click('#splash-guest-btn'); page.wait_for_timeout(400)
        page.click('#go-train'); page.click('#go-solo'); page.wait_for_timeout(1500)
        page.evaluate("async u => { const { VIS } = await import('/js/vis.js'); VIS.u = u; }", int(__import__('os').environ.get('FH_U', '1')))   # VIS.u: 1 nové zvedání (/dev), FH_U=0 dřívější; page.mouse.move(5, 5)
        if cut: page.evaluate(f"() => {{ globalThis.__fhRiseCut = {cut}; globalThis.__fhRiseS = {sc}; }}")
        page.evaluate("() => { const g = window.__fhGame; g.engine.tempo = 0; g.passer.x = 300; g.passer.y = 100; if (g._defender) { g._defender.x = 300; g._defender.y = 380; } g.puck.x = 800; g.puck.y = 380; }")
        cam = page.evaluate("() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(); return { ox: r.left + k.ox, oy: r.top + k.oy, s: k.scale }; }")
        clip = {'x': cam['ox'] + (WX - HALF) * cam['s'], 'y': cam['oy'] + (WY - HALF) * cam['s'], 'width': 2 * HALF * cam['s'], 'height': 2 * HALF * cam['s']}
        rows = []
        for fa, fb in POSE:
            fr = []
            for el in ELS:
                page.evaluate(SET, [el, fa, fb]); page.wait_for_timeout(35)
                fr.append(Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB').resize((200, 200), Image.LANCZOS))
            rows.append(fr)
        cols.append((label, rows)); ctx.close()
    b.close()
try: font = ImageFont.truetype('arial.ttf', 15)
except Exception: font = ImageFont.load_default()
frames = []
for i in range(len(ELS)):
    im = Image.new('RGB', (200 * len(cols), 22 + 400), 'white'); d = ImageDraw.Draw(im)
    for c, (label, rows) in enumerate(cols):
        d.text((c * 200 + 6, 3), label, fill='black', font=font)
        for r, fr in enumerate(rows): im.paste(fr[i], (c * 200, 22 + r * 200))
    frames.append(im)
frames[0].save(OUT, save_all=True, append_images=frames[1:] + [frames[-1]] * 10, duration=33, loop=0)
print('GIF', OUT, len(frames), 'snímků')
