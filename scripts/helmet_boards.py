# Sestaví popsané tabule ze snímků helmet_metrics.py + helmet_ingame.mjs: board_h<N>.png (jeden směr) a compare_all.png (všechny vedle sebe).
# python scripts/helmet_boards.py <složka>
import sys, os
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1] if len(sys.argv) > 1 else '.'
F = lambda s: ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', s)
NAME = {1: 'H1 dnes (výchozí)', 3: 'A · H3 Plochá ikona', 4: 'B · H4 Skořepina', 5: 'C · H5 Týmový pruh', 6: 'D · H6 Hloubka'}
IDEA = {1: 'tón dresu ±45 %, přechod + lesk, světlý tenký kšilt',
        3: 'jedna plná barva v kontrastu k dresu, tmavý kšilt přes přední třetinu, silný obrys',
        4: 'vejčitý tvar, helma v barvě kalhot (jako NHL), světlo dvoutónově, větrání ×4',
        5: 'pruh v akcentu zezadu dopředu + kšilt = tvar T ukazuje směr',
        6: 'helma v barvě dresu, o 20 % větší, vrhá stín na ramena'}
ROWS = ['světlý dres · helma = dres', 'světlý dres · tmavá helma', 'červený dres · helma = dres', 'červený dres · bílá helma', 'typy: kšilt · mřížka · bez']
BG = (250, 250, 252); INK = (20, 26, 40); MUTE = (90, 98, 115)

def board(v):
    s1 = Image.open(f'{D}/sheet_h{v}_s1x2.png'); s4 = Image.open(f'{D}/sheet_h{v}_s4.png'); s1n = Image.open(f'{D}/sheet_h{v}_s1.png')
    ig = Image.open(f'{D}/ingame_h{v}.png'); ig2 = ig.resize((ig.width * 2, ig.height * 2), Image.NEAREST)
    lab = 200; W = lab + s1n.width + 20 + s1.width + 20 + s4.width + 30; H = 70 + max(s4.height, s1.height) + 40 + ig2.height + 40
    W = max(W, ig.width + ig2.width + 60)
    o = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(o)
    d.text((16, 12), NAME[v], font=F(26), fill=INK); d.text((16, 44), IDEA[v], font=F(15), fill=MUTE)
    y0 = 90; x = lab
    for im, t in ((s1n, 'herní měřítko 1:1'), (s1, '1:1 zvětšeno 2× (ostré pixely)'), (s4, 'šatna ×4')):
        d.text((x, y0 - 18), t, font=F(13), fill=MUTE); o.paste(im, (x, y0)); x += im.width + 20
    ch = s4.height / 5
    for r, t in enumerate(ROWS): d.text((16, y0 + int(ch * r + ch / 2) - 8), t, font=F(13), fill=INK)
    y1 = y0 + max(s4.height, s1.height) + 40
    d.text((16, y1 - 20), 've hře (offline zápas, zmrazený okamžik) — 1:1 a 2×', font=F(13), fill=MUTE)
    o.paste(ig, (16, y1)); o.paste(ig2, (16 + ig.width + 20, y1))
    o.save(f'{D}/board_h{v}.png'); return o

for v in NAME: board(v)
# srovnání: 1:1 ×2 archy vedle sebe + výřezy ze hry 2×
sh = [Image.open(f'{D}/sheet_h{v}_s1x2.png') for v in NAME]; w = sh[0].width
crop = lambda v: (lambda im: im.resize((im.width * 2, im.height * 2), Image.NEAREST))(Image.open(f'{D}/ingame_h{v}.png').crop((0, 20, 200, 220)))
cr = [crop(v) for v in NAME]; cw = max(w, cr[0].width)
o = Image.new('RGB', (len(sh) * (cw + 16) + 16, 60 + sh[0].height + 20 + cr[0].height + 20), BG); d = ImageDraw.Draw(o)
for i, v in enumerate(NAME):
    x = 16 + i * (cw + 16); d.text((x, 18), NAME[v], font=F(17), fill=INK); o.paste(sh[i], (x, 50)); o.paste(cr[i], (x, 50 + sh[0].height + 20))
o.save(f'{D}/compare_all.png'); print('tabule:', D)
