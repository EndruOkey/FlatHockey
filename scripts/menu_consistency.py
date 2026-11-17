"""Konzistence menu (UI v3): každá podobrazovka má právě jedno viditelné ovládání ZPĚT na stejném místě (±4 px)
a nadpis stejného stylu; klik na ZPĚT = Esc (návrat do hlavního menu). Čekárna je výjimka (má ODEJÍT).

  python scripts/menu_consistency.py --port 5750 [--sheet out.png] [--dev] [--audit]

--sheet  uloží kontaktní arch (všechny pohledy, 1366×768 a 1920×1080)
--audit  jen vypíše naměřené hodnoty (bez pass/fail) — pro audit stavu před úpravou
--dev    totéž na /dev (cookie fh_dev z dev-gate.js); Šatna v /dev je locker3 (vlastní tlačítko) → přeskočena
Deterministické: pevná okna, žádné animace (reduced-motion), čekání na stav DOM, ne na čas.
"""
import argparse, os, subprocess, sys
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = [(1366, 768), (1920, 1080)]
# pohled → (id tlačítka v hlavním menu, id view)
VIEWS = [('browse', 'go-online', 'v-browse'), ('create', 'vm-create-btn', 'v-create'),
         ('stats', 'go-stats', 'v-stats'), ('store', 'go-store', 'v-store'), ('profile', 'go-profile', 'v-profile')]
BACK_SEL = '.back3, button.back, .sv-back, [data-back]'
TOL = 4

MEASURE = r"""([viewId, backSel]) => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && r.bottom > 0 && r.top < innerHeight; };
  const view = document.getElementById(viewId);
  const backs = [...document.querySelectorAll('#lobby ' + backSel.split(',').join(', #lobby '))].filter(vis)
    .map(b => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: b.textContent.trim().replace(/\s+/g, ' ') }; });
  let title = view.querySelector('.v3-title');
  if (!title || !vis(title)) {          // bez sdíleného nadpisu: největší viditelné písmo v pohledu
    let best = null, bs = 0;
    for (const el of view.querySelectorAll('*')) { if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize); if (fs > bs) { bs = fs; best = el; } }
    title = best;
  }
  const ts = title ? getComputedStyle(title) : null, tr = title ? title.getBoundingClientRect() : null;
  return { backs, title: title ? { cls: title.className, text: title.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), x: Math.round(tr.left),
    font: `${ts.fontStyle} ${ts.fontWeight} ${Math.round(parseFloat(ts.fontSize))}px ${ts.fontFamily.split(',')[0].replace(/"/g, '')} ${ts.textTransform}` } : null,
    vw: innerWidth };
}"""


def visible(page, vid):
    return page.evaluate("id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; }", vid)


def wait_view(page, vid):
    page.wait_for_function("id => { const e = document.getElementById(id); return e && e.style.display !== 'none'; }", arg=vid, timeout=8000)


def to_main(page):
    if not visible(page, 'v-main'):
        page.keyboard.press('Escape')
    wait_view(page, 'v-main')


def run(base, dev, audit, sheet_shots):
    res, fails = [], 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        for (w, h) in SIZES:
            ctx = br.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce')
            if dev:
                tok = subprocess.check_output(['node', '-e', "import('file:///' + process.argv[1].replace(/\\\\/g, '/')).then(m=>console.log(m.makeToken()))",
                                               os.path.join(ROOT, 'dev-gate.js')], text=True).strip()
                ctx.add_cookies([{'name': 'fh_dev', 'value': tok, 'url': base + '/dev'}])
            page = ctx.new_page()
            page.goto(base + ('/dev?fhtest' if dev else '/?fhtest'), wait_until='networkidle')
            page.wait_for_function("document.getElementById('v-main') && document.getElementById('v-splash')")
            g = page.locator('#splash-guest-btn')
            if g.count() and g.is_visible():
                g.click()
            else:
                page.evaluate("() => document.getElementById('v-splash').style.display !== 'none' && document.querySelector('#v-splash button:not([style*=none])')?.click()")
            wait_view(page, 'v-main')
            page.wait_for_timeout(300)
            if sheet_shots is not None:
                sheet_shots.append((f'main {w}x{h}', page.screenshot()))
            ref = None
            for (name, btn, vid) in VIEWS:
                to_main(page)
                page.evaluate("id => document.getElementById(id).click()", btn)
                wait_view(page, vid)
                page.wait_for_timeout(250)
                m = page.evaluate(MEASURE, [vid, BACK_SEL])
                if sheet_shots is not None:
                    sheet_shots.append((f'{name} {w}x{h}', page.screenshot()))
                skip = False   # Šatna v3 (/dev) už používá sdílenou hlavičku → kontroluje se taky
                errs = []
                if not skip:
                    if len(m['backs']) != 1:
                        errs.append(f"zpět: {len(m['backs'])}×")
                    elif ref is None:
                        ref = (m['backs'][0], m['title'])
                    else:
                        b0, b = ref[0], m['backs'][0]
                        if abs(b['x'] - b0['x']) > TOL or abs(b['y'] - b0['y']) > TOL:
                            errs.append(f"zpět na {b['x']},{b['y']} ≠ {b0['x']},{b0['y']}")
                        t0, t1 = ref[1], m['title']
                        if not t1 or t1['font'] != t0['font']:
                            errs.append(f"nadpis styl {t1 and t1['font']} ≠ {t0['font']}")
                        elif abs(t1['x'] - t0['x']) > TOL:
                            errs.append(f"nadpis x {t1['x']} ≠ {t0['x']}")
                    if len(m['backs']) == 1:   # klik = Esc → hlavní menu
                        b = m['backs'][0]
                        page.mouse.click(b['x'] + b['w'] / 2, b['y'] + b['h'] / 2)
                        try:
                            wait_view(page, 'v-main')
                        except Exception:
                            errs.append('klik na zpět nevede do menu')
                    else:
                        page.keyboard.press('Escape')
                        try:
                            wait_view(page, 'v-main')
                        except Exception:
                            errs.append('Esc nevede do menu')
                verdict = 'SKIP' if skip else ('OK' if not errs else 'NE')
                if not audit and verdict == 'NE':
                    fails += 1
                res.append((f'{name:8s} {w}x{h}', verdict, m, errs))
            # čekárna: výjimka — místo ZPĚT má ODEJÍT (ověř, že existuje a vede ven)
            to_main(page)
            page.evaluate("() => document.getElementById('vm-create-btn').click()")
            wait_view(page, 'v-create')
            page.evaluate("() => document.getElementById('create-go').click()")
            errs = []
            try:
                wait_view(page, 'v-wait')
                page.wait_for_timeout(250)
                m = page.evaluate(MEASURE, ['v-wait', BACK_SEL])
                if sheet_shots is not None:
                    sheet_shots.append((f'wait {w}x{h}', page.screenshot()))
                if not page.locator('#wait-leave').is_visible():
                    errs.append('chybí ODEJÍT')
                if m['backs']:
                    errs.append(f"čekárna má {len(m['backs'])}× zpět (má mít jen ODEJÍT)")
                page.locator('#wait-leave').click()
                wait_view(page, 'v-browse')
            except Exception as e:
                m = {'backs': [], 'title': None}
                errs.append('čekárna: ' + str(e).splitlines()[0][:80])
            verdict = 'OK' if not errs else 'NE'
            if not audit and verdict == 'NE':
                fails += 1
            res.append((f'wait     {w}x{h}', verdict, m, errs))
            ctx.close()
        br.close()
    for (k, v, m, errs) in res:
        b = '; '.join(f"{x['x']},{x['y']} {x['w']}×{x['h']} '{x['text'][:18]}'" for x in m['backs']) or '—'
        t = m['title']
        tt = f"{t['font']} x={t['x']} '{t['text'][:22]}'" if t else '—'
        print(f"{v:4s} {k}  zpět[{b}]  nadpis[{tt}]" + (f"  ← {', '.join(errs)}" if errs and not audit else ''))
    return fails


def contact_sheet(shots, out):
    from PIL import Image, ImageDraw
    import io
    tw, cols = 683, 4
    ims = []
    for (lab, png) in shots:
        im = Image.open(io.BytesIO(png)).convert('RGB')
        im = im.resize((tw, round(im.height * tw / im.width)))
        ImageDraw.Draw(im).rectangle([0, 0, 260, 30], fill=(0, 0, 0)); ImageDraw.Draw(im).text((8, 8), lab, fill=(255, 255, 0))
        ims.append(im)
    th = max(i.height for i in ims)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (tw * cols, th * rows), (30, 30, 30))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
    sheet.save(out)
    print('arch:', out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 5750)))
    ap.add_argument('--sheet'); ap.add_argument('--dev', action='store_true'); ap.add_argument('--audit', action='store_true')
    a = ap.parse_args()
    base = f'http://localhost:{a.port}'
    shots = [] if a.sheet else None
    f = run(base, a.dev, a.audit, shots)
    if a.sheet:
        contact_sheet(shots, a.sheet)
    if a.audit:
        print('AUDIT (bez hodnocení)')
    else:
        print('VŠE OK' if f == 0 else f'NEPROŠLO {f}')
    sys.exit(0 if (a.audit or f == 0) else 1)
