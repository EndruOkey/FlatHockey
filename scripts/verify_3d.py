import time, io, os
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

OUT = r"C:\Users\EndruOkey\AppData\Local\Temp\fh-3dcc"
URL = os.environ.get("FH_URL", "http://localhost:4710/")

logs = []

def shot_canvas(page, path):
    el = page.query_selector("#lk-3d-canvas")
    el.screenshot(path=path)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":1280,"height":900}, reduced_motion="no-preference")
    ctx.add_init_script("""
        try { localStorage.setItem('hockey_tutorial_done','1');
              localStorage.setItem('hockey_name','Verify');
              localStorage.setItem('hockey_num','27'); } catch(e){}
    """)
    page = ctx.new_page()
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
    page.goto(URL, wait_until="networkidle")
    time.sleep(1)

    # Enter as guest (force-click even if splash-first is showing)
    try:
        page.eval_on_selector("#splash-guest-btn", "el=>el.click()")
    except Exception as e:
        logs.append(f"guest click: {e}")
    time.sleep(1.2)

    # make sure we have a name, then go to profile/locker
    page.evaluate("""() => {
        const n = document.getElementById('name-input');
        if (n && !n.value) { n.value = 'Verify'; n.dispatchEvent(new Event('input',{bubbles:true})); }
    }""")
    try:
        page.eval_on_selector("#go-profile", "el=>el.click()")
    except Exception as e:
        logs.append(f"go-profile click: {e}")
    time.sleep(1.5)

    # click the 3D toggle
    page.eval_on_selector('.lk-dim-btn[data-dim="3d"]', "el=>el.click()")
    # wait for the glb + gear to build and rAF to run
    for _ in range(40):
        st = page.evaluate("() => (window._fh3d ? window._fh3d() : null)")
        if st and st.get("running"):
            break
        time.sleep(0.25)
    logs.append(f"_fh3d after 3D: {page.evaluate('()=>window._fh3d&&window._fh3d()')}")
    # wait for canvas to have real size
    for _ in range(20):
        sz = page.evaluate("()=>{const c=document.getElementById('lk-3d-canvas');const r=c.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};}")
        if sz["w"] > 10 and sz["h"] > 10: break
        time.sleep(0.2)
    logs.append(f"canvas size: {sz}")
    page.evaluate("()=>{if(window._fh3d&&window._fh3d().hasViewer){}}")
    time.sleep(1.0)

    # FRONT screenshot
    shot_canvas(page, OUT + r"\front.png")

    # idle animation: two frames ~1s apart
    shot_canvas(page, OUT + r"\idleA.png")
    time.sleep(1.1)
    shot_canvas(page, OUT + r"\idleB.png")

    # dragged 3/4 rotation
    cv = page.query_selector("#lk-3d-canvas")
    box = cv.bounding_box()
    cx, cy = box["x"]+box["width"]/2, box["y"]+box["height"]/2
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1,13):
        page.mouse.move(cx - i*18, cy - i*2)
        time.sleep(0.02)
    page.mouse.up()
    time.sleep(0.6)
    shot_canvas(page, OUT + r"\rotated.png")

    # kit change: apply a very different kit (jersey + helmet) via the console hook
    before = page.evaluate("()=>window._fhLocker.getCurrentKit()")
    page.evaluate("""() => {
        // roll the dice a few times then force a loud kit through applyCode is internal;
        // use rollDice which applies a curated kit live
        for (let i=0;i<3;i++) window._fhLocker.rollDice();
    }""")
    time.sleep(1.0)
    after = page.evaluate("()=>window._fhLocker.getCurrentKit()")
    logs.append(f"kit before jersey={before.get('jersey')} helmet={before.get('helmet')} num={before.get('num')}")
    logs.append(f"kit after  jersey={after.get('jersey')} helmet={after.get('helmet')} num={after.get('num')}")
    shot_canvas(page, OUT + r"\recolor.png")

    # rAF stop on switch to 2D
    page.eval_on_selector('.lk-dim-btn[data-dim="2d"]', "el=>el.click()")
    time.sleep(0.5)
    st2d = page.evaluate("()=>window._fh3d()")
    logs.append(f"_fh3d after 2D: {st2d}")

    ctx.close(); b.close()

# diff idle frames
a = Image.open(OUT + r"\idleA.png").convert("RGB")
bb = Image.open(OUT + r"\idleB.png").convert("RGB")
diff = ImageChops.difference(a, bb)
bbox = diff.getbbox()
hist = diff.histogram()
# count non-zero-ish pixels
import numpy as np
na = np.asarray(a).astype(int); nb = np.asarray(bb).astype(int)
d = np.abs(na-nb).sum(axis=2)
changed = int((d > 12).sum())
total = d.size
logs.append(f"IDLE changed pixels: {changed}/{total} ({100*changed/total:.2f}%) bbox={bbox}")

# contact sheet
imgs = [Image.open(OUT+f"\\{n}.png").convert("RGB") for n in ["front","rotated","recolor"]]
h = 420
scaled = []
for im in imgs:
    r = h/im.height
    scaled.append(im.resize((int(im.width*r), h)))
W = sum(im.width for im in scaled) + 20*len(scaled)
sheet = Image.new("RGB", (W, h+10), (20,22,28))
x=10
for im in scaled:
    sheet.paste(im,(x,5)); x+=im.width+20
sheet.save(OUT + r"\sheet.png")

print("\n".join(logs))
print("SHEET:", OUT + r"\sheet.png")
