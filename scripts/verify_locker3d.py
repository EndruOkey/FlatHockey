import asyncio, json, os
from playwright.async_api import async_playwright
from PIL import Image

OUT = r"C:\Users\EndruOkey\AppData\Local\Temp\fh-3d"
URL = os.environ.get("FH_URL", "http://localhost:4700/")

def avg_region(path, box):
    im = Image.open(path).convert("RGB")
    crop = im.crop(box)
    px = list(crop.getdata())
    n = len(px)
    r = sum(p[0] for p in px)//n; g = sum(p[1] for p in px)//n; b = sum(p[2] for p in px)//n
    return (r, g, b)

async def main():
    results = {}
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width":1280,"height":820}, reduced_motion="no-preference")
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type=="error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: "+str(e)))
        await page.add_init_script("localStorage.setItem('hockey_tutorial_done','1');")
        await page.goto(URL, wait_until="networkidle")
        await page.wait_for_timeout(600)

        # guest entry
        gb = page.locator("#splash-guest-btn")
        if await gb.count() and await gb.is_visible():
            await gb.click()
            await page.wait_for_timeout(400)
        # open locker
        await page.locator("#mn-tab-locker").click()
        await page.wait_for_timeout(600)
        await page.screenshot(path=os.path.join(OUT,"01_locker_2d.png"))

        # flip to 3D
        await page.locator('.lk-dim-btn[data-dim="3d"]').click()
        # wait for three.js + model
        await page.wait_for_function("window._fh3d && window._fh3d().hasViewer===true", timeout=20000)
        await page.wait_for_timeout(1200)  # let model load + a few rotation frames
        st1 = await page.evaluate("window._fh3d()")
        results["state_after_3d"] = st1
        await page.screenshot(path=os.path.join(OUT,"02_3d_front.png"))

        # drag to rotate
        box = await page.locator("#lk-3d-canvas").bounding_box()
        cx, cy = box["x"]+box["width"]/2, box["y"]+box["height"]/2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        for i in range(12):
            await page.mouse.move(cx - i*18, cy, steps=1)
            await page.wait_for_timeout(16)
        await page.mouse.up()
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT,"03_3d_rotated.png"))

        # recolor: apply a deterministic contrasting kit, screenshot
        kit_before = await page.evaluate("window._fhLocker.getCurrentKit()")
        await page.evaluate("window._fhLocker.rollDice(1)")  # deterministic blue/yellow kit
        await page.wait_for_timeout(700)
        kit_after = await page.evaluate("window._fhLocker.getCurrentKit()")
        results["kit_before_jersey"] = kit_before.get("jersey")
        results["kit_after_jersey"] = kit_after.get("jersey")
        await page.screenshot(path=os.path.join(OUT,"04_3d_recolored.png"))

        # back to 2D -> confirm rAF stopped
        await page.locator('.lk-dim-btn[data-dim="2d"]').click()
        await page.wait_for_timeout(500)
        st2 = await page.evaluate("window._fh3d()")
        results["state_after_2d"] = st2

        await browser.close()

    # compare chest region (center-ish) between front and recolored
    box_chest = (560, 430, 720, 560)
    front = avg_region(os.path.join(OUT,"02_3d_front.png"), box_chest)
    recol = avg_region(os.path.join(OUT,"04_3d_recolored.png"), box_chest)
    front_r = avg_region(os.path.join(OUT,"02_3d_front.png"), box_chest)
    rot = avg_region(os.path.join(OUT,"03_3d_rotated.png"), box_chest)
    results["chest_front_rgb"] = front
    results["chest_recolored_rgb"] = recol
    results["chest_rotated_rgb"] = rot
    results["recolor_delta"] = sum(abs(a-b) for a,b in zip(front,recol))
    results["rotate_delta"] = sum(abs(a-b) for a,b in zip(front_r,rot))
    results["console_errors"] = errors

    # build contact sheet
    files = ["01_locker_2d.png","02_3d_front.png","03_3d_rotated.png","04_3d_recolored.png"]
    thumbs = [Image.open(os.path.join(OUT,f)).convert("RGB").resize((500,320)) for f in files]
    sheet = Image.new("RGB",(500*2+30,320*2+30),(20,22,28))
    pos = [(10,10),(520,10),(10,340),(520,340)]
    for t,p_ in zip(thumbs,pos): sheet.paste(t,p_)
    sheet.save(os.path.join(OUT,"sheet.png"))

    print(json.dumps(results, indent=2))

asyncio.run(main())
