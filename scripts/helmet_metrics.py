# HELMA — deterministické měření vzhledu hlavy shora (2026-11-17). Skutečný renderer (Player.draw) v Chromiu, stejné id hráče
# napříč variantami (jinak se liší póza). Hlava = pixely, které se změní, když se hlava nekreslí (globalThis.__fhNoHead).
# Server: PORT=5850 DB_PATH=$TEMP/hl.db node server.js   →   python scripts/helmet_metrics.py [výstupní složka] [port]
# Maska hlavy = kresba s globalThis.__fhHeadMask (skořepina+obrys fialově). Měří pro VIS.h ∈ {1 (dnes), 3, 4, 5, 6}: podíl plochy hlavy, kontrast WCAG hlava↔okolí (dres) a hlava↔led, směr hlavy
# (posun předních prvků ve směru pohledu, rozdíl jasu přední/zadní třetiny), obrys, odlišnost typů (kšilt/mřížka/bez) + kontrola 0.
# Výstup: tabulka na stdout, helmet_metrics.json, kontaktní archy sheet_h*_s1.png (1:1), *_s1x2.png (2× nejbližší soused), *_s4.png.
import sys, json, os, base64, io
from playwright.sync_api import sync_playwright
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
PORT = sys.argv[2] if len(sys.argv) > 2 else '5850'
os.makedirs(OUT, exist_ok=True)
VARS = [1, 3, 4, 5, 6]
KITS = [  # (název, dres, helma nebo None = v barvě dresu)
    ('světlý dres, helma = dres', '#f4f7fb', None),
    ('světlý dres, tmavá helma', '#f4f7fb', '#1b2a4a'),
    ('červený dres, helma = dres', '#c8102e', None),
    ('červený dres, bílá helma', '#c8102e', '#f4f7fb'),
]
JS = r"""async ([VARS, KITS, ICE]) => {
  const { Player } = await import('/js/entities/Player.js'); const { PLAYER } = await import('/js/constants.js'); const { VIS } = await import('/js/vis.js');
  const mk = (id, kit, type) => { const p = new Player(id, 'home', null); p._dispReach = PLAYER.stickLen; p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false;
    p.handed = 1; p.name = ''; p.num = 17; p.color = kit[1]; if (kit[2]) p.helmet = kit[2]; p.helmetType = type; return p; };
  const render = (S, kit, type, hd, noHead, id, g, N, ox, oy, clear = true) => { const p = mk(id, kit, type);
    for (let f = 0; f < 20; f++) { g.fillStyle = ICE; if (clear === true) g.fillRect(0, 0, N, N); else g.fillRect(...clear); globalThis.__fhNoHead = noHead;
      p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = hd; p.vx = 0; p.vy = 0; p.aimAngle = p.carryAngle = p._stickDisp = hd;
      p.draw(g, { scale: S, ox: (ox ?? N / 2) - 500 * S, oy: (oy ?? N / 2) - 200 * S, dt: 1 / 60 }); }
    globalThis.__fhNoHead = false; };
  const grab = (S, kit, type, hd, noHead, id) => { const N = Math.ceil(60 * S), c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true }); render(S, kit, type, hd, noHead, id, g, N); return { d: g.getImageData(0, 0, N, N).data, N }; };
  const L = (r, g, b) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const wc = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const ice = [parseInt(ICE.slice(1, 3), 16), parseInt(ICE.slice(3, 5), 16), parseInt(ICE.slice(5, 7), 16)];
  const res = {};
  for (const v of VARS) { VIS.h = v; res[v] = {};
    for (const S of [1.2, 4]) { const per = [];
      for (let ki = 0; ki < KITS.length; ki++) { const kit = KITS[ki]; const acc = { head: 0, player: 0, cJ: 0, cI: 0, off: 0, fb: 0, ol: 0, n: 0 };
        for (let di = 0; di < 8; di++) { const hd = di * Math.PI / 4, id = 'hm' + di;
          const A = grab(S, kit, 'visor', hd, false, id), B = grab(S, kit, 'visor', hd, true, id), N = A.N, a = A.d, b = B.d; globalThis.__fhHeadMask = true; const m = grab(S, kit, 'visor', hd, false, id).d; globalThis.__fhHeadMask = false;
          const head = new Uint8Array(N * N); let hn = 0, pn = 0, hxs = 0, hys = 0; const R = [], G = [], Bl = [];
          for (let i = 0, k = 0; k < a.length; i++, k += 4) { const dh = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
            if (Math.abs(a[k] - ice[0]) + Math.abs(a[k + 1] - ice[1]) + Math.abs(a[k + 2] - ice[2]) > 24) pn++;
            // maska = hlava kreslená fialově (skořepina + obrys, bez stínu H6, bez vystrčené mřížky/obličeje)
            if (m[k] > 200 && m[k + 2] > 200 && m[k + 1] < 60) { head[i] = 1; hn++; hxs += i % N; hys += (i / N) | 0; R.push(a[k]); G.push(a[k + 1]); Bl.push(a[k + 2]); } }
          const cx = hxs / hn, cy = hys / hn, ux = Math.cos(hd), uy = Math.sin(hd);
          // vnitřek hlavy (eroze o obrys) → barva skořepiny = medián zadní třetiny vnitřku (vzadu nikdy není kšilt/mřížka)
          const er = Math.ceil(S * 1.2), inner = new Uint8Array(N * N);
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; if (!head[i]) continue; let ok = true;
            for (let dy = -er; dy <= er && ok; dy++) for (let dx = -er; dx <= er; dx++) { if (dx * dx + dy * dy > er * er) continue; const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= N || xx >= N || !head[yy * N + xx]) { ok = false; break; } } inner[i] = ok; }
          let ext = 0; for (let i = 0; i < N * N; i++) if (head[i]) { const pr = (i % N - cx) * ux + (((i / N) | 0) - cy) * uy; ext = Math.max(ext, Math.abs(pr)); }
          const sr = [], sg = [], sb = []; for (let i = 0; i < N * N; i++) if (inner[i]) { const pr = (i % N - cx) * ux + (((i / N) | 0) - cy) * uy; if (pr < -ext / 4) { const k = i * 4; sr.push(a[k]); sg.push(a[k + 1]); sb.push(a[k + 2]); } }
          const bins = new Map(); for (let j = 0; j < sr.length; j++) { const key = (sr[j] >> 4) * 256 + (sg[j] >> 4) * 16 + (sb[j] >> 4); const e = bins.get(key) || [0, 0, 0, 0]; e[0]++; e[1] += sr[j]; e[2] += sg[j]; e[3] += sb[j]; bins.set(key, e); }
          let best = [1, 0, 0, 0]; for (const e of bins.values()) if (e[0] > best[0] || best[0] === 1 && e[0] >= 1) best = e;   // nejčastější barva (koš 16 úrovní) = skořepina
          const mr = best[1] / best[0], mg = best[2] / best[0], mb = best[3] / best[0], hL = L(mr, mg, mb);
          // okolí hlavy: pixely hráče 1–3 px vně masky hlavy (= ramena, dres), bez ledu
          const rr = [], rg = [], rb = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; if (head[i]) continue; let near = false;
            for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < N && xx >= 0 && xx < N && head[yy * N + xx]) { near = true; break; } }
            if (!near) continue; const k = i * 4; if (Math.abs(a[k] - ice[0]) + Math.abs(a[k + 1] - ice[1]) + Math.abs(a[k + 2] - ice[2]) <= 24) continue; rr.push(a[k]); rg.push(a[k + 1]); rb.push(a[k + 2]); }
          const ringL = L(med(rr), med(rg), med(rb));
          // směr 1: přední prvky = pixely vnitřku jiné než skořepina (> 60); posun jejich těžiště od středu hlavy ve směru pohledu (px)
          // směr 2: asymetrie vpředu/vzadu = průměrný rozdíl RGB pixelu hlavy a jeho zrcadla přes osu kolmou na pohled (0 = zepředu i zezadu stejné)
          let fx = 0, fy = 0, fn = 0, asy = 0, an = 0;
          for (let i = 0; i < N * N; i++) if (head[i]) { const x = i % N, y = (i / N) | 0, k = i * 4;
            if (inner[i] && Math.abs(a[k] - mr) + Math.abs(a[k + 1] - mg) + Math.abs(a[k + 2] - mb) > 60) { fx += x; fy += y; fn++; }
            const pr = (x - cx) * ux + (y - cy) * uy, mx = Math.round(x - 2 * pr * ux), my = Math.round(y - 2 * pr * uy);
            if (mx >= 0 && my >= 0 && mx < N && my < N) { const q = (my * N + mx) * 4; asy += (Math.abs(a[k] - a[q]) + Math.abs(a[k + 1] - a[q + 1]) + Math.abs(a[k + 2] - a[q + 2])) / 3; an++; } }
          const off = fn ? ((fx / fn - cx) * ux + (fy / fn - cy) * uy) : 0, ol = asy / Math.max(1, an), fr = fn / hn;
          acc.head += hn; acc.player += pn; acc.cJ += wc(hL, ringL); acc.cI += wc(hL, L(...ice)); acc.off += off; acc.fb += fr; acc.ol += ol; acc.n++; }
        const n = acc.n; per.push({ kit: kit[0], headPx: acc.head / n, share: 100 * acc.head / acc.player, cJ: acc.cJ / n, cI: acc.cI / n, off: acc.off / n, fb: acc.fb / n, ol: acc.ol / n }); }
      // odlišnost typů (kit 0 i 3), + kontrola: stejný typ znovu = 0
      const types = ['visor', 'cage', 'none'], dist = {};
      const pairs = [['visor', 'cage'], ['visor', 'none'], ['cage', 'none'], ['visor', 'visor']];
      for (const [t1, t2] of pairs) { let n = 0; for (const ki of [0, 3]) for (let di = 0; di < 8; di++) { const hd = di * Math.PI / 4;
          const A = grab(S, KITS[ki], t1, hd, false, 'ht' + di).d, B = grab(S, KITS[ki], t2, hd, false, 'ht' + di).d;
          for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 90) n++; }
        dist[t1 + '–' + t2] = n / 16; }
      res[v][S] = { kits: per, types: dist }; } }
  VIS.h = 1;
  // KONTAKTNÍ ARCHY: řádky = 4 kity (kšilt) + řádek typů (kšilt/mřížka/bez, červený dres s bílou helmou); sloupce = 3 směry
  const sheets = {}, HDS = [0, 3 * Math.PI / 4, 3 * Math.PI / 2];
  for (const v of VARS) { VIS.h = v; sheets[v] = {};
    for (const S of [1.2, 4]) { const cell = Math.ceil(46 * S), rows = 5, cols = 3, c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * cell;
      const g = c.getContext('2d'); g.fillStyle = ICE; g.fillRect(0, 0, c.width, c.height);
      for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) { const kit = r < 4 ? KITS[r] : KITS[3], type = r < 4 ? 'visor' : ['visor', 'cage', 'none'][col], hd = r < 4 ? HDS[col] : HDS[1];
        g.save(); g.beginPath(); g.rect(col * cell, r * cell, cell, cell); g.clip(); render(S, kit, type, hd, false, 'sh' + col, g, 0, col * cell + cell / 2, r * cell + cell / 2, [col * cell, r * cell, cell, cell]); g.restore(); }
      sheets[v][S] = c.toDataURL('image/png'); } }
  VIS.h = 1;
  // kontrola determinismu: stejný vstup dvakrát = 0 rozdílných pixelů
  const A = grab(1.2, KITS[3], 'visor', 1, false, 'ctl').d, B = grab(1.2, KITS[3], 'visor', 1, false, 'ctl').d; let ctl = 0; for (let k = 0; k < A.length; k++) if (A[k] !== B[k]) ctl++;
  return { res, sheets, ctl }; }"""

with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(); pg.goto(f'http://localhost:{PORT}/?fhtest'); pg.wait_for_timeout(800)
    out = pg.evaluate(JS, [VARS, KITS, '#dfeaf3']); b.close()

NAME = {1: 'H1 dnes', 3: 'H3 plochá ikona', 4: 'H4 skořepina', 5: 'H5 týmový pruh', 6: 'H6 hloubka'}
print(f"kontrola determinismu (stejný vstup 2×): {out['ctl']} rozdílných hodnot")
for S in ('1.2', '4'):
    print(f"\n== měřítko {S} ==")
    print(f"{'varianta':18} {'kit':28} {'hlava px':>8} {'podíl %':>7} {'K dres':>6} {'K led':>6} {'posun px':>8} {'prvky %':>7} {'asym p/z':>8}")
    for v in VARS:
        for k in out['res'][str(v)][S]['kits']:
            print(f"{NAME[v]:18} {k['kit']:28} {k['headPx']:8.1f} {k['share']:7.1f} {k['cJ']:6.2f} {k['cI']:6.2f} {k['off']:8.2f} {100*k['fb']:7.1f} {k['ol']:8.1f}")
    print(f"{'odlišnost typů (px, průměr 8 směrů × 2 kity)':50}")
    for v in VARS: print(f"  {NAME[v]:18} " + '  '.join(f"{p} {n:6.1f}" for p, n in out['res'][str(v)][S]['types'].items()))
json.dump({'res': out['res'], 'ctl': out['ctl']}, open(os.path.join(OUT, 'helmet_metrics.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for v, d in out['sheets'].items():
    for S, url in d.items():
        im = Image.open(io.BytesIO(base64.b64decode(url.split(',')[1])))
        tag = 's1' if S == '1.2' else 's4'
        im.save(os.path.join(OUT, f'sheet_h{v}_{tag}.png'))
        if tag == 's1': im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(os.path.join(OUT, f'sheet_h{v}_s1x2.png'))
print('archy →', OUT)
