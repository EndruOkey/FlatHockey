"""Deterministický průchod CSS v public/index.html (hlavní <style>):
 1) font-size < 12 px (rem*16) → 12 px (0.75rem)
 2) color: s kontrastem < 4.5:1 proti pozadí #0d0f14 → zesvětlit (rgba: zvýšit alfu, pak míchat s bílou)
    Výjimka: INK = tmavý text na světlých tlačítkách (ověřeno výpisem barev s luminancí < 0.05), nechat.
Spuštění: python scripts/ux_css_pass.py  (idempotentní)"""
import re
F='public/index.html'; s=open(F,encoding='utf8').read()
a=s.index('<style>', s.index('<style>')+1); b=s.index('</style>', a)
css=s[a:b]; BG=(13,15,20)
INK={'#00277f','#0a0f28','#0a0e1f','#0e1016','#222222'}
def lum(c):
    f=lambda v:(v/255)/12.92 if v/255<=0.03928 else ((v/255+0.055)/1.055)**2.4
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
def cr(c): l1,l2=lum(c),lum(BG); return (max(l1,l2)+0.05)/(min(l1,l2)+0.05)
def blend(c,a): return tuple(round(c[i]*a+BG[i]*(1-a)) for i in range(3))
nf=nc=0
def fs(m):
    global nf
    v,u=float(m.group(1)),m.group(2); px=v*16 if u=='rem' else v
    if px<12-1e-6: nf+=1; return 'font-size: 0.75rem'
    return m.group(0)
css=re.sub(r'font-size:\s*([\d.]+)(rem|px)',fs,css)
def col(m):
    global nc
    pre,val=m.group(1),m.group(2).strip()
    h=re.fullmatch(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})',val)
    r=re.fullmatch(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)',val)
    if h:
        x=h.group(1); x=''.join(ch*2 for ch in x) if len(x)==3 else x
        c=tuple(int(x[i:i+2],16) for i in (0,2,4)); al=1.0
    elif r: c=tuple(int(r.group(i)) for i in (1,2,3)); al=float(r.group(4) or 1)
    else: return m.group(0)
    if '#%02x%02x%02x'%c in INK or cr(blend(c,al))>=4.5: return m.group(0)
    while al<1 and cr(blend(c,al))<4.5: al=round(min(1,al+0.05),2)
    while cr(blend(c,al))<4.5: c=tuple(min(255,round(v+(255-v)*0.08)) for v in c)
    nc+=1
    return f"{pre}rgba({c[0]},{c[1]},{c[2]},{al})" if al<1 else f"{pre}#{c[0]:02x}{c[1]:02x}{c[2]:02x}"
css=re.sub(r'((?<![-\w])color:\s*)([^;}\n!]+?)(?=\s*[;}!\n])',col,css)
s=s[:a]+css+s[b:]; open(F,'w',encoding='utf8').write(s)
print(f'písmo zvětšeno: {nf} pravidel, barva zesvětlena: {nc} pravidel')
