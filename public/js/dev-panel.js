// Dev playground panel (jen /dev pod heslem): přepínání pokusů za běhu. Volby se pamatují v prohlížeči.
import { VIS, setVis } from './vis.js';
const ROWS = [
  { key: 'ctrl', label: 'Ovládání', opts: [['A', 'WASD'], ['R1', 'Zaoblené WASD'], ['B2', 'Za kurzorem']] },
  { key: 'g', label: 'Branka', opts: [[5, 'Shora, přesně (kolize)'], [8, 'G8 skutečný tvar (náhled)'], [6, 'G6 čistá'], [7, 'G7 výrazná'], [3, 'Shora s hloubkou'], [4, 'Shora, větší hloubka'], [1, 'Půdorys'], [0, 'Šikmý 3D'], [2, 'Nízký náklon']] },
  { key: 'p', label: 'Výška puku', opts: [[1, 'Shora (jako branka)'], [0, 'Šikmo nahoru (dřív)']] },
  { key: 'h', label: 'Hlava', opts: [[1, 'Oddělená helma'], [0, 'V barvě dresu'], [2, 'Světlá helma']] },
  { key: 's', label: 'Hokejka', opts: [[3, 'Dnešní štíhlejší'], [0, 'Dnešní (původní)'], [1, 'Štíhlá'], [2, 'Lopatka']] },
  { key: 'k', label: 'Bruslení', opts: [[3, 'Plynulý krok (nový)'], [0, 'Dřívější'], [1, 'Krok do stran'], [2, 'Velký odraz']] },
];
const css = `#fh-dev{position:fixed;left:12px;bottom:12px;z-index:9998;background:rgba(10,20,35,.94);color:#eef4fb;border:2px solid #4cc3ff;
border-radius:8px;font:600 13px/1.3 system-ui,sans-serif;padding:8px 10px;max-width:calc(100vw - 24px);box-sizing:border-box}
#fh-dev summary{cursor:pointer;color:#4cc3ff;font-weight:800;letter-spacing:.04em}
#fh-dev .r{display:grid;grid-template-columns:96px auto;gap:6px;align-items:center;margin-top:6px}
#fh-dev select{background:#0b1424;color:#fff;border:1px solid #3a5476;border-radius:4px;padding:3px 4px;font:inherit}
#fh-dev form{margin:8px 0 0}#fh-dev button{background:none;border:1px solid #3a5476;color:#a9bdd6;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit}`;
function build() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const d = document.createElement('details'); d.id = 'fh-dev'; d.open = true;
  d.innerHTML = '<summary>DEV PLAYGROUND</summary>';
  let ctrl = 'A'; try { ctrl = localStorage.getItem('fh_ctrl') || 'A'; } catch {}
  for (const r of ROWS) {
    const row = document.createElement('label'); row.className = 'r';
    const sel = document.createElement('select'); sel.dataset.k = r.key;
    for (const [v, t] of r.opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = r.key === 'ctrl' ? ctrl : VIS[r.key];
    sel.addEventListener('change', () => {
      if (r.key === 'ctrl') { try { localStorage.setItem('fh_ctrl', sel.value); } catch {} window.dispatchEvent(new CustomEvent('fh-ctrl', { detail: sel.value })); }
      else setVis(r.key, +sel.value);
      sel.blur();   // ať klávesy dál jdou do hry
    });
    row.append(r.label, sel); d.appendChild(row);
  }
  const f = document.createElement('form'); f.method = 'post'; f.action = '/dev/logout'; f.innerHTML = '<button type="submit">Odhlásit</button>'; d.appendChild(f);
  document.body.appendChild(d);
  window.addEventListener('fh-ctrl-shown', e => { const s = d.querySelector('select[data-k="ctrl"]'); if (s) s.value = e.detail; });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
