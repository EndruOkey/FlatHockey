# List a GIF ze snímků scripts/pass_recv_shots.mjs: pro každou událost (vypuštění pasu, příjem nahrávače, pas nahrávače, příjem hráče)
# řádek PŘED (VIS.r 0) a PO (VIS.r 1), snímek po snímku (60 Hz), výřez kolem hráče, který puk pouští / přijímá.
# Vlevo navíc „stopa" = všechny snímky okna přes sebe (tmavší zůstává) → skok puku je vidět jako mezera v řadě kotoučů.
#   python scripts/pass_recv_sheet.py DIR OUT_PREFIX     → OUT_PREFIX.png + OUT_PREFIX.gif
import sys, os, json
from PIL import Image, ImageDraw, ImageChops, ImageFont
try: F = ImageFont.truetype('arial.ttf', 15)
except Exception: F = None
D, OUT = sys.argv[1], sys.argv[2]
# výřez ve světě (snímky pokrývají svět x 380–660, y 290–370); hráč stojí na x 420, nahrávač na 620
REG = {'1vypusteni': (400, 480), '2nahravac_prijem': (560, 640), '3nahravac_pas': (560, 640), '4prijem': (400, 480)}
NAME = {'1vypusteni': 'pas hráče (vypuštění)', '2nahravac_prijem': 'příjem nahrávače', '3nahravac_pas': 'pas nahrávače', '4prijem': 'příjem hráče'}
files = sorted(f for f in os.listdir(D) if f.endswith('.png'))
def load(lab, k):
    fs = [f for f in files if f.startswith(f'{lab}_{k}_')]
    return [Image.open(os.path.join(D, f)).convert('RGB') for f in fs], [int(f.rsplit('_', 1)[1][:2]) - 10 for f in fs]
SCL = 0.42
rows, gif = [], {}
for k in REG:
    for lab in ('pred', 'po'):
        ims, idx = load(lab, k)
        if not ims: continue
        W, H = ims[0].size; x0, x1 = REG[k]; cx0, cx1 = int((x0 - 380) / 280 * W), int((x1 - 380) / 280 * W)
        cr = [im.crop((cx0, 0, cx1, H)) for im in ims]
        st = cr[0]
        for c in cr[1:]: st = ImageChops.darker(st, c)
        cells = [st] + cr
        cw, ch = int(cr[0].width * SCL), int(cr[0].height * SCL)
        row = Image.new('RGB', (len(cells) * (cw + 4) + 260, ch + 22), (245, 245, 245))
        d = ImageDraw.Draw(row); d.text((6, ch // 2), f"{NAME[k]}\n{'PŘED (skok)' if lab == 'pred' else 'PO (plynule)'}", fill=(0, 0, 0), font=F)
        for i, c in enumerate(cells):
            row.paste(c.resize((cw, ch), Image.LANCZOS), (260 + i * (cw + 4), 18))
            d.text((260 + i * (cw + 4) + 4, 3), 'stopa' if i == 0 else f'{idx[i - 1]:+d}', fill=(180, 0, 0) if i and idx[i - 1] == 0 else (0, 0, 0), font=F)
        rows.append(row); gif.setdefault(k, {})[lab] = cr
sheet = Image.new('RGB', (max(r.width for r in rows), sum(r.height + 6 for r in rows)), (255, 255, 255))
y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height + 6
sheet.save(OUT + '.png')
# GIF: PŘED | PO vedle sebe, všechny události za sebou, 0,25× rychlost (snímek 60 Hz → 67 ms)
fr = []
for k, v in gif.items():
    a, b = v.get('pred', []), v.get('po', [])
    for i in range(min(len(a), len(b))):
        w, h = int(a[i].width * 0.6), int(a[i].height * 0.6)
        c = Image.new('RGB', (w * 2 + 6, h + 18), (255, 255, 255)); dd = ImageDraw.Draw(c)
        c.paste(a[i].resize((w, h)), (0, 18)); c.paste(b[i].resize((w, h)), (w + 6, 18))
        dd.text((4, 3), f'PŘED  {NAME[k]}', fill=(0, 0, 0), font=F); dd.text((w + 10, 3), 'PO', fill=(0, 0, 0), font=F)
        fr.append(c)
fr[0].save(OUT + '.gif', save_all=True, append_images=fr[1:], duration=67, loop=0)
print(OUT + '.png', sheet.size, '|', OUT + '.gif', len(fr), 'snímků')
