"""ZVEDÁNÍ Z PÁDU bez „flekatého morphu" (2026-11-16, Ondřej: „při zvedání … takový flekatý morph").
Zmrazená simulace (engine.tempo = 0), čas sekvence nastavený přímo → každý snímek = přesný čas (deterministické).
python scripts/rise_morph_metrics.py <base_url> [out_dir]
RUBRIKA (předem, obě varianty pádu: břicho i záda):
  F1 poloprůhledné vrstvy na postavě během zvedání (globalAlpha < 1 při kresbě, mimo tříšť nárazu) = 0
  F2 hrbolatost těla: solidita siluety (plocha / konvexní obal, tělo bez hole = otevření masky) v každém snímku
     zvedání OD KLEKU (u ≥ 0,68; ležení a čtyři jsou rozkročené záměrně) ≥ solidita normálního stoje − 0,05
     (upřesněno po 1. běhu: v ležení solidita přirozeně nízká)
  Lokální hráč s _isLocal = false (bez kroužku a jmenovky — UI by F3 zkreslilo).
  F3 bez skoku: největší změna siluety mezi dvěma po sobě jdoucími snímky (podíl pixelů, XOR / sjednocení) ≤ 0,25,
     včetně přechodu poslední snímek zvedání → normální stoj
"""
import sys, os, io
import numpy as np
from playwright.sync_api import sync_playwright
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull

BASE = sys.argv[1].rstrip('/'); OUT = sys.argv[2] if len(sys.argv) > 2 else None
D, U = 0.7, 0.42
ELS = [round(D + i / 60, 4) for i in range(int(U * 60) + 1)] + [-1]   # zvedání po tiku + stoj
WX, WY, HALF = 600, 230, 30
SET = """([el, fa, fb]) => { const g = window.__fhGame, p = g.local; p._isLocal = false;
  p.x = 600; p.y = 230; p.vx = p.vy = 0; p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = p._stickDisp = fb; p.hasPuck = false;
  p._fallA = fa; p._fallB = fb; p._fallN = 3; p._kdE = null;
  if (el < 0) { p._downT = 0; p._upT = 0; } else if (el < 0.7) { p._downT = 0.7 - el; p._upT = 0.42; } else { p._downT = 0; p._upT = Math.max(1e-6, 1.12 - el); }
  window.__alphaN = 0; }"""
ALPHA_HOOK = """() => { const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha');
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'globalAlpha', { get() { return d.get.call(this); },
    set(v) { if (window.__alphaOn && v < 0.999) window.__alphaN++; d.set.call(this, v); }, configurable: true }); }"""
VAR = [('břicho', -0.4, -0.4 + 0.25), ('záda', -0.4, -0.4 + 3.0)]

def mask(img, bg):   # jen kruh 16 j kolem hráče (jmenovka nad hlavou = UI, do siluety nepatří)
    a = np.asarray(img, dtype=np.int16); b = np.asarray(bg, dtype=np.int16)
    m = np.abs(a - b).sum(axis=2) > 60
    h, w = m.shape; yy, xx = np.mgrid[0:h, 0:w]; r = w / (2 * HALF) * 16
    return m & ((xx - w / 2) ** 2 + (yy - h / 2) ** 2 <= r * r)

def solidity(m, dpr):
    body = ndimage.binary_opening(m, structure=np.ones((int(5 * dpr), int(5 * dpr))))   # pryč dřík hole (tenký)
    lab, n = ndimage.label(body)
    if n == 0: return 0.0
    sizes = ndimage.sum(body, lab, range(1, n + 1)); body = lab == (1 + int(np.argmax(sizes)))
    ys, xs = np.nonzero(body); pts = np.c_[xs, ys]
    return float(body.sum() / ConvexHull(pts).volume) if len(pts) > 10 else 0.0

res = {}; fails = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(); dpr = 3
    ctx = b.new_context(viewport={'width': 1366, 'height': 768}, device_scale_factor=dpr)
    ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
    page = ctx.new_page(); page.goto(BASE + '/?fhtest', wait_until='networkidle'); page.wait_for_timeout(400)
    if page.locator('#splash-guest-btn').is_visible(): page.click('#splash-guest-btn'); page.wait_for_timeout(400)
    page.click('#go-train'); page.click('#go-solo'); page.wait_for_timeout(1500)
    page.evaluate("async u => { const { VIS } = await import('/js/vis.js'); VIS.u = u; }", int(__import__('os').environ.get('FH_U', '1')))   # VIS.u: 1 nové zvedání (/dev), FH_U=0 dřívější; page.mouse.move(5, 5)
    page.evaluate(ALPHA_HOOK)
    if os.environ.get('FH_RISE'):   # ladění: FH_RISE="cut,s" (okamžik přechodu na normální kresbu, počáteční velikost)
        c_, s_ = map(float, os.environ['FH_RISE'].split(',')); page.evaluate(f"() => {{ globalThis.__fhRiseCut = {c_}; globalThis.__fhRiseS = {s_}; }}")
    page.evaluate("() => { const g = window.__fhGame; g.engine.tempo = 0; g.passer.x = 300; g.passer.y = 100; if (g._defender) { g._defender.x = 300; g._defender.y = 380; } g.puck.x = 800; g.puck.y = 380; g.puck.vx = g.puck.vy = 0; }")
    cam = page.evaluate("() => { const g = window.__fhGame, k = g._cam, r = g.canvas.getBoundingClientRect(); return { ox: r.left + k.ox, oy: r.top + k.oy, s: k.scale }; }")
    clip = {'x': cam['ox'] + (WX - HALF) * cam['s'], 'y': cam['oy'] + (WY - HALF) * cam['s'], 'width': 2 * HALF * cam['s'], 'height': 2 * HALF * cam['s']}
    shot = lambda: Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB')
    page.evaluate("() => { const p = window.__fhGame.local; p._isLocal = false; p.x = 900; p.y = 100; p._downT = p._upT = 0; }"); page.wait_for_timeout(120); bg = shot()
    for name, fa, fb in VAR:
        frames, alpha = [], 0
        for el in ELS:
            page.evaluate(SET, [el, fa, fb]); page.wait_for_timeout(40)
            page.evaluate("() => { window.__alphaN = 0; window.__alphaOn = 1; }"); page.wait_for_timeout(50)
            n = page.evaluate("() => { window.__alphaOn = 0; return window.__alphaN; }")
            if el >= 0: alpha = max(alpha, n)
            else: alpha0 = n
            frames.append(shot())
        M = [mask(f, bg) for f in frames]
        sol = [solidity(m, dpr) for m in M]
        jump = [float((M[i] ^ M[i + 1]).sum() / max(1, (M[i] | M[i + 1]).sum())) for i in range(len(M) - 1)]
        k0 = int(0.68 * U * 60); smin, sstand, jmax = min(sol[k0:-1]), sol[-1], max(jump)
        alpha = max(0, alpha - alpha0)   # jen vrstvy navíc oproti stoji (scéna sama má pár průhledných prvků)
        ok1, ok2, ok3 = alpha == 0, smin >= sstand - 0.05, jmax <= 0.25
        fails += (not ok1) + (not ok2) + (not ok3)
        ji = int(np.argmax(jump))
        if os.environ.get('FH_CENT'):   # ladění: těžiště těla (bez hole) po snímcích, jednotky světa vůči středu hráče
            for i, m in enumerate(M):
                body = ndimage.binary_opening(m, structure=np.ones((15, 15))); ys, xs = np.nonzero(body); w = m.shape[1]; k = (2 * HALF) / w
                print(f"    {ELS[i]:7.4f} těžiště x {((xs.mean() - w / 2) * k if len(xs) else 0):+.2f} y {((ys.mean() - w / 2) * k if len(xs) else 0):+.2f}  plocha {body.sum() * k * k:6.1f}")
        print(f"  {name:7s} F1 průhledné vrstvy {alpha:3d} {'OK' if ok1 else 'NE'} | F2 solidita min {smin:.3f} (stoj {sstand:.3f}) {'OK' if ok2 else 'NE'}"
              f" | F3 max skok {jmax:.3f} @ {'stoj' if ji == len(jump) - 1 else ELS[ji + 1]} {'OK' if ok3 else 'NE'}")
        if OUT:
            os.makedirs(OUT, exist_ok=True); sel = frames[::3] + [frames[-2], frames[-1]]; w = 120
            sheet = Image.new('RGB', (w * len(sel), w), 'white')
            for i, f in enumerate(sel): sheet.paste(f.resize((w, w), Image.LANCZOS), (i * w, 0))
            sheet.save(os.path.join(OUT, f'rise_{name}.png'))
            pair = Image.new('RGB', (frames[0].width * 2, frames[0].height), 'white'); pair.paste(frames[-2], (0, 0)); pair.paste(frames[-1], (frames[0].width, 0))
            pair.save(os.path.join(OUT, f'pair_{name}.png'))
    b.close()
print('VŠE OK' if not fails else f'NEPROŠLO {fails}')
