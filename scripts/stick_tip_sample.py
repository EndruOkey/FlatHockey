"""Sběr poloh špičky hole vůči tělu (lokál: +x dopředu, +y doprava, v jednotkách R) z offline zápasu 3v3 s boty.
Pevné okno, pevné čekání; každý 3. snímek 20 s. Výstup scripts/data/stick_tips.json (vstup pro scripts/stick_grip_metrics.mjs).
python scripts/stick_tip_sample.py <base_url>
"""
import sys, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1].rstrip('/')
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1366, 'height': 768})
    ctx.add_init_script("localStorage.setItem('hockey_tutorial_done','1'); localStorage.setItem('hockey_name','Probe');")
    pg = ctx.new_page(); pg.goto(BASE + '/?fhtest', wait_until='networkidle'); pg.wait_for_timeout(400)
    if pg.locator('#splash-guest-btn').is_visible(): pg.click('#splash-guest-btn'); pg.wait_for_timeout(400)
    pg.click('#go-offline'); pg.wait_for_timeout(4000)
    data = pg.evaluate("""() => new Promise(res => { const g = window.__fhGame, out = []; let n = 0; const end = performance.now() + 20000;
      const f = () => { if (n++ % 3 === 0) for (const [, e] of g.players) { const q = e.ent, t = q.stickTip; if (!t || q.bodyAngle == null) continue;
          const dx = t.x - q.x, dy = t.y - q.y, c = Math.cos(-q.bodyAngle), s = Math.sin(-q.bodyAngle), R = q.radius || 7;
          out.push([+((dx * c - dy * s) / R).toFixed(3), +((dx * s + dy * c) / R).toFixed(3), +(q._dispCharge ?? 0).toFixed(2), q.handed ?? 1]); }
        if (performance.now() < end) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })""")
    json.dump(data, open('scripts/data/stick_tips.json', 'w')); print('vzorků', len(data)); b.close()
