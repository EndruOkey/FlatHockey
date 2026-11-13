"""Snímky animace přikopnutí (Q) v tréninku. Skutečný kop: puk pošleme hráči pod nohy, Q (keydown na window) ve chvíli,
kdy je puk v okně; po zabrání zmrazíme simulaci (engine.tempo = 0) a časovou osu animace (_kickFx / _kickSw) nastavujeme
na pevné časy → deterministické snímky. Pokus na dálku: puk projede 20 px od těla, Q nesmí zabrat (máchnutí naprázdno).
python scripts/kick_shot.py <base_url> <out_png> <out_gif>
"""
import sys, os, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

BASE, OUT_PNG, OUT_GIF = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
T_KICK = [0.0, 0.02, 0.04, 0.07, 0.10, 0.13, 0.17, 0.24]   # s od zabrání (8 snímků)
T_SW = [0.0, 0.05, 0.08, 0.11, 0.14, 0.18]               # s od stisku (máchnutí naprázdno)
HALF = 26                                                # výřez ±26 svět. px kolem hráče
errors = []

SETUP = """async ([off, v]) => {
  const g = window.__fhGame; g.engine.tempo = 1;
  g.passer.hasPuck = false; g.passer.x = 200; g.passer.y = 420; if (g._defender) { g._defender.x = 150; g._defender.y = 440; }
  const p = g.local; p.x = 540; p.y = 228; p.vx = p.vy = 0; p.hasPuck = false; p._kickCd = 0; p._kickFx = 0; p._kickSw = 0;
  const P = g.puck; P.ownerId = null; P._carrier = null; P._shot = null; P._passTo = null; P.z = 0; P.vz = 0; P.faceoffTimer = 0;
  P.x = 540 - 200; P.y = 228 + off; P.vx = 0; P.vy = 0;
  return true; }"""
# deterministicky: simulace stojí (tempo 0), puk přijíždí v = 500 px/s a stojí na pevném místě (off = boční odstup, px od středu
# těla); Q přes keydown na window → hra ho zpracuje v příštím snímku (stejná cesta jako hráč)
RUN = """async ([off, v]) => {
  const g = window.__fhGame, p = g.local, P = g.puck, n0 = p._kickN || 0, s0 = p._kickSwN || 0;
  g.engine.tempo = 0; const ax = Math.sqrt(Math.max(0, 10.5 * 10.5 - off * off));
  P.x = p.x - (off < 10.5 ? ax : 2); P.y = p.y + off; P.vx = v; P.vy = 0;
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await raf(); const d = Math.hypot(P.x - p.x, P.y - p.y), win = p.kickWindow(P);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' })); await raf();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ', key: 'q' })); await raf();
  const kk = (p._kickN || 0) > n0;
  return { kicked: kk, swung: (p._kickSwN || 0) > s0, d: kk ? Math.hypot(p._kickOx, p._kickOy) : d, win, hasPuck: p.hasPuck, side: p._kickSide }; }"""
SET_T = """async ([key, full, e]) => { const p = window.__fhGame.local; p[key] = full - e; if (key === '_kickSw') p._kickFx = 0;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }"""


def shot(page, cam_js):
    cam = page.evaluate(cam_js)
    x0, y0 = cam['ox'] + (cam['px'] - HALF) * cam['s'], cam['oy'] + (cam['py'] - HALF) * cam['s']
    w = 2 * HALF * cam['s']
    png = page.screenshot(clip={'x': x0, 'y': y0, 'width': w, 'height': w})
    return Image.open(io.BytesIO(png)).convert('RGB')


CAM = """() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(); return { ox: r.left + k.ox, oy: r.top + k.oy, s: k.scale, px: g.local.x, py: g.local.y }; }"""
rows, info = {}, {}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for dpr in (1, 3):
        ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=dpr)
        ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and not ('401' in m.text and 'Failed to load resource' in m.text) else None)
        page.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not (r.status == 401 and r.url.endswith('/auth/me')) else None)
        page.goto(BASE + '/?fhtest', wait_until='networkidle'); page.wait_for_timeout(400)
        if page.locator('#splash-guest-btn').is_visible(): page.click('#splash-guest-btn'); page.wait_for_timeout(400)
        page.click('#go-solo'); page.wait_for_timeout(1500)
        cam = page.evaluate(CAM)
        page.mouse.move(cam['ox'] + 400 * cam['s'], cam['oy'] + 228 * cam['s'])   # míř proti puku (vlevo)
        page.wait_for_timeout(300)
        FX = page.evaluate("async () => (await import('/js/entities/Player.js')).KICK")
        # 1) přikopnutí: puk 500 px/s (hokejkou čistě nejde), 10,5 px od středu těla, 4 px od osy
        page.evaluate(SETUP, [4, 500]); page.wait_for_timeout(200)
        r = page.evaluate(RUN, [4, 500]); info[f'kick@{dpr}'] = r
        rows[f'kick{dpr}'] = []
        for e in T_KICK: page.evaluate(SET_T, ['_kickFx', FX['FX'], e]); rows[f'kick{dpr}'].append(shot(page, CAM))
        if dpr == 1:   # GIF: 3× zpomaleně, krok 1/60 s
            gif = []
            for i in range(0, 19): page.evaluate(SET_T, ['_kickFx', FX['FX'], i / 60]); gif.append(shot(page, CAM))
            rows['gif'] = gif
        # 2) pokus na dálku: puk 20 px od těla, Q nesmí zabrat
        page.evaluate("() => { const p = window.__fhGame.local; p._kickCd = 0; p.hasPuck = false; }")
        page.evaluate(SETUP, [20, 500]); page.wait_for_timeout(200)
        r = page.evaluate(RUN, [20, 500]); info[f'far@{dpr}'] = r
        rows[f'sw{dpr}'] = []
        for e in T_SW: page.evaluate(SET_T, ['_kickSw', FX['SW'], e]); rows[f'sw{dpr}'].append(shot(page, CAM))
        ctx.close()
    b.close()

# list: řádky 1× (zvětšeno 4× nejbližším sousedem) a detail dpr3 (zvětšeno na stejnou velikost)
CELL = 4 * 2 * HALF * 1  # ~ px; dopočítá se ze skutečné velikosti
def up(im, size): return im.resize((size, size), Image.NEAREST if im.width < size / 2 else Image.LANCZOS)
c1 = rows['kick1'][0].width * 4
labels = [('Přikopnutí 1× (zvětšeno 4×), ms od zabrání', 'kick1', T_KICK), ('Přikopnutí detail dpr3', 'kick3', T_KICK),
          ('Na dálku (puk 20 px od těla): Q nezabere, máchnutí naprázdno 1× (4×)', 'sw1', T_SW), ('Na dálku detail dpr3', 'sw3', T_SW)]
pad, lh = 8, 22
sheet = Image.new('RGB', (pad + 8 * (c1 + pad), len(labels) * (c1 + lh + pad) + pad), (24, 28, 36))
dr = ImageDraw.Draw(sheet)
try: FONT = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 15)
except OSError: FONT = None
for ri, (lab, key, ts) in enumerate(labels):
    y = pad + ri * (c1 + lh + pad); dr.text((pad, y + 4), lab, fill=(230, 235, 245), font=FONT)
    for ci, im in enumerate(rows[key]):
        x = pad + ci * (c1 + pad); sheet.paste(up(im, c1), (x, y + lh)); dr.text((x + 4, y + lh + 4), f'{round(ts[ci] * 1000)} ms', fill=(200, 120, 0), font=FONT)
sheet.save(OUT_PNG)
g = [up(im, c1) for im in rows['gif']]
g = [g[0]] * 6 + g + [g[-1]] * 10
g[0].save(OUT_GIF, save_all=True, append_images=g[1:], duration=50, loop=0)   # 1/60 s na snímek × 3 = 50 ms (3× zpomaleno)
print('info:', info)
print('chyby konzole:', errors if errors else 0)
ok = all(info[f'kick@{d}']['kicked'] and info[f'kick@{d}']['d'] <= 12 for d in (1, 3)) and all(not info[f'far@{d}']['kicked'] and info[f'far@{d}']['swung'] and not info[f'far@{d}']['hasPuck'] for d in (1, 3))
print('kop pod nohama zabral, na dálku ne:', ok)
sys.exit(0 if ok and not errors else 1)
