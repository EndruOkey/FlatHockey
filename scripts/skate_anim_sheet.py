# List před/po ze snímků scripts/skate_anim_shots.mjs: řádky = situace × (1× zvětšeno 3× bez vyhlazení | detail dpr 3), sloupce = 12 po sobě jdoucích snímků.
# python scripts/skate_anim_sheet.py DIR OUT.png OUT.gif [labels=pred,po]
import sys, os
from PIL import Image, ImageDraw, ImageFont
D, OUT, GIF = sys.argv[1], sys.argv[2], sys.argv[3]
LAB = (sys.argv[4] if len(sys.argv) > 4 else 'pred,po').split(',')
SIT = [('vpred', 'vpřed'), ('bokem', 'do strany'), ('couvani', 'couvání')]
T, N, LW, HH = 168, 12, 150, 26
try: F = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 15)
except Exception: F = ImageFont.load_default()
def tile(lab, sit, dpr, i):
    im = Image.open(os.path.join(D, f'{lab}_{sit}_d{dpr}_{i:02d}.png')).convert('RGB')
    return im.resize((T, T), Image.NEAREST if dpr == 1 else Image.LANCZOS)
rows = [(lab, s, n, d) for s, n in SIT for lab in LAB for d in (1, 3)]
W, H = LW + N * (T + 2), HH + len(rows) * (T + 2)
sheet = Image.new('RGB', (W, H), '#0b1424'); dr = ImageDraw.Draw(sheet)
dr.text((8, 5), 'Bruslení: 12 po sobě jdoucích snímků (60 fps). 1× = reálná velikost 1366×768 dpr 1, výřez 48 px zvětšen 3,5× bez vyhlazení; detail = dpr 3', fill='#eef4fb', font=F)
for r, (lab, s, n, d) in enumerate(rows):
    y = HH + r * (T + 2)
    dr.text((8, y + 8), n, fill='#4cc3ff', font=F); dr.text((8, y + 30), ('PŘED' if lab == 'pred' else 'PO') + (' 1×' if d == 1 else ' detail'), fill='#ffd84c' if lab != 'pred' else '#eef4fb', font=F)
    for i in range(N): sheet.paste(tile(lab, s, d, i), (LW + i * (T + 2), y))
sheet.save(OUT); print('list', OUT, sheet.size)
# GIF vpřed: vlevo před, vpravo po; 1× (zvětšeno 5,25× bez vyhlazení) nahoře, detail dole
G = 252
fr = []
n = len([f for f in os.listdir(D) if f.startswith(f'{LAB[0]}_vpred_d1_')])
for i in range(n):
    im = Image.new('RGB', (2 * G + 6, 2 * G + 30), '#0b1424'); d2 = ImageDraw.Draw(im)
    for c, lab in enumerate(LAB):
        d2.text((c * (G + 6) + 6, 6), 'PŘED' if lab == 'pred' else 'PO (nové)', fill='#eef4fb' if lab == 'pred' else '#ffd84c', font=F)
        a = Image.open(os.path.join(D, f'{lab}_vpred_d1_{i:02d}.png')).convert('RGB').resize((G, G), Image.NEAREST)
        im.paste(a, (c * (G + 6), 28))
        bb = Image.open(os.path.join(D, f'{lab}_vpred_d3_{i:02d}.png')).convert('RGB').resize((G, G), Image.LANCZOS)
        im.paste(bb, (c * (G + 6), 28 + G))
    fr.append(im.convert('P', palette=Image.ADAPTIVE, colors=128))
if len(LAB) == 2: fr[0].save(GIF, save_all=True, append_images=fr[1:], duration=33, loop=0); print('gif', GIF, len(fr))
