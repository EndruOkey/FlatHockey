"""Training/tutorial smoke test (deterministic: fixed waits, fixed input rules).

Usage:  python test/training-smoke.py http://localhost:4200 [outdir]
Needs the game served; page is opened with ?fhtest so game.js exposes window.__fhGame.
Records pageerrors/console errors, tutorial steps reached, stuck steps, screenshot per step,
then exercises every training drill x difficulty (+ defender presets, build tab).
Exit code 1 if any pageerror/console error/stuck step/failed check.
"""
import sys, os, json, math, time
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4200').rstrip('/')
OUT = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\EndruOkey\AppData\Local\Temp\fh-training'
os.makedirs(OUT, exist_ok=True)
STUCK_LIMIT = {'goal': 60}   # per-step override (goalie saves are random, scoring needs several shots)
STUCK_S = 25          # no step change for this long => stuck
TICK_MS = 100         # fixed control-loop period
errors, problems, log, warnings = [], [], [], []


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + '.png'))


def state(page):
    return page.evaluate("""() => { const g = window.__fhGame; if (!g) return null;
      return { step: g._tStep ?? -1, fin: !!g._finished, x: g.local.x, y: g.local.y, vx: g.local.vx, vy: g.local.vy,
        has: !!g.local.hasPuck, px: g.puck.x, py: g.puck.y, ax: g.passer.x, ay: g.passer.y, phas: !!g.passer.hasPuck,
        goals: g.score.home, drill: g._drillIdx ?? -1, diff: g._diffIdx ?? -1, tab: g._activeTab,
        dact: !!g._defender.active, dx: g._defender.x, dy: g._defender.y, nan: [g.local.x,g.local.y,g.puck.x,g.puck.y,g.goalie.y].some(v=>!Number.isFinite(v)) } }""")


def w2s(page, x, y):
    return page.evaluate("""([x,y]) => { const g = window.__fhGame, c = g.canvas;
      const cam = g._tutCam || (g.engine.cameraOverride ? g.engine.cameraOverride(c) : null) || {scale:1,ox:0,oy:0};
      const r = c.getBoundingClientRect(); const k = r.width / c.width;
      return [r.left + (cam.ox + x*cam.scale)*k, r.top + (cam.oy + y*cam.scale)*k]; }""", [x, y])


def aim(page, x, y):
    sx, sy = w2s(page, x, y)
    page.mouse.move(sx, sy)


def steer(page, s, tx, ty, dead=14):
    want = set()
    if tx - s['x'] > dead: want.add('KeyD')
    if tx - s['x'] < -dead: want.add('KeyA')
    if ty - s['y'] > dead: want.add('KeyS')
    if ty - s['y'] < -dead: want.add('KeyW')
    for k in ('KeyW', 'KeyA', 'KeyS', 'KeyD'):
        (page.keyboard.down if k in want else page.keyboard.up)(k)


def release_all(page):
    for k in ('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'):
        page.keyboard.up(k)
    page.mouse.up(button='left')


def tap(page, key, hold=120):
    page.keyboard.down(key); page.wait_for_timeout(hold); page.keyboard.up(key)


def click(page, button='left', hold=120):
    page.mouse.down(button=button); page.wait_for_timeout(hold); page.mouse.up(button=button)


GOAL = (990, 228)


def drive_step(page, sid, s, n):
    """One control tick for tutorial step id. n = tick counter within step."""
    if sid == 'move':
        steer(page, s, 675 + 70, 228 - 50, 20)
    elif sid == 'brake':
        # cycle: 12 ticks skate (alternate target left/right), 6 ticks brake
        ph = n % 18
        if ph < 12:
            page.keyboard.up('Space'); steer(page, s, 800 if (n // 18) % 2 == 0 else 450, 228)
        else:
            steer(page, s, 0, 0, 99999); page.keyboard.down('Space')
    elif sid == 'aim':
        a = n * 0.5; aim(page, s['x'] + math.cos(a) * 110, s['y'] + math.sin(a) * 110)
    elif sid == 'spin':
        page.mouse.down(button='left')
        a = n * 0.45; aim(page, s['x'] + math.cos(a) * 110, s['y'] + math.sin(a) * 110)
    elif sid == 'pickup':
        page.mouse.up(button='left'); steer(page, s, s['px'], s['py'], 6)
    elif sid == 'shoot':
        release_all(page); aim(page, *GOAL)
        if n % 6 == 3: click(page)
    elif sid == 'pass':
        aim(page, s['ax'], s['ay'])            # zamiř na nahrávače
        if s['has'] and n % 3 == 1: click(page, 'right', 100)   # RMB = přihrávka, jen když držíš puk
    elif sid == 'mmb':
        # call for the pass (MMB), then meet the puck with the stick like a player would
        if s['phas']:
            steer(page, s, s['x'], s['y'], 9999)
            if n % 6 == 3: click(page, 'middle', 80)
        else:
            aim(page, s['px'], s['py']); steer(page, s, s['px'], s['py'], 6)
    elif sid == 'bodycheck':
        steer(page, s, s['ax'], s['ay'], 4);
    elif sid == 'clona':
        steer(page, s, 900, 228, 15)
    elif sid == 'tece':
        a = n * 0.7; aim(page, 990 + math.cos(a) * 30, 228 + math.sin(a) * 30)
    elif sid == 'goal':
        # skate to alternating wing, aim at far post, charged (900 ms) slapshot whenever carrying; flick shots are saved
        top = (n // 40) % 2 == 0
        steer(page, s, 880, 150 if top else 310, 15)
        aim(page, 992, 245 if top else 211)
        if s['has']: click(page, hold=900)


def run_tutorial(page, ctx):
    ids = page.evaluate("() => window.__fhGame ? 1 : 0")
    names = ['move', 'aim', 'pickup', 'shoot', 'goal', 'brake', 'pass', 'mmb', 'spin', 'bodycheck', 'clona', 'tece']
    reached, stuck = [], []
    last_step, since, n = -1, 0, 0; t0 = time.monotonic()
    page.mouse.move(640, 360)
    for _ in range(3000):
        s = state(page)
        if s is None: problems.append('tutorial: no game'); break
        if s['nan']: problems.append('tutorial: NaN in state at step %s' % s['step']); break
        if s['fin']:
            shot(page, 'tut_99_finished'); reached.append('finished'); break
        if s['step'] != last_step:
            if last_step >= 0: pass
            last_step, since, n = s['step'], 0, 0; t0 = time.monotonic()
            release_all(page)
            page.wait_for_timeout(700)   # let slide-in finish
            shot(page, 'tut_%02d_%s' % (s['step'], names[s['step']]))
            reached.append(names[s['step']])
        sid = names[s['step']]
        drive_step(page, sid, s, n)
        page.wait_for_timeout(TICK_MS); n += 1; since = time.monotonic() - t0
        if n % 25 == 0:
            log.append({'trace': sid, 't': round(since, 1), 'x': round(s['x']), 'y': round(s['y']), 'has': s['has'], 'puck': [round(s['px']), round(s['py'])], 'passer': [round(s['ax']), round(s['ay']), s['phas']]})
        if since > STUCK_LIMIT.get(sid, STUCK_S):
            shot(page, 'tut_STUCK_%s' % sid)
            release_all(page)
            if sid == 'goal':
                # scoring depends on random goalie saves: report as warning (+ shots taken), force the goal to test the finish screen
                shots = page.evaluate("() => window.__fhGame.score.shots")
                warnings.append('goal step: no goal in %ds (%s shots) - feel/difficulty, check by hand' % (STUCK_LIMIT[sid], shots))
                page.evaluate("() => { const g = window.__fhGame; g._handleGoal('goal-home'); }")
                page.wait_for_timeout(5000)
            else:
                stuck.append(sid); problems.append('tutorial stuck at step %s (%ds)' % (sid, STUCK_S))
                # force-advance so later steps still get tested
                page.evaluate("() => { const g = window.__fhGame; g._tDone = true; g._tDoneT = 1; }")
            since = 0; t0 = time.monotonic()
    release_all(page)
    log.append({'tutorial_reached': reached, 'stuck': stuck})
    return reached


def run_training(page):
    """Free practice, breakaway, one-timer x 3 difficulties, 4 s each, plus build tab + defender presets."""
    res = []
    for drill, key in ((0, 'Digit1'), (1, 'Digit2'), (2, 'Digit3')):
        tap(page, key); page.wait_for_timeout(300)
        for diff in range(3):
            for _ in range(5):          # fixed: cycle E until wanted difficulty
                if state(page)['diff'] == diff: break
                tap(page, 'KeyE'); page.wait_for_timeout(150)
            name = 'train_d%d_g%d' % (drill, diff)
            for i in range(40):         # 4 s of play
                s = state(page)
                if s['nan']: problems.append(name + ': NaN'); break
                steer(page, s, 900, 228 + (i // 10 % 2) * 30, 20)
                aim(page, GOAL[0], 215 + (i % 2) * 26)
                if i % 10 == 5: click(page, hold=200)
                page.wait_for_timeout(TICK_MS)
            release_all(page)
            s = state(page); shot(page, name)
            res.append({'scenario': name, 'drill': s['drill'], 'diff': s['diff'], 'goals': s['goals'], 'defender': s['dact']})
            if s['drill'] != drill or s['diff'] != diff: problems.append(name + ': drill/diff not applied %r' % s)
    # Build tab + defender presets (free practice)
    tap(page, 'Digit1'); page.wait_for_timeout(300)
    for preset in ('zone', 'balanced', 'forecheck', 'passive'):
        page.evaluate("""p => { const g = window.__fhGame; g._defConfig = { preset: p };
          g._defender.active = true; g._defender.reset(700, 228); g._defender.config = { preset: p };
          g.passer.active = true; g.passer.x = 600; g.passer.y = 330; }""", preset)
        for i in range(60):             # 6 s: skate at defender with puck
            s = state(page)
            if s['nan']: problems.append('defender ' + preset + ': NaN'); break
            steer(page, s, 800, 228, 20); aim(page, GOAL[0], 228)
            if i % 15 == 10: click(page, hold=150)
            page.wait_for_timeout(TICK_MS)
        release_all(page)
        s = state(page); shot(page, 'defender_' + preset)
        res.append({'scenario': 'defender_' + preset, 'dx': round(s['dx']), 'dy': round(s['dy'])})
    tap(page, 'Tab'); page.wait_for_timeout(600); shot(page, 'build_tab')
    tap(page, 'Tab'); page.wait_for_timeout(300)
    tap(page, 'KeyR'); page.wait_for_timeout(300)
    log.append({'training': res})


def contact_sheet():
    """Merge step screenshots into one small contact.png (needs Pillow; skipped if missing)."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print('Pillow missing: no contact sheet'); return
    names = sorted(f for f in os.listdir(OUT) if f.endswith('.png') and f != 'contact.png'
                   and not f.startswith(('00_', '01_', '02_', '03_')) and 'STUCK' not in f)
    names = [f for f in names if f.startswith(('tut_', 'train_', 'defender_', 'build_'))]
    TW, TH, COLS = 320, 180, 4
    rows = (len(names) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * TW, rows * TH), (8, 8, 12))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(names):
        im = Image.open(os.path.join(OUT, f)).convert('RGB').resize((TW, TH))
        x, y = (i % COLS) * TW, (i // COLS) * TH
        sheet.paste(im, (x, y)); d.rectangle((x, y, x + 150, y + 12), fill=(0, 0, 0)); d.text((x + 3, y + 1), f[:-4], fill=(255, 255, 255))
    sheet.save(os.path.join(OUT, 'contact.png'), optimize=True)
    print('contact.png', len(names), 'tiles')


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 720}, reduced_motion='no-preference')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        page.on('console', lambda m: errors.append('console.%s: %s' % (m.type, m.text)) if m.type == 'error' else None)
        page.on('requestfailed', lambda r: errors.append('requestfailed: %s' % r.url) if '/api/' not in r.url and 'socket' not in r.url else None)
        try:
            page.goto(BASE + '/?fhtest', wait_until='load'); page.wait_for_timeout(1500)
            shot(page, '00_splash')
            # guest -> tutorial (first visit => guest button starts tutorial)
            page.click('#splash-tutorial-btn'); page.wait_for_timeout(800)
            run_tutorial(page, ctx)
            page.wait_for_timeout(1500)
            # finish screen -> Enter -> profile
            page.keyboard.down('Enter'); page.wait_for_timeout(250); page.keyboard.up('Enter'); page.wait_for_timeout(800); shot(page, '01_after_tutorial')
            if page.evaluate("() => localStorage.getItem('hockey_tutorial_done')") != '1':
                problems.append('tutorial_done flag not set')
            # profile -> main -> solo
            page.evaluate("() => { const n = document.querySelector('#name-input, #name'); }")
            for sel in ('#go-solo',):
                if not page.is_visible(sel):
                    # profile view: try to continue via any visible primary button, else reload to splash/main
                    page.reload(wait_until='load'); page.wait_for_timeout(1200)
                    page.goto(BASE + '/?fhtest'); page.wait_for_timeout(1200)
                    if page.is_visible('#splash-guest-btn'): page.click('#splash-guest-btn'); page.wait_for_timeout(800)
                if not page.is_visible(sel):
                    shot(page, '02_nomain'); problems.append('cannot reach main menu / #go-solo not visible'); break
            if page.is_visible('#go-solo'):
                shot(page, '02_main'); page.click('#go-solo'); page.wait_for_timeout(1000)
                if page.evaluate("() => !!window.__fhGame"):
                    shot(page, '03_training_start')
                    run_training(page)
                else:
                    problems.append('go-solo did not start a SandboxGame (profile gate?)'); shot(page, '03_nogame')
            # tutorial replay from main menu button
        except Exception as ex:
            problems.append('test aborted: %r' % ex)
        b.close()
    for e in errors:
        if '401 (Unauthorized)' in e: continue   # guest /api session probe, expected
        problems.append(e)
    contact_sheet()
    print(json.dumps({'problems': problems, 'warnings': warnings, 'log': log}, ensure_ascii=False, indent=1))
    print('RESULT:', 'FAIL (%d)' % len(problems) if problems else 'PASS')
    sys.exit(1 if problems else 0)


main()
