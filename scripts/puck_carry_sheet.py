# List PŘED/PO ze snímků scripts/puck_carry_shots.mjs: řádky = situace × (PŘED/PO) × (1× zvětšeno bez vyhlazení | detail dpr 4).
# python scripts/puck_carry_sheet.py DIR OUT.png [labs=pred,po]
import sys, os
from PIL import Image, ImageDraw, ImageFont
D, OUT = sys.argv[1], sys.argv[2]
LABS = (sys.argv[3] if len(sys.argv) > 3 else 'pred,po').split(',')
SIT = [('vpred', 'vpřed'), ('zatacka', 'zatáčka'), ('couvani', 'couvání'), ('bokem', 'bokem'), ('stoj', 'stoj'), ('klicka', 'klička')]
T, N, LW, HH = 140, 8, 130, 26
try: F = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 14)
except Exception: F = ImageFont.load_default()
def img(lab, sit, dpr, i):
    im = Image.open(os.path.join(D, f'{lab}_{sit}_d{dpr}_{i:02d}.png')).convert('RGB')
    return im.resize((T, T), Image.NEAREST if dpr == 1 else Image.LANCZOS)
rows = [(lab, s, n, d) for s, n in SIT for lab in LABS for d in (1, 4) if os.path.exists(os.path.join(D, f'{lab}_{s}_d{d}_00.png'))]
W, H = LW + N * (T + 2), HH + len(rows) * (T + 2)
sheet = Image.new('RGB', (W, H), '#0b1424'); dr = ImageDraw.Draw(sheet)
dr.text((8, 5), 'Puk na čepeli PŘED / PO. 1× = 1366×768 dpr 1 (výřez 96 px, zvětšeno bez vyhlazení); detail = dpr 4.', fill='#eef4fb', font=F)
for r, (lab, s, n, d) in enumerate(rows):
    y = HH + r * (T + 2)
    dr.text((8, y + 8), n, fill='#4cc3ff', font=F)
    dr.text((8, y + 30), ('PŘED' if lab == 'pred' else 'PO') + (' 1×' if d == 1 else ' detail'), fill='#ffd84c' if lab == 'po' else '#eef4fb', font=F)
    for i in range(N): sheet.paste(img(lab, s, d, i), (LW + i * (T + 2), y))
sheet.save(OUT); print('list', OUT, sheet.size)
