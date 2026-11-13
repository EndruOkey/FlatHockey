"""RUBRIKA G8b „tvar D + hierarchie" — měřeno z PIXELŮ snímku (scripts/goal8_shot.py), kritéria stanovená PŘEDEM (2026-11-13),
před úpravou návrhu. Rozšiřuje goal8_rubric.py (R1–R8) o body tvaru D, hierarchie čar a viditelnosti sítě (R9–R13).
Měří se v reálné velikosti 1366×768 @1 (nejhorší běžný případ), pravá (červená) branka, scéna bez brankáře.
Třídy pixelů: D obrys (jas < 0,15, ne modrý) · T týmová (R − max(G,B) > 70) · W světlá trubka (jas ≥ 0,78, |R − B| < 20)
              · S ocelová čára (jas < 0,45, ne D/T) · N ostatní (led, výplň, síť).
Skupina „základna" na řezu = od prvního ne-N pixelu zvenku, mezery N ≤ 1 px se tolerují, končí na ≥ 2 px N.
Skupina „horní rám" = souvislý běh T včetně sousedních D.
Změny proti goal8_rubric.py (zdůvodnění): R1 a R4 už nevyžadují bílou trubku s černým obrysem z obou stran — právě ta trojitá
linka (obrys–bílá–obrys) je kritizovaná chyba; nově stačí čitelná základna (kontrast k ledu) a jeden vnější obrys.
R1  základna čitelná: skupina na řezech A, B, C ≥ 2 px a v ní kontrast k ledu ≥ 1,8:1
R2  horní rám (T) na A, B, C ≥ 2 px
R3  mezi základnou a horním rámem ≥ 2 px N na A, B, C (dva oddělené obrysy)
R4  vnější obrys základny na A 1–2 px (D nebo S; hráč ≈ 1,2 px) a kontrast trubka/týmová ≥ 1,5:1
R5  síť bez šumu: rozteč ≥ 6 px a v ploše u ústí P90/P10 jasu ≤ 1,35:1
R6  tyčka ⌀ ≥ 4 px          R7  přední vrstva zakryje ≤ 20 % brankáře          R8  puk v síti ≥ 3:1
R9  tvar D — poměr: největší vnější šířka základny / ústí (44 px hřiště) ≥ 1,15  (NHL 88″/72″ = 1,22)
R10 tvar D — rozšíření: vnější šířka max − šířka u tyček (x 994,5 = 4,5 px za čarou, hned za diskem tyčky) ≥ 3 px v 1×
R11 zaoblená záda: vnější hloubka zad ve středu (y 228) − hloubka na y 228 ± 16 ≥ 2 px v 1× (průměr obou stran)
R12 hierarchie: základna jemnější než horní rám — na řezech A i C max. kontrast základny k ledu ≤ 0,6 × max. kontrastu horního
    rámu a tloušťka skupiny základny ≤ tloušťka skupiny horního rámu
R13 síť viditelná, ale tichá: svislý řez x 1007, y 216→240 (gradient výplně je vodorovný → na řezu jen síť), P90/P10 jasu 1,15–1,35:1
DOJEM /10 (pevný vzorec, ne pocit): 10 − 2 × (nesplněné R9–R13, vizuální body) − 1 × (nesplněné R1–R8), minimum 1.
python scripts/goal8b_rubric.py <dir_se_snímky> g8,g10 [WxH@dpr]
"""
import sys, json, os
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')

D = sys.argv[1]
GS = sys.argv[2].split(',') if len(sys.argv) > 2 else ['g8']
CFG = sys.argv[3] if len(sys.argv) > 3 else '1366x768@1'
meta = json.load(open(os.path.join(D, 'meta.json')))
WX0, WX1, WY0, WY1 = meta['world']


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def lum(c): return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def cr(a, b):
    a, b = max(a, b), min(a, b)
    return (a + 0.05) / (b + 0.05)


def cls(c):
    L = lum(c)
    if L < 0.15 and c[2] - c[0] < 50: return 'D'
    if c[0] - max(c[1], c[2]) > 70: return 'T'
    if L >= 0.78 and abs(c[0] - c[2]) < 20: return 'W'
    if L < 0.45: return 'S'
    return 'N'


def base_group(px):
    """indexy skupiny základny (zvenku dovnitř)."""
    k = [cls(c) for c in px]
    i = next((i for i, q in enumerate(k) if q != 'N'), None)
    if i is None: return []
    j = i
    while j + 1 < len(k):
        if k[j + 1] != 'N': j += 1; continue
        if j + 2 < len(k) and k[j + 2] != 'N' and k[j + 2] != 'T': j += 2; continue
        break
    return list(range(i, j + 1))


def top_group(px, start):
    k = [cls(c) for c in px]
    t = next((i for i in range(start, len(k)) if k[i] == 'T'), None)
    if t is None: return []
    a = t
    while a - 1 >= start and k[a - 1] in 'DT': a -= 1
    b = t
    while b + 1 < len(k) and k[b + 1] in 'DT': b += 1
    return list(range(a, b + 1))


def evaluate(g):
    key = f'{g}_{CFG}'
    m = meta['meta'][key + '_empty']; s = m['scale'] * m['dpr']; s1 = m['scale']   # s = px snímku, s1 = px obrazovky v 1× (CSS)
    E = Image.open(os.path.join(D, key + '_empty.png')).convert('RGB')
    P = lambda wx, wy: (min(E.width - 1, max(0, round((wx - WX0) * s))), min(E.height - 1, max(0, round((wy - WY0) * s))))
    def cut(a, b):
        (x0, y0), (x1, y1) = P(*a), P(*b); n = max(abs(x1 - x0), abs(y1 - y0))
        return [E.getpixel((round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n))) for i in range(n + 1)]
    ice = E.getpixel(P(1036, 186)); Lice = lum(ice)
    cuts = {'A': cut((992, 228), (WX1, 228))[::-1], 'B': cut((996, WY0), (996, 228)), 'C': cut((1001, WY0), (1001, 228))}
    res, info, groups = {}, {}, {}
    r1, r2, r3 = [], [], []
    for name, px in cuts.items():
        bg = base_group(px); tg = top_group(px, (bg[-1] + 1) if bg else 0)
        bc = max((cr(lum(px[i]), Lice) for i in bg), default=1); tc = max((cr(lum(px[i]), Lice) for i in tg), default=1)
        groups[name] = (len(bg) / m['dpr'], bc, len(tg) / m['dpr'], tc)
        r1.append((len(bg) / m['dpr'], round(bc, 1)))
        r2.append(sum(1 for i in tg if cls(px[i]) == 'T') / m['dpr'])
        r3.append((tg[0] - bg[-1] - 1) / m['dpr'] if bg and tg else 0)
        info[name] = ''.join(cls(c) for c in px).lstrip('N')[:40]
    res['R1'] = (all(w >= 2 and c >= 1.8 for w, c in r1), f'základna A/B/C (px, kontrast) = {r1}')
    res['R2'] = (min(r2) >= 2, f'horní rám A/B/C = {r2} px')
    res['R3'] = (min(r3) >= 2, f'mezera A/B/C = {r3} px')
    A = cuts['A']; bgA = base_group(A); o = 0
    for i in bgA:
        if cls(A[i]) in 'DS': o += 1
        else: break
    team, white = (255, 68, 85), (238, 243, 249)
    ctw = cr(lum(team), lum(white))
    res['R4'] = (1 <= o / m['dpr'] <= 2 and ctw >= 1.5, f'vnější obrys {o / m["dpr"]:.1f} px, trubka/týmová {ctw:.1f}:1')
    real = meta.get('real', {}).get(g[1:], {}); sp_px = real.get('mesh', 7.5) * s1 / 2 ** 0.5
    Ls = sorted(lum(E.getpixel(P(x, y))) for x in range(993, 999) for y in range(218, 239))
    q = cr(Ls[len(Ls) * 9 // 10], Ls[len(Ls) // 10])
    res['R5'] = (sp_px >= 6 and q <= 1.35, f'rozteč {sp_px:.1f} px, šum u ústí P90/P10 {q:.2f}:1')
    cx, cy = P(990, 206); seq = [cls(E.getpixel((cx - i, cy))) for i in range(0, round(8 * s))]
    i = 0
    while i < len(seq) and seq[i] != 'D': i += 1
    while i < len(seq) and seq[i] == 'D': i += 1
    dia = (2 * i - 1) / m['dpr']
    res['R6'] = (dia >= 4, f'tyčka ⌀ {dia:.0f} px')
    G1, G0 = [Image.open(os.path.join(D, f'{key}_{n}.png')).convert('RGB') for n in ('gk', 'gknf')]
    E0 = Image.open(os.path.join(D, key + '_emptynf.png')).convert('RGB')
    gp = hid = 0
    for y in range(G0.height):
        for x in range(G0.width):
            a = G0.getpixel((x, y))
            if sum(abs(i - j) for i, j in zip(a, E0.getpixel((x, y)))) > 40 and (x / s + WX0) < 1000:
                gp += 1
                if sum(abs(i - j) for i, j in zip(a, G1.getpixel((x, y)))) > 40: hid += 1
    fr = hid / max(1, gp)
    res['R7'] = (fr <= 0.20, f'zakryto {fr * 100:.0f} % brankáře')
    px_, py_ = P(1006, 236); nb = [(px_ + dx, py_ + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    c8 = cr(sum(lum(E.getpixel(q)) for q in nb) / 9, sum(lum(G1.getpixel(q)) for q in nb) / 9)
    res['R8'] = (c8 >= 3, f'puk/okolí {c8:.1f}:1')
    # --- tvar D ---
    def width_at(wx):
        col = cut((wx, WY0), (wx, WY1)); k = [cls(c) for c in col]
        idx = [i for i, q in enumerate(k) if q != 'N']
        return (idx[-1] - idx[0] + 1) / s if idx else 0          # v px hřiště
    ws = {round(994.5 + 0.5 * i, 1): width_at(994.5 + 0.5 * i) for i in range(0, 52)}
    wmax = max(ws.values()); w0 = ws[994.5]
    res['R9'] = (wmax / 44 >= 1.15, f'záda/ústí = {wmax:.1f}/44 = {wmax / 44:.2f}')
    res['R10'] = ((wmax - w0) * s1 >= 3, f'šířka u tyček {w0:.1f} → max {wmax:.1f} px hřiště = +{(wmax - w0) * s1:.1f} px v 1×')
    def depth_at(wy):
        row = cut((992, wy), (WX1, wy)); k = [cls(c) for c in row]
        idx = [i for i, q in enumerate(k) if q != 'N']
        return idx[-1] / s if idx else 0
    dc = depth_at(228); dsd = (depth_at(212) + depth_at(244)) / 2
    res['R11'] = ((dc - dsd) * s1 >= 2, f'hloubka zad střed − (y±16) = {(dc - dsd) * s1:.1f} px v 1×')
    ok12 = all(bc <= 0.6 * tc and bw <= tw for (bw, bc, tw, tc) in (groups['A'], groups['C']))
    res['R12'] = (ok12, 'A/C základna (px, kontrast) vs rám: ' + ' · '.join(f'{bw:.0f} px {bc:.1f}:1 vs {tw:.0f} px {tc:.1f}:1' for (bw, bc, tw, tc) in (groups['A'], groups['C'])))
    col = cut((1007, 216), (1007, 240)); Ls = sorted(lum(c) for c in col)
    q13 = cr(Ls[len(Ls) * 9 // 10], Ls[len(Ls) // 10])
    res['R13'] = (1.15 <= q13 <= 1.35, f'síť na svislém řezu P90/P10 {q13:.2f}:1')
    return res, info


for g in GS:
    res, info = evaluate(g)
    f_old = sum(1 for k in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8') if not res[k][0])
    f_new = sum(1 for k in ('R9', 'R10', 'R11', 'R12', 'R13') if not res[k][0])
    score = max(1, 10 - 2 * f_new - f_old)
    print(f'== {g.upper()} {CFG} · {sum(1 for ok, _ in res.values() if ok)}/{len(res)} · DOJEM {score}/10 (−2×{f_new} vizuální, −1×{f_old} základní)')
    for k, (ok, t) in res.items(): print(f"{'ANO' if ok else 'NE '}  {k:<3}  {t}")
    print('   řezy (zvenku dovnitř):', info)
