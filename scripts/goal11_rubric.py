"""RUBRIKA G11 „skutečná branka shora" — kritéria stanovená PŘEDEM (2026-11-13), před kreslením návrhu.
Proč nová: G8–G10 optimalizovaly kontrast čar (goal8b_rubric.py), ale tvar shora fyzikálně nedával smysl
(červený vnitřní oblouk s černým obrysem = nic na skutečné brance; dvojitě obtažená základna). Ondřej: „takhle brána z vrchu nevypadá".
Fyzika (NHL 2013-14, wikipedia Goal (ice hockey)): ústí 72″ × 48″, hloubka u ledu 40″, nahoře (horní police) 18″.
Měřítko hry: ústí 44 px → 1″ = 0,611 px → základna 24,4 px, horní police 11,0 px. Tyčka 2⅜″ = 1,45 px (pro čitelnost zesíleno).
Shora je vidět (odshora dolů): břevno v týmové barvě (tyčky jsou pod jeho konci) → bílý horní rám police (U z konců břevna rovně dozadu)
→ střecha sítě (vodorovná, řidší) → zadní šikmá síť mezi policí a základnou (průmět hustší = bělejší) → bílá základna na ledu (širší než ústí).
Měří se pravá (červená) branka, snímky scripts/goal8_shot.py. Geometrie ze snímku 1366x768@3, čitelnost z 1366x768@1. u = px za brankovou čarou.
R1  břevno: týmová barva na ústí (řádek y 228) tloušťka 1,8–3,2 px hřiště, rovné (střed běhu na y 210/228/246 se liší ≤ 0,5 px)
R2  týmová barva jen na břevně: T pixely dál než 3 px od čáry ≤ 0,5 % výřezu
R3  horní police: bílá trubka (běh W ≥ 1 px) na řádku y 228 se středem u = 11 ± 1
R4  základna: poslední bílá trubka na řádku y 228 se středem u = 24,4 ± 1
R5  boky police rovně dozadu nad tyčkami: na sloupci u = 6 bílý běh se středem y = 206 ± 1,5 a 250 ± 1,5
R6  základna širší než ústí: největší vnější šířka bílé základny ≥ 1,15 × 44 px (odhad NHL ~88″/72″ = 1,22)
R7  dvě zóny sítě: střední jas zadní šikmé sítě (u 15–21) − střecha (u 3–8), řádky y 220–236, ≥ 0,03 (průmět šikmé sítě hustší)
R8  žádné černé obrysy uvnitř půdorysu: pixely jasu < 0,15 v u 3–23, y 212–244 ≤ 0,5 %
R9  stín na ledu ve směru světla (HGT lx, ly > 0 → vpravo dolů): led pod spodním bokem (u 6–18, y 253–257) tmavší než volný led o ≥ 3 %
R10 puk v síti ≥ 3:1 (scéna gk, puk 1006,236)   R11 přední vrstva zakryje ≤ 20 % brankáře (gk vs gknf)
R12 čitelnost v 1×: na řádku y 228 jsou tři oddělené prvky — břevno (T), police a základna (jas o ≥ 1,15:1 nad okolím)
python scripts/goal11_rubric.py <dir_se_snímky> g11[,g10]
"""
import sys, json, os
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
D = sys.argv[1]; GS = sys.argv[2].split(',') if len(sys.argv) > 2 else ['g11']
meta = json.load(open(os.path.join(D, 'meta.json'))); WX0, WX1, WY0, WY1 = meta['world']
GL, CY = 990, 228

def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
def lum(c): return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
def cr(a, b): a, b = max(a, b), min(a, b); return (a + 0.05) / (b + 0.05)
def isT(c): return c[0] - max(c[1], c[2]) > 70
def isW(c): return lum(c) >= 0.87 and max(c) - min(c) < 22   # led ddeef8 má jas 0,833 → nesmí projít

def load(g, cfg, sc):
    k = f'{g}_{cfg}_{sc}'; m = meta['meta'][k]; s = m['scale'] * m['dpr']
    im = Image.open(os.path.join(D, k + '.png')).convert('RGB')
    P = lambda wx, wy: (min(im.width - 1, max(0, round((wx - WX0) * s))), min(im.height - 1, max(0, round((wy - WY0) * s))))
    return im, P, s, m

def runs(flags, step):
    """souvislé běhy True → [(start_world, end_world)], mezera 1 px snímku se toleruje."""
    out, i, n = [], 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j + 1 < n and (flags[j + 1] or (j + 2 < n and flags[j + 2])): j += 1
            out.append((i * step, (j + 1) * step)); i = j + 1
        else: i += 1
    return out

def evaluate(g):
    res = {}
    E, P, s, m = load(g, '1366x768@3', 'empty'); st = 1 / s
    def row(wy, u0, u1): x0, _ = P(GL + u0, wy); x1, y = P(GL + u1, wy); return [E.getpixel((x, y)) for x in range(x0, x1)]
    def col(wu, y0, y1): x, a = P(GL + wu, y0); _, b = P(GL + wu, y1); return [E.getpixel((x, y)) for y in range(a, b)]
    # R1 břevno
    cen = []
    for wy in (210, 228, 246):
        r = runs([isT(c) for c in row(wy, -4, 4)], st); r = max(r, key=lambda q: q[1] - q[0]) if r else (0, 0)
        cen.append(((r[0] + r[1]) / 2 - 4, r[1] - r[0]))
    w = cen[1][1]; dev = max(c for c, _ in cen) - min(c for c, _ in cen)
    res['R1'] = (1.8 <= w <= 3.2 and dev <= 0.5, f'tloušťka {w:.2f} px, odchylka středu {dev:.2f} px')
    # R2 týmová jen na břevně
    tot = far = 0
    for y in range(E.height):
        for x in range(E.width):
            tot += 1
            if abs(x / s + WX0 - GL) > 3 and isT(E.getpixel((x, y))): far += 1
    res['R2'] = (far / tot <= 0.005, f'týmová mimo břevno {far / tot * 100:.2f} %')
    # R3, R4 police a základna na středovém řádku
    wr = [q for q in runs([isW(c) for c in row(CY, 2, 32)], st) if q[1] - q[0] >= 1.0]
    mids = [round((a + b) / 2 + 2, 2) for a, b in wr]
    res['R3'] = (bool(mids) and abs(mids[0] - 11) <= 1, f'bílé trubky na y 228: středy u = {mids}')
    res['R4'] = (bool(mids) and abs(mids[-1] - 24.4) <= 1, f'základna u = {mids[-1] if mids else "—"} (cíl 24,4)')
    # R5 boky police
    cr_ = [q for q in runs([isW(c) for c in col(6, 196, 260)], st) if q[1] - q[0] >= 0.8]
    ys = [round((a + b) / 2 + 196, 2) for a, b in cr_]
    ok5 = any(abs(y - 206) <= 1.5 for y in ys) and any(abs(y - 250) <= 1.5 for y in ys)
    res['R5'] = (ok5, f'bílé běhy na u = 6: y = {ys}')
    # R6 šířka základny
    wmax = 0
    for k in range(0, 50):
        wu = 2 + k * 0.5; f = [isW(c) for c in col(wu, WY0, WY1)]; idx = [i for i, q in enumerate(f) if q]
        if idx: wmax = max(wmax, (idx[-1] - idx[0] + 1) * st)
    res['R6'] = (wmax / 44 >= 1.15, f'šířka {wmax:.1f}/44 = {wmax / 44:.2f}')
    # R7 dvě zóny sítě
    def zone(u0, u1): L = [lum(E.getpixel(P(GL + u0 + (u1 - u0) * i / 20, y))) for i in range(21) for y in range(220, 237)]; return sum(L) / len(L)
    zr, zs = zone(3, 8), zone(15, 21)
    res['R7'] = (zs - zr >= 0.03, f'šikmá síť {zs:.3f} − střecha {zr:.3f} = {zs - zr:+.3f}')
    # R8 černé obrysy uvnitř
    (x0, y0), (x1, y1) = P(GL + 3, 212), P(GL + 23, 244)
    tot = dk = 0
    for y in range(y0, y1):
        for x in range(x0, x1): tot += 1; dk += lum(E.getpixel((x, y))) < 0.15
    res['R8'] = (dk / tot <= 0.005, f'tmavé uvnitř {dk / tot * 100:.2f} %')
    # R9 stín
    free = sum(lum(E.getpixel(P(GL + u, 270))) for u in range(6, 19)) / 13
    sh = sum(lum(E.getpixel(P(GL + u, y))) for u in range(6, 19) for y in range(253, 258)) / 65
    res['R9'] = (sh <= free * 0.97, f'stín {sh:.3f} vs led {free:.3f} ({(1 - sh / free) * 100:.1f} % tmavší)')
    # R10, R11 (převzato z goal8b_rubric.py R8, R7)
    G1, _, _, _ = load(g, '1366x768@3', 'gk'); G0, _, _, _ = load(g, '1366x768@3', 'gknf'); E0, _, _, _ = load(g, '1366x768@3', 'emptynf')
    px_, py_ = P(1006, 236); nb = [(px_ + dx, py_ + dy) for dx in (-2, 0, 2) for dy in (-2, 0, 2)]
    c10 = cr(sum(lum(E.getpixel(q)) for q in nb) / 9, sum(lum(G1.getpixel(q)) for q in nb) / 9)
    res['R10'] = (c10 >= 3, f'puk/okolí {c10:.1f}:1')
    gp = hid = 0
    for y in range(0, G0.height, 2):
        for x in range(0, G0.width, 2):
            a = G0.getpixel((x, y))
            if sum(abs(i - j) for i, j in zip(a, E0.getpixel((x, y)))) > 40 and (x / s + WX0) < 1000:
                gp += 1; hid += sum(abs(i - j) for i, j in zip(a, G1.getpixel((x, y)))) > 40
    res['R11'] = (hid / max(1, gp) <= 0.20, f'zakryto {hid / max(1, gp) * 100:.0f} % brankáře')
    # R12 čitelnost v 1×
    E1, P1, s1, _ = load(g, '1366x768@1', 'empty')
    x0, y = P1(GL - 3, CY); x1, _ = P1(GL + 30, CY); px = [E1.getpixel((x, y)) for x in range(x0, x1)]
    hasT = any(isT(c) for c in px[:round(6 * s1)])
    L = [lum(c) for c in px]; peaks = []
    for i in range(round(4 * s1), len(L) - 1):
        nbh = min(L[max(0, i - 3):i] + L[i + 1:i + 4])
        if cr(L[i], nbh) >= 1.15 and L[i] >= L[i - 1] and L[i] >= L[i + 1] and (not peaks or i - peaks[-1] > 3): peaks.append(i)
    pu = [round(i / s1 - 3, 1) for i in peaks]
    res['R12'] = (hasT and len(pu) >= 2, f'břevno T {"ano" if hasT else "ne"}, světlé vrcholy u = {pu}')
    return res

for g in GS:
    res = evaluate(g); ok = sum(1 for v, _ in res.values() if v)
    print(f'== {g.upper()} · {ok}/{len(res)}')
    for k, (v, t) in res.items(): print(f"{'ANO' if v else 'NE '}  {k:<3}  {t}")
