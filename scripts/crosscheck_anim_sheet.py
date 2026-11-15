# List a GIF PŘED/PO přechodu hůl <-> crosscheck ze snímků scripts/crosscheck_anim_metrics.mjs --out=DIR (každý snímek 60 fps, 3× zvětšeno).
# python scripts/crosscheck_anim_sheet.py PRED_DIR PO_DIR OUT.png OUT.gif
import sys, os
from PIL import Image, ImageDraw, ImageFont
PD, PO, OUT, GIF = sys.argv[1:5]
SIT = [('stoj', 'stoj'), ('jizda', 'jízda 165 px/s'), ('stoj_levak', 'stoj, levák')]
ON, OFF, T = 30, 66, 120
COLS = list(range(ON - 1, ON + 11)) + list(range(OFF - 1, OFF + 11))
try: F = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 15)
except Exception: F = ImageFont.load_default()
def img(d, sc, i, size=T): return Image.open(os.path.join(d, f'{sc}_{i:03d}.png')).convert('RGB').resize((size, size), Image.LANCZOS)
LW, HH = 150, 48
rows = [(d, lab, sc, n) for sc, n in SIT for d, lab in ((PD, 'PŘED'), (PO, 'PO'))]
W, H = LW + len(COLS) * (T + 2) + 12, HH + len(rows) * (T + 2)
sh = Image.new('RGB', (W, H), '#0b1424'); dr = ImageDraw.Draw(sh)
dr.text((8, 5), 'Crosscheck: PŘED (okamžité přepnutí) / PO (prolnutí 0,15 s). Každý snímek 60 fps; vlevo stisk RMB, vpravo puštění.', fill='#eef4fb', font=F)
for k, i in enumerate(COLS):
    x = LW + k * (T + 2) + (12 if k >= 12 else 0)
    dr.text((x + 4, 27), f'{(i - (ON if k < 12 else OFF)) * 1000 // 60:+d} ms', fill='#ffd84c' if i in (ON, OFF) else '#a9bdd6', font=F)
for r, (d, lab, sc, n) in enumerate(rows):
    y = HH + r * (T + 2)
    dr.text((8, y + 8), n, fill='#4cc3ff', font=F); dr.text((8, y + 30), lab, fill='#ffd84c' if lab == 'PO' else '#eef4fb', font=F)
    for k, i in enumerate(COLS): sh.paste(img(d, sc, i), (LW + k * (T + 2) + (12 if k >= 12 else 0), y))
sh.save(OUT); print('list', OUT, sh.size)
G, fr = 300, []
for sc, n in SIT[:2]:
    for i in range(ON - 8, OFF + 24):
        im = Image.new('RGB', (2 * G + 6, G + 30), '#0b1424'); d2 = ImageDraw.Draw(im)
        for c, (d, lab) in enumerate(((PD, 'PŘED'), (PO, 'PO'))):
            d2.text((c * (G + 6) + 6, 6), f'{lab} {n}' + (' · RMB' if ON <= i < OFF else ''), fill='#ffd84c' if lab == 'PO' else '#eef4fb', font=F)
            im.paste(img(d, sc, i, G), (c * (G + 6), 28))
        fr.append(im.convert('P', palette=Image.ADAPTIVE, colors=128))
fr[0].save(GIF, save_all=True, append_images=fr[1:], duration=34, loop=0); print('gif', GIF, len(fr), 'snímků, zpomaleno 2×')
