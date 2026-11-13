"""RUBRIKA ČITELNOSTI BRANKY „SKUTEČNÝ TVAR" (G8+) — měřeno z PIXELŮ snímku (scripts/goal8_shot.py), kritéria stanovená předem (2026-11-12).
Měří se v reálné velikosti 1366×768 @1 (nejhorší běžný případ, 1,198 px na px hřiště), pravá (červená) branka, bez brankáře.
Řezy (pevné souřadnice hřiště): A = vodorovně y 228, x 992→1040 (záda) · B = svisle x 996, y 180→228 (bok u tyčky) · C = svisle x 1001 (bok dál).
Třídy pixelů: D obrys (jas < 0,15, ne modrý) · T týmová barva (R − max(G,B) > 70) · W bílá trubka (jas ≥ 0,86 a |R − B| < 20) · N ostatní (síť, led).
R1 základna (W) na řezech A, B, C ≥ 2 px              R2 horní rám (T) na A, B, C ≥ 2 px
R3 mezi horním rámem a základnou ≥ 2 px sítě (N) na A, B, C → dva oddělené obrysy, ne jedna zdvojená čára
R4 obrys jako hráči: vnější D na řezu A 1–3 px (hráč ≈ 1,2 px) a kontrast trubka/týmová ≥ 1,5:1
R5 síť bez šumu: rozteč ≥ 6 px (kolmo) a v ploše sítě P90/P10 jasu ≤ 1,35:1
R6 tyčky výrazné: průměr disku tyčky vč. obrysu ≥ 4 px (2× poloměr od středu doleva po konec obrysu)
R7 brankář čitelný: přední vrstva branky zakryje ≤ 20 % jeho pixelů (ODHAD prahu)
R8 puk v síti vidět: kontrast puk / totéž místo bez puku ≥ 3:1 (puk u x 1006, y 236)
python scripts/goal8_rubric.py <dir_se_snímky> g8,g9 [WxH@dpr]
"""
import sys, json, os
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')

D = sys.argv[1]
GS = sys.argv[2].split(',') if len(sys.argv) > 2 else ['g8']
CFG = sys.argv[3] if len(sys.argv) > 3 else '1366x768@1'
meta = json.load(open(os.path.join(D, 'meta.json')))
WX0, WX1, WY0, WY1 = meta['world']
MESH = {'g5': (3.3, False), 'g6': (7.5, True), 'g7': (7.5, True)}   # rozteč sítě (px hřiště), diagonální?
import re
src = open(os.path.join(os.path.dirname(__file__), '..', 'public', 'js', 'entities', 'Rink.js'), encoding='utf-8').read()


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def cr(a, b):
    a, b = max(a, b), min(a, b)
    return (a + 0.05) / (b + 0.05)


def cls(c):
    L = lum(c)
    if L < 0.15 and c[2] - c[0] < 50: return 'D'   # tmavě modrá čára brankoviště není obrys
    if c[0] - max(c[1], c[2]) > 70: return 'T'
    if L >= 0.86 and abs(c[0] - c[2]) < 20: return 'W'
    return 'N'


def runs(seq):
    out = []
    for k in seq:
        if out and out[-1][0] == k: out[-1][1] += 1
        else: out.append([k, 1])
    return out


def mesh_of(g):
    real = meta.get('real', {}).get(g[1:])
    if real: return real['mesh'], True
    return MESH.get(g, (7.5, True))


def evaluate(g):
    key = f'{g}_{CFG}'
    m = meta['meta'][key + '_empty']; s = m['scale'] * m['dpr']
    E = Image.open(os.path.join(D, key + '_empty.png')).convert('RGB')
    P = lambda wx, wy: (min(E.width - 1, max(0, round((wx - WX0) * s))), min(E.height - 1, max(0, round((wy - WY0) * s))))
    def cut(a, b):
        (x0, y0), (x1, y1) = P(*a), P(*b); n = max(abs(x1 - x0), abs(y1 - y0))
        return [E.getpixel((round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n))) for i in range(n + 1)]
    cuts = {'A': cut((992, 228), (WX1, 228)), 'B': cut((996, WY0), (996, 228)), 'C': cut((1001, WY0), (1001, 228))}
    cuts['A'] = cuts['A'][::-1]   # řezy B, C jdou zvenku dovnitř (od ledu), A zevnitř ven → sjednotit: zvenku dovnitř
    res, info = {}, {}
    r1, r2, r3, r4o = [], [], [], None
    for name, px in cuts.items():
        rr = runs([cls(c) for c in px])
        # zvenku: led N → D → W (základna) → D → N (síť) → D → T (horní rám) …
        w = next((n for k, n in rr if k == 'W'), 0)
        t = next((n for k, n in rr if k == 'T'), 0)
        iw = next((i for i, (k, n) in enumerate(rr) if k == 'W'), None); it = next((i for i, (k, n) in enumerate(rr) if k == 'T'), None)
        gap = sum(n for k, n in rr[iw + 1:it] if k == 'N') if iw is not None and it is not None and it > iw else 0
        r1.append(w); r2.append(t); r3.append(gap)
        if name == 'A' and iw is not None: r4o = sum(n for k, n in rr[:iw] if k == 'D')
        info[name] = ''.join(f'{k}{n}' for k, n in rr)
    res['R1'] = (min(r1) >= 2, f'základna A/B/C = {r1} px')
    res['R2'] = (min(r2) >= 2, f'horní rám A/B/C = {r2} px')
    res['R3'] = (min(r3) >= 2, f'síť mezi rámy A/B/C = {r3} px')
    team, white = (255, 68, 85), (238, 243, 249)
    ctw = cr(lum(team), lum(white))
    res['R4'] = (r4o is not None and 1 <= r4o <= 3 and ctw >= 1.5, f'vnější obrys {r4o} px (hráč 1,2), trubka/týmová {ctw:.1f}:1')
    sp, diag = mesh_of(g); sp_px = sp * m['scale'] / (2 ** 0.5 if diag else 1)
    Ls = sorted(lum(E.getpixel(P(x, y))) for x in range(993, 999) for y in range(218, 239, 1))
    p10, p90 = Ls[len(Ls) // 10], Ls[len(Ls) * 9 // 10]
    res['R5'] = (sp_px >= 6 and cr(p90, p10) <= 1.35, f'rozteč {sp_px:.1f} px, šum sítě P90/P10 {cr(p90, p10):.2f}:1')
    # od středu tyčky doleva: výplň (T/W) → obrys (D) → konec obrysu = poloměr (vlevo je jen led a brankoviště)
    cx, cy = P(990, 206); seq = [cls(E.getpixel((cx - i, cy))) for i in range(0, round(8 * s))]
    i = 0
    while i < len(seq) and seq[i] != 'D': i += 1
    while i < len(seq) and seq[i] == 'D': i += 1
    dia = (2 * i - 1) / m['dpr']
    res['R6'] = (dia >= 4, f'tyčka ⌀ {dia:.0f} px')
    # R7: pixely brankáře = rozdíl gknf vs emptynf; zakryté = ty, které se liší mezi gk a gknf
    G1, G0 = [Image.open(os.path.join(D, f'{key}_{n}.png')).convert('RGB') for n in ('gk', 'gknf')]
    E0 = Image.open(os.path.join(D, key + '_emptynf.png')).convert('RGB')
    gp = hid = 0
    for y in range(G0.height):
        for x in range(G0.width):
            a = G0.getpixel((x, y))
            if sum(abs(i - j) for i, j in zip(a, E0.getpixel((x, y)))) > 40 and (x / s + WX0) < 1000:   # jen brankář (puk je za x 1000)
                gp += 1
                if sum(abs(i - j) for i, j in zip(a, G1.getpixel((x, y)))) > 40: hid += 1
    fr = hid / max(1, gp)
    res['R7'] = (fr <= 0.20, f'zakryto {fr * 100:.0f} % brankáře ({hid}/{gp} px)')
    # puk vs totéž místo bez puku (scéna empty) — 3×3 kolem středu puku
    px, py = P(1006, 236); nb = [(px + dx, py + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    core = sum(lum(G1.getpixel(q)) for q in nb) / 9; bg = sum(lum(E.getpixel(q)) for q in nb) / 9
    c8 = cr(bg, core)
    res['R8'] = (c8 >= 3, f'puk/okolí {c8:.1f}:1')
    return res, info


for g in GS:
    res, info = evaluate(g)
    print(f'== {g.upper()} {CFG} · {sum(1 for ok, _ in res.values() if ok)}/{len(res)}')
    for k, (ok, t) in res.items(): print(f"{'ANO' if ok else 'NE '}  {k}  {t}")
    print('   řezy (zvenku dovnitř):', info)
