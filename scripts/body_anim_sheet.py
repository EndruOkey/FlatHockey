# List a GIF před/po ze snímků scripts/body_anim_shots.mjs: řádky = situace × (PŘED/PO) × (1× zvětšeno bez vyhlazení | detail dpr 3).
# python scripts/body_anim_sheet.py DIR OUT.png OUT.gif
import sys, os
from PIL import Image, ImageDraw, ImageFont
D, OUT, GIF = sys.argv[1], sys.argv[2], sys.argv[3]
SIT = [('vpred', 'vpřed', 2), ('zatacka', 'zatáčka', 3), ('brzda', 'brzda', 2), ('napr', 'nápřah+rána', 4), ('klid', 'klid', 12)]
T, N, LW, HH = 150, 12, 150, 26
try: F = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 15)
except Exception: F = ImageFont.load_default()
def img(lab, sit, dpr, i, size):
    im = Image.open(os.path.join(D, f'{lab}_{sit}_d{dpr}_{i:02d}.png')).convert('RGB')
    return im.resize((size, size), Image.NEAREST if dpr == 1 else Image.LANCZOS)
rows = [(lab, s, n, k, d) for s, n, k in SIT for lab in ('pred', 'po') for d in (1, 3)]
W, H = LW + N * (T + 2), HH + len(rows) * (T + 2)
sheet = Image.new('RGB', (W, H), '#0b1424'); dr = ImageDraw.Draw(sheet)
dr.text((8, 5), 'Tělo hráče PŘED (B0) / PO (B1). 1× = 1366×768 dpr 1, výřez 52 px zvětšen bez vyhlazení; detail = dpr 3. Ve sloupcích každý k-tý snímek (60 fps).', fill='#eef4fb', font=F)
for r, (lab, s, n, k, d) in enumerate(rows):
    y = HH + r * (T + 2)
    dr.text((8, y + 8), n, fill='#4cc3ff', font=F); dr.text((8, y + 30), ('PŘED' if lab == 'pred' else 'PO') + (' 1×' if d == 1 else ' detail'), fill='#ffd84c' if lab == 'po' else '#eef4fb', font=F)
    dr.text((8, y + 52), f'každý {k}. snímek', fill='#a9bdd6', font=F)
    for i in range(N): sheet.paste(img(lab, s, d, i, T), (LW + i * (T + 2), y))
sheet.save(OUT); print('list', OUT, sheet.size)
# GIF: vlevo před, vpravo po; nahoře 1× (bez vyhlazení), dole detail; situace za sebou
G = 240; fr = []
for s, n, k in SIT:
    for i in range(N):
        im = Image.new('RGB', (2 * G + 6, 2 * G + 30), '#0b1424'); d2 = ImageDraw.Draw(im)
        for c, lab in enumerate(('pred', 'po')):
            d2.text((c * (G + 6) + 6, 6), ('PŘED ' if lab == 'pred' else 'PO ') + n, fill='#eef4fb' if lab == 'pred' else '#ffd84c', font=F)
            im.paste(img(lab, s, 1, i, G), (c * (G + 6), 28)); im.paste(img(lab, s, 3, i, G), (c * (G + 6), 28 + G))
        fr.append(im.convert('P', palette=Image.ADAPTIVE, colors=128))
fr[0].save(GIF, save_all=True, append_images=fr[1:], duration=[min(200, 17 * k) for s, n, k in SIT for _ in range(N)], loop=0); print('gif', GIF, len(fr))
