# Náhledový arch: každý směr ve 4 formátech + test čitelnosti v malé velikosti (200 px šířka)
import sys, os
from PIL import Image
out = os.path.join(os.path.dirname(__file__), 'out')
dirs = sys.argv[1:] or ['ice', 'close']
sizes = ['1920x1080', '800x1200', '800x800', '630x500']
rowH = 300
rows = []
for d in dirs:
    tiles = []
    for s in sizes:
        im = Image.open(os.path.join(out, f'{d}-{s}.png')).convert('RGB')
        tiles.append(im.resize((round(im.width * rowH / im.height), rowH), Image.LANCZOS))
    small = Image.open(os.path.join(out, f'{d}-800x800.png')).convert('RGB').resize((200, 200), Image.LANCZOS)
    w = sum(t.width for t in tiles) + 220 + 10 * len(tiles)
    row = Image.new('RGB', (w, rowH), (40, 44, 52))
    x = 0
    for t in tiles:
        row.paste(t, (x, 0)); x += t.width + 10
    row.paste(small, (x + 10, (rowH - 200) // 2))
    rows.append(row)
W = max(r.width for r in rows)
sheet = Image.new('RGB', (W, (rowH + 12) * len(rows)), (40, 44, 52))
for i, r in enumerate(rows):
    sheet.paste(r, (0, i * (rowH + 12)))
sheet.thumbnail((2400, 2400))
sheet.save(os.path.join(out, 'sheet-' + '-'.join(dirs) + '.png'))
