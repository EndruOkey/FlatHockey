"""Bruslení vpřed ve videu (GIF), varianty parametrů K3 vedle sebe. python scripts/skate_gif.py <port> <out.gif> "<popisek>|<json SKATE_K3>" ...
Hráč jede doprava (D) z místa, výřez kolem hráče, snímky ze skutečné hry (reálný čas, ~25 fps). Jen pro posouzení okem.
"""
import sys, io, json
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

PORT, OUT, VARS = sys.argv[1], sys.argv[2], [v.split('|', 1) for v in sys.argv[3:]]
HALF, N = 24, 45
cols = []
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=2)
    ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
    page = ctx.new_page(); page.goto(f'http://localhost:{PORT}/?fhtest', wait_until='networkidle'); page.wait_for_timeout(400)
    if page.locator('#splash-guest-btn').is_visible(): page.click('#splash-guest-btn'); page.wait_for_timeout(400)
    page.click('#go-train'); page.click('#go-solo'); page.wait_for_timeout(1500)
    for label, js in VARS:
        page.evaluate("async s => { const m = await import('/js/entities/Player.js'); Object.assign(m.SKATE_K3, JSON.parse(s)); }", js)
        page.evaluate("() => { const g = window.__fhGame, L = g.local; L.x = 150; L.y = 330; L.vx = L.vy = 0; g.passer.x = 300; g.passer.y = 80; if (g._defender) { g._defender.x = 300; g._defender.y = 560; } }")
        page.wait_for_timeout(300); page.keyboard.down('KeyD'); fr = []
        for i in range(N):
            c = page.evaluate("() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(), L = g.local; k && 0; window.__fhMouse = 1; g.input.mouseX = k.ox + (L.x + 150) * k.scale; g.input.mouseY = k.oy + L.y * k.scale; return { x: r.left + k.ox + L.x * k.scale, y: r.top + k.oy + L.y * k.scale, s: k.scale }; }")
            h = HALF * c['s']
            fr.append(Image.open(io.BytesIO(page.screenshot(clip={'x': c['x'] - h, 'y': c['y'] - h, 'width': 2 * h, 'height': 2 * h}))).convert('RGB').resize((220, 220), Image.LANCZOS))
        page.keyboard.up('KeyD'); page.wait_for_timeout(600); cols.append((label, fr))
    b.close()
try: font = ImageFont.truetype('arial.ttf', 15)
except Exception: font = ImageFont.load_default()
frames = []
for i in range(N):
    im = Image.new('RGB', (220 * len(cols), 242), 'white'); d = ImageDraw.Draw(im)
    for c, (label, fr) in enumerate(cols): d.text((c * 220 + 6, 3), label, fill='black', font=font); im.paste(fr[i], (c * 220, 22))
    frames.append(im)
frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=40, loop=0)
print('GIF', OUT, N, 'snímků')
