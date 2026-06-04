import { PLAYER, PUCK } from './constants.js';

const _snap = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'number'));
const _fmt  = (v, step) => step < 1 ? v.toFixed(2) : String(Math.round(v));

const DEFAULTS = { PLAYER: _snap(PLAYER), PUCK: _snap(PUCK) };

const GROUPS = [
  {
    label: 'Hráč',
    obj: PLAYER,
    rows: [
      { key: 'speed',        label: 'Rychlost',       min: 50,  max: 800,  step: 10   },
      { key: 'accel',        label: 'Zrychlení',      min: 100, max: 3000, step: 50   },
      { key: 'decel',        label: 'Brzdění',        min: 5,   max: 500,  step: 5    },
      { key: 'stickLen',     label: 'Délka hole',     min: 20,  max: 120,  step: 1    },
      { key: 'turnRate',     label: 'Zatáčení',        min: 0.5, max: 8,    step: 0.1  },
      { key: 'pickupRadius', label: 'Dosah pickup',   min: 20,  max: 150,  step: 1    },
    ],
  },
  {
    label: 'Puk',
    obj: PUCK,
    rows: [
      { key: 'decel',        label: 'Brzdění',        min: 0,   max: 400,  step: 5    },
      { key: 'bounce',       label: 'Odraz',          min: 0,   max: 1,    step: 0.01 },
      { key: 'maxShotSpeed', label: 'Max střela',     min: 200, max: 2000, step: 10   },
      { key: 'minShotSpeed', label: 'Min střela',     min: 50,  max: 800,  step: 10   },
      { key: 'passSpeed',    label: 'Pas',            min: 100, max: 1000, step: 10   },
    ],
  },
];

export class Tweaker {
  constructor() {
    this._visible = false;
    this._rows = []; // { slider, val, obj, key, step }
    _injectStyles();
    this._hint = this._makeHint();
    this._panel = this._build();
    document.body.append(this._hint, this._panel);
    document.addEventListener('keydown', e => {
      if (e.code === 'Tab') { e.preventDefault(); this.toggle(); }
    });
  }

  toggle() {
    this._visible = !this._visible;
    this._panel.classList.toggle('open', this._visible);
    this._hint.style.color = this._visible ? '#444' : '#252836';
  }

  _makeHint() {
    const el = document.createElement('div');
    el.id = 'tw-hint';
    el.textContent = 'Tab — tweaker';
    return el;
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'tweaker';

    for (const { label, obj, rows } of GROUPS) {
      const h2 = document.createElement('h2');
      h2.textContent = label;
      panel.appendChild(h2);
      for (const row of rows) panel.appendChild(this._makeRow(obj, row));
    }

    const btns = document.createElement('div');
    btns.className = 'tw-btns';
    btns.append(this._resetBtn(), this._copyBtn());
    panel.appendChild(btns);
    return panel;
  }

  _makeRow(obj, { key, label, min, max, step }) {
    const row = document.createElement('div');
    row.className = 'tw-row';

    const lbl = document.createElement('span');
    lbl.className = 'tw-label';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'tw-slider';
    Object.assign(slider, { min, max, step, value: obj[key] });

    const val = document.createElement('span');
    val.className = 'tw-val';
    val.textContent = _fmt(obj[key], step);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      obj[key] = v;
      val.textContent = _fmt(v, step);
    });

    this._rows.push({ slider, val, obj, key, step });
    row.append(lbl, slider, val);
    return row;
  }

  _resetBtn() {
    const btn = document.createElement('button');
    btn.className = 'tw-btn';
    btn.textContent = 'Reset výchozí';
    btn.addEventListener('click', () => {
      for (const { slider, val, obj, key, step } of this._rows) {
        const group   = obj === PLAYER ? 'PLAYER' : 'PUCK';
        const def     = DEFAULTS[group][key];
        if (def === undefined) continue;
        obj[key]      = def;
        slider.value  = def;
        val.textContent = _fmt(def, step);
      }
    });
    return btn;
  }

  _copyBtn() {
    const btn = document.createElement('button');
    btn.className = 'tw-btn';
    btn.textContent = 'Kopírovat JSON';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(
        JSON.stringify({ PLAYER: _snap(PLAYER), PUCK: _snap(PUCK) }, null, 2)
      );
      btn.textContent = '✓ Zkopírováno';
      setTimeout(() => { btn.textContent = 'Kopírovat JSON'; }, 1600);
    });
    return btn;
  }
}

function _injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #tweaker {
      position: fixed; top: 0; right: 0;
      width: 268px; height: 100%;
      background: rgba(8, 10, 18, 0.96);
      border-left: 1px solid #1a1e2c;
      backdrop-filter: blur(10px);
      overflow-y: auto;
      padding: 22px 18px 32px;
      z-index: 100;
      transform: translateX(100%);
      transition: transform 0.22s cubic-bezier(.4,0,.2,1);
      scrollbar-width: thin;
      scrollbar-color: #1e2230 transparent;
    }
    #tweaker.open { transform: translateX(0); }

    #tweaker h2 {
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #3a9fff; font-size: 10px;
      letter-spacing: 0.2em; text-transform: uppercase;
      margin: 22px 0 13px; padding-bottom: 8px;
      border-bottom: 1px solid #1a1e2c;
    }
    #tweaker h2:first-child { margin-top: 0; }

    .tw-row {
      display: flex; align-items: center;
      gap: 8px; margin-bottom: 11px;
    }
    .tw-label {
      flex: 0 0 98px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #666; font-size: 11px;
    }
    .tw-slider {
      flex: 1; -webkit-appearance: none; appearance: none;
      height: 3px; background: #1e2230; border-radius: 2px;
      outline: none; cursor: pointer;
    }
    .tw-slider::-webkit-slider-thumb {
      -webkit-appearance: none; width: 13px; height: 13px;
      border-radius: 50%; background: #3a9fff; cursor: pointer;
      transition: background 0.12s, transform 0.12s;
    }
    .tw-slider:hover::-webkit-slider-thumb {
      background: #6fb8ff; transform: scale(1.15);
    }
    .tw-val {
      flex: 0 0 42px; text-align: right;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #ddd; font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .tw-btns { display: flex; gap: 8px; margin-top: 24px; }
    .tw-btn {
      flex: 1; padding: 9px 0;
      background: #0d1018; border: 1px solid #222536;
      border-radius: 7px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #777; font-size: 11px; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .tw-btn:hover { border-color: #3a9fff; color: #ccc; }

    #tw-hint {
      position: fixed; right: 16px; bottom: 14px;
      color: #252836; font-size: 11px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      pointer-events: none; z-index: 99;
      transition: color 0.2s;
      user-select: none;
    }
  `;
  document.head.appendChild(s);
}
